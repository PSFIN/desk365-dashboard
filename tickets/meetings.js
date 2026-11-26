/* Meetings: AI notes from the notes tool. Dashboard first (numbers + charts), then the meetings and their action items,
   with "mark resolved" on every action item and open question. Every chart part links to a filtered list below. */

let meetings = null;            // meeting_notes rows (only meetings the signed-in person attended)
let itemStatus = new Map();     // "meetingKey|kind|idx" -> { resolved, by, at }
let allItems = [];              // every action item / open question, flattened
const MP = { period: 30, tab: 'meetings', items: 'all', owner: '', mine: false, week: '', series: '', q: '' };
const MPERIODS = [[30, '30 days'], [90, '90 days'], [0, 'All time']];
const whenFmtMeeting = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });
const mdate = ts => whenFmtMeeting.format(new Date(ts));
const etDate = ts => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
function weekStart(d) { const dow = new Date(d + 'T00:00:00Z').getUTCDay(); return Charts.addDays(d, -((dow + 6) % 7)); }   // Monday of that week

function resetMeetings() { meetings = null; itemStatus = new Map(); allItems = []; Object.assign(MP, { period: 30, tab: 'meetings', items: 'all', owner: '', mine: false, week: '', series: '', q: '' }); $('meetingList').innerHTML = ''; $('itemsList').innerHTML = ''; $('mDash').innerHTML = ''; }

// An action item is "yours" when its owner is your full name, or just your first name.
function isMine(owner) {
  const me = ((state.staff && state.staff.full_name) || '').trim().toLowerCase(), o = (owner || '').trim().toLowerCase();
  if (!me || !o) return false;
  return o === me || o === me.split(/\s+/)[0];
}
const itemKey = (key, kind, idx) => `${key}|${kind}|${idx}`;
const statusOf = i => itemStatus.get(itemKey(i.key, i.kind, i.idx)) || { resolved: false };
function meetingsOpenForMe() { return meetings == null ? null : allItems.filter(i => i.kind === 'action' && isMine(i.owner) && !statusOf(i).resolved).length; }

async function loadMeetingsData() {
  const [m, s] = await Promise.all([
    sb.from('meeting_notes').select('key,title,ended_at,speakers,recap').order('ended_at', { ascending: false }).limit(500),
    sb.from('meeting_item_status').select('meeting_key,kind,idx,resolved,resolved_by,resolved_at').limit(10000),
  ]);
  if (m.error) { meetings = []; $('mDash').innerHTML = `<div class="card w12"><h3>Couldn't load meetings</h3><p class="hint">${Charts.esc(m.error.message)}</p></div>`; return; }
  meetings = m.data;
  // The AI writes "Shinod" in one meeting and "Shinod Vengaloor" in another. A first name that matches exactly one known
  // person (from the attendee lists and the signed-in user) is shown as that person's full name, so counts add up.
  const people = new Set(((state.staff && state.staff.full_name) ? [state.staff.full_name.trim()] : []));
  meetings.forEach(mt => (mt.speakers || []).forEach(n => n && people.add(String(n).trim())));
  const byFirst = new Map();
  people.forEach(full => { if (!/\s/.test(full)) return; const f = full.split(/\s+/)[0].toLowerCase(); byFirst.set(f, byFirst.has(f) ? null : full); });
  const canon = o => { const t = (o || '').trim(); if (!t) return null; if (/\s/.test(t)) return t; return byFirst.get(t.toLowerCase()) || t; };
  meetings.forEach(mt => { const r = mt.recap; if (r && r.action_items) r.action_items.forEach(a => { a.owner = canon(a.owner); }); });
  itemStatus =new Map((s.data || []).map(r => [itemKey(r.meeting_key, r.kind, r.idx), { resolved: r.resolved, by: r.resolved_by, at: r.resolved_at }]));
  allItems = meetings.flatMap(mt => {
    const r = mt.recap || {};
    return [
      ...(r.action_items || []).map((a, idx) => ({ key: mt.key, title: mt.title, ended_at: mt.ended_at, kind: 'action', idx, task: a.task, owner: a.owner || null, due: a.due || null })),
      ...(r.open_questions || []).map((q, idx) => ({ key: mt.key, title: mt.title, ended_at: mt.ended_at, kind: 'question', idx, task: q, owner: null, due: null })),
    ];
  });
  renderSidebar();
  if (state.route === 'meetings') renderMeetingsView();
  if (state.route === 'dashboard' && state.dash) paintDashboard(state.dash.data);   // fills the "my action items" card
}

