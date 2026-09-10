const app = document.querySelector('#app');

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const isDone = value => /done|closed|resolved/i.test(value);
const isActive = value => /progress|review/i.test(value);
const stateClass = value => isDone(value) ? 'done' : isActive(value) ? 'progress' : 'todo';
const pct = (value, total) => total ? Math.round((value / total) * 100) : 0;

const icons = {
  overview: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="4" rx="2"/><rect x="14" y="11" width="7" height="10" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/></svg>',
  epics: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h7"/><circle cx="19" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></svg>',
  program: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16"/><circle cx="8" cy="5" r="2"/><circle cx="14" cy="12" r="2"/><circle cx="10" cy="19" r="2"/></svg>',
  quality: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.8 2.8 8.2 7 10 4.2-1.8 7-5.2 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 8A7 7 0 0 1 18.5 6.5L20 9M4 15l1.5 2.5A7 7 0 0 0 17.9 16"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  trend: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16 5-5 4 4 7-8"/><path d="M15 7h5v5"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z"/></svg>'
};

let dashboard;

function routeHref(path) {
  const space = dashboard?.space?.key || new URLSearchParams(location.search).get('space');
  return space ? `${path}?space=${encodeURIComponent(space)}` : path;
}

function connectionBadge(label, live) {
  return `<span class="connection ${live ? 'live' : ''}"><i></i>${esc(label)}</span>`;
}

function shell(content, active = 'overview') {
  const jiraLive = dashboard.connection.jira.includes('Live');
  const zephyrLive = dashboard.connection.zephyr.includes('Live');
  return `<div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="${routeHref('/')}" data-route><span class="brand-mark">Q</span><span>Quality<br>Dashboard</span></a>
      <nav aria-label="Primary navigation">
        <a href="${routeHref('/')}" data-route class="${active === 'overview' ? 'active' : ''}">${icons.overview}<span>Overview</span></a>
        <a href="${routeHref('/pis')}" data-route class="${active === 'program' ? 'active' : ''}">${icons.program}<span>PIs & Sprints</span></a>
        <a href="${routeHref('/epics')}" data-route class="${active === 'epics' ? 'active' : ''}">${icons.epics}<span>Epics</span></a>
        <a href="${routeHref('/quality')}" data-route class="${active === 'quality' ? 'active' : ''}">${icons.quality}<span>Quality</span></a>
      </nav>
      <div class="sidebar-status"><span>Connections</span>${connectionBadge('Jira', jiraLive)}${connectionBadge('Zephyr', zephyrLive)}</div>
    </aside>
    <main class="workspace">
      <header class="topbar">
        <div class="mobile-brand"><span class="brand-mark">Q</span><strong>Quality Dashboard</strong></div>
        <label class="space-switch"><span>Space</span><select id="space-select" aria-label="Select Jira space">${dashboard.spaces.map(space => `<option value="${esc(space.key)}" ${space.key === dashboard.space.key ? 'selected' : ''}>${esc(space.name || space.key)} (${esc(space.key)})</option>`).join('')}</select></label>
        <button class="icon-button" id="refresh" aria-label="Refresh dashboard" title="Refresh dashboard">${icons.refresh}</button>
      </header>
      ${content}
    </main>
    <nav class="mobile-nav" aria-label="Mobile navigation">
      <a href="${routeHref('/')}" data-route class="${active === 'overview' ? 'active' : ''}">${icons.overview}<span>Overview</span></a>
      <a href="${routeHref('/pis')}" data-route class="${active === 'program' ? 'active' : ''}">${icons.program}<span>PIs</span></a>
      <a href="${routeHref('/epics')}" data-route class="${active === 'epics' ? 'active' : ''}">${icons.epics}<span>Epics</span></a>
      <a href="${routeHref('/quality')}" data-route class="${active === 'quality' ? 'active' : ''}">${icons.quality}<span>Quality</span></a>
    </nav>
  </div>`;
}

