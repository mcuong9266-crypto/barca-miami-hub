/* Core: data, analysis, prediction, notifications — shared by page and service worker (no DOM). */
const API = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const TEAMS = {
  barca: { key: 'barca', id: '83', name: 'Barcelona', short: 'Barça', leagues: ['esp.1'],
           c1: '#a50044', c2: '#004d98', acc: '#edbb00', emoji: '🔵🔴' },
  miami: { key: 'miami', id: '20232', name: 'Inter Miami CF', short: 'Inter Miami', leagues: ['usa.1'],
           c1: '#f7b5cd', c2: '#2b2b2b', acc: '#f7b5cd', emoji: '🩷🖤' }
};
const KV_CACHE = 'bmh-kv-v1';
const LEAGUE_VI = {
  'esp.1': 'La Liga', 'usa.1': 'Giải Nhà nghề Mỹ', 'uefa.champions': 'Champions League', 'esp.copa_del_rey': 'Cúp Nhà vua Tây Ban Nha',
  'esp.super_cup': 'Siêu cúp Tây Ban Nha', 'club.friendly': 'Giao hữu', 'concacaf.champions': 'Cúp các câu lạc bộ CONCACAF',
  'usa.open': 'Cúp quốc gia Mỹ', 'concacaf.leagues.cup': 'Leagues Cup', 'fifa.cwc': 'FIFA Club World Cup', 'uefa.super_cup': 'Siêu cúp châu Âu'
};
function leagueName(l) { if (!l) return ''; return LEAGUE_VI[l.slug] || l.name || l.shortName || l.abbreviation || ''; }

/* ---------- tiny key/value store on Cache API (works in page + SW) ---------- */
async function kvGet(k) {
  try { const c = await caches.open(KV_CACHE); const r = await c.match('__kv/' + encodeURIComponent(k)); return r ? await r.json() : undefined; }
  catch (e) { return undefined; }
}
async function kvSet(k, v) {
  try { const c = await caches.open(KV_CACHE); await c.put('__kv/' + encodeURIComponent(k), new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } })); }
  catch (e) { /* ignore */ }
}

async function fetchJSON(url, { ttl = 300000, store = true } = {}) {
  const key = 'http:' + url;
  const cached = store ? await kvGet(key) : undefined;
  if (cached && Date.now() - cached.t < ttl) return cached.d;
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { signal: ctl.signal }); clearTimeout(tm);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (store) await kvSet(key, { t: Date.now(), d });
    return d;
  } catch (e) {
    if (cached) return cached.d;
    throw e;
  }
}

/* ---------------------------- parsing ---------------------------- */
function num(v) { if (v == null) return null; if (typeof v === 'object') v = v.value ?? v.displayValue; const n = Number(v); return isNaN(n) ? null : n; }
function logoOf(t) { return (t.logos && t.logos[0] && t.logos[0].href) || t.logo || ''; }

function parseEvent(e, teamId) {
  const c = e.competitions[0], st = c.status.type;
  const comps = c.competitors.map(x => ({
    id: String(x.team.id), name: x.team.displayName, short: x.team.shortDisplayName || x.team.displayName,
    abbr: x.team.abbreviation, logo: logoOf(x.team), home: x.homeAway === 'home',
    score: num(x.score), pen: num(x.shootoutScore)
  }));
  const me = comps.find(x => x.id === String(teamId)) || comps[0];
  const opp = comps.find(x => x !== me) || comps[1];
  const completed = !!st.completed;
  const gf = completed ? me.score : null, ga = completed ? opp.score : null;
  return {
    id: String(e.id), date: e.date, teamId: String(teamId),
    league: leagueName(e.league),
    leagueSlug: (e.league && e.league.slug) || '',
    venue: (c.venue && c.venue.fullName) || '', state: st.state, completed, status: st.name,
    detail: st.shortDetail || st.detail || '', clock: c.status.displayClock || '',
    me, opp, isHome: me.home, gf, ga,
    liveGf: me.score, liveGa: opp.score,
    result: completed && gf != null ? (gf > ga ? 'W' : gf < ga ? 'L' : 'D') : null
  };
}

async function loadSchedule(teamKey, opts = {}) {
  const T = TEAMS[teamKey], id = T.id, ttl = opts.ttl ?? 300000;
  const urls = [`${API}/all/teams/${id}/schedule`, `${API}/all/teams/${id}/schedule?fixture=true`];
  for (const l of T.leagues) urls.push(`${API}/${l}/teams/${id}/schedule`, `${API}/${l}/teams/${id}/schedule?fixture=true`);
  return mergeSchedules(await Promise.all(urls.map(u => fetchJSON(u, { ttl }).catch(() => null))), id, T);
}

