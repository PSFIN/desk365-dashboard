/* Small chart toolkit for the ticket system: no libraries. Each function returns an HTML/SVG string.
   Every clickable part is a real <a href="#/...">, so the router handles it (keyboard, middle-click, back button). */
const Charts = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = n => Number(n).toLocaleString('en-US');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---- icons (stroke style) ----
  const PATHS = {
    layout: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    active: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4l2 2"/>',
    dot: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    userx: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 8 5 5M22 8l-5 5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m22 4-10 10-3-3"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>',
    archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    checks: '<path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
    folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
    trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  };
  const icon = (name, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;

  // ---- dates ----
  const iso = d => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  function bucketLabel(s, gran) {
    const [y, m, d] = s.split('-').map(Number);
    return gran === 'month' ? `${MONTHS[m - 1]} ’${String(y).slice(2)}` : `${MONTHS[m - 1]} ${d}`;
  }
  function bucketRange(s, gran) {
    if (gran === 'day') return { from: s, to: s };
    if (gran === 'week') return { from: s, to: addDays(s, 6) };
    const [y, m] = s.split('-').map(Number);
    return { from: s, to: iso(new Date(Date.UTC(y, m, 0))) };
  }
  function niceMax(v) {
    if (v <= 4) return 4;
    const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

  // ---- KPI card ----
  function kpi({ href, label, value, sub = '', tone = 'accent', icon: ic = 'inbox', delta }) {
    return `<a class="kpi tone-${tone}" href="${href}">
      <span class="kpi-top"><span class="kpi-ico">${icon(ic, 20)}</span><span class="kpi-label">${esc(label)}</span></span>
      <span class="kpi-value" data-count="${Number(value) || 0}">${typeof value === 'number' ? nf(value) : esc(value)}</span>
      <span class="kpi-foot">${delta ? `<span class="kpi-delta ${delta.cls}">${delta.text}</span>` : ''}<span class="kpi-sub">${sub}</span></span>
    </a>`;
  }
  // numbers count up from 0 (skipped when the person prefers reduced motion)
  function countUp(root) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || countUp.skip) return;   // skip: a repaint after a tick shouldn't replay the animation
    root.querySelectorAll('.kpi-value[data-count]').forEach(el => {
      const end = Number(el.dataset.count); if (!end || end < 2) return;
      const t0 = performance.now(), dur = 700;
      const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = nf(Math.round(end * e)); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  // ---- donut ----
  function donut({ items, centerValue, centerLabel, size = 170, thickness = 20, label = 'Chart' }) {
    const live = items.filter(i => i.n > 0), total = live.reduce((a, i) => a + i.n, 0);
    const r = (size - thickness) / 2, c = 2 * Math.PI * r, mid = size / 2;
    let acc = 0;
    const segs = total === 0
      ? `<circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="var(--paper-2)" stroke-width="${thickness}"/>`
      : live.map(i => {
          const len = i.n / total * c, gap = live.length > 1 ? Math.min(3, len * 0.25) : 0, seg = Math.max(len - gap, 0.5);
          const el = `<a href="${i.href}"><circle class="seg" cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${i.color}" stroke-width="${thickness}"
            stroke-dasharray="${seg.toFixed(2)} ${(c - seg).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 ${mid} ${mid})" style="--c:${c.toFixed(2)}"
            data-tip="${esc(i.label)}: ${nf(i.n)} (${Math.round(i.n / total * 100)}%)"/></a>`;
          acc += len; return el;
        }).join('');
    const legend = items.map(i => `<li><a href="${i.href}"><i style="background:${i.color}"></i><span>${esc(i.label)}</span><b>${nf(i.n)}</b><em>${total ? Math.round(i.n / total * 100) : 0}%</em></a></li>`).join('');
    return `<div class="donut"><svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)}">${segs}
      <text class="donut-v" x="${mid}" y="${mid + 2}" text-anchor="middle">${esc(centerValue ?? nf(total))}</text>
      <text class="donut-l" x="${mid}" y="${mid + 20}" text-anchor="middle">${esc(centerLabel || '')}</text></svg>
      <ul class="legend">${legend}</ul></div>`;
  }

  // ---- horizontal bars (label, bar, number) ----
  function hbars({ items, max, empty = 'Nothing here yet' }) {
    if (!items.length) return `<p class="chart-empty">${esc(empty)}</p>`;
    const m = max || Math.max(1, ...items.map(i => i.n));
    return `<div class="hbars">${items.map((i, k) => `<a class="hb" href="${i.href}" data-tip="${esc(i.label)}: ${nf(i.n)}">
      <span class="hb-l" title="${esc(i.label)}">${esc(i.label)}</span>
      <span class="hb-bar"><i style="width:${Math.max(2, i.n / m * 100).toFixed(1)}%;background:${i.color || 'var(--accent)'};animation-delay:${k * 45}ms"></i></span>
      <span class="hb-n">${nf(i.n)}</span></a>`).join('')}</div>`;
  }

  // ---- vertical bars with labels underneath (age buckets etc.) ----
  function vbars({ items, empty = 'Nothing here yet' }) {
    if (!items.length) return `<p class="chart-empty">${esc(empty)}</p>`;
    const m = Math.max(1, ...items.map(i => i.n));
    return `<div class="vbars">${items.map((i, k) => `<a class="vb" href="${i.href}" data-tip="${esc(i.label)}: ${nf(i.n)}">
      <span class="vb-n">${nf(i.n)}</span>
      <span class="vb-col"><i style="height:${Math.max(i.n ? 4 : 0, i.n / m * 100).toFixed(1)}%;background:${i.color};animation-delay:${k * 60}ms"></i></span>
      <span class="vb-l">${esc(i.label)}</span></a>`).join('')}</div>`;
  }

  // ---- columns over time: bars (a) + line (b); every bucket is a link ----
  function columns({ data, gran, a, b, hrefFor, tipFor }) {
    const W = 760, H = 250, pl = 38, pr = 10, pt = 14, pb = 28, iw = W - pl - pr, ih = H - pt - pb;
    if (!data.length) return '<p class="chart-empty">No data in this period</p>';
    const maxV = niceMax(Math.max(1, ...data.map(d => Math.max(d.a, d.b || 0))));
    const step = iw / data.length, bw = Math.max(2, Math.min(26, step * 0.62));
    const y = v => pt + ih - v / maxV * ih;
    const grid = [0, 1, 2, 3, 4].map(i => { const v = maxV * i / 4; return `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" class="axis">${nf(Math.round(v))}</text>`; }).join('');
    const bars = data.map((d, i) => `<rect class="col" x="${(pl + i * step + (step - bw) / 2).toFixed(1)}" y="${y(d.a).toFixed(1)}" width="${bw.toFixed(1)}" height="${(d.a / maxV * ih).toFixed(1)}" rx="${Math.min(3, bw / 2)}" fill="${a.color}" style="animation-delay:${Math.min(i * 12, 500)}ms"/>`).join('');
    const line = b ? `<polyline class="ln" fill="none" stroke="${b.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${data.map((d, i) => `${(pl + i * step + step / 2).toFixed(1)},${y(d.b).toFixed(1)}`).join(' ')}"/>
      ${data.length <= 40 ? data.map((d, i) => `<circle cx="${(pl + i * step + step / 2).toFixed(1)}" cy="${y(d.b).toFixed(1)}" r="2.6" fill="${b.color}"/>`).join('') : ''}` : '';
    const every = Math.ceil(data.length / 9);
    const xl = data.map((d, i) => i % every === 0 ? `<text x="${(pl + i * step + step / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="axis">${esc(bucketLabel(d.d, gran))}</text>` : '').join('');
    const hits = data.map((d, i) => `<a href="${hrefFor(d)}"><rect class="hit" x="${(pl + i * step).toFixed(1)}" y="${pt}" width="${step.toFixed(1)}" height="${ih}" fill="transparent" data-tip="${esc(tipFor(d))}"/></a>`).join('');
    return `<div class="columns"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tickets over time">${grid}${bars}${line}${xl}${hits}</svg>
      <div class="chart-legend"><span><i style="background:${a.color}"></i>${esc(a.label)}</span>${b ? `<span><i style="background:${b.color}" class="line"></i>${esc(b.label)}</span>` : ''}</div></div>`;
  }

  // ---- floating tooltip for anything with data-tip ----
  function initTips() {
    const tip = document.createElement('div'); tip.id = 'tip'; tip.className = 'tip hidden'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip);
    const move = e => { const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8), yy = e.clientY + 18 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 18; tip.style.left = x + 'px'; tip.style.top = yy + 'px'; };
    document.addEventListener('mouseover', e => { const t = e.target.closest && e.target.closest('[data-tip]'); if (!t) return; tip.textContent = t.dataset.tip; tip.classList.remove('hidden'); move(e); });
    document.addEventListener('mousemove', e => { if (!tip.classList.contains('hidden')) move(e); });
    document.addEventListener('mouseout', e => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t) tip.classList.add('hidden'); });
    document.addEventListener('scroll', () => tip.classList.add('hidden'), true);
  }

  return { esc, nf, icon, kpi, countUp, donut, hbars, vbars, columns, bucketRange, bucketLabel, addDays, initTips };
})();