/* ---------------------------------------------------------------- address <-> filters */
const mHref = obj => '#/meetings' + (Object.keys(obj).length ? '?' + new URLSearchParams(obj).toString() : '');
function applyMeetingParams(p) {
  Object.assign(MP, {
    tab: p.get('tab') === 'items' ? 'items' : 'meetings', items: ['open', 'resolved'].includes(p.get('items')) ? p.get('items') : 'all',
    owner: p.get('owner') || '', mine: p.get('mine') === '1', week: p.get('week') || '', series: p.get('series') || '', q: p.get('q') || '',
    period: p.has('days') ? Number(p.get('days')) : MP.period,
  });
  $('mq').value = MP.q;
  renderMeetingsView();
}
function mParams() {
  const o = {};
  if (MP.tab === 'items') o.tab = 'items';
  if (MP.items !== 'all') o.items = MP.items;
  if (MP.owner) o.owner = MP.owner;
  if (MP.mine) o.mine = '1';
  if (MP.week) o.week = MP.week;
  if (MP.series) o.series = MP.series;
  if (MP.q) o.q = MP.q;
  if (MP.period !== 30) o.days = MP.period;
  return o;
}
function syncMeetingsHash() { const h = mHref(mParams()); state.routeHash = h; if (!state.openTicket && location.hash !== h) history.replaceState(null, '', location.pathname + h); renderSidebar(); }

/* ---------------------------------------------------------------- filtering */
const inPeriod = mt => MP.period === 0 || new Date(mt.ended_at).getTime() >= Date.now() - MP.period * 86400000;
function meetingText(mt) {
  const r = mt.recap || {};
  return [mt.title, (mt.speakers || []).join(' '), r.summary, (r.decisions || []).join(' '), (r.action_items || []).map(a => a.task + ' ' + (a.owner || '')).join(' '), (r.open_questions || []).join(' ')].join(' ').toLowerCase();
}
function meetingMatches(mt) {
  if (!inPeriod(mt)) return false;
  if (MP.week && weekStart(etDate(mt.ended_at)) !== MP.week) return false;
  if (MP.series && mt.title !== MP.series) return false;
  if (MP.q && !meetingText(mt).includes(MP.q.toLowerCase())) return false;
  const its = allItems.filter(i => i.key === mt.key);
  if (MP.owner && !its.some(i => (MP.owner === '_none' ? !i.owner : i.owner === MP.owner))) return false;
  if (MP.mine && !its.some(i => isMine(i.owner))) return false;
  if (MP.items === 'open' && !its.some(i => !statusOf(i).resolved)) return false;
  if (MP.items === 'resolved' && !its.some(i => statusOf(i).resolved)) return false;
  return true;
}
function itemMatches(i) {
  const mt = meetings.find(x => x.key === i.key);
  if (!mt || !inPeriod(mt)) return false;
  if (MP.week && weekStart(etDate(mt.ended_at)) !== MP.week) return false;
  if (MP.series && mt.title !== MP.series) return false;
  if (MP.owner && (MP.owner === '_none' ? i.owner : i.owner !== MP.owner)) return false;
  if (MP.mine && !isMine(i.owner)) return false;
  const done = statusOf(i).resolved;
  if (MP.items === 'open' && done) return false;
  if (MP.items === 'resolved' && !done) return false;
  if (MP.q && !(`${i.task} ${i.owner || ''} ${i.title}`).toLowerCase().includes(MP.q.toLowerCase())) return false;
  return true;
}