function mergeSchedules(list, id, T) {
  const map = new Map(); let info = null;
  for (const d of list) {
    if (!d) continue;
    if (d.team && !info) info = d.team;
    for (const e of d.events || []) { try { map.set(String(e.id), parseEvent(e, id)); } catch (_) { } }
  }
  if (!map.size && list.every(x => !x)) throw new Error('Không tải được dữ liệu (mất mạng?)');
  const all = [...map.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
  return {
    team: T, info,
    results: all.filter(m => m.completed),
    upcoming: all.filter(m => !m.completed && (m.state === 'pre' || m.state === 'in')),
    live: all.filter(m => m.state === 'in')
  };
}

async function loadOpponentSchedule(oppId, slug) {
  const urls = [`${API}/all/teams/${oppId}/schedule`];
  if (slug && slug !== 'all') urls.push(`${API}/${slug}/teams/${oppId}/schedule`);
  // domestic league of opponent is unknown; 'all' + this competition is usually enough
  const res = await Promise.all(urls.map(u => fetchJSON(u, { ttl: 3 * 3600e3 }).catch(() => null)));
  return mergeSchedules(res, oppId, { id: oppId });
}

function parseSummary(d) {
  const comp = (d.header && d.header.competitions && d.header.competitions[0]) || {};
  const teams = (comp.competitors || []).map(c => ({
    id: String(c.team.id), name: c.team.displayName, abbr: c.team.abbreviation, logo: logoOf(c.team),
    home: c.homeAway === 'home', score: num(c.score), pen: num(c.shootoutScore)
  }));
  const stats = {};
  for (const t of (d.boxscore && d.boxscore.teams) || []) {
    const o = {}; for (const s of t.statistics || []) { const v = parseFloat(s.displayValue); if (!isNaN(v)) o[s.name] = v; }
    stats[String(t.team.id)] = o;
  }
  const events = (d.keyEvents || []).map(k => ({
    type: (k.type && k.type.type) || '', text: (k.type && k.type.text) || '', min: (k.clock && k.clock.displayValue) || '',
    sec: (k.clock && k.clock.value) || 0, period: (k.period && k.period.number) || 0,
    teamId: k.team ? String(k.team.id) : null, player: (k.participants && k.participants[0] && k.participants[0].athlete.displayName) || '',
    assist: (k.participants && k.participants[1] && k.participants[1].athlete.displayName) || '',
    scoring: !!k.scoringPlay, shootout: !!k.shootout, x: k.fieldPositionX, y: k.fieldPositionY, desc: k.text || ''
  })).filter(k => k.scoring || /card|goal|penalty|substitution/.test(k.type));
  let odds = null;
  const p = d.pickcenter && d.pickcenter[0];
  if (p && p.homeTeamOdds && p.awayTeamOdds) {
    odds = { provider: (p.provider && p.provider.name) || '', home: num(p.homeTeamOdds.moneyLine), away: num(p.awayTeamOdds.moneyLine),
             draw: p.drawOdds ? num(p.drawOdds.moneyLine) : null, ou: num(p.overUnder), over: num(p.overOdds), under: num(p.underOdds) };
  }
  const st = (comp.status && comp.status.type) || {};
  return {
    id: String(comp.id || (d.header && d.header.id) || ''), date: comp.date, completed: !!st.completed, state: st.state, detail: st.shortDetail || st.detail || '',
    teams, stats, events, odds,
    venue: (d.gameInfo && d.gameInfo.venue && d.gameInfo.venue.fullName) || '', attendance: (d.gameInfo && d.gameInfo.attendance) || null,
    league: leagueName(d.header && d.header.league)
  };
}

async function loadSummary(eventId, force) {
  const k = 'sum2:' + eventId;
  if (!force) { const c = await kvGet(k); if (c) return c; }
  const d = await fetchJSON(`${API}/all/summary?event=${eventId}`, { store: false });
  const s = parseSummary(d);
  if (s.completed) await kvSet(k, s);
  return s;
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const j = i++; try { out[j] = await fn(items[j]); } catch (e) { out[j] = null; } }
  }));
  return out;
}

/* ---------------------------- analysis ---------------------------- */
function xgProxy(s) {
  if (!s) return 0;
  const tot = s.totalShots || 0, on = s.shotsOnTarget || 0, bl = s.blockedShots || 0, pk = s.penaltyKickShots || 0;
  const off = Math.max(0, tot - on - bl);
  return +(Math.max(0, on - pk) * 0.27 + pk * 0.76 + off * 0.055 + bl * 0.04).toFixed(2);
}
const pct = v => v == null ? null : (v <= 1 ? v * 100 : v);
const passP = s => s && s.totalPasses ? (s.accuratePasses ?? 0) / s.totalPasses * 100 : pct(s && s.passPct);

