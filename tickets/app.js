// Public by design: the anon key only lets people sign in; row-level security decides what they can read.
const SUPABASE_URL = 'https://sfxaaxdkfmddisnntcty.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmeGFheGRrZm1kZGlzbm50Y3R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1ODc0NjYsImV4cCI6MjExMDE2MzQ2Nn0.SsjahDDBQFHJ9Ek8pRLPfutoi0mZmj5Tkyxr-DDvjOs';
// Loading feedback: a thin bar along the top of the window whenever anything is being fetched. Every request the
// Supabase client makes goes through trackedFetch; the bar appears only if it takes longer than a moment.
let pending = 0, barOn = null, barOff = null;
function netStart() {
  if (++pending !== 1) return;
  clearTimeout(barOff);
  barOn = setTimeout(() => { if (pending > 0) { const b = document.getElementById('topbar'); b.className = ''; void b.offsetWidth; b.className = 'on'; } }, 120);
}
function netEnd() {
  pending = Math.max(0, pending - 1);
  if (pending > 0) return;
  clearTimeout(barOn);
  const b = document.getElementById('topbar');
  if (b.classList.contains('on')) { b.className = 'done'; barOff = setTimeout(() => { b.className = ''; }, 700); }
}
const trackedFetch = (...args) => { netStart(); return fetch(...args).finally(netEnd); };
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: 'pkce' }, global: { fetch: trackedFetch } });

const PAGE_SIZE = 50;
const LIST_COLS = 'ticket_number,subject,status,priority,assigned_to,category,contact_name,contact_email,created_on,updated_on,origin';
const NATIVE_FROM = 100000;   // tickets created here are numbered from 100001; Desk365's archive stays below this
const DETAIL_COLS = 'ticket_number,subject,status,priority,type,source,assigned_to,group_name,category,subcategory,' +
  'contact_name,contact_email,company_name,form_name,sla,completed_within_sla,conversation_count,created_on,updated_on,' +
  'due_date,first_response_time,resolved_on,closed_on,watchers,share_to,custom_fields,description_text';
const PRIORITY = { 1: 'Low', 5: 'Medium', 10: 'High', 20: 'Urgent' };

const $ = id => document.getElementById(id);
const state = { page: 0, sort: 'ticket_number', asc: false, token: 0, staff: null, optionsLoaded: false };

// colour theme (light / dark), remembered per browser; same sun/moon button as the meetings tool
$('themeBtn').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch (e) { /* private window: just not remembered */ }
});

// splash while the sign-in state is being checked (and while Microsoft's code is exchanged on return)
let booted = false;
if (/[?&]code=/.test(location.search)) $('bootText').textContent = 'Signing you in…';
function hideBoot() { if (booted) return; booted = true; const b = $('boot'); b.classList.add('gone'); setTimeout(() => b.classList.add('hidden'), 350); }

// pulsing placeholders shown where data is about to appear
const sk = (w, h = 12) => `<span class="sk" style="width:${w}px;height:${h}px"></span>`;
function skeletonRows(n) {
  const widths = [40, 260, 70, 60, 110, 130, 90, 90, 90];
  return Array.from({ length: n }, (_, i) => `<tr>${widths.map(w => `<td>${sk(Math.round(w * (0.7 + ((i * 37) % 30) / 100)))}</td>`).join('')}</tr>`).join('');
}
const skeletonCards = n => Array.from({ length: n }, () => `<div class="mcard" style="pointer-events:none"><div>${sk(220, 16)}</div><div style="margin:8px 0">${sk(160)}</div>${sk(420)}</div>`).join('');
const drawerSkeleton = () => `<div style="padding-top:34px">${sk(120)}<div style="margin:12px 0 18px">${sk(380, 22)}</div>${sk(260)}<div style="margin:22px 0 10px">${sk(520, 64)}</div>${sk(420)}<div style="margin:10px 0">${sk(480)}</div>${sk(300)}</div>`;

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
const fmtET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
// Desk365's archive stores UTC with no zone marker; everything else carries one. Show all of it in Eastern time.
function fmt(ts) {
  if (!ts) return '—';
  const s = String(ts).replace(' ', 'T');
  const d = new Date(/(Z|[+-]\d\d(:?\d\d)?)$/.test(s) ? s : s + 'Z');
  return isNaN(d) ? String(ts) : fmtET.format(d).replace(',', '');
}
// Start / end of a calendar day in Eastern time (handles daylight saving), as an ISO string with an offset.
function etDay(d, end) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(new Date(end ? Date.parse(`${d}T00:00:00Z`) + 28 * 3600e3 : Date.parse(`${d}T05:00:00Z`))).find(p => p.type === 'timeZoneName').value;
  const h = parseInt(part.replace('GMT', ''), 10) || 0;
  return `${d}T${end ? '23:59:59' : '00:00:00'}${h < 0 ? '-' : '+'}${String(Math.abs(h)).padStart(2, '0')}:00`;
}
function show(id, on) { $(id).classList.toggle('hidden', !on); }
function name(email) { return email ? email.split('@')[0] : '—'; }