function epicCard(epic) {
  const total = epic.children.length;
  const completion = pct(epic.done, total);
  const active = epic.children.filter(item => isActive(item.status)).length;
  return `<a class="epic-card" href="${routeHref(`/epics/${encodeURIComponent(epic.key)}`)}" data-route>
    <div class="epic-card-top"><span class="epic-key">${esc(epic.key)}</span><span class="arrow">${icons.arrow}</span></div>
    <h3>${esc(epic.summary)}</h3>
    <div class="epic-numbers"><strong>${completion}%</strong><span>${epic.done}/${total} complete · ${active} active</span></div>
    <div class="mini-progress"><i style="width:${completion}%"></i></div>
  </a>`;
}

function piCard(pi) {
  const m = pi.metrics;
  return `<a class="pi-card" href="${routeHref(`/pis/${pi.number}`)}" data-route>
    <div class="pi-card-heading"><div><span class="pi-number">${esc(pi.name)}</span><h3>${m.total} ${m.total === 1 ? 'story' : 'stories'}</h3></div><span class="arrow">${icons.arrow}</span></div>
    <div class="pi-progress"><i style="width:${m.completion}%"></i></div>
    <div class="pi-card-footer"><strong>${m.completion}% complete</strong><span>${m.done} done · ${m.inProgress} active · ${m.todo} to do</span></div>
  </a>`;
}

function sprintCard(sprint, piNumber) {
  const m = sprint.metrics;
  return `<a class="sprint-card" href="${routeHref(`/pis/${piNumber}/sprints/${sprint.number}`)}" data-route>
    <div><span class="sprint-index">S${sprint.number}</span><strong>Sprint ${sprint.number}</strong><small>${m.total} ${m.total === 1 ? 'story' : 'stories'}</small></div>
    <div class="sprint-score"><strong>${m.completion}%</strong><span>complete</span></div>
    <div class="mini-progress"><i style="width:${m.completion}%"></i></div>
  </a>`;
}

function statusTone(name) {
  const value = String(name).toLowerCase();
  if (value.includes('blocked')) return 'coral';
  if (value.includes('cancel')) return 'neutral';
  if (isDone(value)) return 'green';
  if (isActive(value)) return 'blue';
  if (value.includes('to do') || value.includes('open')) return 'amber';
  return 'indigo';
}

function statusMetricCards(metrics) {
  return (metrics.statuses || []).map(status => `<article class="status-metric ${statusTone(status.name)}"><span>${esc(status.name)}</span><div><strong>${status.count}</strong><i></i></div><small>${metrics.total ? pct(status.count, metrics.total) : 0}% of stories</small></article>`).join('');
}