function analyzeMatch(sum, teamId, avg) {
  teamId = String(teamId);
  const me = sum.teams.find(t => t.id === teamId) || sum.teams[0];
  const opp = sum.teams.find(t => t !== me) || sum.teams[1];
  const a = sum.stats[me.id] || {}, b = sum.stats[opp.id] || {};
  const gf = me.score ?? 0, ga = opp.score ?? 0;
  const xg = xgProxy(a), xga = xgProxy(b);
  const poss = a.possessionPct ?? null;
  const goals = sum.events.filter(e => e.scoring && !e.shootout);
  const ins = [];
  const nm = me.name, on = opp.name;

  // result narrative & game state
  let lead = 0, minLead = 0, maxLead = 0;
  for (const g of goals) { lead += g.teamId === me.id ? 1 : -1; minLead = Math.min(minLead, lead); maxLead = Math.max(maxLead, lead); }
  if (gf > ga && minLead < 0) ins.push({ i: '🔥', t: `Ngược dòng ấn tượng: từng bị dẫn ${-minLead} bàn trước khi thắng ${gf}-${ga}.` });
  else if (gf < ga && maxLead > 0) ins.push({ i: '💔', t: `Đánh rơi lợi thế: từng dẫn ${maxLead} bàn nhưng thua ${gf}-${ga}.` });
  else if (gf === ga && maxLead > 0) ins.push({ i: '⚠️', t: `Để đối thủ gỡ hòa sau khi đã vượt lên dẫn trước.` });
  else if (gf - ga >= 3) ins.push({ i: '💥', t: `Chiến thắng hủy diệt cách biệt ${gf - ga} bàn.` });
  else if (gf === 0 && ga === 0) ins.push({ i: '🧱', t: `Trận hòa không bàn thắng — hàng công bế tắc.` });

  const late = goals.filter(g => parseInt(g.min) >= 80);
  if (late.length) ins.push({ i: '⏱️', t: `${late.length} bàn thắng đến ở 10 phút cuối (${late.map(g => g.min).join(', ')}) — thể lực và bản lĩnh quyết định.` });
  const early = goals.find(g => parseInt(g.min) <= 15);
  if (early) ins.push({ i: '⚡', t: `Bàn mở tỉ số sớm ở phút ${early.min} của ${early.teamId === me.id ? nm : on}.` });

  if (poss != null) {
    if (poss >= 62) ins.push({ i: '🎯', t: `Áp đảo thế trận với ${poss.toFixed(0)}% kiểm soát bóng.` });
    else if (poss <= 40) ins.push({ i: '🛡️', t: `Chơi chủ động lùi sâu, chỉ cầm bóng ${poss.toFixed(0)}%${gf > ga ? ' nhưng vẫn giành chiến thắng nhờ phản công hiệu quả' : ''}.` });
  }
  if (a.totalShots != null) ins.push({ i: '👟', t: `Tung ra ${a.totalShots} cú sút (${a.shotsOnTarget ?? 0} trúng đích) so với ${b.totalShots ?? 0} (${b.shotsOnTarget ?? 0}) của ${on}.` });
  if (a.totalShots) {
    const diff = gf - xg;
    if (diff >= 1.2) ins.push({ i: '🎯', t: `Dứt điểm cực kỳ sắc bén: ${gf} bàn trong khi số bàn thắng kỳ vọng chỉ là ${xg.toFixed(1)} (+${diff.toFixed(1)}).` });
    else if (diff <= -1.2) ins.push({ i: '😤', t: `Phung phí cơ hội: chỉ ${gf} bàn dù số bàn thắng kỳ vọng là ${xg.toFixed(1)}.` });
    if (xga - ga >= 1) ins.push({ i: '🧤', t: `Thủ môn/hàng thủ đứng vững: chỉ thủng lưới ${ga} dù đối thủ tạo ra cơ hội tương đương khoảng ${xga.toFixed(1)} bàn.` });
  }
  const pp = passP(a);
  if (pp != null && a.totalPasses) {
    if (pp >= 88) ins.push({ i: '🧠', t: `Luân chuyển bóng chính xác ${pp.toFixed(0)}% trên ${a.totalPasses} đường chuyền.` });
    else if (pp < 78) ins.push({ i: '📉', t: `Chuyền bóng thiếu chính xác (${pp.toFixed(0)}%) — bị đối thủ gây áp lực mạnh.` });
  }
  if ((b.saves || 0) >= 5) ins.push({ i: '🧱', t: `Thủ môn ${on} cứu thua ${b.saves} lần — nếu không tỉ số còn đậm hơn.` });
  if ((a.saves || 0) >= 5) ins.push({ i: '🦸', t: `Thủ môn ${nm} có ${a.saves} pha cứu thua quan trọng.` });
  const cards = (a.yellowCards || 0) + 2 * (a.redCards || 0);
  if (a.redCards) ins.push({ i: '🟥', t: `Nhận ${a.redCards} thẻ đỏ — ảnh hưởng lớn đến cục diện.` });
  else if (cards >= 4) ins.push({ i: '🟨', t: `Kỷ luật kém: ${a.yellowCards} thẻ vàng, ${a.foulsCommitted ?? '?'} lỗi.` });
  if ((a.interceptions || 0) + (a.effectiveTackles || 0) >= 25) ins.push({ i: '🛡️', t: `Pressing hiệu quả: ${a.effectiveTackles || 0} tắc bóng thành công, ${a.interceptions || 0} lần cắt bóng.` });

  if (avg && avg.n >= 3) {
    if (a.totalShots != null && avg.shots) {
      const d = a.totalShots - avg.shots;
      if (Math.abs(d) >= 3) ins.push({ i: d > 0 ? '📈' : '📉', t: `Số cú sút ${d > 0 ? 'cao' : 'thấp'} hơn trung bình gần đây (${avg.shots.toFixed(1)}/trận).` });
    }
    if (poss != null && avg.poss) {
      const d = poss - avg.poss;
      if (Math.abs(d) >= 6) ins.push({ i: '🔄', t: `Kiểm soát bóng ${d > 0 ? 'nhiều' : 'ít'} hơn thường lệ ${Math.abs(d).toFixed(0)}% (trung bình ${avg.poss.toFixed(0)}%).` });
    }
  }

  const dom = poss == null ? null : Math.round(
    0.35 * poss + 0.35 * share(a.totalShots, b.totalShots) + 0.3 * share(a.shotsOnTarget, b.shotsOnTarget));
  let rating = 6 + (gf - ga) * 0.7 + ((poss ?? 50) - 50) / 25 + ((a.shotsOnTarget || 0) - (b.shotsOnTarget || 0)) * 0.12 + (xg - xga) * 0.35;
  rating = Math.max(1, Math.min(10, rating));
  return {
    me, opp, a, b, gf, ga, xg, xga, poss, dom, rating: +rating.toFixed(1), insights: ins,
    result: gf > ga ? 'W' : gf < ga ? 'L' : 'D',
    conv: a.totalShots ? gf / a.totalShots * 100 : null,
    acc: a.totalShots ? (a.shotsOnTarget || 0) / a.totalShots * 100 : null,
    scorers: goals.map(g => ({ team: g.teamId === me.id ? 'me' : 'opp', player: g.player, min: g.min, type: g.type, x: g.x, y: g.y }))
  };
}
/* Short recap: the key moments of the match in ≤5 lines */
function matchRecap(sum, a) {
  const me = a.me, opp = a.opp, out = [];
  const goals = sum.events.filter(e => e.scoring && !e.shootout);
  const verb = a.result === 'W' ? 'thắng' : a.result === 'L' ? 'thua' : 'hòa';
  let ht = [0, 0]; goals.filter(g => g.period === 1).forEach(g => ht[g.teamId === me.id ? 0 : 1]++);
  out.push({ i: '📝', t: `${me.name} ${verb} ${opp.name} ${a.gf}-${a.ga}${sum.league ? ' (' + sum.league + ')' : ''}${goals.length ? `, hiệp 1 ${ht[0]}-${ht[1]}` : ''}.` });
  if (goals.length) {
    let s = [0, 0];
    const line = goals.map(g => { s[g.teamId === me.id ? 0 : 1]++; const tag = /own/i.test(g.type) ? ' (phản lưới)' : /penalty/i.test(g.type) ? ' (phạt đền)' : ''; return `${g.min} ${g.player || '?'}${tag} ${s[0]}-${s[1]}`; });
    out.push({ i: '⚽', t: line.join(' · ') });
  }
  // turning point
  let lead = 0, decisive = null;
  for (const g of goals) { const prev = lead; lead += g.teamId === me.id ? 1 : -1; if ((prev <= 0 && lead > 0) || (prev >= 0 && lead < 0)) decisive = g; }
  if (decisive && a.result !== 'D' && decisive === goals[0]) out.push({ i: '🔑', t: `Bàn mở tỉ số của ${decisive.player} (${decisive.min}) định đoạt thế trận — ${decisive.teamId === me.id ? me.name : opp.name} dẫn trước đến hết trận.` });
  else if (decisive && a.result !== 'D') out.push({ i: '🔑', t: `Bước ngoặt: bàn của ${decisive.player} phút ${decisive.min} đưa ${decisive.teamId === me.id ? me.name : opp.name} vượt lên và giữ đến hết trận.` });
  const reds = sum.events.filter(e => /red/.test(e.type));
  if (reds.length) out.push({ i: '🟥', t: reds.map(r => `${r.player} (${r.teamId === me.id ? me.name : opp.name}) nhận thẻ đỏ phút ${r.min}`).join('; ') + '.' });
  if (a.a.totalShots != null) out.push({ i: '📊', t: `Kiểm soát bóng ${a.poss != null ? a.poss.toFixed(0) + '%' : 'không rõ'}; ${a.a.totalShots} cú sút (${a.a.shotsOnTarget || 0} trúng đích) so với ${a.b.totalShots ?? 0} (${a.b.shotsOnTarget || 0}); bàn thắng kỳ vọng ${a.xg.toFixed(1)} so với ${a.xga.toFixed(1)}.` });
  return out.slice(0, 5);
}
function share(x, y) { x = x || 0; y = y || 0; return x + y === 0 ? 50 : x / (x + y) * 100; }

