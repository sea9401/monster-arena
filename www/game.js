// 몬스터 아레나 — 다마고치식 육성 + PvP
// 서버 없이 localStorage에 저장. "다음 날로" 버튼으로 날짜 경과를 시뮬레이션해 테스트 가능.

const SAVE_KEY = "monster-arena-save-v1";
const STAMINA_MAX = 10;
const STAMINA_OVERFILL_MAX = 20;
const STAMINA_REGEN_MS = 15 * 60 * 1000;

// 종(種): 단계별 이모지와 스탯 성향
const SPECIES = {
  ember: {
    name: "불꽃 도마뱀", egg: "🥚", stages: ["🦎", "🐊", "🦖"], type: "fire",
    base: { atk: 12, def: 8, spd: 9, hp: 60 }, bias: "공격형",
  },
  aqua: {
    name: "물방울 거북", egg: "🥚", stages: ["🐟", "🐢", "🐋"], type: "water",
    base: { atk: 8, def: 13, spd: 7, hp: 80 }, bias: "방어형",
  },
  spark: {
    name: "번개 다람쥐", egg: "🥚", stages: ["🐤", "🐔", "🦅"], type: "electric",
    base: { atk: 10, def: 7, spd: 14, hp: 55 }, bias: "속도형",
  },
  lion: {
    name: "맹수 사자", egg: "🥚", stages: ["🐱", "🐯", "🦁"], type: "fire",
    base: { atk: 12, def: 9, spd: 8, hp: 62 }, bias: "공격형",
  },
  crab: {
    name: "갑각 게", egg: "🥚", stages: ["🦐", "🦀", "🦞"], type: "water",
    base: { atk: 7, def: 15, spd: 6, hp: 78 }, bias: "방어형",
  },
  hare: {
    name: "질풍 토끼", egg: "🥚", stages: ["🐰", "🐇", "🦘"], type: "electric",
    base: { atk: 9, def: 7, spd: 15, hp: 54 }, bias: "속도형",
  },
};

// 속성 메타 + 상성. 사이클: 물 > 불 > 전기 > 물
const ELEMENTS = {
  fire:     { label: "불",   icon: "🔥" },
  water:    { label: "물",   icon: "💧" },
  electric: { label: "전기", icon: "⚡" },
};
const BEATS = { water: "fire", fire: "electric", electric: "water" }; // key가 value를 이긴다
const TYPE_ADV = 1.12;  // 유리
const TYPE_DIS = 0.90;  // 불리
const DMG_K = 0.6;      // 전역 데미지 계수(전투 길이 조절)

// 종 패시브: 불=주는 피해+8%, 물=받는 피해-8%, 전기=회피+9%
const PASSIVE = {
  fire:     { label: "🔥 맹공 (주는 피해 +6%)",  dmgDealt: 1.06 },
  water:    { label: "💧 견고 (받는 피해 -8%)",  dmgTaken: 0.92 },
  electric: { label: "⚡ 잔상 (회피 +10%)",      evaBonus: 0.10 },
};

// 공격 속성 a가 방어 속성 d를 상대로 갖는 데미지 배율
function typeMult(a, d) {
  if (!a || !d) return 1;
  if (BEATS[a] === d) return TYPE_ADV;
  if (BEATS[d] === a) return TYPE_DIS;
  return 1;
}

// 내 속성(mine) 기준 상대(foe)와의 상성 안내 문구
function matchupHint(mine, foe) {
  const m = typeMult(mine, foe);
  if (m > 1) return "🟢 속성 유리 — 내 공격이 강해진다";
  if (m < 1) return "🔴 속성 불리 — 내 공격이 약해진다";
  return "⚪ 속성 중립";
}

// 종(속성)별 스킬 키트. 각 스킬은 자체 type/power/cd 보유.
// power = 일반 공격 대비 배율(1.0이 기본). cd = 사용 후 쿨다운 턴.
const SKILL_KITS = {
  fire: [ // 공격형: 순수 화력 + 공격 버프
    { id: "f_basic",    name: "기본 공격",  type: "fire",     power: 1.0, cd: 0 },
    { id: "f_strike",   name: "불꽃 강타",  type: "fire",     power: 1.28, cd: 2 },
    { id: "f_overheat", name: "과열",       type: "fire",     power: 1.1, cd: 3, buffAtk: { mult: 1.2, turns: 2 } },
  ],
  water: [ // 방어형: 피해 감소 + 회복으로 장기전
    { id: "w_basic",  name: "기본 공격",   type: "water", power: 1.0,  cd: 0 },
    { id: "w_shield", name: "파도 방패",   type: "water", power: 0.85, cd: 3, shield: { reduce: 0.25, turns: 2 } },
    { id: "w_heal",   name: "회복의 물결", type: "water", power: 0.8,  cd: 4, heal: 0.12 },
  ],
  electric: [ // 속도형: 속도 우위 강타 + 연쇄 추가타
    { id: "e_basic",  name: "기본 공격",   type: "electric", power: 1.0,  cd: 0 },
    { id: "e_thrust", name: "번개 찌르기", type: "electric", power: 1.25, cd: 2, speedScale: 1.28 },
    { id: "e_chain",  name: "연쇄 스파크", type: "electric", power: 1.0,  cd: 3, extraHit: { chance: 0.4, power: 0.55 } },
  ],
};

let lastTypeMult = 1; // 직전 스킬의 상성 배율(로그용)

// 전투용 파이터 객체(스킬 키트 + 쿨다운/버프 + 종 패시브 부착)
function buildFighter(base) {
  const p = PASSIVE[base.type] || {};
  return Object.assign({}, base, {
    kit: SKILL_KITS[base.type],
    cd: {},                              // skillId -> 남은 쿨다운
    atkBuffTurns: 0, atkBuffMult: 1,     // 공격 버프
    shieldTurns: 0, shieldReduce: 0,     // 피해 감소
    pDmgDealt: p.dmgDealt || 1,          // 패시브: 주는 피해 배율
    pDmgTaken: p.dmgTaken || 1,          // 패시브: 받는 피해 배율
    pEva: p.evaBonus || 0,               // 패시브: 회피 가산
  });
}