/* ---------- auth ---------- */
// Microsoft sign-in (Supabase "azure" provider, company tenant only). Same approach as the meetings tool.
$('msSignIn').addEventListener('click', async () => {
  const btn = $('msSignIn'), msg = $('loginMsg');
  btn.disabled = true; btn.classList.add('busy'); msg.className = 'msg'; msg.textContent = '';
  $('msLabel').textContent = 'Signing in…';
  try { sessionStorage.setItem('post_login_hash', location.hash); } catch (e) { /* private window: the deep link is just not restored */ }
  const { error } = await sb.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email', redirectTo: location.origin + location.pathname } });
  if (error) {                                   // otherwise the browser is already on its way to Microsoft
    btn.disabled = false; btn.classList.remove('busy'); $('msLabel').textContent = 'Sign in with Microsoft';
    msg.className = 'msg err'; msg.textContent = "Microsoft sign-in isn't available right now. " + error.message;
  }
});

// Back from Microsoft with a problem (declined, wrong account, ...): say so on the sign-in panel.
(function showReturnedError() {
  const q = new URLSearchParams(location.search), h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const text = q.get('error_description') || h.get('error_description');
  if (!text) return;
  history.replaceState(null, '', location.pathname);
  const msg = $('loginMsg'); msg.className = 'msg err'; msg.textContent = text.replace(/\+/g, ' ');
})();
$('signOut').addEventListener('click', () => sb.auth.signOut());

async function route(session) {
  hideBoot();
  const uid = session ? session.user.id : null;
  if (state.uid !== uid) {                      // a different person (or sign-out): drop anything cached for the last one
    state.uid = uid; formOpts = null; state.counts = null; state.view = 'all'; state.dash = null; state.staff = null; state.openTicket = null;
    if (typeof resetMeetings === 'function') resetMeetings();
    $('drawer').innerHTML = ''; show('drawer', false); show('overlay', false);
  }
  show('login', false); show('denied', false); show('app', false); show('signOut', false); show('side', false); show('menuBtn', false);
  document.body.classList.remove('authed');
  $('who').textContent = '';
  if (!session) { show('login', true); return; }
  $('who').textContent = session.user.email;
  show('signOut', true);
  const email = (session.user.email || '').toLowerCase();
  state.email = email;
  const { data, error } = await sb.from('staff').select('email,full_name,is_admin').eq('email', email).maybeSingle();
  if (error || !data) { $('deniedText').textContent = `${email} isn't on the staff list. Ask an admin to add you.`; show('denied', true); return; }
  state.staff = data;
  $('who').textContent = `${data.full_name || email}${data.is_admin ? ' · admin' : ''}`;
  document.body.classList.add('authed');
  show('side', true); show('menuBtn', true); show('app', true);
  loadCounts();
  if (typeof loadMeetingsData === 'function') loadMeetingsData();
  loadFormOptions().then(() => {                  // staff names, so charts say "Beth Evans" instead of "b.evans"
    if (state.uid !== uid) return;
    Charts.countUp.skip = true;
    try {
      if (state.route === 'dashboard' && state.dash) paintDashboard(state.dash.data);
      if (state.route === 'meetings' && typeof renderMeetingsView === 'function' && meetings) renderMeetingsView();
    } finally { Charts.countUp.skip = false; }
  }).catch(() => { /* names fall back to the email prefix */ });
  if (!state.optionsLoaded) await loadOptions();
  try {                                           // a link opened before sign-in comes back after it
    const saved = sessionStorage.getItem('post_login_hash'); sessionStorage.removeItem('post_login_hash');
    if (saved && (!location.hash || location.hash === '#')) history.replaceState(null, '', location.pathname + saved);
  } catch (e) { /* nothing saved */ }
  applyRoute();
}
sb.auth.onAuthStateChange((_evt, session) => { setTimeout(() => route(session), 0); });
setTimeout(() => { if (!booted) route(null); }, 8000);   // safety net: never leave the splash up forever

