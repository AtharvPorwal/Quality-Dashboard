import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);

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
].map(([key, summary, type, status]) => ({ key, summary, type, status, priority: 'Medium', assignee: 'Atharv Porwal', parent: 'DD-1', points: null }));

function seedDashboard() {
  return buildDashboard(issueSeed, false, 'Local verified DD-1 snapshot. Configure Jira credentials to refresh live.', pendingZephyrQuality());
}

function number(value) { return Number.isFinite(value) ? value : 0; }

function pendingZephyrQuality(status = 'Awaiting live Zephyr sync') {
  return {
    live: false,
    testCases: 8,
    testCycles: 1,
    testPlans: 0,
    executions: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    notExecuted: 0,
    passRate: null,
    status,
    source: 'zephyr-demo-import.csv',
    cycles: [],
    plans: []
  };
}

function buildDashboard(issues, live, notice, quality = pendingZephyrQuality()) {
  const isEpic = item => /epic/i.test(item.type);
  const workItems = issues.filter(item => !isEpic(item));
  const counts = { todo: 0, inProgress: 0, done: 0 };
  for (const issue of workItems) {
    const state = issue.status.toLowerCase();
    if (state.includes('done') || state.includes('closed') || state.includes('resolved')) counts.done += 1;
    else if (state.includes('progress') || state.includes('review')) counts.inProgress += 1;
    else counts.todo += 1;
  }
  const epics = new Map();
  const byKey = new Map(issues.map(item => [item.key, item]));
  for (const issue of issues.filter(isEpic)) epics.set(issue.key, { ...issue, children: [] });
  if (!epics.size) epics.set('DD-1', { key: 'DD-1', summary: 'Epic 1', type: 'Epic', status: 'In Progress', children: [] });
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
    done: epic.children.filter(item => /done|closed|resolved/i.test(item.status)).length
  })).sort((a, b) => a.key === 'UNASSIGNED' ? 1 : b.key === 'UNASSIGNED' ? -1 : a.key.localeCompare(b.key));
  const total = workItems.length;
  return {
    project: { key: process.env.JIRA_PROJECT_KEY || 'DD', name: 'Quality Dashboard', sprint: 'DD Sprint 1', sprintDates: '7 Sep – 21 Sep 2026' },
    connection: { jira: live ? 'Live Jira Cloud' : 'Snapshot mode', zephyr: quality.live ? 'Live Zephyr Cloud' : 'Zephyr sync unavailable', updatedAt: new Date().toISOString(), notice },
    metrics: { total, todo: counts.todo, inProgress: counts.inProgress, done: counts.done, completion: total ? Math.round((counts.done / total) * 100) : 0, points: workItems.reduce((sum, item) => sum + number(item.points), 0) },
    epics: sortedEpics,
    quality
  };
}

async function fetchJiraIssues() {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY = 'DD' } = process.env;
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    return { issues: issueSeed, live: false, notice: 'Local verified DD-1 snapshot. Configure Jira credentials to refresh live.' };
  }
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  const fields = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'parent', 'subtasks', 'created', 'updated', 'duedate', 'customfield_10016', 'customfield_10020'];
  const url = new URL('/rest/api/3/search/jql', JIRA_BASE_URL);
  url.searchParams.set('jql', `project = ${JIRA_PROJECT_KEY} ORDER BY parent ASC, created ASC`);
  url.searchParams.set('fields', fields.join(','));
  url.searchParams.set('maxResults', '100');
  const response = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Jira returned ${response.status}. Check the site URL, email, token, and Browse Projects permission.`);
  const payload = await response.json();
  const rawIssues = payload.issues || payload.values || [];
  const issues = rawIssues.map(({ key, fields: item }) => ({
    key,
    summary: item.summary || key,
    type: item.issuetype?.name || 'Work item',
    status: item.status?.name || 'To Do',
    priority: item.priority?.name || 'None',
    assignee: item.assignee?.displayName || 'Unassigned',
    parent: item.parent?.key || null,
    points: typeof item.customfield_10016 === 'number' ? item.customfield_10016 : null,
    updated: item.updated
  }));
  return { issues, live: true, notice: `Live Jira and Zephyr data for ${JIRA_PROJECT_KEY}.` };
}

function zephyrRegion(baseUrl) {
  const host = new URL(baseUrl).hostname;
  if (host.startsWith('eu.')) return 'EU';
  if (host.startsWith('au.')) return 'AU';
  if (host.startsWith('de.')) return 'DE';
  return 'US';
}

async function fetchZephyrCollection(resource) {
  const { ZEPHYR_API_BASE_URL, ZEPHYR_API_TOKEN, JIRA_PROJECT_KEY = 'DD' } = process.env;
  if (!ZEPHYR_API_BASE_URL || !ZEPHYR_API_TOKEN) throw new Error('Zephyr API URL or token is missing.');
  const values = [];
  let startAt = 0;
  const maxResults = 1000;
  while (true) {
    const url = new URL(`${ZEPHYR_API_BASE_URL.replace(/\/$/, '')}/${resource}`);
    url.searchParams.set('projectKey', JIRA_PROJECT_KEY);
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

async function fetchZephyrQuality() {
  const { ZEPHYR_API_BASE_URL, ZEPHYR_API_TOKEN } = process.env;
  if (!ZEPHYR_API_BASE_URL || !ZEPHYR_API_TOKEN) return pendingZephyrQuality('Zephyr credentials are not configured.');
  const [testCases, cycles, plans, executions, statuses] = await Promise.all([
    fetchZephyrCollection('testcases'),
    fetchZephyrCollection('testcycles'),
    fetchZephyrCollection('testplans'),
    fetchZephyrCollection('testexecutions'),
    fetchZephyrCollection('statuses')
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

async function fetchDashboard() {
  const [jira, zephyr] = await Promise.all([
    fetchJiraIssues(),
    fetchZephyrQuality().catch(error => pendingZephyrQuality(error.message))
  ]);
  return buildDashboard(jira.issues, jira.live, jira.notice, zephyr);
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
function reply(res, code, body, type = 'application/json; charset=utf-8') { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); }

await parseEnv();
createServer(async (req, res) => {
  const path = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (path === '/api/health') {
    reply(res, 200, JSON.stringify({ status: 'ok' }));
    return;
  }
  if (path === '/api/dashboard') {
    try { reply(res, 200, JSON.stringify(await fetchDashboard())); }
    catch (error) { reply(res, 502, JSON.stringify({ error: error.message, ...seedDashboard() })); }
    return;
  }
  const requested = path === '/' ? '/index.html' : path;
  const file = normalize(join(root, 'public', requested));
  if (!file.startsWith(join(root, 'public'))) return reply(res, 403, 'Forbidden', 'text/plain');
  try { await stat(file); reply(res, 200, await readFile(file), mime[extname(file)] || 'application/octet-stream'); }
  catch {
    if (/^\/(epics|quality)(\/|$)/.test(path)) {
      reply(res, 200, await readFile(join(root, 'public', 'index.html')), mime['.html']);
      return;
    }
    reply(res, 404, 'Not found', 'text/plain');
  }
}).listen(port, '0.0.0.0', () => console.log(`Dashboard running on http://localhost:${port}`));
