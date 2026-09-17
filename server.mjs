import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const SESSION_COOKIE = 'quality_dashboard_session';
const SESSION_TTL_MS = 60 * 60 * 1000;
const sessions = new Map();
const connectionAttempts = new Map();
const zephyrRegions = {
  US: 'https://api.zephyrscale.smartbear.com/v2',
  EU: 'https://eu.api.zephyrscale.smartbear.com/v2',
  AU: 'https://au.api.zephyrscale.smartbear.com/v2',
  DE: 'https://de.api.zephyrscale.smartbear.com/v2'
};
const piFieldId = () => process.env.JIRA_PI_FIELD_ID || 'customfield_10074';
const sprintFieldId = () => process.env.JIRA_SPRINT_FIELD_ID || 'customfield_10075';

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id);
  for (const [key, attempts] of connectionAttempts) {
    const recent = attempts.filter(time => now - time < 10 * 60 * 1000);
    if (recent.length) connectionAttempts.set(key, recent);
    else connectionAttempts.delete(key);
  }
}, 5 * 60 * 1000).unref();

function parseEnv() {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;
  return readFile(envPath, 'utf8').then(text => {
    for (const line of text.split(/\r?\n/)) {
      const entry = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (entry && !process.env[entry[1]]) process.env[entry[1]] = entry[2].replace(/^['"]|['"]$/g, '');
    }
  });
}

function normalizedJiraUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw new Error('Enter a valid Jira Cloud URL.'); }
  if (url.protocol !== 'https:' || !url.hostname.toLowerCase().endsWith('.atlassian.net')) {
    throw new Error('Use an HTTPS Jira Cloud URL ending in .atlassian.net.');
  }
  return url.origin;
}

function jiraHeaders(credentials) {
  const auth = Buffer.from(`${credentials.jiraEmail}:${credentials.jiraApiToken}`).toString('base64');
  return { Authorization: `Basic ${auth}`, Accept: 'application/json' };
}

