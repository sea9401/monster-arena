// 몬스터 아레나 — 비동기 고스트 PvP 서버
// 의존성 0: Node 내장 http + JSON 파일 저장. 정적 파일도 함께 서빙.
// 실행: node server/server.js   (기본 포트 3000, PORT 환경변수로 변경)
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, "..", "www");    // Capacitor webDir(정적 파일)
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");
const VERSION = "1.0.0";

// ---------- 저장소 (JSON 파일) ----------
let db = { players: {}, matches: {} };
// DATA_FILE 디렉터리 보장 (영속 볼륨/커스텀 경로 대비)
try { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); } catch {}
function load() {
  try { db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { db = {}; }
  if (!db.players) db.players = {};
  if (!db.matches) db.matches = {};
  if (!db.accounts) db.accounts = {};   // username -> { username, pass, playerId, createdAt }
  if (!db.sessions) db.sessions = {};   // token -> { username, playerId, exp }
  if (!db.saves) db.saves = {};         // playerId -> 게임 state(JSON)
  if (!db.tournament) db.tournament = { weekId: weekInfo().weekId, scores: {}, lastChampion: null };
  if (!db.tournament.claimedBy) db.tournament.claimedBy = {}; // playerId -> 보상 받은 weekId
  if (!db.messages) db.messages = {};   // toPlayerId -> [{from,fromName,text,at}]
  if (!db.season) db.season = { monthId: monthInfo().monthId, lastResults: {}, claimedBy: {} };
  if (!db.season.lastResults) db.season.lastResults = {};
  if (!db.season.claimedBy) db.season.claimedBy = {};
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(db), () => {});
  }, 150);
}

const uid = () => crypto.randomBytes(8).toString("hex");
const now = () => Date.now();

// 클라이언트 SPECIES 키와 일치해야 함(스냅샷 검증용). 신규 종 추가 시 여기도 갱신.
const VALID_SPECIES = ["ember", "aqua", "spark", "lion", "crab", "hare", "wolf", "bat", "armadillo", "bear", "unicorn", "swan", "toad", "viper"];

// ---------- 매칭 풀 시드 (실제 플레이어가 적을 때 고스트 제공) ----------
const SEED_SPECIES = ["ember", "aqua", "spark"];
function seedGhosts() {
  if (Object.values(db.players).some((p) => p.seeded)) return;
  const names = ["라이벌 카이", "트레이너 보라", "고스트 진", "야생의 루", "챔프 모모", "도전자 한"];
  names.forEach((name, i) => {
    const id = "ghost-" + i;
    const rating = 950 + i * 90; // 950 ~ 1400 분포
    const lvl = 4 + i;
    const base = 40 + i * 18;
    db.players[id] = {
      playerId: id, name, species: SEED_SPECIES[i % 3], seeded: true,
      level: lvl, atk: base, def: Math.round(base * 0.9), spd: Math.round(base * 0.8),
      hp: 90 + i * 20, rating, dayCount: lvl, wins: i, losses: 1, updatedAt: now(),
    };
  });
  save();
}

// ---------- 주간 토너먼트 (KST 기준 월~일, 승점 누적) ----------
const KST = 9 * 3600 * 1000; // EC2 타임존과 무관하게 한국 시간 고정 사용
// 주어진 시각이 속한 KST 주의 월요일 날짜(weekId)와 다음 월요일 0시(KST)의 실제 UTC ms.
function weekInfo(ts = Date.now()) {
  const sh = new Date(ts + KST);                 // UTC 필드 = KST 벽시계
  const day = (sh.getUTCDay() + 6) % 7;          // 0=월 ... 6=일
  const monWall = Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), sh.getUTCDate() - day);
  return { weekId: new Date(monWall).toISOString().slice(0, 10), endsAt: (monWall - KST) + 7 * 86400000 };
}
// 동기 함수 — 주가 바뀌면 직전 1위를 챔피언으로 보관하고 점수 초기화. (Node 단일스레드 → 원자적)
function rolloverTournament() {
  const { weekId } = weekInfo();
  if (db.tournament.weekId === weekId) return;
  const top = Object.values(db.tournament.scores).sort((a, b) => b.points - a.points)[0];
  if (top) db.tournament.lastChampion = { playerId: top.playerId, name: top.name, species: top.species, points: top.points, weekId: db.tournament.weekId };
  db.tournament.scores = {};
  db.tournament.weekId = weekId;
}