/* ---------------------------------------------------------------- the screen */
function renderMeetingsView() {
  if (state.route !== 'meetings') return;
  $('mPeriod').innerHTML = MPERIODS.map(([v, l]) => `<button type="button" data-mdays="${v}" class="${v === MP.period ? 'on' : ''}">${l}</button>`).join('');
  if (meetings == null) { $('mDash').innerHTML = skeletonCards(3); return; }
  paintMeetingsDash();
  $('mTabs').innerHTML = `<button type="button" data-mtab="meetings" class="${MP.tab === 'meetings' ? 'on' : ''}">Meetings</button><button type="button" data-mtab="items" class="${MP.tab === 'items' ? 'on' : ''}">Action items</button>`;
  $('mStatus').classList.toggle('hidden', MP.tab !== 'items');
  $('mStatus').innerHTML = [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([v, l]) => `<button type="button" data-mstatus="${v}" class="${MP.items === v ? 'on' : ''}">${l}</button>`).join('');
  paintMeetingsFilters();
  paintMeetingsLists();
  syncMeetingsHash();
}

function paintMeetingsDash() {
  const ms = meetings.filter(inPeriod), keys = new Set(ms.map(m => m.key));
  const its = allItems.filter(i => keys.has(i.key)), actions = its.filter(i => i.kind === 'action');
  const openA = actions.filter(i => !statusOf(i).resolved), doneA = actions.length - openA.length;
  const mine = openA.filter(i => isMine(i.owner)).length, decisions = ms.reduce((a, m) => a + ((m.recap && m.recap.decisions) || []).length, 0);
  const pct = actions.length ? Math.round(doneA / actions.length * 100) : 0;
  const hd = MP.period === 0 ? {} : { days: MP.period };

  const kpis = [
    Charts.kpi({ href: mHref(hd), label: 'Meetings', value: ms.length, icon: 'calendar', tone: 'accent', sub: MP.period ? `in the last ${MP.period} days` : 'all time' }),
    Charts.kpi({ href: mHref(Object.assign({ tab: 'items', items: 'open' }, hd)), label: 'Open action items', value: openA.length, icon: 'checks', tone: 'warn', sub: `of ${actions.length} raised` }),
    Charts.kpi({ href: mHref(Object.assign({ tab: 'items', items: 'resolved' }, hd)), label: 'Resolved', value: `${pct}%`, icon: 'check', tone: 'good', sub: `${doneA} of ${actions.length} action items` }),
    Charts.kpi({ href: mHref({ tab: 'items', items: 'open', mine: '1' }), label: 'Open for me', value: mine, icon: 'user', tone: 'bad', sub: mine ? 'your action items' : 'you are all caught up' }),
    Charts.kpi({ href: mHref(hd), label: 'Decisions recorded', value: decisions, icon: 'trend', tone: 'brass', sub: 'agreed in these meetings' }),
  ].join('');

  // meetings per week (bars) and action items raised (line)
  const today = etToday(), first = ms.length ? weekStart(etDate(ms[ms.length - 1].ended_at)) : weekStart(today);
  const startWk = MP.period ? weekStart(Charts.addDays(today, -MP.period)) : first;
  const weeks = []; for (let w = startWk; w <= weekStart(today); w = Charts.addDays(w, 7)) weeks.push(w);
  const perWeek = new Map(weeks.map(w => [w, { d: w, a: 0, b: 0 }]));
  ms.forEach(m => { const w = perWeek.get(weekStart(etDate(m.ended_at))); if (w) w.a++; });
  actions.forEach(i => { const m = meetings.find(x => x.key === i.key), w = perWeek.get(weekStart(etDate(m.ended_at))); if (w) w.b++; });
  const weekly = Charts.columns({ data: [...perWeek.values()], gran: 'week', a: { label: 'Meetings', color: 'var(--accent)' }, b: { label: 'Action items raised', color: 'var(--brass)' },
    hrefFor: x => mHref({ week: x.d }), tipFor: x => `Week of ${Charts.bucketLabel(x.d, 'week')} · ${x.a} meetings · ${x.b} action items` });

  const status = Charts.donut({ label: 'Action items by status', centerValue: Charts.nf(actions.length), centerLabel: 'action items',
    items: [{ label: 'Open', n: openA.length, color: 'var(--warn)', href: mHref({ tab: 'items', items: 'open' }) }, { label: 'Resolved', n: doneA, color: 'var(--good)', href: mHref({ tab: 'items', items: 'resolved' }) }] });

  const byOwner = new Map(); openA.forEach(i => byOwner.set(i.owner || '_none', (byOwner.get(i.owner || '_none') || 0) + 1));
  const owners = Charts.hbars({ empty: 'No open action items. Everything is resolved.',
    items: [...byOwner].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([o, n], i) => ({ label: o === '_none' ? 'No owner named' : o, n, color: o === '_none' ? 'var(--warn)' : CAT_COLORS[i % CAT_COLORS.length], href: mHref({ tab: 'items', items: 'open', owner: o }) })) });

  const bySeries = new Map(); ms.forEach(m => bySeries.set(m.title, (bySeries.get(m.title) || 0) + 1));
  const series = Charts.hbars({ empty: 'No meetings in this period',
    items: [...bySeries].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([t, n], i) => ({ label: t, n, color: CAT_COLORS[(i + 3) % CAT_COLORS.length], href: mHref({ series: t }) })) });

  const oldest = openA.filter(i => i.kind === 'action').sort((a, b) => new Date(a.ended_at) - new Date(b.ended_at)).slice(0, 5);
  const followUp = oldest.length ? oldest.map(i => itemRow(i, true)).join('') + `<a class="more" href="${mHref({ tab: 'items', items: 'open' })}">See all open action items →</a>` : '<p class="chart-empty">No open action items. Nice work.</p>';

  $('mDash').innerHTML = `<div class="kpis">${kpis}</div>
    <div class="dgrid">
      <div class="card w8"><h3>Meetings per week</h3><p class="hint">Bars: meetings held. Line: action items raised. Click a week to see its meetings.</p>${weekly}</div>
      <div class="card"><h3>Action items</h3><p class="hint">Open vs resolved</p>${status}</div>
      <div class="card"><h3>Open items by person</h3><p class="hint">Who still owes an action item</p>${owners}</div>
      <div class="card"><h3>Most frequent meetings</h3><p class="hint">Click one to see just those</p>${series}</div>
      <div class="card"><h3>Follow up first</h3><p class="hint">Oldest open action items. Tick one when it is done.</p><div id="followUp">${followUp}</div></div>
    </div>`;
  Charts.countUp($('mDash'));
}

