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
// 배포 식별자 — 클라가 /version 폴링해서 변경 감지 시 자동 리로드.
// git 해시 우선, 실패 시 프로세스 시작 시각(매 배포마다 systemd가 새로 띄우므로 결정적으로 바뀜).
const BUILD_ID = (() => {
  try { return require("child_process").execSync("git rev-parse --short HEAD", { cwd: path.join(__dirname, "..") }).toString().trim(); }
  catch { return String(Date.now()); }
})();

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
  if (!db.shareCodes) db.shareCodes = {};  // code -> playerId (친구 코드 룩업)
  if (!db.gifts) db.gifts = {};            // recipientId -> [{from,fromName,coins,at}]
  if (!db.giftSent) db.giftSent = {};      // senderId -> { recipientId: "YYYY-MM-DD" }
  if (!db.boss) db.boss = { weekId: weekInfo().weekId, boss: bossFor(weekInfo().weekId), contributions: {}, attackLog: {}, lastResults: {}, claimedBy: {} };
  if (!db.boss.attackLog) db.boss.attackLog = {};
  if (!db.boss.lastResults) db.boss.lastResults = {};
  if (!db.boss.claimedBy) db.boss.claimedBy = {};
  if (!db.boss.contributions) db.boss.contributions = {};
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

// ---------- 매칭 풀 시드 (실제 플레이어가 적을 때 NPC 상대 제공) ----------
// 모든 14종 커버 + 브론즈~챔피언 레이팅 분포. 신규 풀 적용 시 SEED_VERSION을 올리면 재시드.
const SEED_VERSION = 2;
const SEED_POOL = [
  // 브론즈 (~1100 미만)
  { name: "도전자 한",     species: "ember",     rating: 920,  level: 3,  bias: "atk" },
  { name: "신참 미아",     species: "aqua",      rating: 980,  level: 4,  bias: "def" },
  { name: "야생의 루",     species: "spark",     rating: 1050, level: 5,  bias: "spd" },
  // 실버 (1100~1300)
  { name: "트레이너 보라", species: "lion",      rating: 1150, level: 7,  bias: "atk" },
  { name: "추적자 진",     species: "wolf",      rating: 1210, level: 8,  bias: "atk" },
  { name: "철벽의 갑돌",   species: "crab",      rating: 1270, level: 9,  bias: "def" },
  // 골드 (1300~1550)
  { name: "라이벌 카이",   species: "hare",      rating: 1350, level: 11, bias: "spd" },
  { name: "그림자 노아",   species: "bat",       rating: 1430, level: 13, bias: "spd" },
  { name: "암반 형제 결",  species: "armadillo", rating: 1510, level: 14, bias: "def" },
  // 플래티넘 (1550~1800)
  { name: "곰주먹 윤",     species: "bear",      rating: 1600, level: 16, bias: "atk" },
  { name: "독무의 시아",   species: "toad",      rating: 1680, level: 18, bias: "def" },
  { name: "독사의 후예",   species: "viper",     rating: 1760, level: 19, bias: "atk" },
  // 챔피언 (1800+)
  { name: "백조 기사",     species: "swan",      rating: 1860, level: 21, bias: "spd" },
  { name: "성광 마법사",   species: "unicorn",   rating: 1960, level: 23, bias: "atk" },
  { name: "챔프 모모",     species: "ember",     rating: 2060, level: 25, bias: "atk" },
];
// 레벨/편향에 따른 시드 스탯 계산 — 실제 플레이어 진행도와 비슷한 곡선.
function seedStats(level, bias) {
  const base = 12 + level * 4;
  const hp = 70 + level * 12;
  const s = { atk: base, def: base, spd: base, hp };
  if (bias === "atk")      { s.atk = Math.round(base * 1.30); s.def = Math.round(base * 0.92); }
  else if (bias === "def") { s.def = Math.round(base * 1.30); s.hp  = Math.round(hp   * 1.15); s.spd = Math.round(base * 0.92); }
  else if (bias === "spd") { s.spd = Math.round(base * 1.30); s.atk = Math.round(base * 0.92); }
  return s;
}
// 주간 레이팅 감쇠 + 시드 NPC 셔플(주말 자정 KST에 자동 트리거).
// - 비활동 플레이어(14일+ PvP 없음): rating -25, 1000 미만 방지
// - 시드 NPC: 풀 기본 레이팅 ±50 무작위 변동 + 전적 재설정 → 매주 매칭 분포 새로움
const INACTIVITY_MS = 14 * 86400000;
const INACTIVITY_DECAY = 25;
function weeklyDecayAndShuffle() {
  const { weekId } = weekInfo();
  if (db.lastDecayWeek === weekId) return;
  const cutoff = now() - INACTIVITY_MS;
  for (const p of Object.values(db.players)) {
    if (p.seeded) continue;
    // 신규 도입 — lastPvpAt 없는 기존 유저는 updatedAt을 첫 기준으로 인정(즉시 감쇠 방지)
    if (!p.lastPvpAt) p.lastPvpAt = p.updatedAt || now();
    if (p.lastPvpAt < cutoff && (p.rating || 1000) > 1000) {
      p.rating = Math.max(1000, (p.rating || 1000) - INACTIVITY_DECAY);
    }
  }
  // 시드 NPC: 풀 기본값 ±50 jitter로 매주 새 분포
  SEED_POOL.forEach((seed, i) => {
    const id = "ghost-" + i;
    const p = db.players[id];
    if (!p) return;
    const jitter = Math.floor(Math.random() * 101) - 50; // -50..+50
    p.rating = Math.max(800, seed.rating + jitter);
    p.wins = Math.max(1, Math.floor(seed.level * 0.6));
    p.losses = Math.max(1, Math.floor(seed.level * 0.3));
    p.updatedAt = now();
  });
  db.lastDecayWeek = weekId;
  save();
}
function seedGhosts() {
  // 풀 버전이 바뀌었으면(또는 첫 실행이면) 기존 시드 캐릭터 제거 후 재시드.
  // 진행 중 Elo 변동은 풀 버전 같은 사이에만 유지된다.
  if (db.seedVersion === SEED_VERSION && Object.values(db.players).some((p) => p.seeded)) return;
  for (const id of Object.keys(db.players)) {
    if (db.players[id].seeded) delete db.players[id];
  }
  SEED_POOL.forEach((seed, i) => {
    const id = "ghost-" + i;
    const st = seedStats(seed.level, seed.bias);
    db.players[id] = {
      playerId: id, name: seed.name, species: seed.species, seeded: true,
      level: seed.level, atk: st.atk, def: st.def, spd: st.spd, hp: st.hp,
      rating: seed.rating, dayCount: seed.level,
      wins: Math.max(1, Math.floor(seed.level * 0.6)),
      losses: Math.max(1, Math.floor(seed.level * 0.3)),
      updatedAt: now(),
    };
  });
  db.seedVersion = SEED_VERSION;
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

// ---------- 친구 시스템 ----------
// 짧은 공유 코드(6자, 혼동되는 0/1/I/O 제외)로 친구 추가. 단방향(내 목록에만 추가).
const SHARE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateShareCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += SHARE_ALPHABET[Math.floor(Math.random() * SHARE_ALPHABET.length)];
  return s;
}
function ensureShareCode(playerId) {
  const p = db.players[playerId];
  if (!p) return null;
  if (p.shareCode && db.shareCodes[p.shareCode] === playerId) return p.shareCode;
  let code, tries = 0;
  do { code = generateShareCode(); tries++; } while (db.shareCodes[code] && tries < 20);
  db.shareCodes[code] = playerId;
  p.shareCode = code;
  save();
  return code;
}

