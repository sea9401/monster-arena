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
  catch { db = { players: {}, matches: {} }; }
  if (!db.players) db.players = {};
  if (!db.matches) db.matches = {};
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
const VALID_SPECIES = ["ember", "aqua", "spark", "lion", "crab", "hare"];

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
  };
}
function pub(p) {
  return { playerId: p.playerId, name: p.name, species: p.species, level: p.level,
    atk: p.atk, def: p.def, spd: p.spd, hp: p.hp, rating: p.rating };
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
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
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
    save();
    return send(res, 200, { ok: true, oldRating, newRating: me.rating, delta: me.rating - oldRating });
  }

  if (url === "/leaderboard" && method === "GET") {
    const limit = Math.min(Number(query.limit) || 50, 100);
    const rows = Object.values(db.players)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, limit)
      .map((p, i) => ({ rank: i + 1, playerId: p.playerId, name: p.name, species: p.species, rating: p.rating, wins: p.wins || 0, losses: p.losses || 0 }));
    return send(res, 200, { rows });
  }

  if ((m = url.match(/^\/players\/([^/]+)$/)) && method === "GET") {
    const p = db.players[m[1]];
    if (!p) return send(res, 404, { error: "not found" });
    return send(res, 200, p);
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