/* ---------------------------- trends ---------------------------- */
async function loadTrends(sched, n = 10) {
  const recent = sched.results.slice(-n);
  const sums = await pool(recent, 4, m => loadSummary(m.id));
  const rows = [];
  recent.forEach((m, i) => {
    const s = sums[i]; const r = { id: m.id, date: m.date, opp: m.opp.short || m.opp.name, oppName: m.opp.name, gf: m.gf, ga: m.ga, result: m.result, home: m.isHome, league: m.league };
    if (s) {
      const a = s.stats[m.teamId] || {}, oppId = Object.keys(s.stats).find(k => k !== m.teamId), b = s.stats[oppId] || {};
      Object.assign(r, { poss: a.possessionPct ?? null, shots: a.totalShots ?? null, sot: a.shotsOnTarget ?? null, oppShots: b.totalShots ?? null, oppSot: b.shotsOnTarget ?? null,
        passPct: passP(a), passes: a.totalPasses ?? null, corners: a.wonCorners ?? null, fouls: a.foulsCommitted ?? null, yc: a.yellowCards ?? null,
        xg: a.totalShots != null ? xgProxy(a) : null, xga: b.totalShots != null ? xgProxy(b) : null,
        scorers: s.events.filter(e => e.scoring && !e.shootout && e.teamId === m.teamId && !/own/i.test(e.type)).map(e => e.player) });
    }
    rows.push(r);
  });
  return rows;
}
function avgOf(rows, k) { const v = rows.map(r => r[k]).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; }
function trendAverages(rows) {
  return { n: rows.length, poss: avgOf(rows, 'poss'), shots: avgOf(rows, 'shots'), sot: avgOf(rows, 'sot'), gf: avgOf(rows, 'gf'), ga: avgOf(rows, 'ga'), xg: avgOf(rows, 'xg'), xga: avgOf(rows, 'xga'), passPct: avgOf(rows, 'passPct'), corners: avgOf(rows, 'corners') };
}

/* ---------------------------- prediction ---------------------------- */
function form(results, n = 10) {
  const last = results.slice(-n).reverse();
  let w = 1, sw = 0, gf = 0, ga = 0, pts = 0;
  const homeR = [], awayR = [];
  last.forEach((m, i) => {
    w = Math.pow(0.88, i); sw += w; gf += w * m.gf; ga += w * m.ga; pts += w * (m.result === 'W' ? 3 : m.result === 'D' ? 1 : 0);
    (m.isHome ? homeR : awayR).push(m);
  });
  const p = r => r.length ? r.reduce((s, m) => s + (m.result === 'W' ? 3 : m.result === 'D' ? 1 : 0), 0) / r.length : null;
  let streak = 0, sType = null;
  for (const m of last) { const t = m.result === 'L' ? 'L' : 'U'; if (sType == null) sType = t; if (t === sType) streak++; else break; }
  return {
    n: last.length, gf: sw ? gf / sw : 1.35, ga: sw ? ga / sw : 1.35, ppg: sw ? pts / sw : 1.4,
    homePpg: p(homeR), awayPpg: p(awayR), last5: last.slice(0, 5).map(m => m.result).reverse(),
    cs: last.filter(m => m.ga === 0).length, fts: last.filter(m => m.gf === 0).length,
    unbeaten: sType === 'U' ? streak : 0, losing: sType === 'L' ? streak : 0, games: last
  };
}
function poissonP(k, l) { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; }
function mlToProb(ml) { if (ml == null || isNaN(ml)) return null; return ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100); }