function renderOverview() {
  const { metrics: m, quality: q } = dashboard;
  const epicCount = dashboard.epics.filter(epic => epic.type === 'Epic').length;
  const statusTotal = Math.max(m.total, 1);
  const updated = new Date(dashboard.connection.updatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const content = `<div class="page overview-page">
    <section class="page-title">
      <div><span class="kicker">${esc(dashboard.space.key)} · DELIVERY OVERVIEW</span><h1>${esc(dashboard.space.name)}</h1><p class="page-subtitle">Space-level delivery and quality overview</p></div>
      <span class="updated">Updated ${esc(updated)}</span>
    </section>

    <section class="hero-grid">
      <article class="card health-card">
        <div class="card-heading"><div><span class="kicker light">SPACE DELIVERY</span><h2>All program increments · ${esc(dashboard.space.key)}</h2></div><span class="pulse-dot">${jiraLiveLabel()}</span></div>
        <div class="health-content">
          <div class="radial" style="--value:${m.completion}"><div><strong>${m.completion}%</strong><span>complete</span></div></div>
          <div class="health-summary"><strong>${m.inProgress} stories in progress</strong><span>${m.done} delivered · ${m.todo} waiting</span><div class="hero-progress"><i class="done-segment" style="width:${pct(m.done, statusTotal)}%"></i><i class="active-segment" style="width:${pct(m.inProgress, statusTotal)}%"></i></div></div>
        </div>
      </article>

      <article class="card quality-card">
        <div class="card-heading"><div><span class="kicker">ZEPHYR QUALITY</span><h2>Test confidence</h2></div><a href="${routeHref('/quality')}" data-route>View details ${icons.arrow}</a></div>
        <div class="quality-score"><div class="score-number"><strong>${q.passRate === null ? '—' : `${q.passRate}%`}</strong><span>pass rate</span></div><div class="quality-bars"><div><span>Passed</span><i><b class="pass" style="width:${pct(q.passed, Math.max(q.executions, 1))}%"></b></i><em>${q.passed}</em></div><div><span>Failed</span><i><b class="fail" style="width:${pct(q.failed, Math.max(q.executions, 1))}%"></b></i><em>${q.failed}</em></div><div><span>Blocked</span><i><b class="blocked" style="width:${pct(q.blocked, Math.max(q.executions, 1))}%"></b></i><em>${q.blocked}</em></div></div></div>
        <div class="quality-footer"><span><b>${q.testCases}</b> cases</span><span><b>${q.testCycles}</b> cycles</span><span><b>${q.executions}</b> runs</span></div>
      </article>
    </section>

    <section class="metric-grid" aria-label="Delivery metrics">
      <article class="metric-card"><span>Total stories</span><div><strong>${m.total}</strong><i class="metric-icon indigo">${icons.bolt}</i></div><small>Across ${epicCount} epic${epicCount === 1 ? '' : 's'}</small></article>
      <article class="metric-card"><span>In progress</span><div><strong>${m.inProgress}</strong><i class="metric-icon blue">${icons.trend}</i></div><small>${pct(m.inProgress, statusTotal)}% of space scope</small></article>
      <article class="metric-card"><span>Delivered</span><div><strong>${m.done}</strong><i class="metric-icon green">${icons.quality}</i></div><small>${m.completion}% completion</small></article>
      <article class="metric-card"><span>Test cases</span><div><strong>${q.testCases}</strong><i class="metric-icon coral">${icons.quality}</i></div><small>${q.testCycles} active cycle${q.testCycles === 1 ? '' : 's'}</small></article>
    </section>

    <section class="section-heading program-heading"><div><span class="kicker">PROGRAM DELIVERY</span><h2>Progress by PI</h2></div><a href="${routeHref('/pis')}" data-route>View sprint breakdown ${icons.arrow}</a></section>
    <section class="pi-grid">${dashboard.program.pis.map(piCard).join('')}</section>

    <section class="section-heading"><div><span class="kicker">DELIVERY MAP</span><h2>Epics in ${esc(dashboard.space.key)}</h2></div><a href="${routeHref('/epics')}" data-route>View all ${icons.arrow}</a></section>
    <section class="epic-grid">${dashboard.epics.length ? dashboard.epics.slice(0, 3).map(epicCard).join('') : '<div class="empty-epics">No epics were found in this space.</div>'}</section>
  </div>`;
  app.innerHTML = shell(content, 'overview');
  bindGlobalEvents();
}

function renderEpics() {
  const epics = dashboard.epics;
  const totalItems = epics.reduce((sum, epic) => sum + epic.children.length, 0);
  const totalDone = epics.reduce((sum, epic) => sum + epic.done, 0);
  const content = `<div class="page">
    <section class="page-title detail-title">
      <div><span class="kicker">${esc(dashboard.space.key)} · ALL PROGRAM INCREMENTS</span><h1>Epics</h1><p>${totalDone} of ${totalItems} stories delivered in ${esc(dashboard.space.name)}</p></div>
    </section>
    <section class="epic-grid epic-grid-full">${epics.length ? epics.map(epicCard).join('') : '<div class="empty-epics">No epics were found in this space.</div>'}</section>
  </div>`;
  app.innerHTML = shell(content, 'epics');
  bindGlobalEvents();
}

function warningTotal() {
  return Object.values(dashboard.program.warnings).reduce((sum, value) => sum + value, 0);
}

function assignmentNotice() {
  const warnings = dashboard.program.warnings;
  if (!warningTotal()) return '<div class="assignment-notice success"><strong>PI assignments are clean</strong><span>Every story has one matching PI and sprint.</span></div>';
  return `<div class="assignment-notice"><strong>${warningTotal()} assignment warning${warningTotal() === 1 ? '' : 's'}</strong><span>${warnings.missingPi} missing PI · ${warnings.missingSprint} missing sprint · ${warnings.mismatchedSprint} PI/sprint mismatch · ${warnings.multiplePi + warnings.multipleSprint} multiple selections</span></div>`;
}

function renderProgram() {
  const content = `<div class="page program-page">
    <section class="page-title detail-title"><div><span class="kicker">${esc(dashboard.space.key)} · PROGRAM VIEW</span><h1>Program increments</h1><p>Delivery progress organized by PI</p></div></section>
    ${assignmentNotice()}
    <section class="pi-grid pi-grid-full">${dashboard.program.pis.map(piCard).join('')}</section>
  </div>`;
  app.innerHTML = shell(content, 'program');
  bindGlobalEvents();
}

function renderPiDetail(piNumber) {
  const pi = dashboard.program.pis.find(item => item.number === Number(piNumber));
  if (!pi) return renderNotFound();
  const m = pi.metrics;
  const content = `<div class="page program-page">
    <a class="back-link" href="${routeHref('/pis')}" data-route><span>‹</span> All program increments</a>
    <section class="page-title detail-title"><div><span class="kicker">${esc(dashboard.space.key)} · PROGRAM DELIVERY</span><h1>${esc(pi.name)}</h1><p>Six-sprint delivery breakdown</p></div></section>
    <section class="detail-metrics core-program-metrics">
      <article><span>Complete</span><strong>${m.completion}%</strong><div class="mini-progress"><i style="width:${m.completion}%"></i></div></article>
      <article><span>Total stories</span><strong>${m.total}</strong><small>PI scope</small></article>
    </section>
    <section class="status-metric-grid" aria-label="Story status counts">${statusMetricCards(m)}</section>
    <section class="section-heading"><div><span class="kicker">SPRINT BREAKDOWN</span><h2>${esc(pi.name)} sprints</h2></div></section>
    <section class="sprint-grid">${pi.sprints.map(sprint => sprintCard(sprint, pi.number)).join('')}</section>
  </div>`;
  app.innerHTML = shell(content, 'program');
  bindGlobalEvents();
}

function renderSprintDetail(piNumber, sprintNumber) {
  const pi = dashboard.program.pis.find(item => item.number === Number(piNumber));
  const sprint = pi?.sprints.find(item => item.number === Number(sprintNumber));
  if (!pi || !sprint) return renderNotFound();
  const m = sprint.metrics;
  const content = `<div class="page program-page">
    <a class="back-link" href="${routeHref(`/pis/${pi.number}`)}" data-route><span>‹</span> ${esc(pi.name)} sprint breakdown</a>
    <section class="page-title detail-title"><div><span class="kicker">${esc(dashboard.space.key)} · ${esc(pi.name)}</span><h1>Sprint ${sprint.number}</h1><p>${esc(sprint.jiraValue)}</p></div></section>
    <section class="detail-metrics core-program-metrics">
      <article><span>Complete</span><strong>${m.completion}%</strong><div class="mini-progress"><i style="width:${m.completion}%"></i></div></article>
      <article><span>Total stories</span><strong>${m.total}</strong><small>Sprint scope</small></article>
    </section>
    <section class="status-metric-grid" aria-label="Story status counts">${statusMetricCards(m)}</section>
    <article class="card work-card">
      <div class="card-heading"><div><span class="kicker">JIRA DELIVERY</span><h2>Stories in this sprint</h2></div><span class="table-count">${m.total} stories</span></div>
      <div class="table-wrap"><table><thead><tr><th>Key</th><th>Story</th><th>PI</th><th>Sprint</th><th>Status</th><th>Owner</th><th>Priority</th></tr></thead><tbody>${sprint.issues.map(issueRow).join('') || '<tr><td class="empty-row" colspan="7">No stories assigned to this sprint.</td></tr>'}</tbody></table></div>
    </article>
  </div>`;
  app.innerHTML = shell(content, 'program');
  bindGlobalEvents();
}

function issueRow(issue) {
  const jiraUrl = dashboard.space.jiraBrowseUrl ? `${dashboard.space.jiraBrowseUrl}/${encodeURIComponent(issue.key)}` : null;
  const pi = issue.pis?.map(value => value.replace(/PI\s*-?\s*(\d+)/i, 'PI $1')).join(', ') || 'Unassigned';
  const sprint = issue.sprints?.map(value => {
    const match = value.match(/Sprint\s*-?\s*(\d+)/i);
    return match ? `Sprint ${match[1]}` : value;
  }).join(', ') || 'Unassigned';
  return `<tr>
    <td>${jiraUrl ? `<a class="issue-link" href="${esc(jiraUrl)}" target="_blank" rel="noreferrer">${esc(issue.key)}</a>` : `<strong>${esc(issue.key)}</strong>`}</td>
    <td><strong class="issue-name">${esc(issue.summary)}</strong><span class="issue-type">${esc(issue.type)}</span></td>
    <td><span class="assignment-pill">${esc(pi)}</span></td>
    <td><span class="assignment-pill sprint">${esc(sprint)}</span></td>
    <td><span class="status ${stateClass(issue.status)}">${esc(issue.status)}</span></td>
    <td>${esc(issue.assignee)}</td>
    <td>${esc(issue.priority)}</td>
  </tr>`;
}

function qualityMiniPanel() {
  const q = dashboard.quality;
  return `<aside class="card epic-quality">
    <div class="card-heading"><div><span class="kicker">ZEPHYR</span><h2>Space quality</h2></div><a href="${routeHref('/quality')}" data-route>Open ${icons.arrow}</a></div>
    <div class="mini-quality-score"><strong>${q.passRate === null ? '—' : `${q.passRate}%`}</strong><span>pass rate</span></div>
    <div class="signal-list"><span><i class="signal pass"></i>Passed <b>${q.passed}</b></span><span><i class="signal fail"></i>Failed <b>${q.failed}</b></span><span><i class="signal blocked"></i>Blocked <b>${q.blocked}</b></span><span><i class="signal neutral"></i>Not run <b>${q.notExecuted}</b></span></div>
    <p class="context-note">${esc(q.status)}</p>
  </aside>`;
}

function renderEpicDetail(epicKey) {
  const epic = dashboard.epics.find(item => item.key === epicKey);
  if (!epic) {
    renderNotFound();
    return;
  }
  const total = epic.children.length;
  const done = epic.done;
  const active = epic.children.filter(item => isActive(item.status)).length;
  const todo = total - done - active;
  const content = `<div class="page">
    <a class="back-link" href="${routeHref('/epics')}" data-route><span>‹</span> All epics</a>
    <section class="page-title detail-title epic-title">
      <div><span class="epic-key">${esc(epic.key)}</span><h1>${esc(epic.summary)}</h1><p>${esc(epic.status || 'Epic delivery')}</p></div>
      ${dashboard.space.jiraBrowseUrl ? `<a class="jira-button" href="${esc(`${dashboard.space.jiraBrowseUrl}/${encodeURIComponent(epic.key)}`)}" target="_blank" rel="noreferrer">Open in Jira ↗</a>` : ''}
    </section>
    <section class="detail-metrics">
      <article><span>Complete</span><strong>${pct(done, total)}%</strong><div class="mini-progress"><i style="width:${pct(done, total)}%"></i></div></article>
      <article><span>Total stories</span><strong>${total}</strong><small>Epic scope</small></article>
      <article><span>In progress</span><strong>${active}</strong><small>Active now</small></article>
      <article><span>To do</span><strong>${todo}</strong><small>Not started</small></article>
    </section>
    <section class="detail-layout">
      <article class="card work-card">
        <div class="card-heading"><div><span class="kicker">JIRA DELIVERY</span><h2>Stories</h2></div><span class="table-count">${total} stories</span></div>
        <div class="table-wrap"><table><thead><tr><th>Key</th><th>Story</th><th>PI</th><th>Sprint</th><th>Status</th><th>Owner</th><th>Priority</th></tr></thead><tbody>${epic.children.map(issueRow).join('') || '<tr><td class="empty-row" colspan="7">No stories in this epic.</td></tr>'}</tbody></table></div>
      </article>
      ${qualityMiniPanel()}
    </section>
  </div>`;
  app.innerHTML = shell(content, 'epics');
  bindGlobalEvents();
}

function qualityStat(label, value, tone, caption) {
  return `<article class="quality-stat"><span>${esc(label)}</span><div><strong>${esc(value)}</strong><i class="quality-dot ${tone}"></i></div><small>${esc(caption)}</small></article>`;
}

function collectionRows(items, emptyLabel) {
  if (!items?.length) return `<div class="empty-collection">${esc(emptyLabel)}</div>`;
  return items.map(item => `<div class="collection-row"><span class="epic-key">${esc(item.key || '—')}</span><strong>${esc(item.name || item.key || 'Untitled')}</strong><span class="status ${stateClass(item.status)}">${esc(item.status)}</span></div>`).join('');
}

function renderQuality() {
  const q = dashboard.quality;
  const executed = q.passed + q.failed + q.blocked;
  const qTotal = Math.max(q.executions, 1);
  const content = `<div class="page quality-page">
    <section class="page-title detail-title">
      <div><span class="kicker">${esc(dashboard.space.key)} · ZEPHYR CLOUD</span><h1>Quality</h1><p>${esc(q.status)}</p></div>
      <span class="source-pill">${q.live ? '<i></i> Live data' : 'Snapshot data'}</span>
    </section>
    <section class="quality-stat-grid">
      ${qualityStat('Test cases', q.testCases, 'indigo', 'Total library')}
      ${qualityStat('Executions', q.executions, 'blue', `${executed} completed`)}
      ${qualityStat('Passed', q.passed, 'green', q.passRate === null ? 'No rate yet' : `${q.passRate}% pass rate`)}
      ${qualityStat('Failed', q.failed, 'coral', `${q.blocked} blocked`)}
    </section>
    <section class="quality-layout">
      <article class="card distribution-card">
        <div class="card-heading"><div><span class="kicker">EXECUTION MIX</span><h2>Run distribution</h2></div><span class="table-count">${q.executions} total</span></div>
        <div class="distribution-body">
          <div class="large-radial" style="--pass:${pct(q.passed, qTotal)};--fail:${pct(q.failed, qTotal)};--blocked:${pct(q.blocked, qTotal)}"><div><strong>${q.passRate === null ? '—' : `${q.passRate}%`}</strong><span>pass</span></div></div>
          <div class="distribution-legend">
            <span><i class="signal pass"></i>Passed <b>${q.passed}</b><em>${pct(q.passed, qTotal)}%</em></span>
            <span><i class="signal fail"></i>Failed <b>${q.failed}</b><em>${pct(q.failed, qTotal)}%</em></span>
            <span><i class="signal blocked"></i>Blocked <b>${q.blocked}</b><em>${pct(q.blocked, qTotal)}%</em></span>
            <span><i class="signal neutral"></i>Not executed <b>${q.notExecuted}</b><em>${pct(q.notExecuted, qTotal)}%</em></span>
          </div>
        </div>
      </article>
      <article class="card activity-card">
        <div class="card-heading"><div><span class="kicker">OPERATIONS</span><h2>Zephyr activity</h2></div></div>
        <div class="operation-grid"><div><strong>${q.testCycles}</strong><span>test cycles</span></div><div><strong>${q.testPlans}</strong><span>test plans</span></div><div><strong>${q.testCases}</strong><span>test cases</span></div><div><strong>${q.executions}</strong><span>executions</span></div></div>
        <p class="context-note">Source · ${esc(q.source)}</p>
      </article>
    </section>
    <section class="collections-grid">
      <article class="card collection-card"><div class="card-heading"><div><span class="kicker">CYCLES</span><h2>Test cycles</h2></div></div>${collectionRows(q.cycles, 'No live cycles available')}</article>
      <article class="card collection-card"><div class="card-heading"><div><span class="kicker">PLANS</span><h2>Test plans</h2></div></div>${collectionRows(q.plans, 'No live plans available')}</article>
    </section>
  </div>`;
  app.innerHTML = shell(content, 'quality');
  bindGlobalEvents();
}

function renderNotFound() {
  const content = `<div class="page not-found"><span class="brand-mark">Q</span><h1>Page not found</h1><a href="${routeHref('/')}" data-route>Return to overview</a></div>`;
  app.innerHTML = shell(content);
  bindGlobalEvents();
}

function bindGlobalEvents() {
  document.querySelector('#refresh')?.addEventListener('click', load);
  document.querySelector('#space-select')?.addEventListener('change', event => {
    const url = new URL(location.href);
    url.searchParams.set('space', event.target.value);
    history.pushState({}, '', `${url.pathname}${url.search}`);
    load();
  });
}

function jiraLiveLabel() {
  return dashboard.connection.jira.includes('Live') ? 'Live' : 'Snapshot';
}

function renderRoute() {
  const path = decodeURIComponent(location.pathname.replace(/\/$/, '') || '/');
  if (path === '/') renderOverview();
  else if (path === '/pis') renderProgram();
  else if (/^\/pis\/\d+$/.test(path)) renderPiDetail(path.split('/')[2]);
  else if (/^\/pis\/\d+\/sprints\/\d+$/.test(path)) renderSprintDetail(path.split('/')[2], path.split('/')[4]);
  else if (path === '/epics') renderEpics();
  else if (path === '/quality') renderQuality();
  else if (path.startsWith('/epics/')) renderEpicDetail(path.split('/').pop());
  else renderNotFound();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function load() {
  app.classList.add('is-loading');
  try {
    const selectedSpace = new URLSearchParams(location.search).get('space');
    const response = await fetch(`/api/dashboard${selectedSpace ? `?space=${encodeURIComponent(selectedSpace)}` : ''}`);
    dashboard = await response.json();
    if (!response.ok && !dashboard.metrics) throw new Error(dashboard.error || 'Dashboard request failed');
    if (!selectedSpace || selectedSpace !== dashboard.space.key) {
      const url = new URL(location.href);
      url.searchParams.set('space', dashboard.space.key);
      history.replaceState({}, '', `${url.pathname}${url.search}`);
    }
    renderRoute();
  } catch {
    app.innerHTML = '<div class="load-error"><span class="brand-mark">Q</span><h1>Dashboard unavailable</h1><p>Check the local server and try again.</p><button onclick="location.reload()">Try again</button></div>';
  } finally {
    app.classList.remove('is-loading');
  }
}

document.addEventListener('click', event => {
  const link = event.target.closest('[data-route]');
  if (!link) return;
  event.preventDefault();
  history.pushState({}, '', link.getAttribute('href'));
  renderRoute();
});

window.addEventListener('popstate', renderRoute);
load();