function paintMeetingsFilters() {
  const chip = (label, key) => { const o = mParams(); delete o[key]; return `<a class="af" href="${mHref(o)}" title="Remove this filter">${Charts.esc(label)}<b>${Charts.icon('x', 11)}</b></a>`; };
  const out = [];
  if (MP.week) out.push(chip('Week of ' + Charts.bucketLabel(MP.week, 'week'), 'week'));
  if (MP.series) out.push(chip('Meeting: ' + MP.series, 'series'));
  if (MP.owner) out.push(chip('Owner: ' + (MP.owner === '_none' ? 'none named' : MP.owner), 'owner'));
  if (MP.mine) out.push(chip('Only mine', 'mine'));
  if (MP.q) out.push(chip('Search: “' + MP.q + '”', 'q'));
  if (out.length) out.push(`<a class="af clear" href="${mHref(MP.tab === 'items' ? { tab: 'items' } : {})}">Clear all</a>`);
  $('mActive').innerHTML = out.join('');
}

function itemRow(i, compact) {
  const st = statusOf(i), done = st.resolved, by = st.by ? who(st.by) : '';
  return `<div class="irow ${done ? 'done' : ''}" data-ik="${Charts.esc(i.key)}" data-kind="${i.kind}" data-idx="${i.idx}">
    <button type="button" class="tick ${done ? 'on' : ''}" data-tick aria-pressed="${done}" aria-label="${done ? 'Re-open this item' : 'Mark this item resolved'}" title="${done ? 'Re-open' : 'Mark resolved'}">${Charts.icon('check', 14)}</button>
    <div><div class="task">${Charts.esc(i.task)}</div>
      <div class="sub">${i.kind === 'question' ? 'Open question · ' : ''}${i.owner ? '<b>' + Charts.esc(i.owner) + '</b>' + (isMine(i.owner) ? ' (you)' : '') + ' · ' : ''}${i.due ? 'due ' + Charts.esc(i.due) + ' · ' : ''}<a href="#" data-open-meeting="${Charts.esc(i.key)}">${Charts.esc(i.title)}</a> · ${Charts.esc(mdate(i.ended_at).split(',').slice(0, 2).join(','))}</div></div>
    <div class="side-info">${done ? `Resolved${by ? ' by ' + Charts.esc(by) : ''}${st.at ? '<br>' + Charts.esc(mdate(st.at).split(',').slice(0, 2).join(',')) : ''}` : compact ? '' : 'Open'}</div></div>`;
}

