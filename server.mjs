import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const piFieldId = () => process.env.JIRA_PI_FIELD_ID || 'customfield_10074';
const sprintFieldId = () => process.env.JIRA_SPRINT_FIELD_ID || 'customfield_10075';

function configuredSpaceKeys() {
  const configured = process.env.JIRA_SPACE_KEYS || process.env.JIRA_PROJECT_KEY || 'DD';
  return [...new Set(configured.split(',').map(key => key.trim().toUpperCase()).filter(Boolean))];
}

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

const issueSeed = [
  ['DD-4', 'TEST STORY TO DO', 'Story', 'To Do'],
  ['DD-5', 'Task 2', 'Bug', 'In Progress'],
  ['DD-9', 'TEST STORY IN-P', 'Story', 'In Progress'],
  ['DD-10', 'DD TASK - 1', 'Task', 'In Progress'],
  ['DD-11', 'TEST STORY DONE', 'Story', 'Done'],
  ['DD-12', 'TEST TASK TO DO', 'Task', 'To Do'],
  ['DD-13', 'TEST TASK IN-P', 'Task', 'In Progress'],
  ['DD-14', 'TEST TASK DONE', 'Task', 'Done']
].map(([key, summary, type, status], index) => ({
  key,
  summary,
  type,
  status,
  priority: 'Medium',
  assignee: 'Atharv Porwal',
  parent: 'DD-1',
  points: null,
  pis: ['PI - 1'],
  sprints: [`PI - 1 Sprint - ${(index % 6) + 1}`]
}));