// 회피 확률: 방어자의 속도 우위 + 전기 패시브, 상한 25%
function evades(atkr, dfdr) {
  const ev = clamp((dfdr.spd - atkr.spd) * 0.0020, -0.08, 0.22) + dfdr.pEva;
  return Math.random() < Math.min(ev, 0.27);
}

// 턴 시작 시 쿨다운/버프 시간 감소
function upkeep(f) {
  for (const k in f.cd) if (f.cd[k] > 0) f.cd[k]--;
  if (f.atkBuffTurns > 0 && --f.atkBuffTurns === 0) f.atkBuffMult = 1;
  if (f.shieldTurns > 0 && --f.shieldTurns === 0) f.shieldReduce = 0;
}

// AI 스킬 선택: 위급하면 회복, 가끔 방어, 그 외엔 최고 화력
function chooseSkill(self) {
  const ready = self.kit.filter((s) => (self.cd[s.id] || 0) === 0);
  const heal = ready.find((s) => s.heal);
  if (heal && self.hp < self.maxHp * 0.4) return heal;
  const shield = ready.find((s) => s.shield);
  if (shield && self.shieldTurns === 0 && Math.random() < 0.5) return shield;
  return ready.reduce((best, s) => (s.power > best.power ? s : best), ready[0]);
}

// 스킬 한 방의 데미지 (비율형 방어 + 상성/패시브/버프/방어태세/속도조건 반영)
function skillDamage(atkr, dfdr, skill) {
  let power = skill.power;
  if (skill.speedScale && atkr.spd > dfdr.spd) power = skill.speedScale;
  const eff = atkr.atk * atkr.atkBuffMult * (rand(85, 115) / 100);
  const mult = typeMult(skill.type, dfdr.type);
  lastTypeMult = mult;
  // 비율형 방어: 저공격력도 약간은 들어가고, 방어가 높을수록 완만히 감소
  let raw = (eff * power * DMG_K * 100) / (100 + dfdr.def * 0.8);
  raw *= mult * atkr.pDmgDealt * dfdr.pDmgTaken;
  if (dfdr.shieldTurns > 0) raw *= 1 - dfdr.shieldReduce;
  return Math.max(1, Math.round(raw));
}

const RANKS = [
  { name: "🥉 브론즈", min: 0 },
  { name: "🥈 실버", min: 1100 },
  { name: "🥇 골드", min: 1300 },
  { name: "💎 플래티넘", min: 1550 },
  { name: "👑 챔피언", min: 1800 },
];

const RIVAL_NAMES = ["붉은이빨", "그림자꼬리", "강철등껍질", "폭풍날개", "독안개", "고대왕"];
const RIVAL_EMOJI = ["👺", "🐍", "🦂", "🦖", "🐗", "👹"];

// 데일리 퀘스트 풀 — 매일 3개가 랜덤 배정된다.
// track: 진행도를 올리는 행동 종류 / reward: {type, amt}
const QUEST_POOL = [
  // 기본 육성
  { id: "train3", label: "훈련 3회 하기",   target: 3, track: "train_any",  reward: { type: "exp",    amt: 35 } },
  { id: "stat2",  label: "스탯 훈련 2회",   target: 2, track: "train_stat", reward: { type: "action", amt: 1 } },
  { id: "feed2",  label: "먹이 2번 주기",   target: 2, track: "feed",       reward: { type: "happy",  amt: 25 } },
  { id: "play1",  label: "놀아주기 1회",    target: 1, track: "play",       reward: { type: "exp",    amt: 18 } },
  // 종류별 스탯 훈련
  { id: "atk3",   label: "근력 훈련 3회",   target: 3, track: "train_atk",  reward: { type: "exp",    amt: 40 } },
  { id: "def3",   label: "방어 훈련 3회",   target: 3, track: "train_def",  reward: { type: "action", amt: 1 } },
  { id: "spd3",   label: "민첩 훈련 3회",   target: 3, track: "train_spd",  reward: { type: "exp",    amt: 40 } },
  // 성장/관리 목표
  { id: "level1", label: "레벨업 1회",      target: 1, track: "levelup",    reward: { type: "action", amt: 1 } },
  { id: "care",   label: "포만·행복 80↑",  target: 1, track: "care_max",   reward: { type: "exp",    amt: 30 } },
  // 아레나
  { id: "pvp1",   label: "아레나 1회 출전", target: 1, track: "pvp_play",   reward: { type: "food",   amt: 25 } },
  { id: "pvp3",   label: "아레나 3회 출전", target: 3, track: "pvp_play",   reward: { type: "exp",    amt: 35 } },
  { id: "pvpwin", label: "아레나에서 1승",  target: 1, track: "pvp_win",    reward: { type: "action", amt: 1 } },
  { id: "win2",   label: "아레나 2승",      target: 2, track: "pvp_win",    reward: { type: "action", amt: 2 } },
  { id: "upset",  label: "더 강한 상대 처치", target: 1, track: "pvp_upset", reward: { type: "exp",   amt: 60 } },
];

// 출석 보상 — streak 기준 7일 주기. 7일차는 영구 스탯 보너스(잭팟).
const ATTENDANCE_REWARDS = [
  { icon: "🍖", short: "포만+20",     reward: { food: 20 } },
  { icon: "⭐", short: "EXP+20",      reward: { exp: 20 } },
  { icon: "💛", short: "행복+20",     reward: { happy: 20 } },
  { icon: "💪", short: "스태미너+1",  reward: { action: 1 } },
  { icon: "⭐", short: "EXP+35",      reward: { exp: 35 } },
  { icon: "🧡", short: "포만·행복+15", reward: { food: 15, happy: 15 } },
  { icon: "🏆", short: "영구스탯↑",   reward: { stat: { atk: 1, def: 1, spd: 1, hp: 4 } } },
];

const REWARD_LABEL = {
  exp: (a) => `EXP +${a}`,
  action: (a) => `스태미너 +${a}`,
  happy: (a) => `행복 +${a}`,
  food: (a) => `포만 +${a}`,
};

// 풀에서 n개를 뽑아 진행 상태가 담긴 퀘스트 객체로 생성
function generateQuests(n = 3) {
  const pool = [...QUEST_POOL];
  const picked = [];
  while (picked.length < n && pool.length) {
    picked.push(pool.splice(rand(0, pool.length - 1), 1)[0]);
  }
  return picked.map((q) => ({ ...q, progress: 0, claimed: false }));
}