// ---------- 일일 랜덤 이벤트 (KST 날짜 시드로 결정적 선택, 무상태) ----------
const EVENTS = [
  { id: "harvest",  icon: "🌾", name: "풍요의 날",  desc: "훈련·보상 EXP +50%",   effect: { expMult: 1.5 } },
  { id: "storm",    icon: "⛈️", name: "폭풍의 날",  desc: "전투 회피 +5%",        effect: { evadeBonus: 0.05 } },
  { id: "training", icon: "💪", name: "수련의 날",  desc: "스탯 훈련 효과 +1",    effect: { statBonus: 1 } },
  { id: "feast",    icon: "🍱", name: "잔치의 날",  desc: "먹이·놀이 회복 +50%",  effect: { careMult: 1.5 } },
];
function kstDateStr(ts) { return new Date(ts + KST).toISOString().slice(0, 10); }
function djb2(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h; }
// 오늘 이벤트. 14일 윈도우를 앞으로 walk하며 직전 "확정" 인덱스와 겹치면 +1로 밀어
// 연속 중복을 완전히 방지(전날이 이미 밀린 경우까지 반영). 날짜 시드라 결정적.
function eventFor(ts = Date.now()) {
  const DAY = 86400000, n = EVENTS.length;
  let idx = djb2(kstDateStr(ts - 14 * DAY)) % n;
  for (let k = 13; k >= 0; k--) {
    const cur = djb2(kstDateStr(ts - k * DAY)) % n;
    idx = (n > 1 && cur === idx) ? (cur + 1) % n : cur;
  }
  return { ...EVENTS[idx], date: kstDateStr(ts) };
}

// ---------- 월간 시즌 (KST 기준 월말 티어 스냅샷 + 멱등 claim) ----------
function monthInfo(ts = Date.now()) {
  const sh = new Date(ts + KST);
  const y = sh.getUTCFullYear(), m = sh.getUTCMonth();
  return { monthId: `${y}-${String(m + 1).padStart(2, "0")}`, endsAt: Date.UTC(y, m + 1, 1) - KST };
}
const SEASON_TIERS = [ // min rating ascending — RANKS와 일치
  { name: "브론즈",   min: 0,    coins: 50,  hasTitle: false },
  { name: "실버",     min: 1100, coins: 100, hasTitle: false },
  { name: "골드",     min: 1300, coins: 200, hasTitle: true  },
  { name: "플래티넘", min: 1550, coins: 350, hasTitle: true  },
  { name: "챔피언",   min: 1800, coins: 600, hasTitle: true  },
];
function tierOf(rating) { let t = SEASON_TIERS[0]; for (const x of SEASON_TIERS) if (rating >= x.min) t = x; return t; }
function seasonReward(rating, monthId) {
  const t = tierOf(rating);
  return { monthId, tier: t.name, rating, coins: t.coins, title: t.hasTitle ? `🏅 ${monthId} ${t.name}` : "" };
}
// 동기 — 월이 바뀌면 직전 월의 모든 비시드 플레이어 보상을 스냅샷(claimedBy는 monthId 비교로 자연 만료)
function rolloverSeason() {
  const { monthId } = monthInfo();
  if (db.season.monthId === monthId) return;
  for (const p of Object.values(db.players)) {
    if (p.seeded) continue;
    db.season.lastResults[p.playerId] = seasonReward(p.rating || 1000, db.season.monthId);
  }
  db.season.monthId = monthId;
}