/* ---------- filters ---------- */
async function loadOptions() {
  const { data, error } = await sb.rpc('ticket_filter_options');
  if (error || !data) return;
  ['fStatus', 'fCategory', 'fAssigned'].forEach(id => [...$(id).options].forEach(o => { if (o.value !== '' && o.value !== '__me__') o.remove(); }));
  const fill = (id, vals) => vals.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = id === 'fAssigned' ? name(v) : v; $(id).appendChild(o); });
  fill('fStatus', data.status); fill('fCategory', data.category); fill('fAssigned', data.assigned);
  $('fCategory').insertAdjacentHTML('beforeend', '<option value="_none">(no category)</option>');
  state.optionsLoaded = true;
}
state.view = 'all'; state.counts = null;
const renderQViews = () => { if (typeof renderSidebar === 'function') renderSidebar(); if (typeof updateListHeader === 'function') updateListHeader(); };

async function loadCounts() {
  const { data, error } = await sb.rpc('ticket_view_counts');
  if (!error && data) { state.counts = data; if (typeof renderSidebar === 'function') renderSidebar(); }
}

// the pill's rule, applied on top of whatever else is filled in (search, category, dates)
function applyQuickView(q) {
  const ACTIVE = ['Open', 'Pending'];
  switch (state.view) {
    case 'active':     return q.in('status', ACTIVE);
    case 'open':       return q.eq('status', 'Open');
    case 'pending':    return q.eq('status', 'Pending');
    case 'resolved':   return q.eq('status', 'Resolved');
    case 'closed':     return q.eq('status', 'Closed');
    case 'mine':       return q.in('status', ACTIVE).eq('assigned_to', state.email || '');
    case 'unassigned': return q.in('status', ACTIVE).is('assigned_to', null);
    case 'urgent':     return q.in('status', ACTIVE).gte('priority', 10);
    default:           return q;
  }
}

