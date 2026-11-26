/* Navigation: hash router, left panel, ticket dashboard, ticket-list header.
   Screens: #/dashboard (home), #/tickets?...filters, #/meetings?...filters, and #123 for a ticket on top of any screen.
   Every chart / number links to #/tickets?... so a click always lands on the matching tickets. */

const VIEW_LABELS = {
  all: 'All tickets', active: 'Active tickets', open: 'Open', pending: 'Pending', mine: 'Assigned to me',
  unassigned: 'Unassigned', urgent: 'Urgent & High', resolved: 'Resolved', closed: 'Closed', trash: 'Trash',
};
const VIEW_HINTS = {
  all: 'Everything, newest first: the Desk365 history plus tickets created here.',
  active: 'Tickets that are still being worked: Open and Pending.',
  open: 'Tickets waiting for someone to pick them up or reply.',
  pending: 'Tickets waiting on someone else before work can continue.',
  mine: 'Open and Pending tickets assigned to you.',
  unassigned: 'Open and Pending tickets that nobody owns yet.',
  urgent: 'Open and Pending tickets at High or Urgent priority.',
  resolved: 'Tickets marked resolved.',
  closed: 'Finished tickets, kept for reference.',
  trash: 'Tickets moved to Trash. They stay out of every list, count and chart until restored. Nothing is deleted for good.',
};
const STATUS_COLOR = { Open: 'var(--warn)', Pending: 'var(--accent)', Resolved: 'var(--good)', Closed: '#94a3b8' };
const PRIORITY_COLOR = { 20: 'var(--bad)', 10: 'var(--warn)', 5: 'var(--accent)', 1: '#94a3b8' };
const CAT_COLORS = ['#0a73e0', '#f26f21', '#0ea5a4', '#8b5cf6', '#e11d48', '#16a34a', '#eab308', '#64748b', '#06b6d4', '#d946ef'];
const AGE_COLORS = ['var(--good)', '#84cc16', '#eab308', '#f97316', 'var(--bad)'];
const DASH_PERIODS = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '12 months'], [0, 'All time']];

state.route = null; state.routeHash = '#/dashboard'; state.dashDays = 30; state.dash = null;
const ticketsHref = obj => '#/tickets?' + new URLSearchParams(obj).toString();
const etToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const who = email => email ? (typeof personName === 'function' ? personName(email) : name(email)) : 'Unassigned';