function paintMeetingsLists() {
  const ml = $('meetingList'), il = $('itemsList'), empty = $('mEmpty');
  show('meetingList', MP.tab === 'meetings'); show('itemsList', MP.tab === 'items');
  if (MP.tab === 'meetings') {
    const list = meetings.filter(meetingMatches);
    ml.innerHTML = list.map(m => {
      const its = allItems.filter(i => i.key === m.key), total = its.length, done = its.filter(i => statusOf(i).resolved).length, open = total - done;
      return `<div class="mcard" data-key="${Charts.esc(m.key)}"><h4>${Charts.esc(m.title)}${open ? `<span class="chip">${open} open</span>` : total ? '<span class="chip" style="color:var(--good);background:var(--good-bg);border-color:var(--good-border)">all resolved</span>' : ''}</h4>
        <div class="sub">${Charts.esc(mdate(m.ended_at))} · ${Charts.esc((m.speakers || []).join(', ') || 'no speakers recorded')}</div>
        <p>${Charts.esc((m.recap || {}).summary)}</p>
        ${total ? `<div class="mprog" title="${done} of ${total} resolved"><i style="width:${Math.round(done / total * 100)}%"></i></div><div class="mrow"><span>${done} of ${total} resolved</span></div>` : ''}</div>`;
    }).join('');
    empty.textContent = list.length ? '' : (meetings.length ? 'No meetings match these filters.' : 'No meeting notes yet. Notes appear here for Teams meetings you attended, once they have been processed.');
    show('mEmpty', list.length === 0);
  } else {
    const list = allItems.filter(itemMatches).sort((a, b) => new Date(b.ended_at) - new Date(a.ended_at) || a.idx - b.idx);
    il.innerHTML = list.map(i => itemRow(i, false)).join('');
    empty.textContent = list.length ? '' : (MP.items === 'open' ? 'No open action items match. Nice work.' : 'No action items match these filters.');
    show('mEmpty', list.length === 0);
  }
}