function resetPage() { state.page = 0; loadTickets(); }
['fStatus', 'fCategory', 'fAssigned', 'fPriority', 'fFrom', 'fTo'].forEach(id => $(id).addEventListener('change', resetPage));
// choosing status / assignee / priority by hand means "I'm filtering myself": drop the pill so the two don't fight
['fStatus', 'fAssigned', 'fPriority'].forEach(id => $(id).addEventListener('change', () => { if (state.view !== 'all') { state.view = 'all'; renderQViews(); } }));
let searchTimer; $('q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(resetPage, 300); });
$('reset').addEventListener('click', () => {
  ['q', 'fStatus', 'fCategory', 'fAssigned', 'fPriority', 'fFrom', 'fTo'].forEach(id => $(id).value = '');
  state.view = 'all'; renderQViews();
  resetPage();
});
document.querySelectorAll('th.sortable').forEach(th => th.addEventListener('click', () => {
  const key = th.dataset.sort;
  if (state.sort === key) state.asc = !state.asc; else { state.sort = key; state.asc = key === 'assigned_to' || key === 'category'; }
  resetPage();
}));
$('prev').addEventListener('click', () => { if (state.page > 0) { state.page--; loadTickets(); } });
$('next').addEventListener('click', () => { state.page++; loadTickets(); });

/* ---------- list ---------- */
async function loadTickets() {
  const token = ++state.token;
  if (typeof syncTicketsHash === 'function') { syncTicketsHash(); updateListHeader(); }
  $('count').innerHTML = '<span class="spin"></span>&nbsp; Loading…';
  if (!$('rows').children.length) { $('rows').innerHTML = skeletonRows(10); show('empty', false); }
  else $('tableWrap').classList.add('loading');
  let q = applyQuickView(sb.from('all_tickets').select(LIST_COLS, { count: 'exact' }));   // Desk365 archive + tickets created here
  if ($('fStatus').value) q = q.eq('status', $('fStatus').value);
  if ($('fCategory').value === '_none') q = q.is('category', null);
  else if ($('fCategory').value) q = q.eq('category', $('fCategory').value);
  if ($('fAssigned').value) q = q.eq('assigned_to', $('fAssigned').value === '__me__' ? (state.email || '') : $('fAssigned').value);
  if ($('fPriority').value) q = q.eq('priority', Number($('fPriority').value));
  if ($('fFrom').value) q = q.gte('created_on', etDay($('fFrom').value, false));
  if ($('fTo').value) q = q.lte('created_on', etDay($('fTo').value, true));
  const term = $('q').value.trim().replace(/[*,()%\\]/g, ' ').trim();
  if (term) {
    if (/^#?\d+$/.test(term)) q = q.eq('ticket_number', Number(term.replace('#', '')));
    else q = q.or(`subject.ilike.*${term}*,contact_name.ilike.*${term}*,contact_email.ilike.*${term}*`);
  }
  q = q.order(state.sort, { ascending: state.asc, nullsFirst: false });
  if (state.sort !== 'ticket_number') q = q.order('ticket_number', { ascending: false });
  const from = state.page * PAGE_SIZE;
  const { data, count, error } = await q.range(from, from + PAGE_SIZE - 1);
  if (token !== state.token) return;           // a newer request superseded this one
  $('tableWrap').classList.remove('loading');
  if (error) { $('count').textContent = 'Error: ' + error.message; return; }
  renderRows(data, count, from);
}

function renderRows(rows, count, from) {
  $('rows').innerHTML = rows.map(t => `
    <tr class="row" data-n="${t.ticket_number}">
      <td class="num">${t.ticket_number}</td>
      <td class="subject">${esc(t.subject) || '<span class="note">(no subject)</span>'}${t.origin === 'native' ? '<span class="chip">new</span>' : ''}</td>
      <td><span class="badge st-${esc(t.status)}">${esc(t.status)}</span></td>
      <td><span class="pr pr-${t.priority}">${esc(PRIORITY[t.priority] || t.priority || '—')}</span></td>
      <td>${esc(name(t.assigned_to))}</td>
      <td>${esc(t.category) || '—'}</td>
      <td>${esc(t.contact_name || name(t.contact_email))}</td>
      <td class="num">${fmt(t.created_on)}</td>
      <td class="num">${fmt(t.updated_on)}</td>
    </tr>`).join('');
  show('empty', rows.length === 0);
  const to = from + rows.length;
  $('count').textContent = count === 0 ? '0 tickets' : `${from + 1}–${to} of ${count.toLocaleString()} tickets`;
  $('pageInfo').textContent = `Page ${state.page + 1} of ${Math.max(1, Math.ceil(count / PAGE_SIZE))}`;
  $('prev').disabled = state.page === 0;
  $('next').disabled = to >= count;
}
$('rows').addEventListener('click', e => {
  const tr = e.target.closest('tr.row'); if (tr) openTicket(Number(tr.dataset.n));
});

/* ---------- detail ---------- */
async function openTicket(n) {
  state.openTicket = n;
  history.replaceState(null, '', '#' + n);
  $('drawer').innerHTML = drawerSkeleton();
  show('overlay', true); show('drawer', true);
  if (n >= NATIVE_FROM) return openNativeTicket(n);
  const { data: t, error } = await sb.from('desk365_tickets').select(DETAIL_COLS).eq('ticket_number', n).maybeSingle();
  if (error || !t) { $('drawer').innerHTML = `<button class="close" id="closeBtn">Close</button><p>${esc(error ? error.message : 'Ticket not found or not visible to you.')}</p>`; $('closeBtn').onclick = closeTicket; return; }
  const meta = (label, val) => `<div><span>${label}</span>${val == null || val === '' ? '—' : esc(val)}</div>`;
  const custom = Object.entries(t.custom_fields || {}).filter(([k, v]) => v !== false)
    .map(([k, v]) => `<div><span>${esc(k)}</span>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</div>`).join('');
  $('drawer').innerHTML = `
    <button class="close" id="closeBtn">Close</button>
    <div class="note">Ticket #${t.ticket_number}</div>
    <h2>${esc(t.subject) || '(no subject)'}</h2>
    <span class="badge st-${esc(t.status)}">${esc(t.status)}</span>
    <span class="pr pr-${t.priority}"> ${esc(PRIORITY[t.priority] || '')}</span>
    <div class="meta">
      ${meta('Assigned to', t.assigned_to)}${meta('Group', t.group_name)}
      ${meta('Category', [t.category, t.subcategory].filter(Boolean).join(' › '))}${meta('Type', t.type)}
      ${meta('Contact', [t.contact_name, t.contact_email].filter(Boolean).join(' · '))}${meta('Company', t.company_name)}
      ${meta('Created', fmt(t.created_on))}${meta('Updated', fmt(t.updated_on))}
      ${meta('First response', fmt(t.first_response_time))}${meta('Due', fmt(t.due_date))}
      ${meta('Resolved', fmt(t.resolved_on))}${meta('Closed', fmt(t.closed_on))}
      ${meta('Form', t.form_name)}${meta('Replies / notes', t.conversation_count)}
      ${meta('Watchers', (t.watchers || []).join(', '))}${meta('Shared with', (t.share_to || []).join(', '))}
    </div>
    <h3>Description</h3>
    <div class="desc">${esc(t.description_text) || '<span class="note">(empty)</span>'}</div>
    ${custom ? `<h3>Custom fields</h3><div class="meta">${custom}</div>` : ''}
    <p class="note">This is the archived copy from Desk365. Replies, notes and attachments aren't in the archive yet.</p>`;
  $('closeBtn').onclick = closeTicket;
}
/* ---------- tickets created in this system ---------- */
const NATIVE_COLS = 'ticket_number,subject,description,status,priority,category,assigned_to,created_by,contact_name,contact_email,created_on,updated_on,due_date,resolved_on,closed_on';
const whenFmtNative = ts => ts ? whenFmtET.format(new Date(ts)) : '—';
const whenFmtET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });

/* ---------- attachments ---------- */
const ATT_BUCKET = 'ticket-attachments', ATT_COLS = 'id,activity_id,file_name,content_type,size_bytes,storage_path,uploaded_by,created_at';
const MAX_FILE = 10 * 1024 * 1024, MAX_FILES = 5;
// The type is decided from the file extension (browsers often report nothing for .csv / .xlsx); the server enforces the same list.
const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const ATT_ACCEPT = Object.keys(MIME_BY_EXT).map(e => '.' + e).join(',');
const extOf = f => (f.name.split('.').pop() || '').toLowerCase();
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';

/** Returns a problem description, or '' when the files are fine. */
function checkFiles(files) {
  if (files.length > MAX_FILES) return `Please attach at most ${MAX_FILES} files at a time.`;
  for (const f of files) {
    if (!MIME_BY_EXT[extOf(f)]) return `"${f.name}": this file type isn't allowed. Allowed: PDF, images, Word, Excel, PowerPoint, CSV, text.`;
    if (f.size > MAX_FILE) return `"${f.name}" is ${fmtSize(f.size)}; the limit is 10 MB per file.`;
    if (f.size === 0) return `"${f.name}" is empty.`;
  }
  return '';
}

/** Uploads files for a ticket (optionally tied to a reply). Returns the names that failed. */
async function uploadFiles(ticket, files, activityId) {
  const failed = [];
  for (const f of files) {
    const type = MIME_BY_EXT[extOf(f)];
    const path = `${ticket}/${crypto.randomUUID()}-${f.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-100)}`;
    const up = await sb.storage.from(ATT_BUCKET).upload(path, f, { contentType: type, upsert: false });
    if (up.error) { failed.push(f.name); continue; }
    const row = await sb.from('ticket_attachments').insert({
      ticket_number: ticket, activity_id: activityId || null, file_name: f.name.slice(0, 200), content_type: type, size_bytes: f.size, storage_path: path,
    });
    if (row.error) { failed.push(f.name); await sb.storage.from(ATT_BUCKET).remove([path]); }
  }
  return failed;
}

function attList(items, withHeading) {
  if (!items.length) return '';
  const rows = items.map(a => `<div class="attrow"><a href="#" class="att" data-path="${esc(a.storage_path)}" data-name="${esc(a.file_name)}">📎 ${esc(a.file_name)}</a>
    <span class="note">${esc(fmtSize(a.size_bytes))} · ${esc(personName(a.uploaded_by))} · ${esc(whenFmtET.format(new Date(a.created_at)))}</span></div>`).join('');
  return `${withHeading ? '<h3>Attachments</h3>' : ''}<div class="atts">${rows}</div>`;
}

// Short-lived signed link; "download" makes the browser save the file instead of opening it.
async function downloadAttachment(path, name, el) {
  const label = el.textContent; el.textContent = 'Preparing…';
  const { data, error } = await sb.storage.from(ATT_BUCKET).createSignedUrl(path, 60, { download: name });
  el.textContent = label;
  if (error || !data) { const m = $('cMsg'); if (m) m.textContent = "Couldn't download: " + (error ? error.message : 'no link'); return; }
  const a = document.createElement('a'); a.href = data.signedUrl; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
}

