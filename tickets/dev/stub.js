/* DEVELOPMENT ONLY (never published): a fake Supabase backend with realistic numbers so the screens can be tried in a
   preview without signing in. Load it in the browser console on the local preview:
       eval(await (await fetch('/dev/stub.js')).text()); await signInAsStub();
   deploy/tickets/deploy.sh does not upload this folder. */
async function signInAsStub() {
  document.documentElement.setAttribute('data-theme', localStorage.getItem('theme') === 'dark' ? 'dark' : 'light');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const dayList = Array.from({ length: 31 }, (_, i) => Charts.addDays(today, i - 30));
  const rnd = (i, a, b) => a + Math.round(((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * (b - a));
  const weekend = d => [0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay());
  const dash = () => ({
    gran: 'day', since: Charts.addDays(today, -30),
    totals: { all: 9706, active: 105, open: 105, pending: 0, resolved: 1, closed: 9600, unassigned: 0, urgent: 24, mine: 11 },
    period: { created: 327, created_prev: 455, closed: 350, closed_prev: 456, median_days_to_close: 2.9 },
    by_status: [{ k: 'Closed', n: 9600 }, { k: 'Open', n: 105 }, { k: 'Resolved', n: 1 }],
    by_priority_active: [{ k: 20, n: 4 }, { k: 10, n: 20 }, { k: 5, n: 11 }, { k: 1, n: 70 }],
    by_category_period: [['Maintenance', 62], ['Sales & Revenue Management', 59], ['(none)', 58], ['Accounting', 51], ['Customer Service', 39], ['Marketing', 23], ['Inspection/Cleaning/Pool Heat Request', 10], ['Human Resources', 8]].map(([k, n]) => ({ k, n })),
    by_assignee_active: [['j.messasierra', 21], ['j.rushton', 11], ['l.brigida', 11], ['h.mcnamara', 10], ['d.husak', 7], ['b.evans', 7], ['s.soriafrausto', 6]].map(([k, n]) => ({ k: k + '@choosegulfcoast.com', n })),
    age_active: [{ k: 'Today', n: 2, lo: 0, hi: 0 }, { k: '1-3 days', n: 15, lo: 1, hi: 3 }, { k: '4-7 days', n: 8, lo: 4, hi: 7 }, { k: '8-30 days', n: 22, lo: 8, hi: 30 }, { k: 'Over 30 days', n: 58, lo: 31, hi: null }],
    trend: dayList.map((d, i) => ({ d, created: weekend(d) ? rnd(i, 1, 4) : rnd(i, 8, 19), closed: weekend(d) ? rnd(i + 5, 1, 5) : rnd(i + 5, 7, 21) })),
    attention: [[8860, 20, 'Pool heater not working at Seaside 4B', 'j.messasierra', 118], [8866, 20, 'Owner statement dispute: October payout', 'b.evans', 117], [9710, 20, 'Guest locked out, Lynx lock offline', 'h.mcnamara', 3], [8355, 10, 'Update vendor insurance certificates', 'j.rushton', 95]]
      .map(([n, p, s, a, ageDays]) => ({ n, priority: p, subject: s, assigned_to: a + '@choosegulfcoast.com', created_on: new Date(Date.now() - ageDays * 86400000).toISOString() })),
  });
  const counts = { all: 9706, active: 105, open: 105, pending: 0, resolved: 1, closed: 9600, mine: 11, unassigned: 0, urgent: 24,
    cats: { Maintenance: 31, Accounting: 22, 'Sales & Revenue Management': 18, 'Customer Service': 14, Marketing: 9, 'Technology Request': 6, Other: 5 } };
  const mk = (k, title, daysAgo, speakers, summary, actions, questions, decisions) => ({ key: k, title, ended_at: new Date(Date.now() - daysAgo * 86400000).toISOString(), speakers, recap: { summary, topics: [], decisions: decisions || [], action_items: actions, open_questions: questions || [] } });
  const mts = [
    mk('m1', 'Weekly ops sync', 1, ['Shinod Vengaloor', 'Jordan Lee'], 'Reviewed open maintenance tickets and the Lynx lock rollout. Agreed to prioritise Gulf Shores units before the holiday week.', [{ task: 'Confirm vendor start date for lock install', owner: 'Shinod Vengaloor', due: 'Friday' }, { task: 'Send unit list to the vendor', owner: 'Jordan', due: null }, { task: 'Update the ticket dashboard', owner: 'Shinod', due: 'Monday' }], ['Who pays for the extra batteries?'], ['Prioritise Gulf Shores units']),
    mk('m2', 'Weekly ops sync', 8, ['Shinod Vengaloor', 'Jordan Lee'], 'Looked at the backlog and agreed an owner for each urgent ticket.', [{ task: 'Assign owners to urgent tickets', owner: 'Jordan Lee', due: 'Tuesday' }, { task: 'Share the vacancy report', owner: 'Beth Evans', due: null }], [], ['Weekly report goes out Mondays']),
    mk('m3', 'Revenue Management Weekly Huddle', 3, ['Beth Evans', 'Shinod Vengaloor'], 'Reviewed pacing for December and the owner statement timing.', [{ task: 'Pull December pacing report', owner: 'Beth Evans', due: 'Thursday' }, { task: 'Check owner statement dates', owner: 'Shinod', due: null }], []),
    mk('m4', 'Account Manager Issues', 5, ['Beth Evans', 'Eric Buchanan', 'Shinod Vengaloor'], 'Discussed escalations and the new assignment workflow.', [{ task: 'Document the escalation steps', owner: 'Eric Buchanan', due: null }, { task: 'Set up the notification pilot', owner: 'Shinod Vengaloor', due: 'This week' }], ['Should vendors see ticket status?']),
    mk('m5', 'Leadership Meeting', 12, ['Beth Evans', 'Shinod Vengaloor'], 'Quarterly priorities and budget.', [{ task: 'Share the budget deck', owner: 'Beth Evans', due: null }], []),
    mk('m6', 'Weekly ops sync', 15, ['Shinod Vengaloor'], 'Short sync.', [{ task: 'Order lock batteries', owner: 'Shinod', due: null }], []),
  ];
  const stat = [['m2', 'action', 0, 'j.lee@choosegulfcoast.com'], ['m3', 'action', 0, 'b.evans@choosegulfcoast.com'], ['m5', 'action', 0, 'b.evans@choosegulfcoast.com'], ['m6', 'action', 0, 's.vengaloor@choosegulfcoast.com']]
    .map(([k, kd, i, by]) => ({ meeting_key: k, kind: kd, idx: i, resolved: true, resolved_by: by, resolved_at: new Date(Date.now() - 2 * 86400000).toISOString() }));
  const people = [['s.vengaloor', 'Shinod Vengaloor'], ['j.messasierra', 'Juan Mesa Sierra'], ['b.evans', 'Beth Evans'], ['h.mcnamara', 'Heather McNamara'], ['j.rushton', 'Jessica Rushton'], ['l.brigida', 'Lei Brigida'], ['d.husak', 'Dave Husak'], ['s.soriafrausto', 'Sandra Soria Frausto'], ['e.buchanan', 'Eric Buchanan']]
    .map(([e, n]) => ({ email: e + '@choosegulfcoast.com', full_name: n }));
  const rows = Array.from({ length: 12 }, (_, i) => ({ ticket_number: 9744 - i, subject: ['Peace In The Palms | Amenities inquiry', 'Sandy Pointe | Hole in the pool bed', 'Refund check request', 'AI Rank social post for GCPM', 'Post arrival call'][i % 5], status: i % 4 ? 'Open' : 'Closed', priority: [1, 5, 10, 20][i % 4], assigned_to: 'j.rushton@choosegulfcoast.com', category: 'Maintenance', contact_name: 'Vernice Consigna', created_on: '2026-11-26T18:06:00Z', updated_on: '2026-11-26T19:10:00Z', origin: 'desk365' }));
  const realFrom = window.__realFrom || (window.__realFrom = sb.from.bind(sb));
  window.__queries = []; window.__rpcCalls = []; window.__stubStatus = stat; window.__stubMeetings = mts;
  sb.from = t => {
    if (t === 'staff') { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: { email: 's.vengaloor@choosegulfcoast.com', full_name: 'Shinod Vengaloor', is_admin: true }, error: null }) }; return c; }
    if (t === 'meeting_notes') return { select: () => ({ order: () => ({ limit: async () => ({ data: mts, error: null }) }) }) };
    if (t === 'meeting_item_status') return { select: () => ({ limit: async () => ({ data: stat, error: null }) }) };
    if (t === 'ticket_categories') return { select: () => ({ eq: () => ({ order: async () => ({ data: [{ name: 'Maintenance' }, { name: 'Accounting' }], error: null }) }) }) };
    if (t === 'all_tickets') { const rec = []; return new Proxy({}, { get: (_, m) => m === 'then' ? undefined : function f(...a) { if (m === 'range') { window.__queries.push(rec.filter(x => !/^(select|order)/.test(x)).join(' ')); return Promise.resolve({ data: rows, count: 9706, error: null }); } rec.push(m + '(' + a.map(x => JSON.stringify(x)).join(',') + ')'); return new Proxy({}, { get: (_, m2) => m2 === 'then' ? undefined : (...b) => f.call(null, ...b) && undefined }); } }); }
    return realFrom(t);
  };
  // all_tickets needs a chainable builder; simpler explicit version:
  sb.from = ((prev) => t => {
    if (t !== 'all_tickets') return prev(t);
    const rec = []; const q = new Proxy({}, { get: (_, m) => m === 'then' ? undefined : (...a) => { if (m === 'range') { window.__queries.push(rec.filter(x => !/^(select|order)/.test(x)).join(' ')); return Promise.resolve({ data: rows, count: 9706, error: null }); } rec.push(m + '(' + a.map(x => JSON.stringify(x)).join(',') + ')'); return q; } });
    return q;
  })(sb.from);
  sb.rpc = async (name, args) => {
    window.__rpcCalls.push(name + (args ? ' ' + JSON.stringify(args) : ''));
    if (name === 'ticket_dashboard') return { data: dash(), error: null };
    if (name === 'ticket_view_counts') return { data: counts, error: null };
    if (name === 'ticket_filter_options') return { data: { status: ['Closed', 'Open', 'Resolved'], category: ['Accounting', 'Maintenance', 'Marketing'], assigned: ['j.rushton@choosegulfcoast.com'], group: [] }, error: null };
    if (name === 'staff_directory') return { data: people, error: null };
    if (name === 'set_meeting_item') {
      const i = stat.findIndex(s => s.meeting_key === args.p_key && s.kind === args.p_kind && s.idx === args.p_idx);
      if (i >= 0) stat[i].resolved = args.p_resolved; else stat.push({ meeting_key: args.p_key, kind: args.p_kind, idx: args.p_idx, resolved: args.p_resolved, resolved_by: 's.vengaloor@choosegulfcoast.com', resolved_at: new Date().toISOString() });
      return { data: null, error: null };
    }
    return { data: null, error: null };
  };
  if (!location.hash) location.hash = '#/dashboard';
  await route({ user: { id: 'u1', email: 's.vengaloor@choosegulfcoast.com' } });
  await new Promise(r => setTimeout(r, 900));
  return 'signed in as stub';
}