function seedDashboard(spaceKey = configuredSpaceKeys()[0]) {
  const issues = spaceKey === 'DD' ? issueSeed : [];
  const notice = spaceKey === 'DD'
    ? 'Local verified DD-1 snapshot. Configure Jira credentials to refresh live.'
    : `No local snapshot is available for ${spaceKey}. Configure Jira credentials to load it.`;
  const spaces = configuredSpaceKeys().map(key => ({ key, name: key }));
  const statuses = ['To Do', 'In Progress', 'Done'].map(name => ({ name, category: name === 'To Do' ? 'new' : name === 'Done' ? 'done' : 'indeterminate' }));
  return buildDashboard(issues, { key: spaceKey, name: spaceKey }, false, notice, pendingZephyrQuality('Awaiting live Zephyr sync', spaceKey), spaces, statuses);
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

function buildDashboard(issues, space, live, notice, quality = pendingZephyrQuality('Awaiting live Zephyr sync', space.key), spaces = [], workflowStatuses = []) {
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
  const spaceKeys = configuredSpaceKeys();
  return {
    space: {
      key: space.key,
      name: space.name || space.key,
      jiraBrowseUrl: process.env.JIRA_BASE_URL ? `${process.env.JIRA_BASE_URL.replace(/\/$/, '')}/browse` : null
    },
    spaces: spaces.length ? spaces : spaceKeys.map(key => ({ key, name: key === space.key ? (space.name || key) : key })),
    program: buildProgramAnalytics(workItems, workflowStatuses),
    statuses: workflowStatuses,
    connection: { jira: live ? 'Live Jira Cloud' : 'Snapshot mode', zephyr: quality.live ? 'Live Zephyr Cloud' : 'Zephyr sync unavailable', updatedAt: new Date().toISOString(), notice },
    metrics: deliveryMetrics(workItems, workflowStatuses),
    epics: sortedEpics,
    quality
  };
}

async function fetchJiraIssues(spaceKey) {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    return {
      issues: spaceKey === 'DD' ? issueSeed : [],
      space: { key: spaceKey, name: spaceKey },
      statuses: ['To Do', 'In Progress', 'Done'].map(name => ({ name, category: name === 'To Do' ? 'new' : name === 'Done' ? 'done' : 'indeterminate' })),
      live: false,
      notice: spaceKey === 'DD' ? 'Local verified DD-1 snapshot. Configure Jira credentials to refresh live.' : `No local snapshot is available for ${spaceKey}.`
    };
  }
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
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
    const response = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
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
    const statusResponse = await fetch(statusUrl, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
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
    const projectResponse = await fetch(projectUrl, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
    if (projectResponse.ok) {
      const project = await projectResponse.json();
      space = { key: project.key || spaceKey, name: String(project.name || spaceKey).trim() };
    }
  } catch {
    // The issue data is still valid if optional space metadata cannot be loaded.
  }
  return { issues, space, statuses, live: true, notice: `Live Jira and Zephyr data for ${spaceKey}.` };
}

async function fetchSpaceCatalog(selectedSpace) {
  const spaceKeys = configuredSpaceKeys();
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    return spaceKeys.map(key => ({ key, name: key === selectedSpace.key ? selectedSpace.name : key }));
  }
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  return Promise.all(spaceKeys.map(async key => {
    if (key === selectedSpace.key) return selectedSpace;
    try {
      const projectUrl = new URL(`/rest/api/3/project/${encodeURIComponent(key)}`, JIRA_BASE_URL);
      const response = await fetch(projectUrl, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
      if (!response.ok) return { key, name: key };
      const project = await response.json();
      return { key: project.key || key, name: String(project.name || key).trim() };
    } catch {
      return { key, name: key };
    }
  }));
}

function zephyrRegion(baseUrl) {
  const host = new URL(baseUrl).hostname;
  if (host.startsWith('eu.')) return 'EU';
  if (host.startsWith('au.')) return 'AU';
  if (host.startsWith('de.')) return 'DE';
  return 'US';
}

async function fetchZephyrCollection(resource, spaceKey) {
  const { ZEPHYR_API_BASE_URL, ZEPHYR_API_TOKEN } = process.env;
  if (!ZEPHYR_API_BASE_URL || !ZEPHYR_API_TOKEN) throw new Error('Zephyr API URL or token is missing.');
  const values = [];
  let startAt = 0;
  const maxResults = 1000;
  while (true) {
    const url = new URL(`${ZEPHYR_API_BASE_URL.replace(/\/$/, '')}/${resource}`);
    url.searchParams.set('projectKey', spaceKey);
    url.searchParams.set('maxResults', String(maxResults));
    url.searchParams.set('startAt', String(startAt));
    const response = await fetch(url, { headers: { Authorization: `Bearer ${ZEPHYR_API_TOKEN}`, Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Zephyr ${resource} returned ${response.status}. Check the regional API URL, token, and project permissions.`);
    const payload = await response.json();
    const page = Array.isArray(payload.values) ? payload.values : [];
    values.push(...page);
    if (payload.isLast !== false || page.length === 0) break;
    startAt += Number(payload.maxResults) || page.length;
  }
  return values;
}

async function fetchZephyrQuality(spaceKey) {
  const { ZEPHYR_API_BASE_URL, ZEPHYR_API_TOKEN } = process.env;
  if (!ZEPHYR_API_BASE_URL || !ZEPHYR_API_TOKEN) return pendingZephyrQuality('Zephyr credentials are not configured.', spaceKey);
  const [testCases, cycles, plans, executions, statuses] = await Promise.all([
    fetchZephyrCollection('testcases', spaceKey),
    fetchZephyrCollection('testcycles', spaceKey),
    fetchZephyrCollection('testplans', spaceKey),
    fetchZephyrCollection('testexecutions', spaceKey),
    fetchZephyrCollection('statuses', spaceKey)
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

async function fetchDashboard(spaceKey) {
  const [jira, zephyr] = await Promise.all([
    fetchJiraIssues(spaceKey),
    fetchZephyrQuality(spaceKey).catch(error => pendingZephyrQuality(error.message, spaceKey))
  ]);
  const spaces = await fetchSpaceCatalog(jira.space);
  return buildDashboard(jira.issues, jira.space, jira.live, jira.notice, zephyr, spaces, jira.statuses);
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
function reply(res, code, body, type = 'application/json; charset=utf-8') { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); }

await parseEnv();
createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const path = requestUrl.pathname;
  if (path === '/api/health') {
    reply(res, 200, JSON.stringify({ status: 'ok' }));
    return;
  }
  if (path === '/api/spaces') {
    reply(res, 200, JSON.stringify({ spaces: configuredSpaceKeys().map(key => ({ key })) }));
    return;
  }
  if (path === '/api/dashboard') {
    const spaceKeys = configuredSpaceKeys();
    const requestedSpace = (requestUrl.searchParams.get('space') || spaceKeys[0]).trim().toUpperCase();
    if (!spaceKeys.includes(requestedSpace)) {
      reply(res, 400, JSON.stringify({ error: `Unknown Jira space: ${requestedSpace}`, spaces: spaceKeys.map(key => ({ key })) }));
      return;
    }
    try { reply(res, 200, JSON.stringify(await fetchDashboard(requestedSpace))); }
    catch (error) { reply(res, 502, JSON.stringify({ error: error.message, ...seedDashboard(requestedSpace) })); }
    return;
  }
  const requested = path === '/' ? '/index.html' : path;
  const file = normalize(join(root, 'public', requested));
  if (!file.startsWith(join(root, 'public'))) return reply(res, 403, 'Forbidden', 'text/plain');
  try { await stat(file); reply(res, 200, await readFile(file), mime[extname(file)] || 'application/octet-stream'); }
  catch {
    if (/^\/(epics|quality|pis)(\/|$)/.test(path)) {
      reply(res, 200, await readFile(join(root, 'public', 'index.html')), mime['.html']);
      return;
    }
    reply(res, 404, 'Not found', 'text/plain');
  }
}).listen(port, '0.0.0.0', () => console.log(`Dashboard running on http://localhost:${port}`));
