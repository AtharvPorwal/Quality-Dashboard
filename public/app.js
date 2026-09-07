const app = document.querySelector('#app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const stateClass = value => /done|closed|resolved/i.test(value) ? 'done' : /progress|review/i.test(value) ? 'progress' : 'todo';

function issueRow(issue) {
  return `<tr><td><a href="https://atharvporwal051.atlassian.net/browse/${esc(issue.key)}" target="_blank" rel="noreferrer">${esc(issue.key)}</a></td><td><strong>${esc(issue.summary)}</strong><span class="type">${esc(issue.type)}</span></td><td><span class="status ${stateClass(issue.status)}">${esc(issue.status)}</span></td><td>${esc(issue.assignee)}</td><td>${esc(issue.priority)}</td></tr>`;
}
function render(data) {
  const m = data.metrics;
  const totalForProgress = Math.max(m.total, 1);
  const epicCount = data.epics.filter(epic => epic.type === 'Epic').length;
  app.innerHTML = `<header><div><p class="eyebrow">DELIVERY INTELLIGENCE · ${esc(data.project.key)}</p><h1>${esc(data.project.name)}</h1><p class="sub">Leadership-ready view of delivery progress, scope and test quality.</p></div><div class="header-actions"><span class="connection ${data.connection.jira.includes('Live') ? 'live' : ''}">${esc(data.connection.jira)}</span><button id="refresh">Refresh</button></div></header>
  <section class="sprint"><div><span class="label">ACTIVE SPRINT</span><h2>${esc(data.project.sprint)}</h2><p>${esc(data.project.sprintDates)} · ${m.total} delivery items</p></div><div class="completion"><span>${m.completion}%</span><small>delivery complete</small></div><div class="progressbar"><i style="width:${m.completion}%"></i></div></section>
  <section class="metrics"><article><span>Delivery items</span><strong>${m.total}</strong><small>all work types</small></article><article><span>To do</span><strong>${m.todo}</strong><small>not started</small></article><article><span>In progress</span><strong>${m.inProgress}</strong><small>active work</small></article><article><span>Done</span><strong>${m.done}</strong><small>completed</small></article></section>
  <section class="grid"><article class="panel epic-panel"><div class="panel-heading"><div><p class="eyebrow">EPIC DELIVERY</p><h2>Scope, sorted by epic</h2></div><span>${epicCount} epic${epicCount === 1 ? '' : 's'}</span></div>${data.epics.map(epic => `<details open><summary><span><b>${esc(epic.key)}</b><strong>${esc(epic.summary)}</strong></span><span class="epic-progress">${epic.done}/${epic.children.length} done <i><em style="width:${epic.children.length ? epic.done / epic.children.length * 100 : 0}%"></em></i></span></summary><div class="table-wrap"><table><thead><tr><th>Key</th><th>Work item</th><th>Status</th><th>Owner</th><th>Priority</th></tr></thead><tbody>${epic.children.map(issueRow).join('') || '<tr><td colspan="5">No child work items.</td></tr>'}</tbody></table></div></details>`).join('')}</article>
  <aside class="side"><article class="panel"><p class="eyebrow">QUALITY SIGNAL</p><h2>Zephyr test operations</h2><div class="quality"><div><strong>${data.quality.importedCases}</strong><span>imported test cases</span></div><div><strong>${data.quality.testCycles}</strong><span>test cycle${data.quality.testCycles === 1 ? '' : 's'}</span></div></div><p class="quality-note">${esc(data.quality.status)}</p><p class="muted">Source: ${esc(data.quality.source)}. A live Zephyr credential will populate execution, pass/fail, test-plan and coverage metrics.</p></article><article class="panel insight"><p class="eyebrow">EXECUTIVE READOUT</p><h2>Current delivery position</h2><p><b>${m.inProgress} active</b> items need attention. <b>${m.done} of ${m.total}</b> delivery items are complete.</p><p class="muted">${esc(data.connection.notice)}</p></article></aside></section><footer>Last dashboard refresh: ${new Date(data.connection.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</footer>`;
  document.querySelector('#refresh').addEventListener('click', load);
}
async function load() {
  app.querySelector('#refresh')?.setAttribute('disabled', '');
  try { const response = await fetch('/api/dashboard'); const data = await response.json(); render(data); }
  catch { app.innerHTML = '<div class="loading">Unable to load dashboard data. Please check the local server.</div>'; }
}
load();