/* ---------------------------------------------------------------- router */
function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (/^\d+$/.test(raw)) return { ticket: Number(raw) };
  const [path, qs = ''] = raw.split('?');
  return { route: ['dashboard', 'tickets', 'meetings'].includes(path) ? path : 'dashboard', params: new URLSearchParams(qs) };
}
function applyRoute() {
  if (!state.staff) return;
  const r = parseRoute();
  if (r.ticket) {                                   // #123: the ticket opens over whatever screen is underneath
    if (state.openTicket !== r.ticket) openTicket(r.ticket);
    if (!state.route) showRoute('dashboard', new URLSearchParams());
    return;
  }
  if (state.openTicket) { show('overlay', false); show('drawer', false); state.openTicket = null; }
  state.routeHash = r.route === 'dashboard' && !location.hash ? '#/dashboard' : (location.hash || '#/dashboard');
  showRoute(r.route, r.params);
}
function showRoute(route, params) {
  state.route = route;
  ['dashboard', 'tickets', 'meetings'].forEach(v => show('view' + v[0].toUpperCase() + v.slice(1), v === route));
  if (route === 'dashboard') renderDashboard();
  else if (route === 'tickets') applyTicketParams(params);
  else applyMeetingParams(params);
  renderSidebar(); closeSide();
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', applyRoute);

/* ---------------------------------------------------------------- left panel */
function renderSidebar() {
  if (!state.staff) return;
  const c = state.counts, n = k => c ? Number(c[k] ?? 0).toLocaleString() : '…';
  const onT = state.route === 'tickets', cat = onT ? $('fCategory').value : '';
  const nav = ({ href, ic, label, count, active, hot }) =>
    `<a class="nav ${active ? 'active' : ''} ${hot ? 'hot' : ''}" href="${href}" ${active ? 'aria-current="page"' : ''}>${Charts.icon(ic, 18)}<span class="l">${Charts.esc(label)}</span>${count != null ? `<span class="n">${count}</span>` : ''}</a>`;
  const view = (id, ic, label, key, hot) => nav({ href: id === 'all' ? '#/tickets' : ticketsHref({ view: id }), ic, label, count: n(key || id), active: onT && state.view === id && !cat, hot: hot && c && c[key || id] > 0 });
  const cats = c && c.cats ? Object.entries(c.cats).sort((a, b) => b[1] - a[1]) : [];
  const mt = typeof meetingsOpenForMe === 'function' ? meetingsOpenForMe() : null;
  const mroute = state.route === 'meetings', mp = new URLSearchParams(location.hash.split('?')[1] || '');
  $('side').innerHTML = `
    <button class="primary newbtn" id="sideNew" type="button">${Charts.icon('plus', 17)} New ticket</button>
    <div class="grp"><h4>Overview</h4>${nav({ href: '#/dashboard', ic: 'layout', label: 'Dashboard', active: state.route === 'dashboard' })}</div>
    <div class="grp"><h4>Tickets</h4>
      ${view('all', 'inbox', 'All tickets', 'all')}
      ${view('active', 'active', 'Open + Pending', 'active')}
      ${view('open', 'dot', 'Open', 'open')}
      ${view('pending', 'clock', 'Pending', 'pending')}
      ${view('mine', 'user', 'Assigned to me', 'mine')}
      ${view('unassigned', 'userx', 'Unassigned', 'unassigned')}
      ${view('urgent', 'flame', 'Urgent & High', 'urgent', true)}
      ${view('resolved', 'check', 'Resolved', 'resolved')}
      ${view('closed', 'archive', 'Closed', 'closed')}
      ${view('trash', 'trash', 'Trash', 'trash')}
    </div>
    ${cats.length ? `<div class="grp"><details open><summary>Active by category</summary>${cats.map(([k, v]) =>
      nav({ href: ticketsHref({ view: 'active', cat: k }), ic: 'folder', label: k, count: v.toLocaleString(), active: onT && cat === k })).join('')}</details></div>` : ''}
    <div class="grp"><h4>Meetings</h4>
      ${nav({ href: '#/meetings', ic: 'calendar', label: 'Overview', active: mroute && !mp.get('tab') })}
      ${nav({ href: '#/meetings?tab=items&items=open&mine=1', ic: 'checks', label: 'My action items', count: mt == null ? '…' : mt, active: mroute && mp.get('tab') === 'items' && mp.get('mine') === '1', hot: mt > 0 })}
      ${nav({ href: '#/meetings?tab=items&items=open', ic: 'list', label: 'All open items', active: mroute && mp.get('tab') === 'items' && mp.get('mine') !== '1' })}
    </div>`;
}
$('side').addEventListener('click', e => { if (e.target.closest('#sideNew')) { openNewTicket(); closeSide(); } });
function openSide() { $('side').classList.add('open'); show('scrim', true); $('menuBtn').setAttribute('aria-expanded', 'true'); }
function closeSide() { $('side').classList.remove('open'); show('scrim', false); $('menuBtn').setAttribute('aria-expanded', 'false'); }
$('menuBtn').addEventListener('click', () => $('side').classList.contains('open') ? closeSide() : openSide());
$('scrim').addEventListener('click', closeSide);

/* ---------------------------------------------------------------- ticket list: filters <-> address, header, chips */
function ticketsParams() {
  const p = new URLSearchParams();
  if (state.view !== 'all') p.set('view', state.view);
  const map = { status: 'fStatus', cat: 'fCategory', assignee: 'fAssigned', priority: 'fPriority', from: 'fFrom', to: 'fTo', q: 'q' };
  for (const [k, id] of Object.entries(map)) if ($(id).value) p.set(k, $(id).value);
  if (state.sort !== 'ticket_number' || state.asc) { p.set('sort', state.sort); p.set('dir', state.asc ? 'asc' : 'desc'); }
  if (state.page > 0) p.set('page', state.page + 1);
  return p;
}
function syncTicketsHash() {
  if (state.route !== 'tickets') return;
  const qs = ticketsParams().toString(), h = '#/tickets' + (qs ? '?' + qs : '');
  state.routeHash = h;
  if (!state.openTicket && location.hash !== h) history.replaceState(null, '', location.pathname + h);   // no new history entry per keystroke
}
function setSelect(id, value) {
  const el = $(id);
  if (value && ![...el.options].some(o => o.value === value)) {
    const o = document.createElement('option'); o.value = value; o.textContent = id === 'fAssigned' ? who(value) : value; el.appendChild(o);
  }
  el.value = value || '';
}
function applyTicketParams(p) {
  state.view = VIEW_LABELS[p.get('view')] ? p.get('view') : 'all';
  setSelect('fStatus', p.get('status')); setSelect('fCategory', p.get('cat')); setSelect('fAssigned', p.get('assignee'));
  $('fPriority').value = p.get('priority') || ''; $('fFrom').value = p.get('from') || ''; $('fTo').value = p.get('to') || ''; $('q').value = p.get('q') || '';
  state.sort = p.get('sort') || 'ticket_number'; state.asc = p.get('dir') === 'asc';
  state.page = Math.max(0, Number(p.get('page') || 1) - 1);
  loadTickets();
}
function updateListHeader() {
  if (state.route !== 'tickets') return;
  $('listTitle').textContent = VIEW_LABELS[state.view] || 'Tickets';
  $('listSub').textContent = VIEW_HINTS[state.view] || '';
  const base = ticketsParams(), without = key => { const q = new URLSearchParams(base); q.delete(key); q.delete('page'); return '#/tickets' + (q.toString() ? '?' + q : ''); };
  const chip = (label, key) => `<a class="af" href="${without(key)}" title="Remove this filter">${Charts.esc(label)}<b>${Charts.icon('x', 11)}</b></a>`;
  const prioName = { 20: 'Urgent', 10: 'High', 5: 'Medium', 1: 'Low' };
  const out = [];
  if (state.view !== 'all') out.push(chip('View: ' + VIEW_LABELS[state.view], 'view'));
  if ($('fStatus').value) out.push(chip('Status: ' + $('fStatus').value, 'status'));
  if ($('fCategory').value) out.push(chip('Category: ' + ($('fCategory').value === '_none' ? '(none)' : $('fCategory').value), 'cat'));
  if ($('fAssigned').value) out.push(chip('Assigned to: ' + ($('fAssigned').value === '__me__' ? 'me' : who($('fAssigned').value)), 'assignee'));
  if ($('fPriority').value) out.push(chip('Priority: ' + prioName[$('fPriority').value], 'priority'));
  if ($('fFrom').value || $('fTo').value) {
    const a = $('fFrom').value, b = $('fTo').value, L = x => Charts.bucketLabel(x, 'day');
    const label = a && b ? (a === b ? 'Created: ' + L(a) : `Created: ${L(a)} → ${L(b)}`) : a ? `Created since ${L(a)}` : `Created up to ${L(b)}`;
    const q = new URLSearchParams(base); q.delete('from'); q.delete('to'); q.delete('page');
    out.push(`<a class="af" href="#/tickets${q.toString() ? '?' + q : ''}" title="Remove this filter">${Charts.esc(label)}<b>${Charts.icon('x', 11)}</b></a>`);
  }
  if ($('q').value) out.push(chip('Search: “' + $('q').value + '”', 'q'));
  if (out.length > 1) out.push('<a class="af clear" href="#/tickets">Clear all</a>');
  $('activeFilters').innerHTML = out.join('');
  renderSidebar();
}
// the list's own controls update the address as they change (app.js calls loadTickets, which calls syncTicketsHash)

/* ---------------------------------------------------------------- ticket dashboard */
function invalidateDash() { state.dash = null; if (state.route === 'dashboard') renderDashboard(); }
$('viewDashboard').addEventListener('click', e => {
  const b = e.target.closest('[data-days]'); if (!b) return;
  state.dashDays = Number(b.dataset.days); state.dash = null; renderDashboard();
});

function dashboardSkeleton() {
  const k = () => `<div class="kpi" style="pointer-events:none"><div class="kpi-top">${sk(36, 36)}${sk(110, 12)}</div>${sk(90, 30)}${sk(150, 10)}</div>`;
  const c = (cls, h) => `<div class="card ${cls}" style="pointer-events:none">${sk(160, 14)}<div style="margin-top:16px">${sk(Math.round(h * 2.6), h)}</div></div>`;
  return `<div class="hello"><div>${sk(280, 30)}<div style="margin-top:8px">${sk(220, 12)}</div></div></div>
    <div class="kpis">${Array.from({ length: 7 }, k).join('')}</div>
    <div class="dgrid">${c('w8', 150)}${c('', 150)}${c('', 120)}${c('', 120)}${c('', 120)}</div>`;
}

async function renderDashboard() {
  const el = $('viewDashboard'), days = state.dashDays;
  if (state.dash && state.dash.days === days && Date.now() - state.dash.at < 60000) { paintDashboard(state.dash.data); return; }
  if (!el.children.length || !state.dash) el.innerHTML = dashboardSkeleton();
  const [res] = await Promise.all([sb.rpc('ticket_dashboard', { p_days: days }), (typeof loadFormOptions === 'function' ? loadFormOptions().catch(() => null) : null)]);
  if (state.route !== 'dashboard' || state.dashDays !== days) return;
  if (res.error || !res.data) { el.innerHTML = `<div class="card w12"><h3>Couldn't load the dashboard</h3><p class="hint">${Charts.esc(res.error ? res.error.message : 'No data')}</p></div>`; return; }
  state.dash = { days, data: res.data, at: Date.now() };
  paintDashboard(res.data);
}

function delta(cur, prev, upIsGood) {
  if (!prev) return null;
  const pct = Math.round((cur - prev) / prev * 100);
  if (pct === 0) return { cls: 'flat', text: '▬ same as before' };
  const up = pct > 0, good = upIsGood == null ? null : (up === upIsGood);
  return { cls: good == null ? 'flat' : good ? 'good' : 'bad', text: `${up ? '▲' : '▼'} ${Math.abs(pct)}% vs previous` };
}

function paintDashboard(d) {
  const t = d.totals, p = d.period, days = state.dashDays, since = d.since;
  const periodName = days === 0 ? 'of all time' : days === 365 ? 'in the last 12 months' : `in the last ${days} days`;
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date()));
  const first = ((state.staff && state.staff.full_name) || '').trim().split(/\s+/)[0];
  const today = etToday(), dateText = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' });
  const mt = typeof meetingsOpenForMe === 'function' ? meetingsOpenForMe() : null;
  const range = (lo, hi) => ({ from: hi == null ? '' : Charts.addDays(today, -hi), to: Charts.addDays(today, -lo) });

  const kpis = [
    Charts.kpi({ href: ticketsHref({ view: 'active' }), label: 'Active tickets', value: t.active, icon: 'active', tone: 'accent', sub: `Open ${Charts.nf(t.open)} · Pending ${Charts.nf(t.pending)}` }),
    Charts.kpi({ href: ticketsHref({ view: 'urgent' }), label: 'Urgent & High', value: t.urgent, icon: 'flame', tone: 'bad', sub: 'need attention first' }),
    Charts.kpi({ href: ticketsHref({ view: 'unassigned' }), label: 'Unassigned', value: t.unassigned, icon: 'userx', tone: 'warn', sub: t.unassigned ? 'waiting for an owner' : 'everything has an owner' }),
    Charts.kpi({ href: ticketsHref({ view: 'mine' }), label: 'Assigned to me', value: t.mine, icon: 'user', tone: 'good', sub: 'your open + pending tickets' }),
    Charts.kpi({ href: ticketsHref(since ? { view: 'all', from: since } : { view: 'all' }), label: 'Created', value: p.created, icon: 'plus', tone: 'brass', delta: days ? delta(p.created, p.created_prev, null) : null, sub: periodName }),
    Charts.kpi({ href: ticketsHref({ view: 'closed' }), label: 'Closed or resolved', value: p.closed, icon: 'check', tone: 'good', delta: days ? delta(p.closed, p.closed_prev, true) : null, sub: p.median_days_to_close != null ? `typically in ${p.median_days_to_close} days` : periodName }),
    Charts.kpi({ href: '#/meetings?tab=items&items=open&mine=1', label: 'My meeting action items', value: mt == null ? '…' : mt, icon: 'checks', tone: 'accent', sub: 'open, from meetings you attended' }),
  ].join('');

  const gran = d.gran;
  const trend = Charts.columns({
    data: d.trend.map(x => ({ d: x.d, a: x.created, b: x.closed })), gran,
    a: { label: 'Created', color: 'var(--accent)' }, b: { label: 'Closed or resolved', color: 'var(--good)' },
    hrefFor: x => { const r = Charts.bucketRange(x.d, gran); return ticketsHref({ view: 'all', from: r.from, to: r.to }); },
    tipFor: x => `${gran === 'week' ? 'Week of ' : ''}${Charts.bucketLabel(x.d, gran)} · ${x.a} created · ${x.b} closed`,
  });

  const stDonut = Charts.donut({
    label: 'Tickets by status', centerValue: Charts.nf(t.all), centerLabel: 'tickets',
    items: d.by_status.map(s => ({ label: s.k, n: s.n, color: STATUS_COLOR[s.k] || '#94a3b8', href: ticketsHref({ view: String(s.k).toLowerCase() }) })),
  });
  const prioName = { 20: 'Urgent', 10: 'High', 5: 'Medium', 1: 'Low' };
  const prDonut = Charts.donut({
    label: 'Active tickets by priority', centerValue: Charts.nf(t.active), centerLabel: 'active',
    items: d.by_priority_active.map(s => ({ label: prioName[s.k] || s.k, n: s.n, color: PRIORITY_COLOR[s.k] || '#94a3b8', href: ticketsHref({ view: 'active', priority: s.k }) })),
  });
  const cats = Charts.hbars({
    empty: 'No tickets in this period',
    items: d.by_category_period.map((c, i) => ({ label: c.k === '(none)' ? 'No category' : c.k, n: c.n, color: CAT_COLORS[i % CAT_COLORS.length],
      href: ticketsHref(Object.assign({ view: 'all', cat: c.k === '(none)' ? '_none' : c.k }, since ? { from: since } : {})) })),
  });
  const owners = Charts.hbars({
    empty: 'No active tickets',
    items: d.by_assignee_active.map((a, i) => ({ label: a.k ? who(a.k) : 'Unassigned', n: a.n, color: a.k ? CAT_COLORS[i % CAT_COLORS.length] : 'var(--warn)',
      href: a.k ? ticketsHref({ view: 'active', assignee: a.k }) : ticketsHref({ view: 'unassigned' }) })),
  });
  const ages = Charts.vbars({
    empty: 'No active tickets',
    items: d.age_active.map((a, i) => { const r = range(a.lo, a.hi); return { label: a.k, n: a.n, color: AGE_COLORS[i], href: ticketsHref(Object.assign({ view: 'active' }, r.from ? { from: r.from } : {}, { to: r.to })) }; }),
  });
  const attn = d.attention.length ? `<div class="attn">${d.attention.map(a => {
    const age = Math.max(0, Math.floor((Date.now() - new Date(a.created_on).getTime()) / 86400000));
    return `<a href="#${a.n}"><span class="badge ${a.priority === 20 ? 'pb-urgent' : 'pb-high'}">${a.priority === 20 ? 'Urgent' : 'High'}</span>
      <span class="t"><b>${Charts.esc(a.subject || '(no subject)')}</b><span>#${a.n} · ${Charts.esc(who(a.assigned_to))}</span></span><span class="age">${age === 0 ? 'today' : age + (age === 1 ? ' day' : ' days')}</span></a>`;
  }).join('')}</div><a class="more" href="${ticketsHref({ view: 'urgent' })}">See all urgent &amp; high tickets →</a>` : '<p class="chart-empty">Nothing urgent. Nice work.</p>';

  const seg = DASH_PERIODS.map(([v, l]) => `<button type="button" data-days="${v}" class="${v === days ? 'on' : ''}">${l}</button>`).join('');
  $('viewDashboard').innerHTML = `
    <div class="hello"><div><p class="eyebrow">${Charts.esc(dateText)}</p><h1>${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}${first ? ', ' + Charts.esc(first) : ''}</h1>
      <p>Here is where tickets stand. Click any number, bar or slice to see those tickets.</p></div>
      <div class="seg" role="group" aria-label="Time period">${seg}</div></div>
    <div class="kpis">${kpis}</div>
    <div class="dgrid">
      <div class="card w8"><h3>Tickets over time</h3><p class="hint">Bars: tickets created. Line: tickets closed or resolved. Click a ${gran} to see its tickets.</p>${trend}</div>
      <div class="card"><h3>Where tickets stand</h3><p class="hint">All tickets, by status</p>${stDonut}</div>
      <div class="card"><h3>Active tickets by priority</h3><p class="hint">Open + Pending right now</p>${prDonut}</div>
      <div class="card"><h3>Busiest categories</h3><p class="hint">Created ${periodName}</p>${cats}</div>
      <div class="card"><h3>Who has the most open work</h3><p class="hint">Active tickets per person</p>${owners}</div>
      <div class="card w6"><h3>How long active tickets have been waiting</h3><p class="hint">Time since each active ticket was created. Older means more at risk.</p>${ages}</div>
      <div class="card w6"><h3>Needs attention</h3><p class="hint">Urgent and High tickets that have waited longest</p>${attn}</div>
    </div>`;
  Charts.countUp($('viewDashboard'));
}

Charts.initTips();