function scoreGrid(lMe, lOp) {
  const N = 9, M = []; let D0 = 0;
  for (let i = 0; i < N; i++) { M[i] = []; for (let j = 0; j < N; j++) { M[i][j] = poissonP(i, lMe) * poissonP(j, lOp); if (i === j) D0 += M[i][j]; } }
  // Dixon-Coles style: real football has a few more draws than pure Poisson — move that mass onto the draw cells
  const bump = Math.min(0.04, 0.06 * Math.exp(-(lMe + lOp) / 2));
  const kd = (D0 + bump) / D0, ko = (1 - D0 - bump) / (1 - D0);
  let W = 0, D = 0, L = 0, o15 = 0, o25 = 0, o35 = 0, btts = 0, csMe = 0, csOp = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const p = M[i][j] *= (i === j ? kd : ko);
    if (i > j) W += p; else if (i === j) D += p; else L += p;
    if (i + j > 1) o15 += p; if (i + j > 2) o25 += p; if (i + j > 3) o35 += p;
    if (i > 0 && j > 0) btts += p; if (j === 0) csMe += p; if (i === 0) csOp += p;
  }
  return { M, W, D, L, o15, o25, o35, btts, csMe, csOp };
}

function predict(fMe, fOpp, isHome, odds, meIsHomeInOdds) {
  const base = 1.35;
  const shrink = (v, n) => { const k = Math.min(1, n / 8); return k * v + (1 - k) * base; };
  const meGf = shrink(fMe.gf, fMe.n), meGa = shrink(fMe.ga, fMe.n), opGf = shrink(fOpp.gf, fOpp.n), opGa = shrink(fOpp.ga, fOpp.n);
  const ha = isHome == null ? 1 : isHome ? 1.08 : 0.93, hb = isHome == null ? 1 : isHome ? 0.93 : 1.08;
  const formAdj = (fMe.ppg - fOpp.ppg) * 0.04;
  let lMe = meGf * opGa / base * ha * (1 + formAdj), lOp = opGf * meGa / base * hb * (1 - formAdj);
  lMe = Math.min(4.5, Math.max(0.2, lMe)); lOp = Math.min(4.5, Math.max(0.15, lOp));
  const mg = scoreGrid(lMe, lOp);
  const model = { W: mg.W, D: mg.D, L: mg.L, lMe, lOp };
  let market = null;
  if (odds && odds.home != null && odds.away != null) {
    const ph = mlToProb(odds.home), pa = mlToProb(odds.away), pd = mlToProb(odds.draw) || 0.25;
    const s = ph + pa + pd;
    market = meIsHomeInOdds ? { W: ph / s, D: pd / s, L: pa / s } : { W: pa / s, D: pd / s, L: ph / s };
  }
  // One unified forecast: re-balance the expected goals so that the score grid itself
  // reproduces the blended (55% model + 45% bookmaker) win/loss balance. Everything shown
  // — probabilities, expected goals, scorelines, goal markets — then comes from this one grid.
  if (market) {
    const target = 0.55 * (model.W - model.L) + 0.45 * (market.W - market.L);
    const total = lMe + lOp;
    let lo = 0.03, hi = 0.97;
    for (let k = 0; k < 40; k++) { const r = (lo + hi) / 2, g = scoreGrid(total * r, total * (1 - r)); if (g.W - g.L < target) lo = r; else hi = r; }
    const r = (lo + hi) / 2; lMe = total * r; lOp = total * (1 - r);
  }
  const g = market ? scoreGrid(lMe, lOp) : mg;
  const fin = { W: g.W, D: g.D, L: g.L };
  const scores = [];
  for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) scores.push({ s: `${i}-${j}`, i, j, p: g.M[i][j] });
  scores.sort((a, b) => b.p - a.p);
  // the headline pick: most likely outcome, then the most likely score inside that outcome
  const outcome = fin.W >= fin.D && fin.W >= fin.L ? 'W' : fin.L >= fin.D ? 'L' : 'D';
  const pick = scores.find(x => outcome === 'W' ? x.i > x.j : outcome === 'L' ? x.i < x.j : x.i === x.j);
  const agree = market ? 1 - (Math.abs(model.W - market.W) + Math.abs(model.L - market.L)) / 2 : 0.7;
  const conf = Math.round(Math.min(95, (Math.min(fMe.n, fOpp.n) / 10) * 45 + agree * 35 + Math.abs(fin.W - fin.L) * 25));
  let ou = null;
  if (odds && odds.ou != null && !isNaN(odds.ou)) {
    const line = Number(odds.ou); let over = 0, push = 0;
    for (let i = 0; i < g.M.length; i++) for (let j = 0; j < g.M.length; j++) { const t = i + j; if (t > line) over += g.M[i][j]; else if (t === line) push += g.M[i][j]; }
    const under = 1 - over - push;
    const po = mlToProb(odds.over), pu = mlToProb(odds.under);
    const mkOver = po != null && pu != null ? po / (po + pu) : null;
    ou = { line, pOver: over, pUnder: under, pPush: push, pick: over >= under ? 'over' : 'under', mkOver };
  }
  return { ou, lMe, lOp, M: g.M, model, market, fin, outcome, pick, o15: g.o15, o25: g.o25, o35: g.o35, btts: g.btts, csMe: g.csMe, csOp: g.csOp, scores: scores.slice(0, 8), conf };
}

