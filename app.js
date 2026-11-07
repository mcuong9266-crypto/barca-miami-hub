/* UI layer */
const $ = s => document.querySelector(s);
const view = $('#view');
const S = {
  team: (() => { try { return localStorage.getItem('team') || 'barca'; } catch (e) { return 'barca'; } })(),
  tab: 'home', data: {}, trends: {}, preds: {}, sel: { match: null, predict: null }, schedMode: 'up', schedTeams: 'both'
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const logo = (src, cls = '') => src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<div class="${cls}" style="width:34px;height:34px"></div>`;
const P = v => (v * 100).toFixed(0) + '%';
const official = rs => rs.filter(m => !/friendly/i.test(m.leagueSlug));
let renderToken = 0;

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2600); }

/* ---------------- theme & nav ---------------- */
function applyTheme() {
  const T = TEAMS[S.team], r = document.documentElement.style;
  r.setProperty('--c1', T.c1); r.setProperty('--c2', T.c2); r.setProperty('--acc', T.acc);
  if (S.team === 'miami') { r.setProperty('--c1', '#e8649b'); r.setProperty('--c2', '#1c1c24'); r.setProperty('--acc', '#ffb6d3'); }
  $('#team-switch').dataset.on = S.team;
  document.querySelectorAll('#team-switch button').forEach(b => b.classList.toggle('on', b.dataset.team === S.team));
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
}
function go(tab, opts = {}) {
  if (opts.team && opts.team !== S.team) { S.team = opts.team; try { localStorage.setItem('team', S.team); } catch (e) { } }
  if (opts.match) S.sel.match = opts.match;
  if (opts.predict) S.sel.predict = opts.predict;
  S.tab = tab; applyTheme(); window.scrollTo({ top: 0, behavior: 'smooth' }); render();
}
$('#team-switch').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.dataset.team === S.team) return; S.sel = { match: null, predict: null }; go(S.tab, { team: b.dataset.team }); });
$('#tabbar').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.tab); });
view.addEventListener('click', e => {
  const a = e.target.closest('[data-go]'); if (!a) return;
  go(a.dataset.go, { team: a.dataset.team, match: a.dataset.match, predict: a.dataset.predict });
});

/* ---------------- data ---------------- */
async function getData(key, force) {
  if (!force && S.data[key] && Date.now() - S.data[key]._t < 240000) return S.data[key];
  const d = await loadSchedule(key, { ttl: force ? 0 : 300000 }); d._t = Date.now(); S.data[key] = d;
  $('#updated').textContent = 'Cập nhật ' + new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return d;
}
async function getTrends(key) {
  if (S.trends[key]) return S.trends[key];
  const d = await getData(key);
  const rows = await loadTrends({ ...d, results: official(d.results) }, 10);
  S.trends[key] = rows; return rows;
}
async function getPrediction(key, m) {
  const ck = key + ':' + m.id; if (S.preds[ck]) return S.preds[ck];
  const T = TEAMS[key], d = await getData(key);
  const fMe = form(official(d.results));
  let oppS = { results: [] }; try { oppS = await loadOpponentSchedule(m.opp.id, m.leagueSlug); } catch (e) { }
  const fOpp = form(official(oppS.results));
  let sum = null; try { sum = await loadSummary(m.id, true); } catch (e) { }
  const odds = sum && sum.odds;
  const pr = predict(fMe, fOpp, m.isHome, odds, m.isHome);
  const h2h = oppS.results.filter(x => x.opp.id === T.id).slice(-5).reverse();
  const res = { T, m, fMe, fOpp, pr, odds, h2h };
  S.preds[ck] = res; return res;
}

/* ---------------- components ---------------- */
function countdownHTML(iso) { return `<div class="countdown" data-cd="${esc(iso)}"><div><b>--</b><span>ngày</span></div><div><b>--</b><span>giờ</span></div><div><b>--</b><span>phút</span></div><div><b>--</b><span>giây</span></div></div>`; }
function tickCountdowns() {
  document.querySelectorAll('[data-cd]').forEach(el => {
    let s = Math.max(0, (new Date(el.dataset.cd) - Date.now()) / 1000);
    const v = [Math.floor(s / 86400), Math.floor(s % 86400 / 3600), Math.floor(s % 3600 / 60), Math.floor(s % 60)];
    el.querySelectorAll('b').forEach((b, i) => { const t = String(v[i]).padStart(2, '0'); if (b.textContent !== t) b.textContent = t; });
  });
}
setInterval(tickCountdowns, 1000);

function probBar(fin, T, opp) {
  return `<div class="prob"><div class="w" data-w="${fin.W * 100}">${P(fin.W)}</div><div class="d" data-w="${fin.D * 100}">${P(fin.D)}</div><div class="l" data-w="${fin.L * 100}">${P(fin.L)}</div></div>
  <div class="prob-legend"><span>${esc(T.short)} thắng</span><span>Hòa</span><span>${esc(opp.short)} thắng</span></div>`;
}
function animateIn(root = view) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelectorAll('[data-w]').forEach(el => el.style.width = Math.max(0, Math.min(100, +el.dataset.w)) + '%');
    root.querySelectorAll('[data-off]').forEach(el => el.style.strokeDashoffset = el.dataset.off);
  }));
}
function formChips(arr) { return `<div class="form">${arr.map(r => `<span class="${r}">${r === 'W' ? 'T' : r === 'D' ? 'H' : 'B'}</span>`).join('')}</div>`; }
function matchRow(m, { team, showTeam } = {}) {
  const key = team || S.team, T = TEAMS[key];
  const right = m.completed ? `<div class="res ${m.result}">${m.gf}-${m.ga}${m.me.pen != null ? `<div style="font-size:10px">pen ${m.me.pen}-${m.opp.pen}</div>` : ''}</div>`
    : m.state === 'in' ? `<div class="res up" style="color:#fca5a5">● ${esc(m.clock)}<br>${m.liveGf ?? 0}-${m.liveGa ?? 0}</div>`
      : `<div class="res up">${new Date(m.date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</div>`;
  const tab = m.completed ? 'match' : 'predict', attr = m.completed ? `data-match="${m.id}"` : `data-predict="${m.id}"`;
  return `<div class="row" data-go="${tab}" data-team="${key}" ${attr}>
    ${logo(m.opp.logo)}
    <div><div class="nm">${showTeam ? `<span class="tbadge" style="background:${key === 'barca' ? '#a50044' : '#e8649b'}"></span>${esc(T.short)} ${m.isHome ? 'vs' : '@'} ` : (m.isHome ? 'vs ' : '@ ')}${esc(m.opp.short)}</div>
    <div class="info">${esc(fmtDate(m.date))} · ${esc(m.league)}${m.isHome ? ' · 🏠' : ''}</div></div>
    ${right}</div>`;
}
function gauge(val, max, label, color) {
  const r = 50, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, val / max)));
  return `<div class="gauge"><svg viewBox="0 0 120 120" width="120" height="120"><circle cx="60" cy="60" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="11"/>
  <circle class="fg" cx="60" cy="60" r="${r}" fill="none" stroke="${color || 'url(#gg)'}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${off}"/>
  <defs><linearGradient id="gg"><stop offset="0" stop-color="var(--acc)"/><stop offset="1" stop-color="var(--c1)"/></linearGradient></defs></svg>
  <div class="val"><div><b>${val}</b><span>${label}</span></div></div></div>`;
}
function cmp(label, a, b, { suf = '', dec = 0, inv = false } = {}) {
  if (a == null && b == null) return '';
  a = a ?? 0; b = b ?? 0; const mx = Math.max(a, b) || 1;
  const f = v => (dec ? v.toFixed(dec) : Math.round(v)) + suf;
  const better = inv ? a < b : a > b;
  return `<div class="cmp"><div class="lab"><span class="${better ? 'best' : ''}">${f(a)}</span><span>${label}</span><span class="${!better && a !== b ? 'best' : ''}">${f(b)}</span></div>
  <div class="bars"><div class="l"><i data-w="${a / mx * 100}"></i></div><div class="r"><i data-w="${b / mx * 100}"></i></div></div></div>`;
}
function lineChart(labels, series, { h = 170, min, max, suf = '', avg } = {}) {
  const W = 340, H = h, pl = 30, pr = 10, pt = 12, pb = 24, n = labels.length;
  const vals = series.flatMap(s => s.v).filter(v => v != null);
  if (!vals.length) return '<div class="empty">Chưa có dữ liệu</div>';
  let lo = min ?? Math.floor(Math.min(...vals)), hi = max ?? Math.ceil(Math.max(...vals)); if (hi === lo) hi = lo + 1;
  const x = i => pl + (n === 1 ? (W - pl - pr) / 2 : i * (W - pl - pr) / (n - 1)), y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4; g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.07)"/><text x="${pl - 6}" y="${y(v) + 3}" fill="#7c869c" font-size="9" text-anchor="end">${+v.toFixed(1)}${suf}</text>`; }
  labels.forEach((l, i) => g += `<text x="${x(i)}" y="${H - 6}" fill="#7c869c" font-size="8.5" text-anchor="middle">${esc(l)}</text>`);
  if (avg != null) g += `<line x1="${pl}" x2="${W - pr}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--acc)" stroke-dasharray="4 4" opacity=".6"/><text x="${W - pr}" y="${y(avg) - 4}" fill="var(--acc)" font-size="9" text-anchor="end">TB ${avg.toFixed(1)}${suf}</text>`;
  series.forEach((s, si) => {
    const pts = s.v.map((v, i) => v == null ? null : [x(i), y(v)]).filter(Boolean);
    if (!pts.length) return;
    let d = 'M' + pts.map(p => p.join(',')).join(' L');
    if (si === 0 && s.area !== false) g += `<defs><linearGradient id="ag${si}${h}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.c}" stop-opacity=".35"/><stop offset="1" stop-color="${s.c}" stop-opacity="0"/></linearGradient></defs><path d="${d} L${pts.at(-1)[0]},${H - pb} L${pts[0][0]},${H - pb} Z" fill="url(#ag${si}${h})" opacity=".9"/>`;
    g += `<path class="draw" pathLength="1000" d="${d}" fill="none" stroke="${s.c}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="5 4" style="animation:none;stroke-dasharray:5 4;stroke-dashoffset:0"' : ''}/>`;
    pts.forEach(p => g += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#0b0f1d" stroke="${s.c}" stroke-width="2"/>`);
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${g}</svg><div class="legend">${series.map(s => `<span><i style="background:${s.c}"></i>${esc(s.n)}</span>`).join('')}</div>`;
}
function goalBars(rows) {
  const W = 340, H = 170, pl = 22, pb = 24, pt = 10, n = rows.length, mx = Math.max(3, ...rows.map(r => Math.max(r.gf, r.ga)));
  const bw = (W - pl - 6) / n, y = v => pt + (H - pt - pb) * (1 - v / mx);
  let g = '';
  for (let k = 0; k <= mx; k++) g += `<line x1="${pl}" x2="${W}" y1="${y(k)}" y2="${y(k)}" stroke="rgba(255,255,255,.06)"/><text x="${pl - 6}" y="${y(k) + 3}" fill="#7c869c" font-size="9" text-anchor="end">${k}</text>`;
  rows.forEach((r, i) => {
    const x0 = pl + i * bw + bw * 0.15, w = bw * 0.33;
    g += `<rect class="grow" style="animation-delay:${i * 60}ms" x="${x0}" y="${y(r.gf)}" width="${w}" height="${Math.max(0, H - pb - y(r.gf))}" rx="3" fill="url(#gb)"/>`;
    g += `<rect class="grow" style="animation-delay:${i * 60 + 30}ms" x="${x0 + w + 2}" y="${y(r.ga)}" width="${w}" height="${Math.max(0, H - pb - y(r.ga))}" rx="3" fill="#64748b"/>`;
    g += `<text x="${x0 + w}" y="${H - 8}" fill="${r.result === 'W' ? '#4ade80' : r.result === 'L' ? '#f87171' : '#fbbf24'}" font-size="8.5" text-anchor="middle" font-weight="700">${esc(r.opp)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--acc)"/><stop offset="1" stop-color="var(--c1)"/></linearGradient></defs>${g}</svg>
  <div class="legend"><span><i style="background:var(--acc)"></i>Bàn thắng</span><span><i style="background:#64748b"></i>Bàn thua</span></div>`;
}
function radar(axes, A, B, ca, cb) {
  const cx = 150, cy = 120, R = 88, n = axes.length, pt = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]; };
  let g = '';
  [0.25, 0.5, 0.75, 1].forEach(k => g += `<polygon points="${axes.map((_, i) => pt(i, k).join(',')).join(' ')}" fill="none" stroke="rgba(255,255,255,.08)"/>`);
  axes.forEach((a, i) => { const [x, y] = pt(i, 1.2); g += `<line x1="${cx}" y1="${cy}" x2="${pt(i, 1)[0]}" y2="${pt(i, 1)[1]}" stroke="rgba(255,255,255,.08)"/><text x="${x}" y="${y + 3}" fill="#aab3c7" font-size="10" text-anchor="middle" font-weight="600">${esc(a)}</text>`; });
  const poly = (V, c, o) => `<polygon points="${V.map((v, i) => pt(i, Math.max(0.05, Math.min(1, v))).join(',')).join(' ')}" fill="${c}" fill-opacity="${o}" stroke="${c}" stroke-width="2" style="transform-origin:${cx}px ${cy}px;animation:pop .8s both"/>`;
  g += poly(B, cb, .18) + poly(A, ca, .32);
  return `<svg class="chart" viewBox="0 0 300 240">${g}</svg>`;
}
function pitch(scorers) {
  let g = `<rect x="1" y="1" width="98" height="62" fill="none" stroke="rgba(255,255,255,.5)" stroke-width=".4" rx="1"/><line x1="50" y1="1" x2="50" y2="63" stroke="rgba(255,255,255,.5)" stroke-width=".4"/><circle cx="50" cy="32" r="8" fill="none" stroke="rgba(255,255,255,.5)" stroke-width=".4"/>
  <rect x="1" y="17" width="15" height="30" fill="none" stroke="rgba(255,255,255,.5)" stroke-width=".4"/><rect x="84" y="17" width="15" height="30" fill="none" stroke="rgba(255,255,255,.5)" stroke-width=".4"/>
  <rect x="1" y="25" width="5" height="14" fill="none" stroke="rgba(255,255,255,.5)" stroke-width=".4"/><rect x="94" y="25" width="5" height="14" fill="none" stroke="rgba(255,255,255,.5)" stroke-width=".4"/>`;
  for (let i = 0; i < 9; i++) g += `<rect x="${1 + i * 10.9}" y="1" width="5.45" height="62" fill="rgba(255,255,255,.025)"/>`;
  scorers.forEach((s, i) => {
    if (s.x == null) return;
    let x = s.x, y = s.y * 0.62 + 1; if (s.team === 'opp') { x = 100 - x; y = 64 - y; }
    const c = s.team === 'me' ? 'var(--acc)' : '#e2e8f0', tx = s.team === 'me' ? 100 : 0;
    g += `<line x1="${x}" y1="${y}" x2="${tx}" y2="32" stroke="${c}" stroke-width=".5" stroke-dasharray="1.2 1" opacity=".8"/><circle cx="${x}" cy="${y}" r="2.1" fill="${c}" stroke="#000" stroke-width=".3" style="animation:pop .5s ${i * .15}s both;transform-origin:${x}px ${y}px"/><text x="${x}" y="${y - 3}" font-size="2.6" fill="#fff" text-anchor="middle" font-weight="700">${esc(s.min)}</text>`;
  });
  return `<svg class="pitch" viewBox="0 0 100 64">${g}</svg><div class="legend"><span><i style="background:var(--acc)"></i>Bàn của ${esc(TEAMS[S.team].short)} (tấn công →)</span><span><i style="background:#e2e8f0"></i>Bàn đối thủ</span></div>`;
}
const skel = n => Array.from({ length: n }, () => '<div class="skel"></div>').join('');
const errBox = e => `<div class="card empty">⚠️ ${esc(e.message || e)}<br><br><button class="btn" onclick="render(true)">Thử lại</button></div>`;

/* ---------------- views ---------------- */
async function render(force) {
  const tok = ++renderToken;
  view.innerHTML = skel(3);
  try {
    const html = await ({ home: vHome, schedule: vSchedule, match: vMatch, predict: vPredict, trends: vTrends }[S.tab])(force);
    if (tok !== renderToken) return;
    view.innerHTML = html; animateIn(); tickCountdowns();
    if (S.tab === 'home') hydrateHome(tok);
  } catch (e) { console.error(e); if (tok === renderToken) view.innerHTML = errBox(e); }
}

async function vHome(force) {
  const key = S.team, T = TEAMS[key], d = await getData(key, force);
  const live = d.live[0], next = d.upcoming.find(m => m.state === 'pre'), last = d.results.at(-1);
  const off = official(d.results), f = form(off, 38);
  const W = off.filter(m => m.result === 'W').length, Dr = off.filter(m => m.result === 'D').length, L = off.filter(m => m.result === 'L').length;
  const gf = off.reduce((s, m) => s + m.gf, 0), ga = off.reduce((s, m) => s + m.ga, 0);
  let h = '';
  if (live) h += `<div class="card hero"><span class="shine"></span><span class="chip live">TRỰC TIẾP · ${esc(live.clock)}</span>
    <div class="vs"><div class="t">${logo(live.isHome ? live.me.logo : live.opp.logo)}${esc(live.isHome ? live.me.short : live.opp.short)}</div>
    <div class="score">${live.isHome ? live.liveGf : live.liveGa} - ${live.isHome ? live.liveGa : live.liveGf}<small>${esc(live.detail)}</small></div>
    <div class="t">${logo(live.isHome ? live.opp.logo : live.me.logo)}${esc(live.isHome ? live.opp.short : live.me.short)}</div></div><div class="meta">${esc(live.league)} · tự cập nhật mỗi phút</div></div>`;
  if (next) {
    const H = next.isHome ? next.me : next.opp, A = next.isHome ? next.opp : next.me;
    h += `<div class="card hero" data-go="predict" data-predict="${next.id}"><span class="shine"></span>
      <div style="display:flex;justify-content:space-between"><span class="chip">⚡ TRẬN TIẾP THEO</span><span class="chip">${esc(next.league)}</span></div>
      <div class="vs"><div class="t">${logo(H.logo)}${esc(H.short)}</div><div class="mid">VS</div><div class="t">${logo(A.logo)}${esc(A.short)}</div></div>
      ${countdownHTML(next.date)}
      <div class="meta">📅 ${esc(fmtDate(next.date, { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}<br>📍 ${esc(next.venue || '—')}</div>
      <div id="home-prob" style="margin-top:12px"><div class="mut" style="text-align:center">🔮 Đang tính xác suất…</div></div></div>`;
  } else h += `<div class="card empty">Chưa có lịch thi đấu sắp tới.</div>`;
  if (last) h += `<div class="card" data-go="match" data-match="${last.id}" style="cursor:pointer">
    <div class="h"><h2>Trận gần nhất</h2><span class="link">Phân tích →</span></div>
    <div class="vs" style="margin:6px 0"><div class="t">${logo(last.me.logo)}${esc(last.me.short)}</div>
    <div class="score"><span class="res ${last.result}" style="font-size:30px;padding:6px 14px">${last.gf} - ${last.ga}</span><small>${esc(last.league)} · ${esc(fmtDate(last.date, { day: '2-digit', month: '2-digit' }))}</small></div>
    <div class="t">${logo(last.opp.logo)}${esc(last.opp.short)}</div></div><div id="home-last">${skel(1)}</div></div>`;
  h += `<div class="card"><div class="h"><h2>Mùa giải ${esc(d.info?.seasonSummary || '')}</h2><span class="sub">${esc(d.info?.standingSummary || '')}</span></div>
    <div class="tiles t4"><div class="tile"><b>${off.length}</b><span>Trận</span></div><div class="tile"><b>${W}-${Dr}-${L}</b><span>T-H-B</span></div><div class="tile"><b>${gf}</b><span>Bàn thắng</span></div><div class="tile"><b>${ga}</b><span>Bàn thua</span></div></div>
    <div class="tiles" style="margin-top:8px"><div class="tile"><b>${off.length ? (gf / off.length).toFixed(2) : '-'}</b><span>Bàn/trận</span></div><div class="tile"><b>${off.length ? Math.round(W / off.length * 100) : 0}%</b><span>Tỉ lệ thắng</span></div><div class="tile"><b>${f.cs}</b><span>Sạch lưới</span></div></div>
    <div class="h" style="margin:14px 0 0"><span class="sub">Phong độ 5 trận</span>${formChips(off.slice(-5).map(m => m.result))}</div></div>`;
  const ups = d.upcoming.filter(m => m.state === 'pre').slice(1, 4);
  if (ups.length) h += `<div class="card"><div class="h"><h2>Sắp diễn ra</h2><span class="link" data-go="schedule">Tất cả →</span></div>${ups.map(m => matchRow(m)).join('')}</div>`;
  const other = key === 'barca' ? 'miami' : 'barca';
  h += `<div class="card" id="home-other"><div class="h"><h2>${esc(TEAMS[other].short)}</h2><span class="link" data-go="home" data-team="${other}">Chuyển →</span></div>${skel(1)}</div>`;
  return h;
}
async function hydrateHome(tok) {
  const key = S.team, d = S.data[key];
  const next = d.upcoming.find(m => m.state === 'pre'), last = d.results.at(-1);
  const other = key === 'barca' ? 'miami' : 'barca';
  const jobs = [];
  if (next) jobs.push(getPrediction(key, next).then(p => {
    if (tok !== renderToken) return; const el = $('#home-prob'); if (!el) return;
    el.innerHTML = probBar(p.pr.fin, p.T, next.opp) + `<div class="meta">Tỉ số khả dĩ: <b>${p.pr.scores[0].s}</b> · xG ${p.pr.lMe.toFixed(1)} - ${p.pr.lOp.toFixed(1)} · Chạm để xem chi tiết</div>`; animateIn(el);
  }).catch(() => { const el = $('#home-prob'); if (el) el.innerHTML = ''; }));
  if (last) jobs.push(loadSummary(last.id).then(s => {
    if (tok !== renderToken) return; const el = $('#home-last'); if (!el) return;
    const a = analyzeMatch(s, TEAMS[key].id);
    el.innerHTML = `<div class="tiles t4"><div class="tile"><b>${a.poss != null ? a.poss.toFixed(0) + '%' : '-'}</b><span>Kiểm soát</span></div><div class="tile"><b>${a.a.totalShots ?? '-'}</b><span>Cú sút</span></div><div class="tile"><b>${a.xg.toFixed(1)}</b><span>xG ước tính</span></div><div class="tile"><b>${a.rating}</b><span>Điểm trận</span></div></div>
      <div class="sec-title" style="margin-top:14px">📰 Tóm tắt</div>${matchRecap(s, a).slice(0, 3).map(x => `<div class="ins"><i>${x.i}</i><div>${esc(x.t)}</div></div>`).join('')}`;
  }).catch(() => { const el = $('#home-last'); if (el) el.innerHTML = ''; }));
  jobs.push(getData(other).then(o => {
    if (tok !== renderToken) return; const el = $('#home-other'); if (!el) return;
    const n = o.upcoming[0], l = o.results.at(-1);
    el.innerHTML = `<div class="h"><h2>${logo(TEAMS[other].key === 'miami' ? 'https://a.espncdn.com/i/teamlogos/soccer/500/20232.png' : 'https://a.espncdn.com/i/teamlogos/soccer/500/83.png', '')}</h2><span class="link" data-go="home" data-team="${other}">Xem ${esc(TEAMS[other].short)} →</span></div>
      ${l ? matchRow(l, { team: other, showTeam: true }) : ''}${n ? matchRow(n, { team: other, showTeam: true }) : ''}`;
    el.querySelector('.h img')?.setAttribute('style', 'width:28px;height:28px');
  }).catch(() => { }));
  await Promise.all(jobs);
}

async function vSchedule(force) {
  const keys = S.schedTeams === 'both' ? ['barca', 'miami'] : [S.team];
  const ds = await Promise.all(keys.map(k => getData(k, force).then(d => ({ k, d })).catch(() => null)));
  let list = [];
  ds.forEach(x => { if (!x) return; const src = S.schedMode === 'up' ? x.d.upcoming : x.d.results.slice().reverse(); list.push(...src.map(m => ({ m, k: x.k }))); });
  list.sort((a, b) => S.schedMode === 'up' ? new Date(a.m.date) - new Date(b.m.date) : new Date(b.m.date) - new Date(a.m.date));
  if (S.schedMode === 'res') list = list.slice(0, 40);
  let h = `<div class="seg" id="seg-mode"><button data-v="up" class="${S.schedMode === 'up' ? 'on' : ''}">Sắp tới</button><button data-v="res" class="${S.schedMode === 'res' ? 'on' : ''}">Kết quả</button></div>
  <div class="seg" id="seg-team"><button data-v="both" class="${S.schedTeams === 'both' ? 'on' : ''}">Cả 2 đội</button><button data-v="one" class="${S.schedTeams === 'one' ? 'on' : ''}">Chỉ ${esc(TEAMS[S.team].short)}</button></div>`;
  let cur = '', body = '';
  for (const { m, k } of list) {
    const mo = new Date(m.date).toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' });
    if (mo !== cur) { if (cur) body += '</div>'; body += `<div class="sec-title">${esc(mo)}</div><div class="card" style="padding:6px 10px">`; cur = mo; }
    body += matchRow(m, { team: k, showTeam: true });
  }
  if (cur) body += '</div>';
  h += body || '<div class="card empty">Không có trận nào.</div>';
  setTimeout(() => {
    $('#seg-mode')?.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.schedMode = b.dataset.v; render(); } });
    $('#seg-team')?.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.schedTeams = b.dataset.v; render(); } });
  });
  return h;
}

async function vMatch(force) {
  const key = S.team, T = TEAMS[key], d = await getData(key, force);
  const res = d.results.slice().reverse().slice(0, 30);
  if (!res.length) return '<div class="card empty">Chưa có trận nào đã đấu.</div>';
  const m = res.find(x => x.id === S.sel.match) || res[0];
  S.sel.match = m.id;
  const sum = await loadSummary(m.id, force);
  const trends = S.trends[key];
  const others = trends ? trends.filter(r => r.id !== m.id) : null;
  const a = analyzeMatch(sum, T.id, others ? trendAverages(others) : null);
  if (!trends) getTrends(key).catch(() => { });
  const A = a.a, B = a.b;
  const H = sum.teams.find(t => t.home) || a.me, Aw = sum.teams.find(t => !t.home) || a.opp;
  let h = `<select class="sel" id="sel-match">${res.map(x => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>${esc(fmtDate(x.date, { day: '2-digit', month: '2-digit' }))} · ${x.isHome ? 'vs' : '@'} ${esc(x.opp.short)} (${x.gf}-${x.ga}) · ${esc(x.league)}</option>`).join('')}</select>`;
  h += `<div class="card hero"><span class="shine"></span><div style="display:flex;justify-content:space-between"><span class="chip">${esc(m.league)}</span><span class="chip">${a.result === 'W' ? '✅ THẮNG' : a.result === 'L' ? '❌ THUA' : '➖ HÒA'}</span></div>
    <div class="vs"><div class="t">${logo(H.logo)}${esc(H.name)}</div><div class="score">${H.score ?? '-'} - ${Aw.score ?? '-'}${H.pen != null ? `<small>Luân lưu ${H.pen}-${Aw.pen}</small>` : `<small>${esc(sum.detail || 'FT')}</small>`}</div><div class="t">${logo(Aw.logo)}${esc(Aw.name)}</div></div>
    <div class="meta">${esc(fmtDate(m.date, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }))} · ${esc(sum.venue || m.venue)}${sum.attendance ? ' · 👥 ' + Number(sum.attendance).toLocaleString('vi-VN') : ''}</div></div>`;
  h += `<div class="card"><div class="h"><h2>Đánh giá màn trình diễn</h2><span class="sub">${esc(T.short)}</span></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:center">${gauge(a.rating, 10, 'Điểm /10')}${a.dom != null ? gauge(a.dom, 100, 'Chỉ số áp đảo', 'var(--c2)') : ''}</div>
    <div class="tiles" style="margin-top:12px"><div class="tile"><b>${a.xg.toFixed(2)}</b><span>xG ước tính<br>đối thủ ${a.xga.toFixed(2)}</span></div>
    <div class="tile"><b>${a.conv != null ? a.conv.toFixed(0) + '%' : '-'}</b><span>Hiệu suất<br>dứt điểm</span></div><div class="tile"><b>${a.acc != null ? a.acc.toFixed(0) + '%' : '-'}</b><span>Sút<br>trúng đích</span></div></div></div>`;
  const ins = a.insights;
  h += `<div class="card"><div class="h"><h2>📰 Tóm tắt trận đấu</h2></div>${matchRecap(sum, a).map((x, i) => `<div class="ins" style="animation-delay:${i * 60}ms"><i>${x.i}</i><div>${esc(x.t)}</div></div>`).join('')}</div>`;
  h += `<div class="card"><div class="h"><h2>🧠 Nhận định chuyên sâu</h2></div>${ins.length ? ins.map((x, i) => `<div class="ins" style="animation-delay:${i * 70}ms"><i>${x.i}</i><div>${esc(x.t)}</div></div>`).join('') : '<div class="mut">Không đủ dữ liệu thống kê cho trận này.</div>'}
    ${!others ? '<div class="disc">Đang tải dữ liệu các trận trước để so sánh với trung bình…</div>' : ''}</div>`;
  if (Object.keys(A).length) {
    h += `<div class="card"><div class="h"><h2>Thống kê trận đấu</h2><span class="sub">${esc(a.me.abbr)} vs ${esc(a.opp.abbr)}</span></div>
      ${cmp('Kiểm soát bóng', A.possessionPct, B.possessionPct, { suf: '%' })}${cmp('Cú sút', A.totalShots, B.totalShots)}${cmp('Sút trúng đích', A.shotsOnTarget, B.shotsOnTarget)}
      ${cmp('xG ước tính', a.xg, a.xga, { dec: 2 })}${cmp('Đường chuyền', A.totalPasses, B.totalPasses)}${cmp('Chuyền chính xác', passP(A), passP(B), { suf: '%' })}
      ${cmp('Phạt góc', A.wonCorners, B.wonCorners)}${cmp('Tắc bóng thành công', A.effectiveTackles, B.effectiveTackles)}${cmp('Cắt bóng', A.interceptions, B.interceptions)}
      ${cmp('Phá bóng', A.effectiveClearance, B.effectiveClearance)}${cmp('Cứu thua', A.saves, B.saves)}${cmp('Tạt bóng', A.totalCrosses, B.totalCrosses)}
      ${cmp('Phạm lỗi', A.foulsCommitted, B.foulsCommitted, { inv: true })}${cmp('Thẻ vàng', A.yellowCards, B.yellowCards, { inv: true })}${cmp('Việt vị', A.offsides, B.offsides, { inv: true })}</div>`;
  }
  if (a.scorers.some(s => s.x != null)) h += `<div class="card"><div class="h"><h2>📍 Vị trí ghi bàn</h2></div>${pitch(a.scorers)}</div>`;
  const evs = sum.events.filter(e => !e.shootout);
  if (evs.length) {
    const icon = e => e.scoring ? '⚽' : /red/.test(e.type) ? '🟥' : /yellow/.test(e.type) ? '🟨' : /substitution/.test(e.type) ? '🔄' : '•';
    h += `<div class="card"><div class="h"><h2>⏱️ Diễn biến</h2><span class="sub">${esc(H.abbr)} | ${esc(Aw.abbr)}</span></div><div class="tl">${evs.map((e, i) => {
      const side = e.teamId === H.id ? 'L' : 'R';
      const txt = `${icon(e)} <b>${esc(e.player)}</b>${e.scoring && /own/i.test(e.type) ? ' (phản lưới)' : ''}${e.scoring && /penalty/i.test(e.type) ? ' (pen)' : ''}${/substitution/.test(e.type) && e.assist ? `<small>ra: ${esc(e.assist)}</small>` : ''}`;
      return `<div class="ev" style="animation-delay:${i * 30}ms"><div class="L">${side === 'L' ? txt : ''}</div><div class="m">${esc(e.min || '')}</div><div class="R">${side === 'R' ? txt : ''}</div></div>`;
    }).join('')}</div></div>`;
  }
  setTimeout(() => $('#sel-match')?.addEventListener('change', e => { S.sel.match = e.target.value; render(); }));
  return h;
}

async function vPredict(force) {
  const key = S.team, T = TEAMS[key], d = await getData(key, force);
  const ups = d.upcoming.filter(m => m.state === 'pre').slice(0, 12);
  if (!ups.length) return '<div class="card empty">Chưa có trận sắp tới để dự đoán.</div>';
  const m = ups.find(x => x.id === S.sel.predict) || ups[0]; S.sel.predict = m.id;
  const [p, trows] = await Promise.all([getPrediction(key, m), getTrends(key).catch(() => null)]);
  const { pr, fMe, fOpp, h2h, odds } = p, opp = m.opp;
  const tavg = trows ? trendAverages(trows) : null;
  const H = m.isHome ? m.me : m.opp, A = m.isHome ? m.opp : m.me;
  let h = `<select class="sel" id="sel-pred">${ups.map(x => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>${esc(fmtDate(x.date, { day: '2-digit', month: '2-digit' }))} · ${x.isHome ? 'vs' : '@'} ${esc(x.opp.short)} · ${esc(x.league)}</option>`).join('')}</select>`;
  h += `<div class="card hero"><span class="shine"></span><div style="display:flex;justify-content:space-between"><span class="chip">🔮 DỰ ĐOÁN</span><span class="chip">${esc(m.league)}</span></div>
    <div class="vs"><div class="t">${logo(H.logo)}${esc(H.short)}</div><div class="score" style="font-size:34px">${(m.isHome ? pr.lMe : pr.lOp).toFixed(1)} - ${(m.isHome ? pr.lOp : pr.lMe).toFixed(1)}<small>Bàn thắng kỳ vọng (xG)</small></div><div class="t">${logo(A.logo)}${esc(A.short)}</div></div>
    ${countdownHTML(m.date)}<div class="meta">📅 ${esc(fmtDate(m.date, { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))} · 📍 ${esc(m.venue || '—')}</div></div>`;
  h += `<div class="card"><div class="h"><h2>Xác suất kết quả</h2><span class="sub">Độ tin cậy ${pr.conf}%</span></div>${probBar(pr.fin, T, opp)}
    <div style="margin-top:14px">
    <div class="mk"><span>Mô hình Poisson</span><span class="mut">${P(pr.model.W)} / ${P(pr.model.D)} / ${P(pr.model.L)}</span><b></b></div>
    ${pr.market ? `<div class="mk"><span>Nhà cái (${esc(odds.provider)})</span><span class="mut">${P(pr.market.W)} / ${P(pr.market.D)} / ${P(pr.market.L)}</span><b></b></div>` : '<div class="mut">Chưa có tỉ lệ nhà cái — dùng 100% mô hình.</div>'}
    </div><div class="ins" style="margin-top:6px"><i>🎙️</i><div><b>Nhận định:</b> ${esc(verdict(T, opp, pr))}</div></div></div>`;
  h += `<div class="card"><div class="h"><h2>Tỉ số khả dĩ nhất</h2><span class="sub">${esc(T.short)} trước</span></div>
    <div class="scores">${pr.scores.slice(0, 8).map(s => `<div><b>${s.s}</b><span>${(s.p * 100).toFixed(1)}%</span></div>`).join('')}</div>
    <div class="sec-title" style="margin-top:16px">Bản đồ nhiệt tỉ số</div>
    <div class="heat"><div class="ax">${esc(T.abbr || '')}</div>${[0, 1, 2, 3, 4, 5].map(j => `<div class="ax">${j}</div>`).join('')}
    ${[0, 1, 2, 3, 4, 5].map(i => `<div class="ax">${i}</div>` + [0, 1, 2, 3, 4, 5].map(j => { const v = pr.M[i][j], mx = pr.scores[0].p, k = v / mx; return `<div style="background:${i > j ? `rgba(34,197,94,${0.1 + k * 0.85})` : i === j ? `rgba(245,158,11,${0.1 + k * 0.85})` : `rgba(239,68,68,${0.1 + k * 0.85})`}">${(v * 100).toFixed(0)}</div>`; }).join('')).join('')}</div>
    <div class="legend"><span>Hàng: bàn của ${esc(T.short)} · Cột: bàn của ${esc(opp.short)} · đơn vị %</span></div></div>`;
  const mk = (l, v) => `<div class="mk"><span>${l}</span><div class="bar"><i data-w="${v * 100}"></i></div><b>${P(v)}</b></div>`;
  h += `<div class="card"><div class="h"><h2>Thị trường bàn thắng</h2>${odds && odds.ou ? `<span class="sub">Kèo nhà cái: ${odds.ou}</span>` : ''}</div>
    ${mk('Trên 1.5 bàn', pr.o15)}${mk('Trên 2.5 bàn', pr.o25)}${mk('Trên 3.5 bàn', pr.o35)}${mk('Cả hai đội ghi bàn', pr.btts)}${mk(esc(T.short) + ' sạch lưới', pr.csMe)}${mk(esc(opp.short) + ' sạch lưới', pr.csOp)}</div>`;
  const nz = (v, lo, hi) => (v - lo) / (hi - lo);
  const axes = ['Tấn công', 'Phòng ngự', 'Phong độ', 'Sân bãi', 'Ổn định'];
  const ctx = (f, home) => (home ? f.homePpg : f.awayPpg) ?? f.ppg;
  const stab = f => 1 - Math.min(1, f.games.length ? f.games.reduce((s, g) => s + Math.abs(g.gf - g.ga - (f.gf - f.ga)), 0) / f.games.length / 3 : .5);
  const vA = [nz(fMe.gf, 0, 3.5), 1 - nz(fMe.ga, 0, 3), fMe.ppg / 3, ctx(fMe, m.isHome) / 3, stab(fMe)];
  const vB = [nz(fOpp.gf, 0, 3.5), 1 - nz(fOpp.ga, 0, 3), fOpp.ppg / 3, ctx(fOpp, !m.isHome) / 3, stab(fOpp)];
  h += `<div class="card"><div class="h"><h2>So sánh sức mạnh</h2></div>${radar(axes, vA, vB, 'var(--acc)', '#94a3b8')}
    <div class="legend" style="justify-content:center"><span><i style="background:var(--acc)"></i>${esc(T.short)}</span><span><i style="background:#94a3b8"></i>${esc(opp.short)}</span></div>
    ${cmp('Bàn thắng/trận', fMe.gf, fOpp.gf, { dec: 2 })}${cmp('Bàn thua/trận', fMe.ga, fOpp.ga, { dec: 2, inv: true })}${cmp('Điểm/trận', fMe.ppg, fOpp.ppg, { dec: 2 })}${cmp('Trận sạch lưới', fMe.cs, fOpp.cs)}
    <div class="h" style="margin-top:14px"><span class="sub">${esc(T.short)}</span>${formChips(fMe.last5)}</div><div class="h"><span class="sub">${esc(opp.short)}</span>${formChips(fOpp.last5)}</div></div>`;
  if (trows) {
    const sc = scorerOdds(trows, pr.lMe);
    if (sc.length) h += `<div class="card"><div class="h"><h2>⚽ Khả năng ghi bàn</h2><span class="sub">dựa trên ${trows.length} trận gần nhất</span></div>${sc.map(s => mk(`${esc(s.player)} <span class="mut">(${s.goals} bàn)</span>`, s.prob)).join('')}</div>`;
  }
  h += `<div class="card"><div class="h"><h2>🔍 Yếu tố then chốt</h2></div>${predictionFactors(T, opp, fMe, fOpp, pr, m.isHome, tavg).map((x, i) => `<div class="ins" style="animation-delay:${i * 60}ms"><i>${x.i}</i><div>${esc(x.t)}</div></div>`).join('')}</div>`;
  if (h2h.length) h += `<div class="card"><div class="h"><h2>Đối đầu gần đây</h2></div>${h2h.map(x => { const r = x.result === 'W' ? 'L' : x.result === 'L' ? 'W' : 'D'; return `<div class="row"><div class="res ${r}">${x.ga}-${x.gf}</div><div><div class="nm">${esc(T.short)} ${x.isHome ? '@' : 'vs'} ${esc(opp.short)}</div><div class="info">${esc(fmtDate(x.date, { day: '2-digit', month: '2-digit', year: 'numeric' }))} · ${esc(x.league)}</div></div><div></div></div>`; }).join('')}</div>`;
  if (fOpp.games.length) h += `<div class="card"><div class="h"><h2>Phong độ ${esc(opp.short)}</h2></div>${fOpp.games.slice(0, 5).map(x => `<div class="row" style="cursor:default">${logo(x.opp.logo)}<div><div class="nm">${x.isHome ? 'vs' : '@'} ${esc(x.opp.short)}</div><div class="info">${esc(fmtDate(x.date, { day: '2-digit', month: '2-digit' }))} · ${esc(x.league)}</div></div><div class="res ${x.result}">${x.gf}-${x.ga}</div></div>`).join('')}</div>`;
  h += `<p class="disc">Mô hình Poisson có trọng số phong độ (10 trận, trận gần hơn nặng hơn), hiệu chỉnh sân nhà/khách và kết hợp 45% xác suất từ tỉ lệ nhà cái (nếu có). Chỉ mang tính tham khảo.</p>`;
  setTimeout(() => $('#sel-pred')?.addEventListener('change', e => { S.sel.predict = e.target.value; render(); }));
  return h;
}

async function vTrends(force) {
  const key = S.team, T = TEAMS[key];
  if (force) delete S.trends[key];
  const rows = await getTrends(key);
  if (!rows.length) return '<div class="card empty">Chưa có dữ liệu.</div>';
  const lab = rows.map(r => r.opp);
  const recent = rows.slice(-5), prev = rows.slice(-10, -5);
  const tile = (label, k, suf = '', dec = 1, inv = false) => {
    const a = avgOf(recent, k), b = avgOf(prev, k); if (a == null) return '';
    const d = b != null ? a - b : null, good = d == null ? null : inv ? d < 0 : d > 0;
    return `<div class="tile"><b>${a.toFixed(dec)}${suf}</b><span>${label}</span>${d != null && Math.abs(d) > 0.05 ? `<div class="tr ${good ? 'up-c' : 'dn-c'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(dec)}${suf}</div>` : '<div class="tr mut">—</div>'}</div>`;
  };
  let h = `<div class="card"><div class="h"><h2>5 trận gần nhất vs 5 trận trước</h2></div><div class="tiles">
    ${tile('Bàn thắng', 'gf')}${tile('Bàn thua', 'ga', '', 1, true)}${tile('xG ước tính', 'xg', '', 2)}${tile('Kiểm soát', 'poss', '%', 0)}${tile('Cú sút', 'shots')}${tile('Sút trúng', 'sot')}</div></div>`;
  // narrative
  const notes = [];
  const g5 = avgOf(recent, 'gf'), g0 = avgOf(prev, 'gf'), c5 = avgOf(recent, 'ga'), c0 = avgOf(prev, 'ga'), x5 = avgOf(recent, 'xg');
  if (g5 != null && g0 != null) notes.push(g5 > g0 + 0.3 ? { i: '🚀', t: `Hàng công đang thăng hoa: ${g5.toFixed(1)} bàn/trận, tăng từ ${g0.toFixed(1)}.` } : g5 < g0 - 0.3 ? { i: '📉', t: `Sức tấn công giảm: ${g5.toFixed(1)} bàn/trận so với ${g0.toFixed(1)} trước đó.` } : { i: '➡️', t: `Hiệu suất ghi bàn ổn định quanh ${g5.toFixed(1)} bàn/trận.` });
  if (c5 != null && c0 != null) notes.push(c5 < c0 - 0.3 ? { i: '🛡️', t: `Hàng thủ cải thiện: thủng lưới ${c5.toFixed(1)}/trận (trước ${c0.toFixed(1)}).` } : c5 > c0 + 0.3 ? { i: '⚠️', t: `Hàng thủ đáng lo: thủng lưới ${c5.toFixed(1)}/trận (trước ${c0.toFixed(1)}).` } : { i: '🧱', t: `Hàng thủ ổn định (${c5.toFixed(1)} bàn thua/trận).` });
  if (g5 != null && x5 != null) notes.push(g5 - x5 > 0.5 ? { i: '🎯', t: `Ghi bàn vượt xG (${g5.toFixed(1)} vs ${x5.toFixed(1)}) — dứt điểm đang rất "nóng", có thể khó duy trì.` } : x5 - g5 > 0.5 ? { i: '🔁', t: `Tạo nhiều cơ hội hơn số bàn (xG ${x5.toFixed(1)} vs ${g5.toFixed(1)}) — bàn thắng sẽ sớm đến.` } : { i: '⚖️', t: `Bàn thắng tương xứng với chất lượng cơ hội tạo ra.` });
  const f = form(rows.map(r => ({ ...r, isHome: r.home })), 10);
  if (f.unbeaten >= 3) notes.push({ i: '🔥', t: `Chuỗi ${f.unbeaten} trận bất bại.` });
  h += `<div class="card"><div class="h"><h2>📌 Xu hướng nổi bật</h2></div>${notes.map((x, i) => `<div class="ins" style="animation-delay:${i * 60}ms"><i>${x.i}</i><div>${esc(x.t)}</div></div>`).join('')}</div>`;
  h += `<div class="card"><div class="h"><h2>Bàn thắng & bàn thua</h2><span class="sub">${rows.length} trận</span></div>${goalBars(rows)}</div>`;
  h += `<div class="card"><div class="h"><h2>Kiểm soát bóng</h2></div>${lineChart(lab, [{ n: 'Kiểm soát %', c: 'var(--acc)', v: rows.map(r => r.poss) }], { min: 20, max: 80, suf: '%', avg: avgOf(rows, 'poss') })}</div>`;
  h += `<div class="card"><div class="h"><h2>Dứt điểm</h2></div>${lineChart(lab, [{ n: 'Cú sút', c: 'var(--acc)', v: rows.map(r => r.shots) }, { n: 'Trúng đích', c: '#38bdf8', v: rows.map(r => r.sot) }, { n: 'Đối thủ sút', c: '#94a3b8', v: rows.map(r => r.oppShots), dash: true }], { min: 0 })}</div>`;
  h += `<div class="card"><div class="h"><h2>xG ước tính vs bàn thắng</h2></div>${lineChart(lab, [{ n: 'xG', c: '#a78bfa', v: rows.map(r => r.xg) }, { n: 'Bàn thắng', c: 'var(--acc)', v: rows.map(r => r.gf) }, { n: 'xG đối thủ', c: '#f87171', v: rows.map(r => r.xga), dash: true }], { min: 0 })}</div>`;
  if (rows.some(r => r.passPct != null)) h += `<div class="card"><div class="h"><h2>Độ chính xác chuyền bóng</h2></div>${lineChart(lab, [{ n: 'Chuyền chính xác %', c: '#34d399', v: rows.map(r => r.passPct) }], { suf: '%', avg: avgOf(rows, 'passPct') })}</div>`;
  const cnt = {}; rows.forEach(r => (r.scorers || []).forEach(p => p && (cnt[p] = (cnt[p] || 0) + 1)));
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (top.length) h += `<div class="card"><div class="h"><h2>🏆 Chân sút tiêu biểu</h2><span class="sub">${rows.length} trận gần nhất</span></div>${top.map(([p, g]) => `<div class="mk"><span>${esc(p)}</span><div class="bar"><i data-w="${g / top[0][1] * 100}"></i></div><b>${g}</b></div>`).join('')}</div>`;
  h += `<p class="disc">xG ước tính được tính từ số cú sút trúng đích/không trúng/bị chặn và phạt đền (dữ liệu ESPN không công bố xG chính thức). Đội: ${esc(T.name)}.</p>`;
  return h;
}

/* ---------------- settings & notifications ---------------- */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
async function swReg() { if (!('serviceWorker' in navigator)) return null; return Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 3000))]); }
async function showNote(title, opt) {
  const o = { icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', vibrate: [120, 60, 120], ...opt };
  const reg = await swReg();
  if (reg) return reg.showNotification(title, o);
  if ('Notification' in window) return new Notification(title, o);
}
async function openSettings() {
  const st = (await kvGet('settings')) || {}; const teams = st.teams || {};
  const last = await kvGet('lastCheck');
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  $('#sheet-body').innerHTML = `
    <div class="set"><div>🔔 Thông báo<small>Kết quả + phân tích sau trận, nhắc trước 24h & 1h, lịch tuần</small></div><label class="sw"><input type="checkbox" id="st-notify" ${st.notify && perm === 'granted' ? 'checked' : ''}><span></span></label></div>
    <div class="set"><div>${logo('https://a.espncdn.com/i/teamlogos/soccer/500/83.png')}</div><div style="flex:1">Barcelona</div><label class="sw"><input type="checkbox" data-t="barca" ${teams.barca !== false ? 'checked' : ''}><span></span></label></div>
    <div class="set"><div>${logo('https://a.espncdn.com/i/teamlogos/soccer/500/20232.png')}</div><div style="flex:1">Inter Miami</div><label class="sw"><input type="checkbox" data-t="miami" ${teams.miami !== false ? 'checked' : ''}><span></span></label></div>
    <div class="set" style="gap:8px;flex-wrap:wrap"><button class="btn ghost" id="st-test">Gửi thử thông báo</button><button class="btn ghost" id="st-check">Kiểm tra trận mới</button></div>
    <div class="mut" style="padding:8px 0">Quyền thông báo: <b>${perm}</b>${last ? ` · Kiểm tra lần cuối: ${new Date(last).toLocaleString('vi-VN')}` : ''}</div>
    ${!standalone ? `<div class="card install">${isIOS ? `<p>📲 <b>Cài lên iPhone:</b> mở bằng Safari → nút <b>Chia sẻ</b> → <b>Thêm vào MH chính</b>. (iOS chỉ cho phép thông báo khi app đã được cài.)</p>` : `<p>📲 <b>Cài ứng dụng</b> lên màn hình chính để nhận thông báo nền và dùng như app thật.</p><button class="btn" id="st-install">Cài đặt</button>`}</div>` : '<div class="mut">✅ Đang chạy dưới dạng ứng dụng đã cài.</div>'}
    <div class="set"><div>Xoá bộ nhớ đệm<small>Tải lại toàn bộ dữ liệu</small></div><button class="btn ghost" id="st-clear">Xoá</button></div>
    <p class="disc">Dữ liệu: ESPN (công khai). Android/Chrome: app tự kiểm tra định kỳ ở chế độ nền (Periodic Background Sync) khi đã cài. iOS: kiểm tra mỗi khi mở app.</p>`;
  $('#sheet').hidden = false;
  $('#st-notify').onchange = async e => {
    if (e.target.checked) {
      if (!('Notification' in window)) { toast('Trình duyệt không hỗ trợ thông báo'); e.target.checked = false; return; }
      const p = await Notification.requestPermission();
      if (p !== 'granted') { toast('Bạn chưa cấp quyền thông báo'); e.target.checked = false; return; }
      await kvSet('settings', { ...(await kvGet('settings')), notify: true });
      await registerPeriodic();
      toast('Đã bật thông báo 🔔'); checkAndNotify(showNote);
    } else { await kvSet('settings', { ...(await kvGet('settings')), notify: false }); toast('Đã tắt thông báo'); }
  };
  document.querySelectorAll('#sheet-body [data-t]').forEach(i => i.onchange = async () => {
    const s = (await kvGet('settings')) || {}; s.teams = { ...(s.teams || {}), [i.dataset.t]: i.checked }; await kvSet('settings', s);
  });
  $('#st-test').onclick = async () => {
    if (!('Notification' in window) || Notification.permission !== 'granted') { toast('Hãy bật thông báo trước'); return; }
    const d = await getData(S.team), l = d.results.at(-1), T = TEAMS[S.team];
    if (!l) return;
    let body = `${l.me.short} ${l.gf}-${l.ga} ${l.opp.short} · ${l.league}`;
    try { const a = analyzeMatch(await loadSummary(l.id), T.id); body += `\nKiểm soát ${a.poss?.toFixed(0) ?? '-'}% · Sút ${a.a.totalShots ?? '-'} · xG~${a.xg.toFixed(1)} · Điểm ${a.rating}/10\n${a.insights[0]?.t || ''}`; } catch (e) { }
    const n = d.upcoming[0]; if (n) body += `\n📅 Trận tới: vs ${n.opp.short} · ${fmtDate(n.date)}`;
    await showNote(`(Thử) Kết thúc: ${T.short} ${l.gf}-${l.ga} ${l.opp.short}`, { body, tag: 'test', data: { url: './#match/' + S.team + '/' + l.id } });
    toast('Đã gửi thông báo thử');
  };
  $('#st-check').onclick = async () => { const s = await checkAndNotify(showNote, { force: Notification.permission === 'granted' }); toast(s.length ? `Đã gửi ${s.length} thông báo` : 'Không có trận mới cần báo'); };
  $('#st-install') && ($('#st-install').onclick = async () => { if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; } else toast('Dùng menu ⋮ của trình duyệt → "Cài đặt ứng dụng"'); });
  $('#st-clear').onclick = async () => { const ks = await caches.keys(); await Promise.all(ks.filter(k => k.startsWith('bmh-') && k !== KV_CACHE).map(k => caches.delete(k))); const c = await caches.open(KV_CACHE); for (const r of await c.keys()) if (/http%3A|sum%3A/.test(r.url)) await c.delete(r); S.data = {}; S.trends = {}; S.preds = {}; toast('Đã xoá cache'); closeSheet(); render(true); };
}
function closeSheet() { $('#sheet').hidden = true; }
async function registerPeriodic() {
  try {
    const reg = await swReg(); if (!reg || !('periodicSync' in reg)) return;
    const s = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (s.state === 'granted') await reg.periodicSync.register('bmh-check', { minInterval: 30 * 60 * 1000 });
  } catch (e) { }
}
$('#btn-settings').onclick = openSettings;
$('#sheet-close').onclick = closeSheet;
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
$('#btn-refresh').onclick = async () => { const b = $('#btn-refresh'); b.classList.add('spinning'); S.preds = {}; if (S.tab === 'trends') delete S.trends[S.team]; await render(true); b.classList.remove('spinning'); toast('Đã cập nhật dữ liệu mới nhất'); };

/* ---------------- routing & boot ---------------- */
function route() {
  const h = location.hash.replace('#', '').split('/');
  if (h[0] && ['home', 'schedule', 'match', 'predict', 'trends'].includes(h[0])) {
    const o = {}; if (h[1] && TEAMS[h[1]]) o.team = h[1];
    if (h[2]) o[h[0] === 'match' ? 'match' : 'predict'] = h[2];
    history.replaceState(null, '', location.pathname);
    go(h[0], o); return true;
  }
  return false;
}
window.addEventListener('hashchange', route);
navigator.serviceWorker?.addEventListener('message', e => { if (e.data && e.data.type === 'nav') { location.hash = e.data.url.split('#')[1] || ''; } });

applyTheme();
if (!route()) render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(() => registerPeriodic()).catch(() => { });
// foreground polling: notifications + live refresh
setInterval(() => checkAndNotify(showNote).catch(() => { }), 5 * 60 * 1000);
setTimeout(() => checkAndNotify(showNote).catch(() => { }), 4000);
setInterval(async () => {
  const d = S.data[S.team];
  const soon = d && d.upcoming.some(m => m.state === 'in' || Math.abs(new Date(m.date) - Date.now()) < 3 * 36e5);
  if (soon && S.tab === 'home' && document.visibilityState === 'visible' && $('#sheet').hidden) { await getData(S.team, true); render(); }
}, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkAndNotify(showNote).catch(() => { }); });