let state = null;
let activeHomeTab = "grow";
let leaderboardReturn = "arena";

// ---------- 유틸 ----------
const $ = (id) => document.getElementById(id);
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const SFX = window.SoundFX || {};

const screens = {
  hatch: $("hatch-screen"),
  home: $("home-screen"),
  arena: $("arena-screen"),
  leaderboard: $("leaderboard-screen"),
};
let tooltipEl = null;

function show(name) {
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
  closeTooltip();
}

function tooltipTitle(el) {
  return el.dataset.tipTitle || el.textContent.trim().replace("ⓘ", "").slice(0, 24);
}

function openTooltip(el) {
  closeTooltip();
  tooltipEl = document.createElement("div");
  tooltipEl.className = "tip-sheet";
  tooltipEl.setAttribute("role", "dialog");
  tooltipEl.innerHTML = `
    <button class="tip-close" type="button" aria-label="설명 닫기">×</button>
    <div class="tip-title">${tooltipTitle(el)}</div>
    <div class="tip-body">${el.dataset.tip}</div>
  `;
  document.body.appendChild(tooltipEl);
  requestAnimationFrame(() => tooltipEl.classList.add("open"));
}

function closeTooltip() {
  if (!tooltipEl) return;
  tooltipEl.remove();
  tooltipEl = null;
}

function playFx(name, ...args) {
  if (SFX && typeof SFX[name] === "function") SFX[name](...args);
}

function haptic(pattern) {
  if (SFX && typeof SFX.haptic === "function") SFX.haptic(pattern);
}

function updateMuteButton() {
  const btn = $("mute-btn");
  if (!btn || !SFX.isMuted) return;
  const muted = SFX.isMuted();
  btn.textContent = muted ? "🔇" : "🔊";
  btn.setAttribute("aria-label", muted ? "사운드 켜기" : "음소거");
}

function sparkle(el) {
  if (!el) return;
  el.classList.remove("sparkle-anim"); void el.offsetWidth; el.classList.add("sparkle-anim");
  setTimeout(() => el.classList.remove("sparkle-anim"), 700);
}

function flashArena() {
  const field = document.querySelector(".arena-field");
  if (!field) return;
  field.classList.remove("super-flash"); void field.offsetWidth; field.classList.add("super-flash");
}

function floatBattleText(who, text, cls) {
  const host = $(who === "me" ? "me-sprite" : "foe-sprite");
  const parent = host && host.closest(".fighter");
  if (!parent) return;
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = text;
  parent.appendChild(el);
  setTimeout(() => el.remove(), 850);
}