/* One-line unified prediction text, e.g. "Barça thắng 2-1" */
function pickText(T, opp, pr) {
  const p = pr.pick, sc = `${p.i}-${p.j}`;
  return pr.outcome === 'W' ? `${T.short} thắng ${sc}` : pr.outcome === 'L' ? `${opp.short || opp.name} thắng ${p.j}-${p.i}` : `Hòa ${sc}`;
}

function scorerOdds(trendRows, lMe) {
  const games = trendRows.filter(r => r.scorers).length || 1;
  const cnt = {}; trendRows.forEach(r => (r.scorers || []).forEach(p => { if (p) cnt[p] = (cnt[p] || 0) + 1; }));
  const avgGf = avgOf(trendRows, 'gf') || 1;
  return Object.entries(cnt).map(([p, g]) => {
    const rate = g / games * (lMe / avgGf);
    return { player: p, goals: g, prob: 1 - Math.exp(-rate) };
  }).sort((a, b) => b.prob - a.prob).slice(0, 5);
}

function predictionFactors(T, opp, fMe, fOpp, pr, isHome, trend) {
  const f = [];
  const nm = T.short, on = opp.short || opp.name;
  f.push({ i: '⚔️', t: `${nm} ghi trung bình ${fMe.gf.toFixed(2)} bàn và thủng lưới ${fMe.ga.toFixed(2)} bàn/trận (${fMe.n} trận gần nhất, có trọng số).` });
  f.push({ i: '🛡️', t: `${on} ghi ${fOpp.gf.toFixed(2)} và để thủng lưới ${fOpp.ga.toFixed(2)} bàn/trận (${fOpp.n} trận).` });
  if (isHome != null) {
    const p = isHome ? fMe.homePpg : fMe.awayPpg;
    f.push({ i: isHome ? '🏟️' : '✈️', t: `${nm} đá ${isHome ? 'sân nhà' : 'sân khách'}${p != null ? ` — ${p.toFixed(2)} điểm/trận trong bối cảnh này` : ''}.` });
  }
  if (fMe.unbeaten >= 3) f.push({ i: '🔥', t: `${nm} đang có chuỗi ${fMe.unbeaten} trận bất bại.` });
  if (fMe.losing >= 2) f.push({ i: '🥶', t: `${nm} đã thua ${fMe.losing} trận liên tiếp — áp lực tâm lý lớn.` });
  if (fOpp.unbeaten >= 3) f.push({ i: '⚠️', t: `${on} bất bại ${fOpp.unbeaten} trận gần nhất.` });
  if (fOpp.losing >= 2) f.push({ i: '📉', t: `${on} thua ${fOpp.losing} trận liên tiếp.` });
  if (fOpp.cs >= 4) f.push({ i: '🧱', t: `${on} giữ sạch lưới ${fOpp.cs}/${fOpp.n} trận — hàng thủ chắc chắn.` });
  if (fMe.fts >= 3) f.push({ i: '😶', t: `${nm} tịt ngòi ${fMe.fts}/${fMe.n} trận gần đây.` });
  if (trend && trend.poss) f.push({ i: '🎛️', t: `Trung bình mỗi trận gần đây: kiểm soát bóng ${trend.poss.toFixed(0)}%, ${trend.shots ? trend.shots.toFixed(1) : '?'} cú sút, ${trend.xg ? trend.xg.toFixed(2) : '?'} bàn thắng kỳ vọng.` });
  if (pr.market) {
    const d = pr.model.W - pr.market.W;
    if (Math.abs(d) > 0.08) f.push({ i: '💹', t: `Mô hình ${d > 0 ? 'lạc quan' : 'thận trọng'} hơn nhà cái ${Math.abs(d * 100).toFixed(0)}% về cửa thắng của ${nm}.` });
  }
  return f;
}

function verdict(T, opp, pr) {
  const { W, D, L } = pr.fin;
  const nm = T.short, on = opp.short || opp.name, pc = v => (v * 100).toFixed(0) + '%';
  let v;
  if (pr.outcome === 'W') v = W >= 0.6 ? `${nm} là ứng viên sáng giá với ${pc(W)} khả năng thắng.` : `${nm} được đánh giá nhỉnh hơn (thắng ${pc(W)}, hòa ${pc(D)}, thua ${pc(L)}) nhưng trận đấu còn bỏ ngỏ.`;
  else if (pr.outcome === 'L') v = L >= 0.6 ? `${on} được đánh giá cao hơn hẳn với ${pc(L)} khả năng thắng.` : `${on} được đánh giá nhỉnh hơn (${on} thắng ${pc(L)}, hòa ${pc(D)}, ${nm} thắng ${pc(W)}).`;
  else v = `Trận đấu rất cân bằng, hòa là kết quả khả dĩ nhất (${pc(D)}).`;
  v += ` Dự đoán: ${pickText(T, opp, pr)}. Tổng số bàn kỳ vọng ${(pr.lMe + pr.lOp).toFixed(1)}, ${pr.o25 > 0.55 ? 'nhiều khả năng có từ 3 bàn trở lên' : pr.o25 < 0.45 ? 'nhiều khả năng có không quá 2 bàn' : 'khả năng có từ 3 bàn trở lên và không quá 2 bàn gần như ngang nhau'}.`;
  return v;
}