const STATUSES = ['Open', 'Pending', 'Resolved', 'Closed'];
const personName = email => {
  if (!email) return 'Unassigned';
  const m = formOpts && formOpts.staff.find(x => x.email === email);
  return (m && m.full_name) || email.split('@')[0];
};
const dueToInput = ts => ts ? new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : '';   // yyyy-mm-dd
const inputToDue = d => d ? new Date(`${d}T17:00:00-05:00`).toISOString() : null;                                  // 5 pm Eastern (standard time)

function eventText(a) {
  const m = a.meta || {}, who = esc(personName(a.actor === 'system' ? null : a.actor));
  const from = v => esc(v == null || v === '' ? 'none' : v);
  switch (a.kind) {
    case 'status': return `${who} changed the status: ${from(m.from)} → ${from(m.to)}`;
    case 'assignment': return `${who} reassigned: ${esc(m.from ? personName(m.from) : 'Unassigned')} → ${esc(m.to ? personName(m.to) : 'Unassigned')}`;
    case 'priority': return `${who} changed the priority: ${from(PRIORITY[m.from])} → ${from(PRIORITY[m.to])}`;
    case 'category': return `${who} changed the category: ${from(m.from)} → ${from(m.to)}`;
    case 'due_date': return `${who} changed the due date: ${m.from ? esc(whenFmtET.format(new Date(m.from)).split(',').slice(0, 2).join(',')) : 'none'} → ${m.to ? esc(whenFmtET.format(new Date(m.to)).split(',').slice(0, 2).join(',')) : 'none'}`;
    default: return who;
  }
}