// ---------- 소셜: 프리셋 도발 메시지 ----------
const TAUNTS = {
  gg:      "GG! 좋은 승부였어 👏",
  again:   "또 붙자! 다음엔 안 져 😤",
  easy:    "이지 게임이었네 😏",
  rematch: "재대결 신청한다! 🔥",
  respect: "강하다… 인정 👍",
  cute:    "네 몬스터 귀엽더라 🥰",
};
const CHAMPION_TITLE = "👑 챔피언";
const CHAMPION_COINS = 200;
const msgRate = {}; // from -> lastSentMs (간단 레이트리밋)

// ---------- Elo ----------
function elo(myRating, oppRating, won, k = 32) {
  const expected = 1 / (1 + Math.pow(10, (oppRating - myRating) / 400));
  return Math.round(myRating + k * ((won ? 1 : 0) - expected));
}

// ---------- HTTP 유틸 ----------
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}

// 스냅샷 정합성 가드(자명한 조작 방지 — 프로토타입 수준)
function sanitizeSnapshot(b) {
  const clampN = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d; };
  return {
    name: String(b.name || "이름없음").slice(0, 12),
    species: VALID_SPECIES.includes(b.species) ? b.species : "ember",
    level: clampN(b.level, 1, 999, 1),
    atk: clampN(b.atk, 1, 99999, 10),
    def: clampN(b.def, 1, 99999, 10),
    spd: clampN(b.spd, 1, 99999, 10),
    hp: clampN(b.hp, 1, 999999, 50),
    dayCount: clampN(b.dayCount, 1, 99999, 1),
    rating: clampN(b.rating, 0, 5000, 1000),
    title: String(b.title || "").slice(0, 16), // 코스메틱(보유검증 안 함, 표시용)
  };
}
function pub(p) {
  return { playerId: p.playerId, name: p.name, species: p.species, level: p.level,
    atk: p.atk, def: p.def, spd: p.spd, hp: p.hp, rating: p.rating, title: p.title || "" };
}

// ---------- 인증 (아이디/비밀번호, scrypt) ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return salt + ":" + hash;
}
function verifyPassword(pw, stored) {
  if (typeof stored !== "string" || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const ref = Buffer.from(hash, "hex");
  let test;
  try { test = crypto.scryptSync(pw, salt, 64); } catch { return false; }
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}
const TOKEN_TTL = 30 * 24 * 3600 * 1000; // 30일
function bearer(req) {
  const h = req.headers["authorization"] || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}
function newSession(username, playerId) {
  const token = crypto.randomBytes(32).toString("hex");
  db.sessions[token] = { username, playerId, exp: now() + TOKEN_TTL };
  return token;
}
function authFrom(req) {
  const s = db.sessions[bearer(req)];
  if (!s) return null;
  if (s.exp < now()) { delete db.sessions[bearer(req)]; return null; }
  return s; // { username, playerId, exp }
}
const validUsername = (u) => typeof u === "string" && /^[A-Za-z0-9_]{3,16}$/.test(u);
// 로그인 시도 제한 (username별, 10분 내 8회)
const loginFails = {};
function tooManyFails(u) {
  const f = loginFails[u];
  return f && f.count >= 8 && now() - f.first < 6e5;
}
function noteFail(u) {
  const f = loginFails[u] || (loginFails[u] = { count: 0, first: now() });
  if (now() - f.first > 6e5) { f.count = 0; f.first = now(); }
  f.count++;
}

// ---------- 정적 파일 ----------
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".ico": "image/x-icon" };
function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const filePath = path.join(ROOT, path.normalize(rel));
  if (!filePath.startsWith(ROOT)) return send(res, 403, { error: "forbidden" });
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, { error: "not found" });
    // 패치가 즉시 적용되도록 정적 파일은 매 요청 재검증(304 또는 200). ETag/Last-Modified는 노드 기본값에 의존하지 않으므로 no-cache로 단순화.
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache, max-age=0, must-revalidate",
    });
    res.end(buf);
  });
}