async function quickPick(key, sched, m) {
  try {
    const T = TEAMS[key], off = r => r.filter(x => !/friendly/i.test(x.leagueSlug));
    const oppS = await loadOpponentSchedule(m.opp.id, m.leagueSlug);
    let odds = null; try { odds = (await loadSummary(m.id, true)).odds; } catch (e) { }
    const pr = predict(form(off(sched.results)), form(off(oppS.results)), m.isHome, odds, m.isHome);
    await savePrediction(m, pr);
    return `\n🔮 Dự đoán: ${pickText(T, m.opp, pr)}${pr.ou ? ` · Mốc nhà cái ${fmtLine(pr.ou.line)} bàn: ${ouWord(pr.ou.pick)} (${((pr.ou.pick === 'over' ? pr.ou.pOver : pr.ou.pUnder) * 100).toFixed(0)}%)` : ''} (${T.short} thắng ${(pr.fin.W * 100).toFixed(0)}%, hòa ${(pr.fin.D * 100).toFixed(0)}%, thua ${(pr.fin.L * 100).toFixed(0)}%)`;
  } catch (e) { return ''; }
}

/* ---------------------------- prediction track record ---------------------------- */
function snapshot(pr) {
  return { t: Date.now(), outcome: pr.outcome, i: pr.pick.i, j: pr.pick.j, W: pr.fin.W, D: pr.fin.D, L: pr.fin.L,
           lMe: pr.lMe, lOp: pr.lOp, top: pr.scores.slice(0, 3).map(x => x.s), ou: pr.ou };
}
// Saved before kick-off (overwritten until the match starts, so the last pre-match forecast is kept)
async function savePrediction(m, pr) {
  if (m.state !== 'pre' || new Date(m.date) <= Date.now()) return;
  await kvSet('pred2:' + m.id, { ...snapshot(pr), source: 'saved' });
}
// For matches played before the app was installed: recompute using ONLY results dated before kick-off
// plus the bookmaker's closing odds, so the forecast never "sees" the match itself.
async function rebuildPrediction(sched, m) {
  const before = r => r.filter(x => new Date(x.date) < new Date(m.date) && !/friendly/i.test(x.leagueSlug));
  let oppS = { results: [] }; try { oppS = await loadOpponentSchedule(m.opp.id, m.leagueSlug); } catch (e) { }
  let odds = null; try { odds = (await loadSummary(m.id)).odds; } catch (e) { }
  const pr = predict(form(before(sched.results)), form(before(oppS.results)), m.isHome, odds, m.isHome);
  return { ...snapshot(pr), source: 'rebuilt' };
}
async function predictionFor(sched, m) {
  const k = 'pred2:' + m.id;
  let p = await kvGet(k);
  if (!p && m.completed) { p = await rebuildPrediction(sched, m); await kvSet(k, p); }
  return p;
}
function gradePrediction(p, m) {
  if (!p || !m.completed || m.gf == null) return null;
  const exact = p.i === m.gf && p.j === m.ga;
  const outcomeOk = p.outcome === m.result;
  const gdOk = p.i - p.j === m.gf - m.ga;
  const totalOk = p.i + p.j === m.gf + m.ga;
  const pActual = m.result === 'W' ? p.W : m.result === 'D' ? p.D : p.L;
  const inTop3 = (p.top || []).includes(`${m.gf}-${m.ga}`);
  const level = outcomeOk ? 'ok' : 'miss';
  const label = outcomeOk ? 'Đúng kết quả' : 'Sai kết quả';
  let ou = null;
  if (p.ou) {
    const t = m.gf + m.ga, actual = t > p.ou.line ? 'over' : t < p.ou.line ? 'under' : 'push';
    ou = { line: p.ou.line, pick: p.ou.pick, actual, total: t, ok: actual === 'push' ? null : actual === p.ou.pick,
           prob: p.ou.pick === 'over' ? p.ou.pOver : p.ou.pUnder, mkOver: p.ou.mkOver };
  }
  return { exact, outcomeOk, gdOk, totalOk, pActual, inTop3, level, label, ou };
}
async function predictionRecord(sched, n = 10) {
  const recent = sched.results.filter(x => !/friendly/i.test(x.leagueSlug)).slice(-n).reverse();
  const rows = await pool(recent, 3, async m => { const p = await predictionFor(sched, m); return p ? { m, p, g: gradePrediction(p, m) } : null; });
  const ok = rows.filter(Boolean);
  const cnt = f => ok.filter(r => r.g && r.g[f]).length;
  const ouRows = ok.filter(r => r.g && r.g.ou && r.g.ou.ok != null);
  return { rows: ok, n: ok.length, outcome: cnt('outcomeOk'), exact: cnt('exact'), gd: cnt('gdOk'), top3: cnt('inTop3'), total: cnt('totalOk'),
           ouN: ouRows.length, ouOk: ouRows.filter(r => r.g.ou.ok).length };
}
const ouWord = k => k === 'over' ? 'Trên' : k === 'under' ? 'Dưới' : 'Bằng mốc (hoàn)';
const fmtLine = v => String(v).replace('.', ',');
function ouText(o) { return o ? `Mốc nhà cái ${fmtLine(o.line)} bàn: dự đoán ${ouWord(o.pick)}, thực tế ${o.total} bàn (${ouWord(o.actual).toLowerCase()}) → ${o.ok == null ? '➖ hoàn' : o.ok ? '✅ đúng' : '❌ sai'}` : ''; }
function pickTextFromSnap(T, opp, p) {
  return p.outcome === 'W' ? `${T.short} thắng ${p.i}-${p.j}` : p.outcome === 'L' ? `${opp.short || opp.name} thắng ${p.j}-${p.i}` : `Hòa ${p.i}-${p.j}`;
}