function cookieValue(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

function sessionCookie(req, id, maxAge = 3600) {
  const secure = req.headers['x-forwarded-proto'] === 'https';
  return `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function activeSession(req) {
  const id = cookieValue(req, SESSION_COOKIE);
  const session = id ? sessions.get(id) : null;
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }
  return { id, ...session };
}

function allowConnectionAttempt(req) {
  const key = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (connectionAttempts.get(key) || []).filter(time => now - time < 10 * 60 * 1000);
  if (recent.length >= 10) return false;
  recent.push(now);
  connectionAttempts.set(key, recent);
  return true;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32 * 1024) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new Error('Invalid request.'); }
}

async function fetchJiraSpaces(credentials) {
  const spaces = [];
  let startAt = 0;
  while (true) {
    const url = new URL('/rest/api/3/project/search', credentials.jiraBaseUrl);
    url.searchParams.set('startAt', String(startAt));
    url.searchParams.set('maxResults', '100');
    let response;
    try {
      response = await fetch(url, { headers: jiraHeaders(credentials), redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch {
      throw new Error('Could not reach that Jira Cloud site. Check the URL and try again.');
    }
    if (!response.ok) throw new Error('Jira connection failed. Check the email, API token, and Browse Projects permission.');
    const payload = await response.json();
    const page = Array.isArray(payload.values) ? payload.values : [];
    spaces.push(...page.map(project => ({ key: String(project.key || '').toUpperCase(), name: String(project.name || project.key || '').trim() })).filter(project => project.key));
    startAt += page.length;
    if (payload.isLast === true || page.length === 0 || startAt >= Number(payload.total || 0)) break;
  }
  if (!spaces.length) throw new Error('Jira connected, but no accessible spaces were found.');
  return spaces;
}

async function validateZephyr(credentials, projectKey) {
  const url = new URL(`${credentials.zephyrApiBaseUrl}/testcases`);
  url.searchParams.set('projectKey', projectKey);
  url.searchParams.set('maxResults', '1');
  url.searchParams.set('startAt', '0');
  let response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${credentials.zephyrApiToken}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error('Could not reach Zephyr Cloud in the selected region.');
  }
  if (!response.ok) throw new Error('Zephyr connection failed. Check the region, API token, and project permissions.');
}

function number(value) { return Number.isFinite(value) ? value : 0; }

function isDoneStatus(value = '') { return /done|closed|resolved/i.test(value); }
function isActiveStatus(value = '') { return /progress|review/i.test(value); }

function statusBreakdown(items, workflowStatuses = []) {
  const statuses = workflowStatuses.map(status => ({ ...status }));
  const known = new Set(statuses.map(status => status.name.toLowerCase()));
  for (const issue of items) {
    const name = issue.status || 'Unknown';
    if (!known.has(name.toLowerCase())) {
      statuses.push({ name, category: 'unknown' });
      known.add(name.toLowerCase());
    }
  }
  return statuses.map(status => ({
    ...status,
    count: items.filter(issue => issue.status.toLowerCase() === status.name.toLowerCase()).length
  }));
}

function deliveryMetrics(items, workflowStatuses = []) {
  const counts = { todo: 0, inProgress: 0, done: 0 };
  for (const issue of items) {
    if (isDoneStatus(issue.status)) counts.done += 1;
    else if (isActiveStatus(issue.status)) counts.inProgress += 1;
    else counts.todo += 1;
  }
  const total = items.length;
  return {
    total,
    ...counts,
    completion: total ? Math.round((counts.done / total) * 100) : 0,
    points: items.reduce((sum, item) => sum + number(item.points), 0),
    statuses: statusBreakdown(items, workflowStatuses)
  };
}

function optionValues(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map(option => typeof option === 'string' ? option : option?.value).filter(Boolean);
}

function numberFrom(value, pattern) {
  const match = String(value || '').match(pattern);
  return match ? Number(match[1]) : null;
}

function buildProgramAnalytics(workItems, workflowStatuses) {
  const primaryPi = issue => numberFrom(issue.pis?.[0], /PI\s*-?\s*(\d+)/i);
  const primarySprint = issue => numberFrom(issue.sprints?.[0], /Sprint\s*-?\s*(\d+)/i);
  const sprintPi = issue => numberFrom(issue.sprints?.[0], /PI\s*-?\s*(\d+)/i);
  const pis = Array.from({ length: 4 }, (_, piIndex) => {
    const number = piIndex + 1;
    const items = workItems.filter(issue => primaryPi(issue) === number);
    const sprints = Array.from({ length: 6 }, (_, sprintIndex) => {
      const sprintNumber = sprintIndex + 1;
      const sprintItems = items.filter(issue => primarySprint(issue) === sprintNumber && sprintPi(issue) === number);
      return {
        number: sprintNumber,
        name: `PI ${number} · Sprint ${sprintNumber}`,
        jiraValue: `PI - ${number} Sprint - ${sprintNumber}`,
        metrics: deliveryMetrics(sprintItems, workflowStatuses),
        issues: sprintItems
      };
    });
    return {
      number,
      name: `PI ${number}`,
      jiraValue: `PI - ${number}`,
      metrics: deliveryMetrics(items, workflowStatuses),
      sprints
    };
  });
  const warnings = {
    missingPi: workItems.filter(issue => !issue.pis?.length).length,
    missingSprint: workItems.filter(issue => !issue.sprints?.length).length,
    multiplePi: workItems.filter(issue => issue.pis?.length > 1).length,
    multipleSprint: workItems.filter(issue => issue.sprints?.length > 1).length,
    mismatchedSprint: workItems.filter(issue => primaryPi(issue) && sprintPi(issue) && primaryPi(issue) !== sprintPi(issue)).length
  };
  return {
    totalPis: 4,
    sprintsPerPi: 6,
    pis,
    unassigned: deliveryMetrics(workItems.filter(issue => !primaryPi(issue)), workflowStatuses),
    warnings
  };
}

function pendingZephyrQuality(status = 'Awaiting live Zephyr sync', spaceKey = 'DD') {
  const hasSnapshot = spaceKey === 'DD';
  return {
    live: false,
    testCases: hasSnapshot ? 8 : 0,
    testCycles: hasSnapshot ? 1 : 0,
    testPlans: 0,
    executions: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    notExecuted: 0,
    passRate: null,
    status,
    source: hasSnapshot ? 'zephyr-demo-import.csv' : `No ${spaceKey} Zephyr snapshot`,
    cycles: [],
    plans: []
  };
}

function buildDashboard(issues, space, live, notice, quality = pendingZephyrQuality('Awaiting live Zephyr sync', space.key), spaces = [], workflowStatuses = [], jiraBaseUrl = null) {
  const isEpic = item => /epic/i.test(item.type);
  const workItems = issues.filter(item => !isEpic(item));
  const epics = new Map();
  const byKey = new Map(issues.map(item => [item.key, item]));
  for (const issue of issues.filter(isEpic)) epics.set(issue.key, { ...issue, children: [] });
  if (!epics.size && issues.length) epics.set(`${space.key}-1`, { key: `${space.key}-1`, summary: 'Epic 1', type: 'Epic', status: 'In Progress', children: [] });
  function parentEpic(issue) {
    const visited = new Set([issue.key]);
    let current = issue;
    while (current.parent && !visited.has(current.parent)) {
      visited.add(current.parent);
      current = byKey.get(current.parent) || {};
      if (isEpic(current)) return current.key;
    }
    return null;
  }
  for (const issue of workItems) {
    let epic = epics.get(parentEpic(issue));
    if (!epic) {
      if (!epics.has('UNASSIGNED')) epics.set('UNASSIGNED', { key: 'UNASSIGNED', summary: 'Unassigned work', type: 'Group', status: '', children: [] });
      epic = epics.get('UNASSIGNED');
    }
    epic.children.push(issue);
  }
  const sortedEpics = [...epics.values()].map(epic => ({
    ...epic,
    children: epic.children.sort((a, b) => a.key.localeCompare(b.key)),
    done: epic.children.filter(item => isDoneStatus(item.status)).length
  })).sort((a, b) => a.key === 'UNASSIGNED' ? 1 : b.key === 'UNASSIGNED' ? -1 : a.key.localeCompare(b.key));
  const availableSpaces = spaces.length ? spaces : [{ key: space.key, name: space.name || space.key }];
  return {
    space: {
      key: space.key,
      name: space.name || space.key,
      jiraBrowseUrl: jiraBaseUrl ? `${jiraBaseUrl.replace(/\/$/, '')}/browse` : null
    },
    spaces: availableSpaces,
    program: buildProgramAnalytics(workItems, workflowStatuses),
    statuses: workflowStatuses,
    connection: { jira: live ? 'Live Jira Cloud' : 'Snapshot mode', zephyr: quality.live ? 'Live Zephyr Cloud' : 'Zephyr sync unavailable', updatedAt: new Date().toISOString(), notice },
    metrics: deliveryMetrics(workItems, workflowStatuses),
    epics: sortedEpics,
    quality
  };
}

async function fetchJiraIssues(spaceKey, credentials) {
  const JIRA_BASE_URL = credentials.jiraBaseUrl;
  const headers = jiraHeaders(credentials);
  const fields = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'parent', 'subtasks', 'created', 'updated', 'duedate', 'customfield_10016', 'customfield_10020', piFieldId(), sprintFieldId()];
  const rawIssues = [];
  const seenPageTokens = new Set();
  let nextPageToken;
  while (true) {
    const url = new URL('/rest/api/3/search/jql', JIRA_BASE_URL);
    url.searchParams.set('jql', `project = ${spaceKey} ORDER BY parent ASC, created ASC`);
    url.searchParams.set('fields', fields.join(','));
    url.searchParams.set('maxResults', '100');
    if (nextPageToken) url.searchParams.set('nextPageToken', nextPageToken);
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Jira returned ${response.status}. Check the site URL, email, token, and Browse Projects permission.`);
    const payload = await response.json();
    rawIssues.push(...(payload.issues || payload.values || []));
    if (!payload.nextPageToken || seenPageTokens.has(payload.nextPageToken)) break;
    seenPageTokens.add(payload.nextPageToken);
    nextPageToken = payload.nextPageToken;
  }
  const issues = rawIssues.map(({ key, fields: item }) => ({
    key,
    summary: item.summary || key,
    type: item.issuetype?.name || 'Story',
    status: item.status?.name || 'To Do',
    priority: item.priority?.name || 'None',
    assignee: item.assignee?.displayName || 'Unassigned',
    parent: item.parent?.key || null,
    points: typeof item.customfield_10016 === 'number' ? item.customfield_10016 : null,
    pis: optionValues(item[piFieldId()]),
    sprints: optionValues(item[sprintFieldId()]),
    updated: item.updated
  }));
  let statuses = [...new Set(issues.map(issue => issue.status))].map(name => ({ name, category: 'unknown' }));
  try {
    const statusUrl = new URL(`/rest/api/3/project/${encodeURIComponent(spaceKey)}/statuses`, JIRA_BASE_URL);
    const statusResponse = await fetch(statusUrl, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (statusResponse.ok) {
      const groups = await statusResponse.json();
      const storyGroup = groups.find(group => /^story$/i.test(group.name));
      const sourceStatuses = storyGroup?.statuses || groups.flatMap(group => group.statuses || []);
      const unique = new Map();
      for (const status of sourceStatuses) {
        const name = String(status.name || '').trim();
        if (name && !unique.has(name.toLowerCase())) unique.set(name.toLowerCase(), { id: status.id, name, category: status.statusCategory?.key || 'unknown' });
      }
      const preferredOrder = new Map(['to do', 'in progress', 'done', 'cancelled', 'canceled', 'blocked'].map((name, index) => [name, index]));
      statuses = [...unique.values()].sort((a, b) => (preferredOrder.get(a.name.toLowerCase()) ?? 100) - (preferredOrder.get(b.name.toLowerCase()) ?? 100));
    }
  } catch {
    // Observed story statuses remain available if workflow metadata cannot be loaded.
  }
  let space = { key: spaceKey, name: spaceKey };
  try {
    const projectUrl = new URL(`/rest/api/3/project/${encodeURIComponent(spaceKey)}`, JIRA_BASE_URL);
    const projectResponse = await fetch(projectUrl, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (projectResponse.ok) {
      const project = await projectResponse.json();
      space = { key: project.key || spaceKey, name: String(project.name || spaceKey).trim() };
    }
  } catch {
    // The issue data is still valid if optional space metadata cannot be loaded.
  }
  return { issues, space, statuses, live: true, notice: `Live Jira and Zephyr data for ${spaceKey}.` };
}

function zephyrRegion(baseUrl) {
  const host = new URL(baseUrl).hostname;
  if (host.startsWith('eu.')) return 'EU';
  if (host.startsWith('au.')) return 'AU';
  if (host.startsWith('de.')) return 'DE';
  return 'US';
}

async function fetchZephyrCollection(resource, spaceKey, credentials) {
  const ZEPHYR_API_BASE_URL = credentials.zephyrApiBaseUrl;
  const ZEPHYR_API_TOKEN = credentials.zephyrApiToken;
  const values = [];
  let startAt = 0;
  const maxResults = 1000;
  while (true) {
    const url = new URL(`${ZEPHYR_API_BASE_URL.replace(/\/$/, '')}/${resource}`);
    url.searchParams.set('projectKey', spaceKey);
    url.searchParams.set('maxResults', String(maxResults));
    url.searchParams.set('startAt', String(startAt));
    const response = await fetch(url, { headers: { Authorization: `Bearer ${ZEPHYR_API_TOKEN}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Zephyr ${resource} returned ${response.status}. Check the regional API URL, token, and project permissions.`);
    const payload = await response.json();
    const page = Array.isArray(payload.values) ? payload.values : [];
    values.push(...page);
    if (payload.isLast !== false || page.length === 0) break;
    startAt += Number(payload.maxResults) || page.length;
  }
  return values;
}

async function fetchZephyrQuality(spaceKey, credentials) {
  const ZEPHYR_API_BASE_URL = credentials.zephyrApiBaseUrl;
  const [testCases, cycles, plans, executions, statuses] = await Promise.all([
    fetchZephyrCollection('testcases', spaceKey, credentials),
    fetchZephyrCollection('testcycles', spaceKey, credentials),
    fetchZephyrCollection('testplans', spaceKey, credentials),
    fetchZephyrCollection('testexecutions', spaceKey, credentials),
    fetchZephyrCollection('statuses', spaceKey, credentials)
  ]);
  const statusNames = new Map(statuses.map(status => [status.id, status.name]));
  const executionStatus = execution => statusNames.get(execution.testExecutionStatus?.id) || 'Unknown';
  const countStatus = name => executions.filter(execution => executionStatus(execution).toLowerCase() === name.toLowerCase()).length;
  const passed = countStatus('Pass');
  const failed = countStatus('Fail');
  const blocked = countStatus('Blocked');
  const notExecuted = countStatus('Not Executed');
  return {
    live: true,
    testCases: testCases.length,
    testCycles: cycles.length,
    testPlans: plans.length,
    executions: executions.length,
    passed,
    failed,
    blocked,
    notExecuted,
    passRate: executions.length ? Math.round((passed / executions.length) * 100) : 0,
    status: 'Live Zephyr Cloud sync',
    source: `Zephyr Cloud API (${zephyrRegion(ZEPHYR_API_BASE_URL)} region)`,
    cycles: cycles.map(cycle => ({ key: cycle.key, name: cycle.name, status: statusNames.get(cycle.status?.id) || 'Unknown' })),
    plans: plans.map(plan => ({ key: plan.key, name: plan.name, status: statusNames.get(plan.status?.id) || 'Unknown' }))
  };
}

async function fetchDashboard(spaceKey, session) {
  const [jira, zephyr] = await Promise.all([
    fetchJiraIssues(spaceKey, session.credentials),
    fetchZephyrQuality(spaceKey, session.credentials).catch(error => pendingZephyrQuality(error.message, spaceKey))
  ]);
  return buildDashboard(jira.issues, jira.space, jira.live, jira.notice, zephyr, session.spaces, jira.statuses, session.credentials.jiraBaseUrl);
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
function reply(res, code, body, type = 'application/json; charset=utf-8', headers = {}) { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers }); res.end(body); }

await parseEnv();
createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const path = requestUrl.pathname;
  if (path === '/api/health') {
    reply(res, 200, JSON.stringify({ status: 'ok' }));
    return;
  }
  if (path === '/api/connect' && req.method === 'POST') {
    if (!allowConnectionAttempt(req)) {
      reply(res, 429, JSON.stringify({ error: 'Too many connection attempts. Please wait a few minutes and try again.' }));
      return;
    }
    try {
      const body = await readJson(req);
      const region = String(body.zephyrRegion || '').toUpperCase();
      const credentials = {
        jiraBaseUrl: normalizedJiraUrl(body.jiraUrl),
        jiraEmail: String(body.jiraEmail || '').trim(),
        jiraApiToken: String(body.jiraApiToken || '').trim(),
        zephyrRegion: region,
        zephyrApiBaseUrl: zephyrRegions[region],
        zephyrApiToken: String(body.zephyrApiToken || '').trim()
      };
      if (!credentials.jiraEmail || !credentials.jiraApiToken) throw new Error('Enter your Jira email and API token.');
      if (!credentials.zephyrApiBaseUrl || !credentials.zephyrApiToken) throw new Error('Select a Zephyr region and enter its API token.');
      const spaces = await fetchJiraSpaces(credentials);
      await validateZephyr(credentials, spaces[0].key);
      const id = randomBytes(32).toString('hex');
      sessions.set(id, { credentials, spaces, expiresAt: Date.now() + SESSION_TTL_MS });
      reply(res, 200, JSON.stringify({ connected: true, spaces, expiresIn: 3600 }), undefined, { 'Set-Cookie': sessionCookie(req, id) });
    } catch (error) {
      reply(res, 400, JSON.stringify({ error: error.message || 'Connection failed.' }));
    }
    return;
  }
  if (path === '/api/disconnect' && req.method === 'POST') {
    const session = activeSession(req);
    if (session) sessions.delete(session.id);
    reply(res, 200, JSON.stringify({ disconnected: true }), undefined, { 'Set-Cookie': sessionCookie(req, '', 0) });
    return;
  }
  if (path === '/api/session') {
    const session = activeSession(req);
    if (!session) {
      reply(res, 401, JSON.stringify({ connected: false }));
      return;
    }
    reply(res, 200, JSON.stringify({ connected: true, spaces: session.spaces, expiresAt: session.expiresAt }));
    return;
  }
  if (path === '/api/spaces') {
    const session = activeSession(req);
    if (!session) return reply(res, 401, JSON.stringify({ error: 'Connect Jira and Zephyr to continue.', code: 'SESSION_REQUIRED' }));
    reply(res, 200, JSON.stringify({ spaces: session.spaces }));
    return;
  }
  if (path === '/api/dashboard') {
    const session = activeSession(req);
    if (!session) return reply(res, 401, JSON.stringify({ error: 'Your connection session has expired. Connect again to continue.', code: 'SESSION_REQUIRED' }), undefined, { 'Set-Cookie': sessionCookie(req, '', 0) });
    const spaceKeys = session.spaces.map(space => space.key);
    const requestedSpace = (requestUrl.searchParams.get('space') || spaceKeys[0]).trim().toUpperCase();
    if (!spaceKeys.includes(requestedSpace)) {
      reply(res, 400, JSON.stringify({ error: `Unknown Jira space: ${requestedSpace}`, spaces: spaceKeys.map(key => ({ key })) }));
      return;
    }
    try { reply(res, 200, JSON.stringify(await fetchDashboard(requestedSpace, session))); }
    catch (error) { reply(res, 502, JSON.stringify({ error: error.message || 'Dashboard data could not be loaded.' })); }
    return;
  }
  const requested = path === '/' ? '/index.html' : path;
  const file = normalize(join(root, 'public', requested));
  if (!file.startsWith(join(root, 'public'))) return reply(res, 403, 'Forbidden', 'text/plain');
  try { await stat(file); reply(res, 200, await readFile(file), mime[extname(file)] || 'application/octet-stream'); }
  catch {
    if (/^\/(connect|epics|quality|pis)(\/|$)/.test(path)) {
      reply(res, 200, await readFile(join(root, 'public', 'index.html')), mime['.html']);
      return;
    }
    reply(res, 404, 'Not found', 'text/plain');
  }
}).listen(port, '0.0.0.0', () => console.log(`Dashboard running on http://localhost:${port}`));