// ---------- 라우팅 ----------
const server = http.createServer(async (req, res) => {
  const { method } = req;
  const url = req.url.split("?")[0];
  const query = Object.fromEntries(new URLSearchParams(req.url.split("?")[1] || ""));

  if (method === "OPTIONS") return send(res, 204, {});

  // --- API ---
  if (url === "/health") return send(res, 200, { ok: true, version: VERSION, players: Object.keys(db.players).length });

  if (url === "/players/register" && method === "POST") {
    const b = await readBody(req);
    const playerId = (typeof b.playerId === "string" && b.playerId) || uid();
    if (!db.players[playerId]) {
      db.players[playerId] = { playerId, name: "신규", species: "ember", level: 1, atk: 10, def: 10, spd: 10, hp: 50, rating: 1000, dayCount: 1, wins: 0, losses: 0, updatedAt: now() };
      save();
    }
    return send(res, 200, { playerId });
  }

  let m;
  if ((m = url.match(/^\/players\/([^/]+)\/snapshot$/)) && method === "PUT") {
    const id = m[1];
    const snap = sanitizeSnapshot(await readBody(req));
    const prev = db.players[id] || { playerId: id, wins: 0, losses: 0, rating: snap.rating };
    db.players[id] = { ...prev, ...snap, playerId: id, seeded: false, updatedAt: now() };
    save();
    return send(res, 200, { ok: true, rating: db.players[id].rating });
  }

  if (url === "/matches/find" && method === "POST") {
    const b = await readBody(req);
    const me = db.players[b.playerId];
    const myRating = me ? me.rating : Number(b.rating) || 1000;
    const pool = Object.values(db.players).filter((p) => p.playerId !== b.playerId);
    if (pool.length === 0) return send(res, 503, { error: "POOL_TOO_SMALL" });
    const within = (r) => pool.filter((p) => Math.abs(p.rating - myRating) <= r);
    let cands = within(150);
    if (cands.length === 0) cands = within(300);
    if (cands.length === 0) cands = pool; // 마지막 폴백: 아무나
    const opp = cands[Math.floor(Math.random() * cands.length)];
    const matchId = uid();
    db.matches[matchId] = { matchId, playerId: b.playerId, opponentId: opp.playerId, createdAt: now(), done: false };
    save();
    return send(res, 200, { matchId, seed: crypto.randomInt(1e9), opponent: pub(opp) });
  }

  if ((m = url.match(/^\/matches\/([^/]+)\/result$/)) && method === "POST") {
    const matchId = m[1];
    const b = await readBody(req);
    const match = db.matches[matchId];
    if (!match) return send(res, 404, { error: "no_match" });
    if (match.done) return send(res, 409, { error: "already_resolved" });
    if (match.playerId !== b.playerId) return send(res, 403, { error: "not_your_match" });

    const me = db.players[match.playerId];
    const opp = db.players[match.opponentId];
    if (!me || !opp) return send(res, 404, { error: "player_gone" });

    const won = b.winner === "player";
    const oldRating = me.rating, oldOpp = opp.rating;
    me.rating = elo(oldRating, oldOpp, won);
    if (won) me.wins++; else me.losses++;
    me.updatedAt = now();
    // 고스트(상대)도 Elo 대칭 갱신 — 비동기 PvP에서 내 몬스터가 남의 고스트로 방어
    opp.rating = elo(oldOpp, oldRating, !won);
    if (won) opp.losses++; else opp.wins++;
    opp.updatedAt = now();
    match.done = true;
    // 주간 토너먼트 승점(제출자 본인만): 승 +10, 패 +3(참가 보상)
    rolloverTournament();
    const sc = db.tournament.scores[match.playerId] || { playerId: match.playerId, points: 0, wins: 0 };
    sc.points += won ? 10 : 3;
    if (won) sc.wins += 1;
    sc.name = me.name; sc.species = me.species; sc.title = me.title || "";
    db.tournament.scores[match.playerId] = sc;
    save();
    return send(res, 200, { ok: true, oldRating, newRating: me.rating, delta: me.rating - oldRating, tp: won ? 10 : 3 });
  }

  if (url === "/leaderboard" && method === "GET") {
    const limit = Math.min(Number(query.limit) || 50, 100);
    const rows = Object.values(db.players)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, limit)
      .map((p, i) => ({ rank: i + 1, playerId: p.playerId, name: p.name, species: p.species, rating: p.rating, wins: p.wins || 0, losses: p.losses || 0, title: p.title || "" }));
    return send(res, 200, { rows });
  }

  if ((m = url.match(/^\/players\/([^/]+)$/)) && method === "GET") {
    const p = db.players[m[1]];
    if (!p) return send(res, 404, { error: "not found" });
    return send(res, 200, p);
  }

  // --- 일일 이벤트 ---
  if (url === "/event" && method === "GET") return send(res, 200, eventFor());

  // --- 주간 토너먼트 ---
  if (url === "/tournament" && method === "GET") {
    rolloverTournament();
    const { weekId, endsAt } = weekInfo();
    const all = Object.values(db.tournament.scores).sort((a, b) => b.points - a.points);
    const rows = all.slice(0, 20).map((s, i) => ({ rank: i + 1, playerId: s.playerId, name: s.name, species: s.species, points: s.points, wins: s.wins || 0, title: s.title || "" }));
    let me2 = null;
    const pid = query.playerId;
    if (pid) { const idx = all.findIndex((s) => s.playerId === pid); if (idx >= 0) me2 = { rank: idx + 1, points: all[idx].points, wins: all[idx].wins || 0 }; }
    return send(res, 200, { weekId, endsAt, rows, me: me2, lastChampion: db.tournament.lastChampion || null });
  }

  // 지난주 챔피언 보상 수령(서버 멱등 — 멀티기기 중복 방지)
  if (url === "/tournament/claim" && method === "POST") {
    rolloverTournament();
    const b = await readBody(req);
    const ch = db.tournament.lastChampion;
    if (!ch || ch.playerId !== b.playerId) return send(res, 200, { reward: null });
    if (db.tournament.claimedBy[b.playerId] === ch.weekId) return send(res, 200, { reward: null }); // 이미 수령
    db.tournament.claimedBy[b.playerId] = ch.weekId;
    save();
    return send(res, 200, { reward: { coins: CHAMPION_COINS, title: CHAMPION_TITLE, weekId: ch.weekId } });
  }

  // --- 월간 시즌 ---
  if (url === "/season" && method === "GET") {
    rolloverSeason();
    const { monthId, endsAt } = monthInfo();
    const pid = query.playerId;
    const me = pid ? db.players[pid] : null;
    const myRating = me ? (me.rating || 1000) : 0;
    const myTier = me ? tierOf(myRating).name : "";
    const lr = pid ? db.season.lastResults[pid] : null;
    const claimed = !!(pid && lr && db.season.claimedBy[pid] === lr.monthId);
    return send(res, 200, { monthId, endsAt, myRating, myTier, lastResult: lr || null, claimed });
  }
  if (url === "/season/claim" && method === "POST") {
    rolloverSeason();
    const b = await readBody(req);
    const lr = db.season.lastResults[b.playerId];
    if (!lr || db.season.claimedBy[b.playerId] === lr.monthId) return send(res, 200, { reward: null });
    db.season.claimedBy[b.playerId] = lr.monthId;
    save();
    return send(res, 200, { reward: { coins: lr.coins, title: lr.title, monthId: lr.monthId, tier: lr.tier } });
  }

  // --- 소셜: 도발 메시지 ---
  if (url === "/messages/presets" && method === "GET") {
    return send(res, 200, { taunts: Object.entries(TAUNTS).map(([id, text]) => ({ id, text })) });
  }
  if (url === "/messages" && method === "POST") {
    const b = await readBody(req);
    const from = String(b.from || ""), to = String(b.toPlayerId || "");
    const text = TAUNTS[b.presetId];
    if (!from || !to || !text) return send(res, 400, { error: "BAD_MESSAGE" });
    if (from === to) return send(res, 400, { error: "SELF" });
    if (msgRate[from] && now() - msgRate[from] < 3000) return send(res, 429, { error: "TOO_FAST" });
    msgRate[from] = now();
    const fromName = (db.players[from] && db.players[from].name) || "익명";
    if (!db.messages[to]) db.messages[to] = [];
    db.messages[to].push({ from, fromName, text, at: now() });
    if (db.messages[to].length > 20) db.messages[to] = db.messages[to].slice(-20); // 인박스 상한
    save();
    return send(res, 200, { ok: true });
  }
  if (url === "/messages" && method === "GET") {
    const pid = query.playerId;
    return send(res, 200, { messages: (pid && db.messages[pid]) || [] });
  }
  if (url === "/messages/ack" && method === "POST") {
    const b = await readBody(req);
    if (b.playerId && db.messages[b.playerId]) { db.messages[b.playerId] = []; save(); }
    return send(res, 200, { ok: true });
  }

  // --- 인증 ---
  if (url === "/auth/register" && method === "POST") {
    const b = await readBody(req);
    const username = String(b.username || "").trim();
    const password = String(b.password || "");
    if (!validUsername(username)) return send(res, 400, { error: "BAD_USERNAME" });
    if (password.length < 6) return send(res, 400, { error: "BAD_PASSWORD" });
    const key = username.toLowerCase();
    if (db.accounts[key]) return send(res, 409, { error: "TAKEN" });
    // 익명 playerId 승계(있고 미연결이면), 아니면 새로 발급
    let playerId = (typeof b.playerId === "string" && b.playerId) || uid();
    if (Object.values(db.accounts).some((a) => a.playerId === playerId)) playerId = uid();
    db.accounts[key] = { username, pass: hashPassword(password), playerId, createdAt: now() };
    if (!db.players[playerId]) {
      db.players[playerId] = { playerId, name: username.slice(0, 12), species: "ember", level: 1, atk: 10, def: 10, spd: 10, hp: 50, rating: 1000, dayCount: 1, wins: 0, losses: 0, updatedAt: now() };
    }
    const token = newSession(username, playerId);
    save();
    return send(res, 200, { token, playerId, username });
  }

  if (url === "/auth/login" && method === "POST") {
    const b = await readBody(req);
    const key = String(b.username || "").trim().toLowerCase();
    if (tooManyFails(key)) return send(res, 429, { error: "TOO_MANY" });
    const acc = db.accounts[key];
    if (!acc || !verifyPassword(String(b.password || ""), acc.pass)) {
      noteFail(key);
      return send(res, 401, { error: "BAD_CREDENTIALS" });
    }
    delete loginFails[key];
    const token = newSession(acc.username, acc.playerId);
    save();
    return send(res, 200, { token, playerId: acc.playerId, username: acc.username });
  }

  if (url === "/auth/logout" && method === "POST") {
    const t = bearer(req);
    if (t && db.sessions[t]) { delete db.sessions[t]; save(); }
    return send(res, 200, { ok: true });
  }

  if (url === "/auth/me" && method === "GET") {
    const s = authFrom(req);
    if (!s) return send(res, 401, { error: "UNAUTH" });
    return send(res, 200, { username: s.username, playerId: s.playerId });
  }

  // --- 클라우드 세이브 ---
  if (url === "/save" && method === "GET") {
    const s = authFrom(req);
    if (!s) return send(res, 401, { error: "UNAUTH" });
    return send(res, 200, { state: db.saves[s.playerId] || null });
  }
  if (url === "/save" && method === "PUT") {
    const s = authFrom(req);
    if (!s) return send(res, 401, { error: "UNAUTH" });
    const b = await readBody(req);
    if (b && b.state && typeof b.state === "object") { db.saves[s.playerId] = b.state; save(); }
    return send(res, 200, { ok: true });
  }

  // --- 정적 파일 (그 외 GET) ---
  if (method === "GET") return serveStatic(req, res);
  return send(res, 404, { error: "not found" });
});

load();
seedGhosts();
server.listen(PORT, () => {
  console.log(`몬스터 아레나 서버 실행 중: http://localhost:${PORT}`);
  console.log(`플레이어 ${Object.keys(db.players).length}명 로드됨`);
});