// ---------- 주간 보스 (비동기 협력 PvE) ----------
// 모든 유저가 주간 보스에 누적 데미지. 매주 월요일 KST 자정 리셋 + 직전 결과 정산.
// 멱등 공격(attackId 클라 생성). 데미지는 서버에서 플레이어 스냅샷으로 계산(클라 위조 차단).
const BOSSES = [
  { id: "ironclad",    name: "철갑 골렘",     icon: "🗿", element: "earth", hpMax: 5000 },
  { id: "voidkraken",  name: "심연의 크라켄", icon: "🐙", element: "water", hpMax: 5500 },
  { id: "infernal",    name: "지옥불 와이번", icon: "🐉", element: "fire",  hpMax: 6000 },
  { id: "thunderlord", name: "뇌제 가루다",   icon: "⚡", element: "elec",  hpMax: 5200 },
];
function bossFor(weekId) {
  const idx = djb2(String(weekId)) % BOSSES.length;
  // 보스는 죽지 않으므로 hp 추적 안 함. id/name/icon/element만 의미 있음.
  const { id, name, icon, element } = BOSSES[idx];
  return { id, name, icon, element };
}
const BOSS_ATTACKS_PER_WEEK = 80;
function calcBossDamage(p) {
  const base = (p.atk || 10) + (p.level || 1) * 2;
  const r = 0.85 + Math.random() * 0.30; // 0.85x ~ 1.15x
  return Math.max(10, Math.round(base * r));
}
function bossRewardFor(rank) {
  if (rank === 1)  return { coins: 300, title: "🐲 보스 슬레이어" };
  if (rank <= 3)  return { coins: 150, title: "" };
  if (rank <= 10) return { coins: 80,  title: "" };
  return { coins: 30, title: "" }; // 참가 보상
}
function rolloverBoss() {
  const { weekId } = weekInfo();
  if (db.boss.weekId === weekId) return;
  // 직전 주 결과 스냅샷
  const sorted = Object.values(db.boss.contributions).filter((c) => c.damage > 0).sort((a, b) => b.damage - a.damage);
  sorted.forEach((c, i) => {
    const rank = i + 1;
    const rw = bossRewardFor(rank);
    db.boss.lastResults[c.playerId] = {
      weekId: db.boss.weekId, rank, damage: c.damage,
      coins: rw.coins, title: rw.title,
      bossName: db.boss.boss.name, bossIcon: db.boss.boss.icon,
    };
  });
  // 새 주 진입
  db.boss = {
    weekId,
    boss: bossFor(weekId),
    contributions: {},
    attackLog: {},
    lastResults: db.boss.lastResults,
    claimedBy: db.boss.claimedBy,
  };
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
  const ext = path.extname(filePath);
  // index.html은 텍스트로 읽어 <script>/<link> 태그에 ?v=BUILD_ID를 주입(캐시 버스팅).
  // 모바일 브라우저가 no-cache를 무시하더라도 URL이 바뀌면 강제로 새 파일을 받음.
  if (ext === ".html") {
    fs.readFile(filePath, "utf8", (err, html) => {
      if (err) return send(res, 404, { error: "not found" });
      const v = encodeURIComponent(BUILD_ID);
      const injected = html
        .replace(/(<script\b[^>]*\bsrc=")([^"?]+\.js)(")/g, `$1$2?v=${v}$3`)
        .replace(/(<link\b[^>]*\bhref=")([^"?]+\.css)(")/g, `$1$2?v=${v}$3`);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache, max-age=0, must-revalidate",
      });
      res.end(injected);
    });
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, { error: "not found" });
    // 패치가 즉시 적용되도록 정적 파일은 매 요청 재검증(304 또는 200). ETag/Last-Modified는 노드 기본값에 의존하지 않으므로 no-cache로 단순화.
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
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
  if (url === "/version") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache, max-age=0, must-revalidate",
    });
    return res.end(JSON.stringify({ build: BUILD_ID }));
  }

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
    weeklyDecayAndShuffle();
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
    me.lastPvpAt = now(); // 비활동 감쇠 기준
    // 고스트(상대)도 Elo 대칭 갱신 — 비동기 PvP에서 내 몬스터가 남의 고스트로 방어
    opp.rating = elo(oldOpp, oldRating, !won);
    if (won) opp.losses++; else opp.wins++;
    opp.updatedAt = now();
    if (!opp.seeded) opp.lastPvpAt = now(); // NPC는 자체 셔플로 관리
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
    weeklyDecayAndShuffle();
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
    weeklyDecayAndShuffle();
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

  // --- 친구 시스템 ---
  if (url === "/me/code" && method === "GET") {
    const pid = String(query.playerId || "");
    if (!db.players[pid]) return send(res, 404, { error: "no_player" });
    return send(res, 200, { code: ensureShareCode(pid) });
  }
  if (url === "/friends" && method === "GET") {
    const pid = String(query.playerId || "");
    const me = db.players[pid];
    if (!me) return send(res, 404, { error: "no_player" });
    const ids = Array.isArray(me.friends) ? me.friends : [];
    const rows = ids
      .map((fid) => db.players[fid])
      .filter((p) => p)
      .map((p) => ({ playerId: p.playerId, name: p.name, species: p.species, level: p.level, rating: p.rating, title: p.title || "", seeded: !!p.seeded, updatedAt: p.updatedAt || 0 }));
    return send(res, 200, { friends: rows });
  }
  if (url === "/friends/add" && method === "POST") {
    const b = await readBody(req);
    const pid = String(b.playerId || "");
    const codeRaw = String(b.code || "").toUpperCase().replace(/[^A-Z2-9]/g, "");
    const me = db.players[pid];
    if (!me) return send(res, 404, { error: "no_player" });
    const friendId = db.shareCodes[codeRaw];
    if (!friendId || !db.players[friendId]) return send(res, 404, { error: "no_code" });
    if (friendId === pid) return send(res, 400, { error: "self" });
    if (!Array.isArray(me.friends)) me.friends = [];
    if (me.friends.includes(friendId)) return send(res, 200, { ok: true, already: true });
    me.friends.push(friendId);
    save();
    const f = db.players[friendId];
    return send(res, 200, { ok: true, friend: { playerId: f.playerId, name: f.name, species: f.species, level: f.level, rating: f.rating, title: f.title || "", seeded: !!f.seeded } });
  }
  if (url === "/gifts/send" && method === "POST") {
    const b = await readBody(req);
    const from = String(b.playerId || ""), to = String(b.friendId || "");
    const fromP = db.players[from], toP = db.players[to];
    if (!fromP || !toP) return send(res, 404, { error: "no_player" });
    if (from === to) return send(res, 400, { error: "self" });
    // 친구로 등록된 사이만(스팸 방지)
    if (!Array.isArray(fromP.friends) || !fromP.friends.includes(to)) return send(res, 403, { error: "not_friend" });
    const today = kstDateStr(now());
    if (!db.giftSent[from]) db.giftSent[from] = {};
    if (db.giftSent[from][to] === today) return send(res, 409, { error: "already_sent" });
    db.giftSent[from][to] = today;
    if (!db.gifts[to]) db.gifts[to] = [];
    db.gifts[to].push({ from, fromName: fromP.name, coins: 30, at: now() });
    save();
    return send(res, 200, { ok: true });
  }
  if (url === "/gifts" && method === "GET") {
    const pid = String(query.playerId || "");
    if (!db.players[pid]) return send(res, 404, { error: "no_player" });
    const list = db.gifts[pid] || [];
    db.gifts[pid] = []; // 한 번 가져가면 비움(수령 처리)
    if (list.length) save();
    return send(res, 200, { gifts: list });
  }
  if (url === "/gifts/sent-today" && method === "GET") {
    const pid = String(query.playerId || "");
    if (!db.players[pid]) return send(res, 404, { error: "no_player" });
    const today = kstDateStr(now());
    const sentMap = db.giftSent[pid] || {};
    const sentIds = Object.entries(sentMap).filter(([_, d]) => d === today).map(([id]) => id);
    return send(res, 200, { sent: sentIds });
  }

  if (url === "/friends/remove" && method === "POST") {
    const b = await readBody(req);
    const pid = String(b.playerId || ""), fid = String(b.friendId || "");
    const me = db.players[pid];
    if (!me || !Array.isArray(me.friends)) return send(res, 200, { ok: true });
    me.friends = me.friends.filter((x) => x !== fid);
    save();
    return send(res, 200, { ok: true });
  }

  // --- 주간 보스 ---
  if (url === "/boss/state" && method === "GET") {
    rolloverBoss();
    const { weekId } = weekInfo();
    const { endsAt } = weekInfo();
    const pid = query.playerId || "";
    const myC = pid ? (db.boss.contributions[pid] || { damage: 0, attacks: 0 }) : { damage: 0, attacks: 0 };
    const all = Object.values(db.boss.contributions).filter((c) => c.damage > 0).sort((a, b) => b.damage - a.damage);
    const totalDamage = all.reduce((sum, c) => sum + c.damage, 0);
    const top = all.slice(0, 10).map((c, i) => ({ rank: i + 1, playerId: c.playerId, name: c.name, species: c.species, title: c.title || "", damage: c.damage }));
    const myRank = pid ? (all.findIndex((c) => c.playerId === pid) + 1) : 0;
    const lr = pid ? db.boss.lastResults[pid] : null;
    const claimed = !!(pid && lr && db.boss.claimedBy[pid] === lr.weekId);
    return send(res, 200, {
      weekId, endsAt,
      boss: { id: db.boss.boss.id, name: db.boss.boss.name, icon: db.boss.boss.icon, element: db.boss.boss.element },
      myDamage: myC.damage, myAttacks: myC.attacks,
      myRank, totalDamage, participants: all.length,
      attacksLeft: Math.max(0, BOSS_ATTACKS_PER_WEEK - myC.attacks),
      top,
      lastResult: lr || null,
      claimed,
    });
  }
  if (url === "/boss/attack" && method === "POST") {
    rolloverBoss();
    const b = await readBody(req);
    const pid = String(b.playerId || "");
    const attackId = String(b.attackId || "");
    if (!pid || !attackId) return send(res, 400, { error: "bad_request" });
    const p = db.players[pid];
    if (!p) return send(res, 404, { error: "no_player" });
    // 멱등 — 같은 attackId 재요청은 이전 결과 반환
    const prev = db.boss.attackLog[attackId];
    if (prev) {
      const cur = db.boss.contributions[pid] || { attacks: 0, damage: 0 };
      return send(res, 200, { ok: true, idempotent: true, damage: prev.damage, attacksLeft: Math.max(0, BOSS_ATTACKS_PER_WEEK - cur.attacks), totalDamage: cur.damage });
    }
    const c = db.boss.contributions[pid] || { playerId: pid, name: p.name, species: p.species, title: p.title || "", damage: 0, attacks: 0, lastAttackAt: 0 };
    if (c.attacks >= BOSS_ATTACKS_PER_WEEK) return send(res, 409, { error: "out_of_attacks", attacksLeft: 0 });
    // 보스는 죽지 않음 — 순위는 주간 누적 데미지로만 결정. 늦게 들어와도 끝까지 경쟁 가능.
    const dmg = calcBossDamage(p);
    c.damage += dmg;
    c.attacks += 1;
    c.lastAttackAt = now();
    c.name = p.name; c.species = p.species; c.title = p.title || ""; // 최신 표시명 동기화
    db.boss.contributions[pid] = c;
    db.boss.attackLog[attackId] = { playerId: pid, damage: dmg, at: now() };
    save();
    return send(res, 200, { ok: true, damage: dmg, attacksLeft: Math.max(0, BOSS_ATTACKS_PER_WEEK - c.attacks), totalDamage: c.damage });
  }
  if (url === "/boss/claim" && method === "POST") {
    rolloverBoss();
    const b = await readBody(req);
    const pid = String(b.playerId || "");
    const lr = db.boss.lastResults[pid];
    if (!lr) return send(res, 200, { reward: null });
    if (db.boss.claimedBy[pid] === lr.weekId) return send(res, 200, { reward: null });
    db.boss.claimedBy[pid] = lr.weekId;
    save();
    return send(res, 200, { reward: { coins: lr.coins, title: lr.title, weekId: lr.weekId, rank: lr.rank, damage: lr.damage, bossName: lr.bossName, bossIcon: lr.bossIcon } });
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