/* ---------------------------------------------------------------- mark resolved */
let toastTimer;
function toast(text, undo) {
  const t = $('toast'); t.innerHTML = `<span>${Charts.esc(text)}</span>${undo ? '<button type="button" id="toastUndo">Undo</button>' : ''}`; show('toast', true);
  if (undo) $('toastUndo').onclick = () => { show('toast', false); undo(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => show('toast', false), 6000);
}
async function setItem(key, kind, idx, resolved, quiet) {
  const k = itemKey(key, kind, idx), before = itemStatus.get(k);
  itemStatus.set(k, { resolved, by: state.email, at: new Date().toISOString() });       // update the screen first
  refreshMeetingScreens(key);
  const { error } = await sb.rpc('set_meeting_item', { p_key: key, p_kind: kind, p_idx: idx, p_resolved: resolved });
  if (error) { before ? itemStatus.set(k, before) : itemStatus.delete(k); refreshMeetingScreens(key); toast("Couldn't save that: " + error.message); return; }
  if (!quiet) toast(resolved ? 'Marked resolved' : 'Re-opened', () => setItem(key, kind, idx, !resolved, true));
}
function refreshMeetingScreens(openKey) {
  Charts.countUp.skip = true;
  try {
    if (state.route === 'meetings') renderMeetingsView();
    if (state.route === 'dashboard' && state.dash) paintDashboard(state.dash.data);
  } finally { Charts.countUp.skip = false; }
  renderSidebar();
  if (openKey && state.openMeeting === openKey) openMeeting(openKey, true);
}

document.addEventListener('click', e => {
  const tick = e.target.closest('[data-tick]');
  if (tick) { const r = tick.closest('[data-ik]'); const i = allItems.find(x => x.key === r.dataset.ik && x.kind === r.dataset.kind && x.idx === Number(r.dataset.idx)); if (i) setItem(i.key, i.kind, i.idx, !statusOf(i).resolved); return; }
  const om = e.target.closest('[data-open-meeting]'); if (om) { e.preventDefault(); openMeeting(om.dataset.openMeeting); return; }
  const card = e.target.closest('.mcard[data-key]'); if (card) { openMeeting(card.dataset.key); return; }
  const md = e.target.closest('[data-mdays]'); if (md) { MP.period = Number(md.dataset.mdays); renderMeetingsView(); return; }
  const mt = e.target.closest('[data-mtab]'); if (mt) { MP.tab = mt.dataset.mtab; if (MP.tab === 'items' && MP.items === 'all') MP.items = 'open'; renderMeetingsView(); return; }
  const ms = e.target.closest('[data-mstatus]'); if (ms) { MP.items = ms.dataset.mstatus; renderMeetingsView(); return; }
});
let mSearchTimer;
$('mq').addEventListener('input', () => { clearTimeout(mSearchTimer); mSearchTimer = setTimeout(() => { MP.q = $('mq').value.trim(); if (meetings) { paintMeetingsFilters(); paintMeetingsLists(); syncMeetingsHash(); } }, 250); });

/* ---------------------------------------------------------------- one meeting (drawer) */
function openMeeting(key, keepScroll) {
  const m = (meetings || []).find(x => x.key === key); if (!m) return;
  state.openMeeting = key;
  const scroller = $('drawer'), top = scroller.scrollTop, r = m.recap || {};
  const mine = allItems.filter(i => i.key === key), done = mine.filter(i => statusOf(i).resolved).length;
  const ul = items => items && items.length ? `<ul class="plain">${items.map(i => `<li>${Charts.esc(i)}</li>`).join('')}</ul>` : '<span class="note">None</span>';
  const rowFor = (kind, idx, text, owner, due) => {
    const i = { key, kind, idx, task: text, owner, due }, st = statusOf(i), on = st.resolved;
    return `<div class="ai ${isMine(owner) ? 'mine' : ''} ${on ? 'done' : ''}" data-ik="${Charts.esc(key)}" data-kind="${kind}" data-idx="${idx}">
      <button type="button" class="tick ${on ? 'on' : ''}" data-tick aria-pressed="${on}" aria-label="${on ? 'Re-open' : 'Mark resolved'}" title="${on ? 'Re-open' : 'Mark resolved'}">${Charts.icon('check', 14)}</button>
      <div><div class="t">${Charts.esc(text)}</div><small>${owner ? Charts.esc(owner) + (isMine(owner) ? ' (you)' : '') : kind === 'question' ? 'Open question' : 'Unassigned'}${due ? ' · due ' + Charts.esc(due) : ''}${on ? ' · resolved' + (st.by ? ' by ' + Charts.esc(who(st.by)) : '') : ''}</small></div></div>`;
  };
  const actions = (r.action_items || []).map((a, idx) => rowFor('action', idx, a.task, a.owner, a.due)).join('');
  const questions = (r.open_questions || []).map((q, idx) => rowFor('question', idx, q, null, null)).join('');
  const topics = (r.topics || []).map(t => `<p><strong>${Charts.esc(t.title)}</strong>${t.start_time ? ` <span class="note">(${Charts.esc(t.start_time)})</span>` : ''}</p>${ul(t.points)}`).join('');
  $('drawer').innerHTML = `
    <button class="close" id="closeBtn">Close</button>
    <div class="note">Meeting notes · ${Charts.esc(mdate(m.ended_at))}</div>
    <h2>${Charts.esc(m.title)}</h2>
    <div class="note">Speakers: ${Charts.esc((m.speakers || []).join(', ') || '—')}</div>
    ${mine.length ? `<div class="mprog" style="margin-top:12px"><i style="width:${Math.round(done / mine.length * 100)}%"></i></div><div class="note" style="margin-top:4px">${done} of ${mine.length} resolved</div>` : ''}
    <h3>Summary</h3><p>${Charts.esc(r.summary)}</p>
    <h3>Action items</h3>${actions || '<span class="note">None</span>'}
    <h3>Decisions</h3>${ul(r.decisions)}
    <h3>Open questions</h3>${questions || '<span class="note">None</span>'}
    ${topics ? `<h3>Topics</h3>${topics}` : ''}
    <p class="note">AI-generated from the Teams transcript. Private to the people who attended; check anything important against the meeting.</p>`;
  show('overlay', true); show('drawer', true);
  $('closeBtn').onclick = () => { state.openMeeting = null; closeTicket(); };
  if (keepScroll) scroller.scrollTop = top;
}