function resultOverlay(won) {
  const el = document.createElement("div");
  el.className = "result-overlay " + (won ? "win" : "loss");
  el.textContent = won ? "VICTORY" : "DEFEAT";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

function showHomeTab(tab) {
  activeHomeTab = tab;
  document.querySelectorAll(".home-tab-content").forEach((el) => {
    el.classList.toggle("hidden", el.dataset.homeTab !== tab);
    el.classList.toggle("active", el.dataset.homeTab === tab);
  });
  document.querySelectorAll(".home-tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  closeTooltip();
  if (tab === "arena") renderArenaLobby();
}

// "오늘" — 실제 날짜 + 테스트용 오프셋
function todayStr() {
  const offset = state ? state.dayOffset : 0;
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function gameNow() {
  return Date.now() + (state ? state.timeOffset || 0 : 0);
}

// ---------- 저장/로드 ----------
function save() { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); }
function load() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}

function migrateState() {
  if (!state) return;
  if (state.dayOffset === undefined) state.dayOffset = 0;
  if (state.timeOffset === undefined) state.timeOffset = 0;
  if (state.stamina === undefined) {
    const legacyActions = Number.isFinite(state.actionsLeft) ? state.actionsLeft : STAMINA_MAX;
    state.stamina = clamp(Math.round(legacyActions), 0, STAMINA_OVERFILL_MAX);
  }
  if (!Number.isFinite(state.stamina)) state.stamina = STAMINA_MAX;
  if (!Number.isFinite(state.staminaAt)) state.staminaAt = gameNow();
  if (!Array.isArray(state.history)) state.history = [];
  delete state.actionsLeft;
  delete state.form; // 분기 진화 제거 — 구버전 저장 정리
}

function regenStamina() {
  if (!state) return false;
  migrateState();

  const now = gameNow();
  const before = state.stamina;
  const beforeAt = state.staminaAt;

  if (now < state.staminaAt) {
    state.staminaAt = now;
    return state.stamina !== before || state.staminaAt !== beforeAt;
  }

  if (state.stamina >= STAMINA_MAX) {
    state.stamina = clamp(state.stamina, 0, STAMINA_OVERFILL_MAX);
    return state.stamina !== before || state.staminaAt !== beforeAt;
  }

  const gained = Math.floor((now - state.staminaAt) / STAMINA_REGEN_MS);
  if (gained <= 0) return false;

  state.stamina = Math.min(STAMINA_MAX, state.stamina + gained);
  state.staminaAt += gained * STAMINA_REGEN_MS;
  if (state.stamina >= STAMINA_MAX) state.staminaAt = now;
  return state.stamina !== before || state.staminaAt !== beforeAt;
}

function addStamina(amount) {
  regenStamina();
  state.stamina = clamp(state.stamina + amount, 0, STAMINA_OVERFILL_MAX);
  state.staminaAt = gameNow();
}

function staminaTimerText() {
  if (state.stamina >= STAMINA_MAX) return state.stamina > STAMINA_MAX ? "보너스 충전됨" : "충전 완료";
  const remain = Math.max(0, STAMINA_REGEN_MS - (gameNow() - state.staminaAt));
  const totalSec = Math.ceil(remain / 1000);
  const min = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const sec = String(totalSec % 60).padStart(2, "0");
  return `${min}:${sec}`;
}

function renderStamina() {
  const changed = regenStamina();
  $("stamina-left").textContent = state.stamina;
  $("stamina-max").textContent = STAMINA_MAX;
  $("stamina-timer").textContent = staminaTimerText();
  return changed;
}

// ---------- 파생 스탯 ----------
function stageIndex(level) {
  if (level >= 10) return 2;   // 성체
  if (level >= 5) return 1;    // 청소년
  return 0;                    // 아기
}
const STAGE_NAMES = ["아기", "청소년", "성체"];

function expToNext(level) { return 80 + level * 40; }

const PW = { hp: 0.5, atk: 1.75, def: 1.70, spd: 1.75 };
function power(p) {
  return Math.round(p.hp * PW.hp + p.atk * PW.atk + p.def * PW.def + p.spd * PW.spd);
}

function rankOf(rating) {
  let r = RANKS[0];
  for (const t of RANKS) if (rating >= t.min) r = t;
  return r.name;
}

// ---------- 부화 화면 ----------
function renderEggs() {
  const roster = $("egg-roster");
  roster.innerHTML = "";
  Object.entries(SPECIES).forEach(([key, sp]) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="emoji">${sp.egg}</div>
      <h3>${sp.name}</h3>
      <div class="stats">${sp.bias}<br>🗡️${sp.base.atk} 🛡️${sp.base.def} 💨${sp.base.spd} ❤️${sp.base.hp}</div>
    `;
    card.addEventListener("click", () => hatch(key));
    roster.appendChild(card);
  });
}

function hatch(speciesKey) {
  const sp = SPECIES[speciesKey];
  const name = prompt(`${sp.name}이(가) 부화했어요!\n이름을 지어주세요:`, sp.name) || sp.name;
  state = {
    species: speciesKey,
    name: name.slice(0, 12),
    level: 1, exp: 0,
    atk: sp.base.atk, def: sp.base.def, spd: sp.base.spd, hp: sp.base.hp,
    food: 70, happy: 70,
    streak: 1,
    dayCount: 1,
    lastDate: todayStr(),
    stamina: STAMINA_MAX,
    staminaAt: Date.now(),
    rating: 1000, wins: 0, losses: 0,
    dayOffset: 0,
    timeOffset: 0,
    history: [],
    quests: generateQuests(),
    attendanceClaimedDate: null, // 오늘 출석 보상 수령 여부(=todayStr이면 수령함)
  };
  save();
  renderHome();
  showHomeTab("grow");
  show("home");
}

// ---------- 날짜 경과 처리 ----------
function checkRollover() {
  regenStamina();
  const today = todayStr();
  if (state.lastDate === today) return;

  // 마지막 접속일과의 차이(일)
  const diff = dateDiff(state.lastDate, today);
  if (diff <= 0) return;

  if (diff === 1) {
    state.streak += 1; // 연속 출석!
  } else {
    // 며칠 빼먹음 — 스트릭 리셋 + 방치 페널티
    state.streak = 1;
    state.happy = clamp(state.happy - diff * 8, 0, 100);
  }
  // 매일 포만감/행복도 자연 감소
  state.food = clamp(state.food - diff * 18, 0, 100);
  state.happy = clamp(state.happy - diff * 6, 0, 100);

  state.dayCount += diff;
  state.quests = generateQuests(); // 새 날, 새 퀘스트
  state.lastDate = today;
  save();
}

function dateDiff(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

// ---------- 훈련 ----------
function train(kind) {
  regenStamina();
  if (state.stamina <= 0) {
    msg("스태미너가 부족해요. 충전 후 다시 시도하세요!", false);
    return;
  }
  playFx("playTick");
  haptic(12);
  // 성장 배율: 행복도/포만감/스트릭이 높을수록 잘 큰다
  const condition = (state.food / 100) * 0.5 + (state.happy / 100) * 0.5; // 0~1
  const streakBonus = 1 + Math.min(state.streak - 1, 14) * 0.03;          // 최대 +42%
  const mult = (0.6 + condition * 0.8) * streakBonus;

  let text = "";
  if (kind === "feed") {
    state.food = clamp(state.food + rand(22, 32), 0, 100);
    state.hp += Math.round(rand(2, 4));
    gainExp(6);
    text = "냠냠! 포만감이 올랐어요.";
  } else if (kind === "play") {
    state.happy = clamp(state.happy + rand(18, 28), 0, 100);
    state.spd += Math.round(rand(0, 1) * mult);
    gainExp(8);
    text = "신난다! 행복도가 올랐어요.";
  } else {
    // 스탯 훈련 (배고프거나 우울하면 효율↓, 약간의 포만감/행복 소모)
    const gain = Math.max(1, Math.round(rand(2, 4) * mult));
    if (kind === "atk") { state.atk += gain; text = `근력 훈련! 공격 +${gain}`; }
    if (kind === "def") { state.def += gain; text = `방어 훈련! 방어 +${gain}`; }
    if (kind === "spd") { state.spd += gain; text = `민첩 훈련! 속도 +${gain}`; }
    state.food = clamp(state.food - 8, 0, 100);
    state.happy = clamp(state.happy - 5, 0, 100);
    gainExp(14);
  }

  // 퀘스트 진행도 반영
  questProgress("train_any");
  if (kind === "feed") questProgress("feed");
  else if (kind === "play") questProgress("play");
  else { questProgress("train_stat"); questProgress("train_" + kind); }
  if (state.food >= 80 && state.happy >= 80) questProgress("care_max");

  // 가득 찬 상태에서 처음 소모할 때만 충전 타이머 시작 (충전 중이면 진행도 유지)
  const wasFull = state.stamina >= STAMINA_MAX;
  state.stamina -= 1;
  if (wasFull) state.staminaAt = gameNow();
  bounce();
  save();
  renderHome();
  msg(text, true);
}

function gainExp(amount) {
  state.exp += amount;
  while (state.exp >= expToNext(state.level)) {
    const prevStage = stageIndex(state.level);
    state.exp -= expToNext(state.level);
    state.level += 1;
    // 레벨업 보너스 스탯
    state.atk += 2; state.def += 2; state.spd += 1; state.hp += 8;
    const evolved = stageIndex(state.level) !== prevStage;
    playFx("playLevelUp");
    sparkle($("pet-sprite"));
    if (evolved) {
      playFx("playEvolve");
      haptic([35, 35, 60]);
      sparkle($("pet-sprite"));
    }
    questProgress("levelup");
  }
}

function msg(text, good) {
  const el = $("train-msg");
  el.textContent = text;
  el.style.color = good ? "var(--good)" : "var(--accent)";
}

function bounce() {
  const s = $("pet-sprite");
  s.classList.remove("happy"); void s.offsetWidth; s.classList.add("happy");
}

// ---------- 출석 보상 ----------
// streak 7일 주기. streak=0(손상된 세이브) 가드를 위해 Math.max(1, ...).
function attendanceCycleDay() {
  return ((Math.max(1, state.streak) - 1) % 7) + 1;
}
function attendanceClaimable() {
  return state.attendanceClaimedDate !== todayStr();
}

function applyAttendanceReward(r) {
  const parts = [];
  if (r.exp)    { gainExp(r.exp);                                  parts.push(`EXP +${r.exp}`); }
  if (r.action) { addStamina(r.action);                            parts.push(`스태미너 +${r.action}`); }
  if (r.food)   { state.food = clamp(state.food + r.food, 0, 100); parts.push(`포만 +${r.food}`); }
  if (r.happy)  { state.happy = clamp(state.happy + r.happy, 0, 100); parts.push(`행복 +${r.happy}`); }
  if (r.stat)   {
    state.atk += r.stat.atk || 0; state.def += r.stat.def || 0;
    state.spd += r.stat.spd || 0; state.hp += r.stat.hp || 0;
    parts.push("영구 스탯 상승!");
  }
  return parts.join(", ");
}

function claimAttendance() {
  if (!attendanceClaimable()) return; // 같은 날 중복 수령 방지
  const day = attendanceCycleDay();
  const label = applyAttendanceReward(ATTENDANCE_REWARDS[day - 1].reward);
  state.attendanceClaimedDate = todayStr();
  playFx("playReward");
  haptic(18);
  bounce();
  save();
  renderHome();
  msg(`📅 ${day}일차 출석 보상! ${label}`, true);
}

function renderAttendance() {
  const day = attendanceCycleDay();
  const claimable = attendanceClaimable();
  $("att-streak").textContent = state.streak;

  const cal = $("att-calendar");
  cal.innerHTML = "";
  // 이번 주기에서 이미 받은 칸: 오늘분을 아직 안 받았으면 day-1까지, 받았으면 day까지 체크
  const claimedThrough = claimable ? day - 1 : day;
  ATTENDANCE_REWARDS.forEach((r, i) => {
    const n = i + 1;
    const cell = document.createElement("div");
    cell.className = "att-cell";
    if (n === 7) cell.classList.add("jackpot");
    if (n === day) cell.classList.add("today");
    if (n <= claimedThrough) cell.classList.add("done");
    cell.innerHTML = `
      <div class="att-day">${n}일</div>
      <div class="att-icon">${r.icon}</div>
      <div class="att-amt">${r.short}</div>
    `;
    cal.appendChild(cell);
  });

  const btn = $("att-claim");
  btn.disabled = !claimable;
  btn.textContent = claimable ? `오늘의 출석 보상 받기 (${day}일차)` : "오늘 출석 완료 ✓";
}

// ---------- 데일리 퀘스트 ----------
// 행동이 일어날 때마다 호출 — 해당 track의 미완료 퀘스트 진행도를 올린다.
function questProgress(track, amount = 1) {
  if (!state.quests) return;
  let advanced = false;
  state.quests.forEach((q) => {
    if (q.track === track && q.progress < q.target) {
      q.progress = Math.min(q.target, q.progress + amount);
      advanced = true;
    }
  });
  if (advanced) save();
}

function claimQuest(idx) {
  const q = state.quests[idx];
  if (!q || q.claimed || q.progress < q.target) return;
  const { type, amt } = q.reward;
  if (type === "exp") gainExp(amt);
  else if (type === "action") addStamina(amt);
  else if (type === "happy") state.happy = clamp(state.happy + amt, 0, 100);
  else if (type === "food") state.food = clamp(state.food + amt, 0, 100);
  q.claimed = true;
  playFx("playReward");
  haptic(18);
  bounce();
  save();
  renderHome();
  msg(`퀘스트 완료! 보상: ${REWARD_LABEL[type](amt)}`, true);
}

function renderQuests() {
  const list = $("quest-list");
  list.innerHTML = "";
  state.quests.forEach((q, idx) => {
    const done = q.progress >= q.target;
    const li = document.createElement("li");
    li.className = "quest-item";
    li.innerHTML = `
      <div class="quest-body">
        <div class="quest-label ${q.claimed ? "cleared" : ""}">${q.label}</div>
        <div class="quest-meta">
          <span>${Math.min(q.progress, q.target)}/${q.target}</span>
          <span class="quest-bar"><div style="width:${q.progress / q.target * 100}%"></div></span>
          <span class="quest-reward">🎁 ${REWARD_LABEL[q.reward.type](q.reward.amt)}</span>
        </div>
      </div>
      <button class="quest-claim" data-quest="${idx}" ${(!done || q.claimed) ? "disabled" : ""}>
        ${q.claimed ? "완료" : done ? "받기" : "진행중"}
      </button>
    `;
    list.appendChild(li);
  });
}

// ---------- 홈 렌더 ----------
function renderHome() {
  const staminaChanged = renderStamina();
  const sp = SPECIES[state.species];
  const stage = stageIndex(state.level);
  $("pet-sprite").textContent = sp.stages[stage];
  $("pet-name").textContent = state.name;
  $("pet-stage").textContent = STAGE_NAMES[stage];
  const petEl = ELEMENTS[sp.type];
  const elBadge = $("pet-element");
  elBadge.textContent = `${petEl.icon} ${petEl.label}`;
  elBadge.className = "elem-badge " + sp.type;

  $("pet-level").textContent = state.level;
  $("exp-fill").style.width = (state.exp / expToNext(state.level) * 100) + "%";
  $("exp-text").textContent = `${state.exp}/${expToNext(state.level)}`;
  $("food-fill").style.width = state.food + "%";
  $("happy-fill").style.width = state.happy + "%";

  $("stat-atk").textContent = state.atk;
  $("stat-def").textContent = state.def;
  $("stat-spd").textContent = state.spd;
  $("stat-hp").textContent = state.hp;

  $("streak").textContent = state.streak;
  $("power").textContent = power(state);

  $("pet-skills").innerHTML =
    `<div class="passive-line">${PASSIVE[sp.type].label}</div>` +
    "보유 스킬 " + SKILL_KITS[sp.type]
      .map((s) => `<span class="skill-chip">${ELEMENTS[s.type].icon} ${s.name}</span>`).join(" ");

  const noActions = state.stamina <= 0;
  $("train-grid").querySelectorAll("button").forEach((b) => {
    b.disabled = false;
    b.classList.toggle("no-stamina", noActions);
    b.setAttribute("aria-disabled", String(noActions));
  });

  renderAttendance();
  renderQuests();
  if (activeHomeTab === "arena") renderArenaLobby();
  if (staminaChanged) save();
}

function renderArenaLobby() {
  if (!state) return;
  $("lobby-rank").textContent = rankOf(state.rating);
  $("lobby-rating").textContent = state.rating;
  $("lobby-record").textContent = `${state.wins}승 ${state.losses}패`;

  const onlineText = Online.status.reachable ? "🟢 온라인" : "⚪ 오프라인(AI)";
  const onlineClass = "online-status " + (Online.status.reachable ? "on" : "off");
  const lobbyOnline = $("lobby-online-status");
  if (lobbyOnline) {
    lobbyOnline.textContent = onlineText;
    lobbyOnline.className = onlineClass;
  }

  const list = $("history-list");
  if (!list) return;
  const rows = (state.history || []).slice(0, 15);
  if (!rows.length) {
    list.innerHTML = `<li class="history-empty">전투 기록이 없습니다</li>`;
    return;
  }
  list.innerHTML = rows.map((h) => {
    const el = ELEMENTS[h.opponentElement] || { icon: "⚪", label: "?" };
    const delta = h.ratingDelta > 0 ? `+${h.ratingDelta}` : `${h.ratingDelta}`;
    const date = new Date(h.timestamp).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
    return `<li class="history-row ${h.result}">
      <span class="history-result">${h.result === "win" ? "승" : "패"}</span>
      <span class="history-main">${el.icon} ${h.opponentName}</span>
      <span class="history-delta">${delta}</span>
      <span class="history-rating">${h.resultRating}</span>
      <span class="history-date">${date}</span>
    </li>`;
  }).join("");
}

function addBattleHistory(won, delta, newRating) {
  if (!state.history) state.history = [];
  const foe = currentOpponent || {};
  state.history.unshift({
    opponentName: foe.name || "상대",
    opponentElement: foe.type || "fire",
    result: won ? "win" : "loss",
    ratingDelta: delta,
    resultRating: newRating,
    timestamp: gameNow(),
  });
  state.history = state.history.slice(0, 15);
}

// ---------- PvP ----------
let currentOpponent = null;
let currentMatchId = null;      // 온라인 매치면 서버 matchId, AI면 null
let lastFoeUnfavorable = false; // 불리 매칭 2연속 방지용 (저장 안 함)

// 내 현재 상태를 서버 스냅샷 형태로
function mySnapshot() {
  return { name: state.name, species: state.species, level: state.level,
    atk: state.atk, def: state.def, spd: state.spd, hp: state.hp + state.level * 6,
    dayCount: state.dayCount, rating: state.rating };
}

// 내 속성 대비 상대 속성을 가중 랜덤으로 선택.
// 유리(내가 이김) 40% / 중립(동속성) 35% / 불리(상대가 이김) 25%.
// 단 불리 2연속 방지 + 강적일 땐 불리 매칭 회피.
function pickFoeType(myType, strong) {
  const iBeat = BEATS[myType];                                  // 내가 이기는 속성 → 유리
  const beatsMe = Object.keys(BEATS).find((k) => BEATS[k] === myType); // 나를 이기는 속성 → 불리
  const mirror = myType;                                        // 동속성 → 중립

  const roll = Math.random();
  let type = roll < 0.40 ? iBeat : roll < 0.75 ? mirror : beatsMe;

  if (type === beatsMe && (lastFoeUnfavorable || strong)) {
    type = Math.random() < 0.5 ? iBeat : mirror; // 좌절 방지: 유리/중립으로 교체
  }
  lastFoeUnfavorable = type === beatsMe;
  return type;
}

function makeOpponent() {
  const myPower = power(state);
  // 레이팅 기반으로 ±변동, 가끔 강적
  const factor = rand(80, 108) / 100;
  const tp = Math.max(40, Math.round(myPower * factor));
  const idx = clamp(Math.floor(state.dayCount / 2 + rand(0, 1)), 0, RIVAL_NAMES.length - 1);

  // 파워 배분 비율을 합=1로 정규화 → 실제 전투력이 tp에 맞도록 (HP 과배분 방지)
  const sh = { hp: rand(23, 31), atk: rand(26, 35), def: rand(19, 27), spd: rand(15, 22) };
  const sum = sh.hp + sh.atk + sh.def + sh.spd;
  const stat = (k) => Math.round(((sh[k] / sum) * tp) / PW[k]);

  const type = pickFoeType(SPECIES[state.species].type, factor >= 1.05);

  return {
    name: RIVAL_NAMES[idx], emoji: RIVAL_EMOJI[idx], type,
    hp: Math.max(40, stat("hp")), atk: Math.max(6, stat("atk")),
    def: Math.max(4, stat("def")), spd: Math.max(4, stat("spd")),
  };
}

function enterArena() {
  $("rating").textContent = state.rating;
  $("rank-tier").textContent = rankOf(state.rating);
  $("record").textContent = `${state.wins}승 ${state.losses}패`;
  Online.uploadSnapshot(mySnapshot()); // 내 고스트를 최신으로
  findMatch();
  show("arena");
}

function updateOnlineStatus() {
  const el = $("online-status");
  const text = Online.status.reachable ? "🟢 온라인" : "⚪ 오프라인(AI)";
  const cls = "online-status " + (Online.status.reachable ? "on" : "off");
  if (el) {
    el.textContent = text;
    el.className = cls;
  }
  const lobby = $("lobby-online-status");
  if (lobby) {
    lobby.textContent = text;
    lobby.className = cls;
  }
}

// 서버 스냅샷 → 전투용 상대 객체
function opponentFromSnapshot(o) {
  const sp = SPECIES[o.species] || SPECIES.ember;
  return {
    name: o.name, type: sp.type, emoji: sp.stages[stageIndex(o.level)],
    atk: o.atk, def: o.def, spd: o.spd, hp: o.hp, ghost: true,
  };
}

async function findMatch() {
  $("opponent-card").innerHTML = `<p class="muted">상대를 찾는 중...</p>`;
  $("match-find").classList.remove("hidden");
  $("match-battle").classList.add("hidden");
  $("match-result").classList.add("hidden");

  // 온라인 고스트 시도 → 실패 시 AI 폴백
  const m = await Online.findMatch(state.rating);
  if (m && m.opponent) {
    currentOpponent = opponentFromSnapshot(m.opponent);
    currentMatchId = m.matchId;
  } else {
    currentOpponent = makeOpponent();
    currentMatchId = null;
  }
  updateOnlineStatus();

  const o = currentOpponent;
  const el = ELEMENTS[o.type];
  const tag = o.ghost ? `<span class="ghost-tag">👤 실제 플레이어</span>` : `<span class="ghost-tag ai">🤖 AI</span>`;
  $("opponent-card").innerHTML = `
    <div class="emoji">${o.emoji}</div>
    <h3>${o.name} <span class="elem-badge ${o.type}">${el.icon} ${el.label}</span></h3>
    ${tag}
    <div class="stats">🗡️${o.atk} 🛡️${o.def} 💨${o.spd} ❤️${o.hp}<br>전투력 약 ${power(o)}</div>
    <div class="matchup">${matchupHint(SPECIES[state.species].type, o.type)}</div>
    <div class="skills-line"><span class="passive-line">${PASSIVE[o.type].label}</span><br>스킬: ${SKILL_KITS[o.type].map((s) => s.name).join(" · ")}</div>
  `;
}

function startBattle() {
  questProgress("pvp_play");
  $("match-find").classList.add("hidden");
  $("match-battle").classList.remove("hidden");

  const sp = SPECIES[state.species];
  const me = buildFighter({ name: state.name, emoji: sp.stages[stageIndex(state.level)], type: sp.type,
               hp: state.hp + state.level * 6, maxHp: state.hp + state.level * 6,
               atk: state.atk, def: state.def, spd: state.spd });
  const foe = buildFighter({ ...currentOpponent, maxHp: currentOpponent.hp });

  $("me-sprite").textContent = me.emoji;
  $("me-name").textContent = `${ELEMENTS[me.type].icon} ${me.name}`;
  $("foe-sprite").textContent = foe.emoji;
  $("foe-name").textContent = `${ELEMENTS[foe.type].icon} ${foe.name}`;
  $("battle-log").innerHTML = "";
  updateHp(me, foe);

  // 속도 빠른 쪽 선공, 동률은 랜덤 (자동 전투)
  const first = me.spd > foe.spd ? "me" : foe.spd > me.spd ? "foe" : (Math.random() < 0.5 ? "me" : "foe");
  runBattle(me, foe, first);
}

function runBattle(me, foe, turn) {
  let round = 0;
  const tick = () => {
    round++;
    if (round > 80) { resolve(me.hp >= foe.hp); return; } // 안전장치

    const atkr = turn === "me" ? me : foe;
    const dfdr = turn === "me" ? foe : me;
    upkeep(atkr);

    const skill = chooseSkill(atkr);
    atkr.cd[skill.id] = skill.cd;

    if (evades(atkr, dfdr)) {
      playFx("playDodge");
      haptic(8);
      floatBattleText(turn === "me" ? "foe" : "me", "회피", "dodge-float");
      blog(`${atkr.name}의 ${skill.name}! 하지만 ${dfdr.name}이(가) 회피했다!`, turn);
    } else {
      const dmg = skillDamage(atkr, dfdr, skill);
      const mult = lastTypeMult;
      dfdr.hp -= dmg;
      hitAnim(turn === "me" ? "foe" : "me");
      floatBattleText(turn === "me" ? "foe" : "me", `-${dmg}`, "dmg-float");
      blog(`${atkr.name}의 ${skill.name}! ${dfdr.name}에게 ${dmg} 피해.`, turn);
      if (mult > 1) {
        playFx("playSuperHit");
        haptic([18, 20, 18]);
        flashArena();
        blog("효과가 굉장했다!", "system");
      } else {
        playFx("playHit");
        haptic(10);
        if (mult < 1) blog("효과가 별로인 듯하다...", "system");
      }

      // 연쇄 추가타
      if (skill.extraHit && dfdr.hp > 0 && Math.random() < skill.extraHit.chance && !evades(atkr, dfdr)) {
        const extra = skillDamage(atkr, dfdr, { type: skill.type, power: skill.extraHit.power });
        dfdr.hp -= extra;
        playFx("playHit");
        floatBattleText(turn === "me" ? "foe" : "me", `-${extra}`, "dmg-float");
        blog(`연쇄 공격! 추가 ${extra} 피해.`, turn);
      }
    }
    // 부가 효과
    if (skill.buffAtk) {
      atkr.atkBuffTurns = skill.buffAtk.turns; atkr.atkBuffMult = skill.buffAtk.mult;
      blog(`${atkr.name}의 공격력이 끓어오른다!`, "system");
    }
    if (skill.shield) {
      atkr.shieldTurns = skill.shield.turns; atkr.shieldReduce = skill.shield.reduce;
      blog(`${atkr.name}이(가) 방어 태세를 갖췄다!`, "system");
    }
    if (skill.heal) {
      const h = Math.round(atkr.maxHp * skill.heal);
      atkr.hp = Math.min(atkr.maxHp, atkr.hp + h);
      blog(`${atkr.name}이(가) ${h} 회복했다!`, "system");
    }

    updateHp(me, foe);
    if (dfdr.hp <= 0) { setTimeout(() => resolve(turn === "me"), 800); return; }
    turn = turn === "me" ? "foe" : "me";
    setTimeout(tick, 800);
  };
  setTimeout(tick, 500);
}

function updateHp(me, foe) {
  $("me-hp").style.width = clamp(me.hp / me.maxHp * 100, 0, 100) + "%";
  $("foe-hp").style.width = clamp(foe.hp / foe.maxHp * 100, 0, 100) + "%";
}

function hitAnim(who) {
  const s = $(who === "me" ? "me-sprite" : "foe-sprite");
  s.classList.add("hit");
  setTimeout(() => s.classList.remove("hit"), 300);
}

function blog(text, type) {
  const el = document.createElement("p");
  el.className = "entry " + (type === "me" ? "me" : type === "foe" ? "foe" : "system");
  el.textContent = text;
  const box = $("battle-log");
  box.appendChild(el); box.scrollTop = box.scrollHeight;
}

async function resolve(won) {
  if (won) {
    state.wins++;
    questProgress("pvp_win");
    if (currentOpponent && power(currentOpponent) > power(state)) questProgress("pvp_upset");
  } else state.losses++;
  playFx(won ? "playWin" : "playLose");
  haptic(won ? [45, 35, 80] : 55);
  resultOverlay(won);

  $("match-battle").classList.add("hidden");
  $("match-result").classList.remove("hidden");
  $("result-title").textContent = won ? "🏆 승리!" : "💀 패배";
  $("result-detail").textContent = "레이팅 반영 중...";

  // 온라인 매치면 서버가 Elo 계산 → 서버 레이팅 신뢰. 아니면 로컬 계산.
  let delta = null, newRating = null;
  if (currentMatchId) {
    const r = await Online.submitResult(currentMatchId, won, 0);
    if (r) { newRating = r.newRating; delta = r.delta; }
  }
  currentMatchId = null;
  if (newRating == null) {
    delta = won ? rand(18, 28) : -rand(14, 24);
    newRating = Math.max(0, state.rating + delta);
  }
  state.rating = newRating;
  addBattleHistory(won, delta, newRating);
  save();
  Online.uploadSnapshot(mySnapshot()); // 갱신된 레이팅으로 내 고스트 업데이트

  const sign = delta > 0 ? "+" : "";
  $("result-detail").textContent = `${sign}${delta} 레이팅 (현재 ${state.rating}, ${rankOf(state.rating)})`;
  $("rating").textContent = state.rating;
  $("rank-tier").textContent = rankOf(state.rating);
  $("record").textContent = `${state.wins}승 ${state.losses}패`;
  renderHome();
  showHomeTab("arena");
  show("home");
}

// ---------- 이벤트 바인딩 ----------
$("train-grid").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b && !b.disabled) train(b.dataset.train);
});

document.addEventListener("click", (e) => {
  const close = e.target.closest(".tip-close");
  if (close) {
    closeTooltip();
    return;
  }

  const tip = e.target.closest("[data-tip]");
  if (tip) {
    e.preventDefault();
    e.stopPropagation();
    openTooltip(tip);
    return;
  }

  if (tooltipEl && !e.target.closest(".tip-sheet")) closeTooltip();
}, true);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeTooltip();
});

document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  if (b.matches("[data-train], .quest-claim, #att-claim, #mute-btn")) return;
  playFx("playTick");
  haptic(8);
});

$("quest-list").addEventListener("click", (e) => {
  const b = e.target.closest(".quest-claim");
  if (b && !b.disabled) claimQuest(Number(b.dataset.quest));
});

$("att-claim").addEventListener("click", claimAttendance);

$("home-screen").addEventListener("click", (e) => {
  const btn = e.target.closest(".home-tab-btn");
  if (btn) showHomeTab(btn.dataset.tab);
});

$("go-pvp").addEventListener("click", enterArena);
$("back-home").addEventListener("click", () => { renderHome(); showHomeTab("arena"); show("home"); });
$("result-home").addEventListener("click", () => { renderHome(); showHomeTab("arena"); show("home"); });
$("fight-btn").addEventListener("click", startBattle);
$("again-btn").addEventListener("click", findMatch);
$("rematch-btn").addEventListener("click", findMatch);
$("leaderboard-btn").addEventListener("click", () => { leaderboardReturn = "arena"; openLeaderboard(); });
$("home-leaderboard-btn").addEventListener("click", () => { leaderboardReturn = "home-arena"; openLeaderboard(); });
$("lb-back").addEventListener("click", () => {
  if (leaderboardReturn === "home-arena") {
    renderHome();
    showHomeTab("arena");
    show("home");
  } else {
    show("arena");
  }
});

$("mute-btn").addEventListener("click", () => {
  if (SFX.toggleMute) SFX.toggleMute();
  updateMuteButton();
  playFx("playTick");
});

// ---------- 리더보드 ----------
async function openLeaderboard() {
  show("leaderboard");
  const list = $("leaderboard-list");
  list.innerHTML = `<li class="muted">불러오는 중...</li>`;
  const rows = await Online.leaderboard(20);
  if (!rows) {
    list.innerHTML = `<li class="muted">서버에 연결할 수 없어요. (오프라인)</li>`;
    return;
  }
  const myId = Online.status.playerId;
  list.innerHTML = rows.map((r) => {
    const sp = SPECIES[r.species] || SPECIES.ember;
    const me = r.playerId === myId ? " me" : "";
    return `<li class="lb-row${me}">
      <span class="lb-rank">${r.rank}</span>
      <span class="lb-emoji">${ELEMENTS[sp.type].icon}</span>
      <span class="lb-name">${r.name}</span>
      <span class="lb-rating">${r.rating} · ${r.wins}승 ${r.losses}패</span>
    </li>`;
  }).join("");
}

// ---------- 시작 ----------
async function init() {
  state = load();
  if (state) {
    migrateState();
    if (!state.quests) state.quests = generateQuests(); // 구버전 저장 호환
    if (state.attendanceClaimedDate === undefined) state.attendanceClaimedDate = null;
    save();
    checkRollover();
    renderHome();
    showHomeTab(activeHomeTab);
    show("home");
  } else {
    renderEggs();
    show("hatch");
  }
  // 온라인 레이어 (실패해도 게임은 정상 동작)
  await Online.init();
  updateOnlineStatus();
  updateMuteButton();
  if (state) Online.uploadSnapshot(mySnapshot());
}
init();

setInterval(() => {
  if (!state || screens.home.classList.contains("hidden")) return;
  const changed = renderStamina();
  if (changed) {
    save();
    $("train-grid").querySelectorAll("button").forEach((b) => {
      b.classList.toggle("no-stamina", state.stamina <= 0);
      b.setAttribute("aria-disabled", String(state.stamina <= 0));
    });
  }
}, 1000);