async function openNativeTicket(n, keepScroll) {
  const scroller = $('drawer'), top = scroller.scrollTop;
  let opts;
  try { opts = await loadFormOptions(); } catch (e) { opts = { categories: [], staff: [] }; }
  const [tr, ar, fr] = await Promise.all([
    sb.from('tickets').select(NATIVE_COLS).eq('ticket_number', n).maybeSingle(),
    sb.from('ticket_activity').select('id,kind,body,meta,actor,created_at').eq('ticket_number', n).order('created_at').order('id'),
    sb.from('ticket_attachments').select(ATT_COLS).eq('ticket_number', n).order('created_at'),
  ]);
  const t = tr.data, error = tr.error || ar.error;
  const atts = fr.error ? [] : fr.data;
  const flash = state.flash; state.flash = null;
  if (error || !t) { $('drawer').innerHTML = `<button class="close" id="closeBtn">Close</button><p>${esc(error ? error.message : 'Ticket not found, or you no longer have access to it.')}</p>`; $('closeBtn').onclick = closeTicket; return; }
  const meta = (label, val) => `<div><span>${label}</span>${val == null || val === '' ? '—' : esc(val)}</div>`;
  const sel = (id, label, items, cur) => `<label>${label}<select id="${id}">${items.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const thread = ar.data.map(a => (a.kind === 'reply' || a.kind === 'note')
    ? `<div class="msg-b ${a.kind}"><div class="who"><strong>${esc(personName(a.actor))}</strong> · ${esc(whenFmtET.format(new Date(a.created_at)))}${a.kind === 'note' ? ' <span class="chip">internal note</span>' : ''}</div><div class="txt">${esc(a.body)}</div>${attList(atts.filter(x => x.activity_id === a.id))}</div>`
    : `<div class="evt">${eventText(a)} <span class="note">· ${esc(whenFmtET.format(new Date(a.created_at)))}</span></div>`).join('');
  $('drawer').innerHTML = `
    <button class="close" id="closeBtn">Close</button>
    <div class="note">Ticket #${t.ticket_number} <span class="chip">created in the new system</span></div>
    <h2>${esc(t.subject)}</h2>
    ${flash ? `<div class="msg err">${esc(flash)}</div>` : ''}
    <div class="controls form">
      ${sel('cStatus', 'Status', STATUSES.map(x => [x, x]), t.status)}
      ${sel('cPri', 'Priority', [[1, 'Low'], [5, 'Medium'], [10, 'High'], [20, 'Urgent']], t.priority)}
      ${sel('cCat', 'Category', [['', '—'], ...opts.categories.map(c => [c, c])], t.category)}
      ${sel('cAssign', 'Assigned to', [['', 'Unassigned'], ...opts.staff.map(x => [x.email, x.full_name || x.email])], t.assigned_to)}
      <label>Due<input type="date" id="cDue" value="${esc(dueToInput(t.due_date))}"></label>
    </div>
    <div class="msg err" id="cMsg"></div>
    <div class="meta">
      ${meta('Contact', [t.contact_name, t.contact_email].filter(Boolean).join(' · '))}${meta('Created by', personName(t.created_by))}
      ${meta('Created', whenFmtNative(t.created_on))}${meta('Updated', whenFmtNative(t.updated_on))}
      ${meta('Resolved', whenFmtNative(t.resolved_on))}${meta('Closed', whenFmtNative(t.closed_on))}
    </div>
    <h3>Description</h3>
    <div class="desc">${esc(t.description) || '<span class="note">(empty)</span>'}</div>
    ${attList(atts.filter(x => !x.activity_id), true)}
    <h3>Conversation</h3>
    <div id="thread">${thread || '<span class="note">No replies yet.</span>'}</div>
    <form id="replyForm" class="form">
      <label>Add to the conversation<textarea id="rBody" rows="4" maxlength="20000" placeholder="Write a reply or an internal note…" required></textarea></label>
      <label>Attach files (optional; up to 5, 10 MB each)<input type="file" id="rFiles" multiple accept="${ATT_ACCEPT}"></label>
      <div class="actions">
        <button class="primary" id="rSend" type="submit" data-kind="reply">Send reply</button>
        <button id="rNote" type="submit" data-kind="note">Add internal note</button>
      </div>
    </form>`;
  $('closeBtn').onclick = closeTicket;
  if (keepScroll) scroller.scrollTop = top;
  $('drawer').querySelectorAll('a.att').forEach(a => a.onclick = ev => { ev.preventDefault(); downloadAttachment(a.dataset.path, a.dataset.name, a); });

  const refresh = () => { openNativeTicket(n, true); loadTickets(); loadCounts(); if (typeof invalidateDash === 'function') invalidateDash(); };
  const save = async (changes, field) => {
    $('cMsg').className = 'msg'; $('cMsg').innerHTML = '<span class="spin"></span>&nbsp; Saving…';
    const { error: e } = await sb.from('tickets').update(changes).eq('ticket_number', n);
    if (e) { $('cMsg').className = 'msg err'; $('cMsg').textContent = "Couldn't save: " + e.message; return; }
    refresh();
  };
  $('cStatus').onchange = e => save({ status: e.target.value });
  $('cPri').onchange = e => save({ priority: Number(e.target.value) });
  $('cCat').onchange = e => save({ category: e.target.value || null });
  $('cAssign').onchange = e => save({ assigned_to: e.target.value || null });
  $('cDue').onchange = e => save({ due_date: inputToDue(e.target.value) });
  $('replyForm').addEventListener('submit', async e => {
    e.preventDefault();
    const kind = (e.submitter && e.submitter.dataset.kind) || 'reply', body = $('rBody').value.trim();
    if (!body) return;
    const files = [...($('rFiles').files || [])], problem = checkFiles(files);
    if (problem) { $('cMsg').textContent = problem; return; }
    const clicked = e.submitter || $('rSend'), label = clicked.textContent;
    $('rSend').disabled = true; $('rNote').disabled = true; clicked.classList.add('busy'); clicked.textContent = kind === 'note' ? 'Adding…' : 'Sending…';
    const { data: row, error: er } = await sb.from('ticket_activity').insert({ ticket_number: n, kind, body }).select('id').single();
    if (er) { $('rSend').disabled = false; $('rNote').disabled = false; clicked.classList.remove('busy'); clicked.textContent = label; $('cMsg').className = 'msg err'; $('cMsg').textContent = "Couldn't post: " + er.message; return; }
    const failed = files.length ? await uploadFiles(n, files, row.id) : [];
    if (failed.length) state.flash = `Your message was posted, but ${failed.length} file(s) didn't upload: ${failed.join(', ')}`;
    openNativeTicket(n, false).then(() => { const th = $('thread'); if (th) th.scrollIntoView({ block: 'end' }); });
    loadCounts();
    loadTickets();
  });
}

let formOpts = null;   // categories + staff for the form; cleared when a different person signs in