/* ---------------------------- formatting ---------------------------- */
function fmtDate(iso, opt) { try { return new Date(iso).toLocaleString('vi-VN', opt || { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } }

/* ---------------------------- notifications ---------------------------- */
async function checkAndNotify(show, { force = false } = {}) {
  const settings = (await kvGet('settings')) || {};
  if (!settings.notify && !force) return [];
  const notified = (await kvGet('notified')) || {};
  const sent = [];
  const upcomingAll = [];
  for (const key of Object.keys(TEAMS)) {
    if (settings.teams && settings.teams[key] === false) continue;
    const T = TEAMS[key];
    let s; try { s = await loadSchedule(key, { ttl: 60000 }); } catch (e) { continue; }
    const next = s.upcoming.find(m => m.state === 'pre');
    upcomingAll.push(...s.upcoming.filter(m => m.state === 'pre').map(m => ({ ...m, T })));
    const last = s.results[s.results.length - 1];
    if (last && !notified['ft:' + last.id] && Date.now() - new Date(last.date) < 3 * 864e5) {
      let body = `${last.me.short} ${last.gf}-${last.ga} ${last.opp.short} · ${last.league}`;
      try {
        const sum = await loadSummary(last.id);
        const a = analyzeMatch(sum, T.id);
        const parts = [];
        if (a.poss != null) parts.push(`Kiểm soát bóng ${a.poss.toFixed(0)}%`);
        if (a.a.totalShots != null) parts.push(`${a.a.totalShots} cú sút (${a.a.shotsOnTarget || 0} trúng đích)`);
        parts.push(`Bàn thắng kỳ vọng ${a.xg.toFixed(1)}`, `Điểm ${a.rating}/10`);
        body += '\n' + parts.join(' · ');
        const rc = matchRecap(sum, a);
        if (rc[1]) body += `\n⚽ ${rc[1].t}`;
        const tp = rc.find(x => x.i === '🔑' || x.i === '🟥');
        if (tp) body += `\n${tp.t}`;
        else if (a.insights[0]) body += `\n${a.insights[0].t}`;
      } catch (e) { }
      try {
        const p = await predictionFor(s, last), g = gradePrediction(p, last);
        if (g) body += `\n🎯 Dự đoán trước trận: ${pickTextFromSnap(T, last.opp, p)} → ${g.outcomeOk ? '✅' : '❌'} ${g.label}`;
        if (g && g.ou) body += `\n📏 ${ouText(g.ou)}`;
      } catch (e) { }
      if (next) body += `\n📅 Trận tới: gặp ${next.opp.short} (${next.isHome ? 'sân nhà' : 'sân khách'}) · ${fmtDate(next.date)}`;
      const em = last.result === 'W' ? '✅' : last.result === 'L' ? '❌' : '➖';
      await show(`${em} Kết thúc: ${T.short} ${last.gf}-${last.ga} ${last.opp.short}`, { body, tag: 'ft-' + last.id, data: { url: './#match/' + key + '/' + last.id } });
      notified['ft:' + last.id] = Date.now(); sent.push('ft');
    }
    if (next) {
      const h = (new Date(next.date) - Date.now()) / 36e5;
      if (h > 1 && h <= 24 && !notified['d1:' + next.id]) {
        await show(`📅 ${T.short} thi đấu trong ${Math.round(h)} giờ nữa`, { body: `Gặp ${next.opp.name} (${next.isHome ? 'sân nhà' : 'sân khách'}) · ${next.league}\n${fmtDate(next.date)} · ${next.venue}${await quickPick(key, s, next)}\nMở ứng dụng để xem phân tích dự đoán chi tiết.`, tag: 'd1-' + next.id, data: { url: './#predict/' + key + '/' + next.id } });
        notified['d1:' + next.id] = Date.now(); sent.push('d1');
      }
      if (h > 0 && h <= 1 && !notified['h1:' + next.id]) {
        await show(`⏰ Sắp bóng lăn: ${T.short} gặp ${next.opp.short}`, { body: `Bắt đầu lúc ${fmtDate(next.date, { hour: '2-digit', minute: '2-digit' })} · ${next.league}`, tag: 'h1-' + next.id, data: { url: './#predict/' + key + '/' + next.id } });
        notified['h1:' + next.id] = Date.now(); sent.push('h1');
      }
    }
  }
  // weekly digest (once per ISO week)
  const wk = isoWeek(new Date());
  if (!notified['wk:' + wk] && upcomingAll.length) {
    const in7 = upcomingAll.filter(m => new Date(m.date) - Date.now() < 7 * 864e5).sort((a, b) => new Date(a.date) - new Date(b.date));
    if (in7.length) {
      const body = in7.map(m => `${m.T.short} gặp ${m.opp.short} (${m.isHome ? 'sân nhà' : 'sân khách'}) — ${fmtDate(m.date)}`).join('\n');
      await show(`🗓️ Lịch thi đấu 7 ngày tới (${in7.length} trận)`, { body, tag: 'wk-' + wk, data: { url: './#schedule' } });
      sent.push('wk');
    }
    notified['wk:' + wk] = Date.now();
  }
  await kvSet('notified', notified);
  await kvSet('lastCheck', Date.now());
  return sent;
}
function isoWeek(d) { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return t.getUTCFullYear() + '-' + Math.ceil(((t - y) / 864e5 + 1) / 7); }