async function loadFormOptions() {
  if (formOpts) return formOpts;
  const [cats, staff] = await Promise.all([
    sb.from('ticket_categories').select('name').eq('active', true).order('sort_order'),
    sb.rpc('staff_directory'),
  ]);
  if (cats.error) throw cats.error;
  if (staff.error) throw staff.error;
  formOpts = { categories: cats.data.map(c => c.name), staff: staff.data };
  return formOpts;
}

async function openNewTicket() {
  history.replaceState(null, '', location.pathname);
  $('drawer').innerHTML = drawerSkeleton();
  show('overlay', true); show('drawer', true);
  let opts;
  try { opts = await loadFormOptions(); }
  catch (e) { $('drawer').innerHTML = `<button class="close" id="closeBtn">Close</button><p>Couldn't load the form: ${esc(e.message)}</p>`; $('closeBtn').onclick = closeTicket; return; }
  const options = (items, label, value) => items.map(i => `<option value="${esc(value(i))}">${esc(label(i))}</option>`).join('');
  $('drawer').innerHTML = `
    <button class="close" id="closeBtn">Cancel</button>
    <h2>New ticket</h2>
    <form id="newForm" class="form">
      <label>Subject *<input id="nSubject" maxlength="300" required autocomplete="off"></label>
      <label>Description<textarea id="nDesc" rows="8" maxlength="20000" placeholder="What happened, where (property / unit), and anything the next person needs to know."></textarea></label>
      <div class="two">
        <label>Category *<select id="nCat" required><option value="">Choose…</option>${options(opts.categories, c => c, c => c)}</select></label>
        <label>Priority<select id="nPri"><option value="1">Low</option><option value="5" selected>Medium</option><option value="10">High</option><option value="20">Urgent</option></select></label>
      </div>
      <label>Assign to<select id="nAssign"><option value="">Unassigned</option>${options(opts.staff, s => s.full_name || s.email, s => s.email)}</select></label>
      <div class="two">
        <label>Contact name (optional)<input id="nCName" autocomplete="off"></label>
        <label>Contact email (optional)<input id="nCEmail" type="email" autocomplete="off"></label>
      </div>
      <div class="note">Leave the contact blank and it's you.</div>
      <label>Attach files (optional; up to 5, 10 MB each: PDF, images, Word, Excel, PowerPoint, CSV, text)<input type="file" id="nFiles" multiple accept="${ATT_ACCEPT}"></label>
      <div class="msg err" id="nMsg"></div>
      <div class="actions"><button class="primary" id="nSubmit" type="submit">Create ticket</button></div>
    </form>`;
  $('closeBtn').onclick = closeTicket;
  $('nSubject').focus();
  $('newForm').addEventListener('submit', async e => {
    e.preventDefault();
    const files = [...($('nFiles').files || [])], problem = checkFiles(files);
    if (problem) { $('nMsg').textContent = problem; return; }
    const btn = $('nSubmit'); btn.disabled = true; btn.classList.add('busy'); btn.textContent = 'Creating…'; $('nMsg').textContent = '';
    const val = id => $(id).value.trim();
    const { data, error } = await sb.from('tickets').insert({
      subject: val('nSubject'), description: $('nDesc').value.trim(), category: val('nCat'), priority: Number($('nPri').value),
      assigned_to: val('nAssign') || null, contact_name: val('nCName') || null, contact_email: val('nCEmail') || null,
    }).select('ticket_number').single();
    if (error) { btn.disabled = false; btn.classList.remove('busy'); btn.textContent = 'Create ticket'; $('nMsg').textContent = "Couldn't create the ticket: " + error.message; return; }
    if (files.length) {
      btn.textContent = 'Uploading files…';
      const failed = await uploadFiles(data.ticket_number, files, null);
      if (failed.length) state.flash = `Ticket created, but ${failed.length} file(s) didn't upload: ${failed.join(', ')}. Add them from the ticket.`;
    }
    closeTicket();
    state.page = 0; state.sort = 'ticket_number'; state.asc = false;
    loadTickets();
    openTicket(data.ticket_number);
    loadCounts();
  });
}
$('newTicket').addEventListener('click', openNewTicket);

function closeTicket() {
  show('overlay', false); show('drawer', false); state.openTicket = null; state.openMeeting = null;
  history.replaceState(null, '', location.pathname + (state.routeHash || '#/dashboard'));   // back to the screen underneath
}
$('overlay').addEventListener('click', closeTicket);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTicket(); });
