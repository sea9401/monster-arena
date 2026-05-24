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
    name: "맹수 사자", egg: "🥚", stages: ["🐈", "🦁", "🐅"], type: "fire",
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
  wolf: {
    name: "그림자 늑대", egg: "🥚", stages: ["🐕", "🦊", "🐺"], type: "dark",
    base: { atk: 13, def: 8, spd: 9, hp: 58 }, bias: "공격형",
  },
  bat: {
    name: "심연 박쥐", egg: "🥚", stages: ["🐀", "🦇", "🐉"], type: "dark",
    base: { atk: 12, def: 7, spd: 12, hp: 55 }, bias: "공격형",
  },
  armadillo: {
    name: "바위 아르마딜로", egg: "🥚", stages: ["🐹", "🦔", "🦏"], type: "earth",
    base: { atk: 8, def: 15, spd: 6, hp: 78 }, bias: "방어형",
  },
  bear: {
    name: "대지 곰", egg: "🥚", stages: ["🐨", "🐻", "🦬"], type: "earth",
    base: { atk: 10, def: 13, spd: 6, hp: 82 }, bias: "방어형",
  },
  unicorn: {
    name: "광휘 유니콘", egg: "🥚", stages: ["🐎", "🦌", "🦄"], type: "light",
    base: { atk: 12, def: 8, spd: 11, hp: 56 }, bias: "공격형",
  },
  swan: {
    name: "성광 백조", egg: "🥚", stages: ["🐥", "🦩", "🦢"], type: "light",
    base: { atk: 11, def: 8, spd: 13, hp: 54 }, bias: "속도형",
  },
  toad: {
    name: "맹독 두꺼비", egg: "🥚", stages: ["🐛", "🦂", "🐸"], type: "poison",
    base: { atk: 9, def: 13, spd: 7, hp: 76 }, bias: "방어형",
  },
  viper: {
    name: "맹독 살무사", egg: "🥚", stages: ["🐛", "🐍", "🐉"], type: "poison",
    base: { atk: 13, def: 8, spd: 11, hp: 58 }, bias: "공격형",
  },
};

// 속성 메타 + 상성. 7각형 사이클: 물 > 불 > 전기 > 빛 > 어둠 > 땅 > 독 > 물
const ELEMENTS = {
  fire:     { label: "불",   icon: "🔥" },
  water:    { label: "물",   icon: "💧" },
  electric: { label: "전기", icon: "⚡" },
  light:    { label: "빛",   icon: "✨" },
  dark:     { label: "어둠", icon: "🌑" },
  earth:    { label: "땅",   icon: "🪨" },
  poison:   { label: "독",   icon: "☠️" },
};
// key가 value를 이긴다. 각 속성은 1개를 이기고 1개에 지고 4개엔 중립.
const BEATS = { water: "fire", fire: "electric", electric: "light", light: "dark", dark: "earth", earth: "poison", poison: "water" };
const TYPE_ADV = 1.12;  // 유리
const TYPE_DIS = 0.90;  // 불리
const DMG_K = 0.6;      // 전역 데미지 계수(전투 길이 조절)

// 종 패시브 (속성별). 새 속성은 기존 역할 틀 재활용 — 어둠/빛=공격형, 땅/독=방어형.
const PASSIVE = {
  fire:     { label: "🔥 맹공 (주는 피해 +6%)",  dmgDealt: 1.06 },
  water:    { label: "💧 견고 (받는 피해 -8%)",  dmgTaken: 0.92 },
  electric: { label: "⚡ 잔상 (회피 +10%)",      evaBonus: 0.10 },
  light:    { label: "✨ 광휘 (주는 피해 +6%)",  dmgDealt: 1.06 },
  dark:     { label: "🌑 흉포 (주는 피해 +6%)",  dmgDealt: 1.06 },
  earth:    { label: "🪨 단단 (받는 피해 -8%)",  dmgTaken: 0.92 },
  poison:   { label: "☠️ 점액 (회피 +6%)",       evaBonus: 0.06 },
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
    { id: "e_thrust", name: "번개 찌르기", type: "electric", power: 1.4, cd: 2, speedScale: 1.4 },
    { id: "e_chain",  name: "연쇄 스파크", type: "electric", power: 1.0,  cd: 3, extraHit: { chance: 0.5, power: 0.55 } },
  ],
  dark: [ // 공격형(불 틀 재활용): 화력 + 공격 버프
    { id: "d_basic",  name: "기본 공격",   type: "dark", power: 1.0,  cd: 0 },
    { id: "d_strike", name: "그림자 일격", type: "dark", power: 1.28, cd: 2 },
    { id: "d_curse",  name: "저주",       type: "dark", power: 1.1,  cd: 3, buffAtk: { mult: 1.2, turns: 2 } },
  ],
  earth: [ // 방어형(물 틀 재활용): 피해 감소 + 회복
    { id: "g_basic",  name: "기본 공격",   type: "earth", power: 1.0,  cd: 0 },
    { id: "g_shield", name: "바위 방패",   type: "earth", power: 0.85, cd: 3, shield: { reduce: 0.25, turns: 2 } },
    { id: "g_mend",   name: "대지 치유",   type: "earth", power: 0.8,  cd: 4, heal: 0.12 },
  ],
  light: [ // 공격/속도형: 화력 + 속도 비례 강타
    { id: "l_basic", name: "기본 공격",   type: "light", power: 1.0,  cd: 0 },
    { id: "l_flash", name: "섬광",       type: "light", power: 1.2,  cd: 2, speedScale: 1.35 },
    { id: "l_judge", name: "심판의 빛",   type: "light", power: 1.1,  cd: 3, buffAtk: { mult: 1.2, turns: 2 } },
  ],
  poison: [ // 지속피해형: 중독 도트로 갉아먹고 부식으로 마무리
    { id: "p_basic",   name: "기본 공격", type: "poison", power: 1.0,  cd: 0 },
    { id: "p_venom",   name: "맹독",     type: "poison", power: 0.6,  cd: 3, dot: { frac: 0.035, turns: 3 } },
    { id: "p_corrode", name: "부식",     type: "poison", power: 1.22, cd: 2 },
  ],
};

// 종별 시그니처 스킬 — 종마다 고유 1개. type 스킬 키트 위에 4번째로 추가.
// 쿨다운이 길어 한 경기 2~3번 사용 가능 — 종 선택에 의미 부여.
const SPECIES_SKILLS = {
  ember:     { id: "ember_sig",     name: "용의 분노",      type: "fire",     power: 1.45, cd: 4 },
  lion:      { id: "lion_sig",      name: "사자후",          type: "fire",     power: 1.05, cd: 3, buffAtk: { mult: 1.35, turns: 3 } },
  aqua:      { id: "aqua_sig",      name: "해류 방벽",       type: "water",    power: 0.75, cd: 4, shield: { reduce: 0.4, turns: 3 } },
  crab:      { id: "crab_sig",      name: "강철 집게",       type: "water",    power: 1.5,  cd: 4 },
  spark:     { id: "spark_sig",     name: "초가속",         type: "electric", power: 1.25, cd: 3, speedScale: 1.6 },
  hare:      { id: "hare_sig",      name: "이단 점프",       type: "electric", power: 1.0,  cd: 3, extraHit: { chance: 0.85, power: 0.7 } },
  wolf:      { id: "wolf_sig",      name: "사냥꾼의 추격",   type: "dark",     power: 1.5,  cd: 4 },
  bat:       { id: "bat_sig",       name: "흡혈",           type: "dark",     power: 1.0,  cd: 3, heal: 0.15 },
  armadillo: { id: "armadillo_sig", name: "가시 방벽",       type: "earth",    power: 0.65, cd: 3, shield: { reduce: 0.5, turns: 2 } },
  bear:      { id: "bear_sig",      name: "거대한 일격",     type: "earth",    power: 1.6,  cd: 4 },
  unicorn:   { id: "unicorn_sig",   name: "프리즘 광선",     type: "light",    power: 1.45, cd: 3 },
  swan:      { id: "swan_sig",      name: "성스러운 치유",   type: "light",    power: 0.7,  cd: 4, heal: 0.18 },
  toad:      { id: "toad_sig",      name: "맹독 분출",       type: "poison",   power: 1.05, cd: 3, dot: { frac: 0.05, turns: 4 } },
  viper:     { id: "viper_sig",     name: "치명타 독니",     type: "poison",   power: 1.3,  cd: 2, dot: { frac: 0.04, turns: 3 } },
};

let lastTypeMult = 1; // 직전 스킬의 상성 배율(로그용)

// 전투용 파이터 객체(스킬 키트 + 쿨다운/버프 + 종 패시브 부착)
function buildFighter(base) {
  const p = PASSIVE[base.type] || {};
  // 종별 시그니처 스킬을 type 키트 위에 합쳐서 4스킬 셋 구성
  const baseKit = SKILL_KITS[base.type] || [];
  const sig = base.species ? SPECIES_SKILLS[base.species] : null;
  return Object.assign({}, base, {
    kit: sig ? [...baseKit, sig] : baseKit,
    cd: {},                              // skillId -> 남은 쿨다운
    atkBuffTurns: 0, atkBuffMult: 1,     // 공격 버프
    shieldTurns: 0, shieldReduce: 0,     // 피해 감소
    dotTurns: 0, dotDmg: 0,              // 중독: 남은 턴 / 턴당 피해(절대값)
    pDmgDealt: p.dmgDealt || 1,          // 패시브: 주는 피해 배율
    pDmgTaken: p.dmgTaken || 1,          // 패시브: 받는 피해 배율
    pEva: p.evaBonus || 0,               // 패시브: 회피 가산
  });
}

// 회피 확률: 방어자의 속도 우위 + 전기 패시브, 상한 25%
function evades(atkr, dfdr) {
  const ev = clamp((dfdr.spd - atkr.spd) * 0.0020, -0.08, 0.22) + dfdr.pEva + evEffect("evadeBonus", 0); // 폭풍의 날
  return Math.random() < Math.min(ev, 0.27);
}

// 턴 시작 시 쿨다운/버프 시간 감소. 중독 중이면 도트 피해를 적용하고 그 값을 반환(로그용).
function upkeep(f) {
  for (const k in f.cd) if (f.cd[k] > 0) f.cd[k]--;
  if (f.atkBuffTurns > 0 && --f.atkBuffTurns === 0) f.atkBuffMult = 1;
  if (f.shieldTurns > 0 && --f.shieldTurns === 0) f.shieldReduce = 0;
  let dot = 0;
  if (f.dotTurns > 0) { dot = f.dotDmg; f.hp -= dot; f.dotTurns--; }
  return dot;
}

// AI 스킬 선택: 위급하면 회복, 상대 미중독이면 맹독, 가끔 방어, 그 외엔 최고 화력
function chooseSkill(self, foe) {
  const ready = self.kit.filter((s) => (self.cd[s.id] || 0) === 0);
  const heal = ready.find((s) => s.heal);
  if (heal && self.hp < self.maxHp * 0.4) return heal;
  const dot = ready.find((s) => s.dot);
  if (dot && foe && foe.dotTurns === 0 && foe.hp > foe.maxHp * 0.3) return dot;
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

// 업적: 평생 1회 해금되는 마일스톤. cur(state)가 goal 이상이면 달성.
// reward는 옵셔널(있으면 1회성 지급). check는 cur>=goal로 파생되며 state를 변경하지 않는다.
const ACHIEVEMENTS = [
  // 육성
  { id: "first_step",   icon: "🐣", name: "첫 걸음",       desc: "처음으로 몬스터를 돌봤다",      cur: (s) => s.lifetime.trains + s.lifetime.feeds + s.lifetime.plays, goal: 1 },
  { id: "teen",         icon: "🐊", name: "쑥쑥 성장",     desc: "청소년기로 진화 (Lv.5)",        cur: (s) => s.level, goal: 5,  reward: { type: "exp",    amt: 30 } },
  { id: "adult",        icon: "🦖", name: "완전체",         desc: "성체로 진화 (Lv.10)",           cur: (s) => s.level, goal: 10, reward: { type: "action", amt: 2 } },
  { id: "level20",      icon: "🌟", name: "정점",           desc: "레벨 20 달성",                  cur: (s) => s.level, goal: 20, reward: { type: "exp",    amt: 60 } },
  { id: "buff",         icon: "💪", name: "강철 몸",         desc: "공·방·속 스탯 합계 200",        cur: (s) => s.atk + s.def + s.spd, goal: 200 },
  { id: "train_master", icon: "🏋️", name: "훈련의 달인",     desc: "스탯 훈련 100회",               cur: (s) => s.lifetime.trains, goal: 100, reward: { type: "action", amt: 3 } },
  // 꾸준함
  { id: "streak3",      icon: "📗", name: "작심삼일 극복",   desc: "3일 연속 출석",                 cur: (s) => s.streak, goal: 3 },
  { id: "streak7",      icon: "📅", name: "개근상",           desc: "7일 연속 출석",                 cur: (s) => s.streak, goal: 7,  reward: { type: "exp",    amt: 50 } },
  { id: "streak30",     icon: "🗓️", name: "한 달 정착",       desc: "30일 연속 출석",                cur: (s) => s.streak, goal: 30, reward: { type: "action", amt: 5 } },
  // 전투
  { id: "first_win",    icon: "🥇", name: "데뷔전 승리",     desc: "아레나에서 첫 승리",            cur: (s) => s.wins, goal: 1,  reward: { type: "food",   amt: 20 } },
  { id: "win10",        icon: "⚔️", name: "베테랑",           desc: "통산 10승",                     cur: (s) => s.wins, goal: 10, reward: { type: "exp",    amt: 40 } },
  { id: "win50",        icon: "🛡️", name: "백전노장",         desc: "통산 50승",                     cur: (s) => s.wins, goal: 50, reward: { type: "action", amt: 3 } },
  { id: "gold",         icon: "🏅", name: "골드 입성",       desc: "레이팅 1300 도달",              cur: (s) => s.rating, goal: 1300, reward: { type: "exp", amt: 50 } },
  { id: "champion",     icon: "👑", name: "챔피언",           desc: "레이팅 1800 도달",              cur: (s) => s.rating, goal: 1800, reward: { type: "action", amt: 5 } },
  { id: "upset",        icon: "🗡️", name: "자이언트 킬링",   desc: "더 강한 상대를 처치",           cur: (s) => s.lifetime.upsets, goal: 1, reward: { type: "exp", amt: 40 } },
  { id: "arena_fan",    icon: "🎟️", name: "단골 도전자",     desc: "아레나 25회 출전",              cur: (s) => s.lifetime.pvp, goal: 25 },
  // 관리
  { id: "care_max",     icon: "😻", name: "최상의 컨디션",   desc: "포만·행복 동시 80 이상",        cur: (s) => (s.food >= 80 && s.happy >= 80 ? 1 : 0), goal: 1 },
  // 도감 (환생으로 여러 종을 키워야 달성)
  { id: "rebirth1",     icon: "🔄", name: "두 번째 인생",     desc: "환생해서 다른 종을 키워봤다",   cur: (s) => (s.lifetime.speciesSeen || []).length, goal: 2,  reward: { type: "exp",    amt: 40 } },
  { id: "collect3",     icon: "📒", name: "수집의 시작",       desc: "서로 다른 3종 육성",            cur: (s) => (s.lifetime.speciesSeen || []).length, goal: 3,  reward: { type: "action", amt: 3 } },
  { id: "collect5",     icon: "📚", name: "베테랑 사육사",     desc: "서로 다른 5종 육성",            cur: (s) => (s.lifetime.speciesSeen || []).length, goal: 5,  reward: { type: "exp",    amt: 80 } },
  { id: "all_elements", icon: "🌈", name: "오속성 정복",       desc: "5속성을 모두 경험",             cur: (s) => new Set((s.lifetime.speciesSeen || []).map((k) => SPECIES[k] && SPECIES[k].type).filter(Boolean)).size, goal: 5, reward: { type: "action", amt: 5 } },
  { id: "dex_complete", icon: "🏆", name: "도감 완성",         desc: "모든 종을 육성",                cur: (s) => (s.lifetime.speciesSeen || []).length, goal: Object.keys(SPECIES).length, reward: { type: "action", amt: 10 } },
];

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
let pendingRebirth = false; // true면 다음 hatch()가 환생(계정 진행도 유지)으로 동작
let currentEvent = null;    // 오늘의 일일 이벤트(서버 제공, 오프라인이면 null)
const evEffect = (key, dflt) => (currentEvent && currentEvent.effect && currentEvent.effect[key] != null ? currentEvent.effect[key] : dflt);
let leaderboardReturn = "arena";

// ---------- 유틸 ----------
const $ = (id) => document.getElementById(id);
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const SFX = window.SoundFX || {};

const screens = {
  auth: $("auth-screen"),
  hatch: $("hatch-screen"),
  home: $("home-screen"),
  arena: $("arena-screen"),
  leaderboard: $("leaderboard-screen"),
  tournament: $("tournament-screen"),
  shop: $("shop-screen"),
  season: $("season-screen"),
  boss: $("boss-screen"),
  friends: $("friends-screen"),
};
let tooltipEl = null;

function show(name) {
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
  closeTooltip();
  haptic(5); // 화면 전환 시 가벼운 진동
}

// 좌측 가장자리에서 우측으로 스와이프 시 현재 화면의 뒤로가기 트리거.
// 전투 중(arena-screen + match-battle visible)에는 비활성.
(() => {
  let startX = 0, startY = 0, startT = 0, tracking = false;
  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX > window.innerWidth * 0.18) return; // 좌측 18% 가장자리에서만
    startX = t.clientX; startY = t.clientY; startT = Date.now(); tracking = true;
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (!tracking) return; tracking = false;
    if (!e.changedTouches.length) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX, dy = t.clientY - startY, dt = Date.now() - startT;
    if (dx < 80 || Math.abs(dy) > 70 || dt > 600) return;
    // 전투 중이면 무시
    const arenaShown = !screens.arena.classList.contains("hidden");
    if (arenaShown && !$("match-battle").classList.contains("hidden")) return;
    // 현재 화면의 screen-back 또는 fallback 핸들러
    const visible = Object.values(screens).find((s) => !s.classList.contains("hidden"));
    if (!visible) return;
    const back = visible.querySelector(".screen-back");
    if (back) { back.click(); return; }
    // 아레나는 back-home 우선
    if (visible === screens.arena) { $("back-home")?.click(); return; }
  }, { passive: true });
})();

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
  if (btn && SFX.isMuted) {
    const muted = SFX.isMuted();
    btn.textContent = muted ? "🔇" : "🔊";
    btn.classList.toggle("off", muted);
    btn.setAttribute("aria-label", muted ? "사운드 켜기" : "음소거");
  }
  const hBtn = $("haptic-btn");
  if (hBtn && SFX.isHapticMuted) {
    const off = SFX.isHapticMuted();
    hBtn.textContent = off ? "🚫" : "📳";
    hBtn.classList.toggle("off", off);
    hBtn.setAttribute("aria-label", off ? "진동 켜기" : "진동 끄기");
  }
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
  const prev = activeHomeTab;
  activeHomeTab = tab;
  document.querySelectorAll(".home-tab-content").forEach((el) => {
    el.classList.toggle("hidden", el.dataset.homeTab !== tab);
    el.classList.toggle("active", el.dataset.homeTab === tab);
  });
  document.querySelectorAll(".home-tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  closeTooltip();
  if (tab === "arena") {
    renderArenaLobby();
    setTimeout(peekInboxBadge, 1500); // refreshInbox가 ack한 후 배지 갱신
  }
  if (prev && prev !== tab) haptic(5);
}

// "오늘" — KST 기준(서버 kstDateStr과 동기). + 테스트용 dayOffset.
// 과거 UTC 기준이었던 탓에 자정~오전 9시(KST) 사이 출석/퀘스트가 어제로 잡혔던 버그를 해소.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
function todayStr() {
  const offset = state ? (state.dayOffset || 0) : 0;
  const d = new Date(Date.now() + KST_OFFSET_MS);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function gameNow() {
  return Date.now() + (state ? state.timeOffset || 0 : 0);
}

// ---------- 저장/로드 ----------
let cloudSaveTimer = null;
// 성장 그래프용: 오늘의 전투력을 statLog에 기록(같은 날은 덮어쓰기, 최근 14일 유지).
function upsertStatLog() {
  if (!state) return;
  if (!Array.isArray(state.statLog)) state.statLog = [];
  const entry = { d: todayStr(), power: power(state), level: state.level };
  const last = state.statLog[state.statLog.length - 1];
  if (last && last.d === entry.d) state.statLog[state.statLog.length - 1] = entry;
  else state.statLog.push(entry);
  if (state.statLog.length > 14) state.statLog = state.statLog.slice(-14);
}

function save() {
  upsertStatLog();
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  // 로그인 상태면 클라우드에도 동기화(디바운스)
  if (Online.status.loggedIn) {
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(() => Online.pushCloudSave(state), 1500);
  }
}
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
  if (!Array.isArray(state.statLog)) state.statLog = [];
  if (!Number.isFinite(state.coins)) state.coins = 0;
  if (state.staminaBuyDate === undefined) state.staminaBuyDate = null;
  if (!Number.isFinite(state.staminaBuyCount)) state.staminaBuyCount = 0;
  // 일회성 보정: 구매 카운트 중복 가산 버그로 한도 초과된 유저 복구
  if (!state.staminaBuyResetV1) {
    state.staminaBuyDate = null;
    state.staminaBuyCount = 0;
    state.staminaBuyResetV1 = true;
  }
  if (!Array.isArray(state.titles)) state.titles = [];
  if (typeof state.title !== "string") state.title = "";
  if (state.title && !state.titles.includes(state.title)) state.title = ""; // 보유 안 한 칭호는 장착 해제
  // 코스메틱 장비 — 머리 슬롯만(외형 전용)
  if (!state.cosmetics || typeof state.cosmetics !== "object") state.cosmetics = { owned: [], equipped: { head: null } };
  if (!Array.isArray(state.cosmetics.owned)) state.cosmetics.owned = [];
  if (!state.cosmetics.equipped || typeof state.cosmetics.equipped !== "object") state.cosmetics.equipped = { head: null };
  // 폐기된 등/꼬리 슬롯 정리 + 코인 환불(1회성)
  if (!state.cosmeticSlotCleanupV1) {
    let refund = 0;
    state.cosmetics.owned = state.cosmetics.owned.filter((id) => {
      if (OBSOLETE_COSMETICS[id] !== undefined) { refund += OBSOLETE_COSMETICS[id]; return false; }
      return true;
    });
    delete state.cosmetics.equipped.back;
    delete state.cosmetics.equipped.tail;
    if (refund > 0) {
      state.coins = (state.coins || 0) + refund;
      state.cosmeticRefundPending = refund; // 게임 진입 후 알림 표시용
    }
    state.cosmeticSlotCleanupV1 = true;
  }
  if (state.cosmetics.equipped.head === undefined) state.cosmetics.equipped.head = null;
  const curHead = state.cosmetics.equipped.head;
  if (curHead && !state.cosmetics.owned.includes(curHead)) state.cosmetics.equipped.head = null;
  if (state.claimedChampionWeek === undefined) state.claimedChampionWeek = null;
  if (state.onboarded === undefined) state.onboarded = true; // 기존 유저는 이미 익숙 → 스킵
  if (state.claimedSeasonMonth === undefined) state.claimedSeasonMonth = null;
  if (!state.achievements || typeof state.achievements !== "object") state.achievements = {};
  if (!state.lifetime || typeof state.lifetime !== "object") state.lifetime = {};
  for (const k of ["trains", "feeds", "plays", "pvp", "upsets"]) {
    if (!Number.isFinite(state.lifetime[k])) state.lifetime[k] = 0;
  }
  // 도감: 현재 키우는 종을 기록에 소급 반영(기존 세이브는 자기 종이 1개 채워짐)
  if (!Array.isArray(state.lifetime.speciesSeen)) state.lifetime.speciesSeen = [];
  if (state.species && !state.lifetime.speciesSeen.includes(state.species)) {
    state.lifetime.speciesSeen.push(state.species);
  }
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

// 후발주자 catch-up: 강해질수록 훈련 효율 점진 감소 (hard cap 아님 — 최소 0.25 유지).
function growthMult(pw) {
  if (pw < 600) return 1.0;
  if (pw < 1000) return 0.70;
  if (pw < 1500) return 0.45;
  return 0.25;
}
// 후발주자 catch-up: 낮은 레이팅 구간은 코인을 더 많이, 상위는 덜 받음.
function ratingCoinMult(rating) {
  if (rating < 900)  return 1.5;
  if (rating < 1200) return 1.2;
  if (rating < 1500) return 1.0;
  if (rating < 1800) return 0.8;
  return 0.6;
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
  // 환생이면 계정성 진행도(레이팅·전적·업적·누적·출석)는 이어받고, 몬스터만 새로 시작.
  const carry = pendingRebirth && state ? state : null;
  const lifetime = carry ? carry.lifetime : { trains: 0, feeds: 0, plays: 0, pvp: 0, upsets: 0, speciesSeen: [] };
  if (!Array.isArray(lifetime.speciesSeen)) lifetime.speciesSeen = [];
  if (!lifetime.speciesSeen.includes(speciesKey)) lifetime.speciesSeen.push(speciesKey); // 도감 기록
  state = {
    species: speciesKey,
    name: name.slice(0, 12),
    level: 1, exp: 0,
    atk: sp.base.atk, def: sp.base.def, spd: sp.base.spd, hp: sp.base.hp,
    food: 70, happy: 70,
    streak: carry ? carry.streak : 1,
    dayCount: carry ? carry.dayCount : 1,
    lastDate: carry ? carry.lastDate : todayStr(),
    stamina: STAMINA_MAX,
    staminaAt: Date.now(),
    rating: carry ? carry.rating : 1000,
    wins: carry ? carry.wins : 0,
    losses: carry ? carry.losses : 0,
    dayOffset: carry ? carry.dayOffset : 0,
    timeOffset: carry ? carry.timeOffset : 0,
    history: carry ? carry.history : [],
    quests: generateQuests(),
    attendanceClaimedDate: carry ? carry.attendanceClaimedDate : null, // 오늘 출석 보상 수령 여부
    achievements: carry ? carry.achievements : {},  // { [업적id]: 해금 타임스탬프 }
    lifetime,                                        // 누적 카운터(업적/도감용)
    coins: carry ? carry.coins : 0,                  // 상점 화폐
    titles: carry ? carry.titles : [],               // 보유 칭호 id 배열
    title: carry ? carry.title : "",                 // 장착 칭호(표시용)
    claimedChampionWeek: carry ? carry.claimedChampionWeek : null, // 챔피언 보상 받은 weekId
    claimedSeasonMonth: carry ? carry.claimedSeasonMonth : null,   // 시즌 보상 받은 monthId
    onboarded: carry ? carry.onboarded : false,                    // 첫 부화면 false → 환영 모달 노출
    staminaBuyDate: carry ? carry.staminaBuyDate : null,           // 마지막 스태미너 구매 날짜(KST yyyy-mm-dd)
    staminaBuyCount: carry ? carry.staminaBuyCount : 0,            // 해당 날짜 누적 구매 횟수
    cosmetics: carry ? carry.cosmetics : { owned: [], equipped: { head: null } }, // 외형 장식(계정성)
  };
  pendingRebirth = false;
  checkAchievements(); // 도감 업적(N종 육성 등) 즉시 체크
  save();
  renderHome();
  showHomeTab("grow");
  show("home");
  if (!state.onboarded) setTimeout(showWelcome, 250); // 첫 부화면 환영 모달
}

// 환생: 현재 몬스터를 졸업시키고 새 종으로 다시 시작(계정성 진행도는 유지).
function startRebirth() {
  if (!state) return;
  const ok = confirm(
    `정말 환생할까요?\n\n지금 몬스터 "${state.name}"(Lv.${state.level})는 떠나고 새 종으로 다시 시작합니다.\n레이팅·전적·업적·도감은 그대로 유지돼요.`
  );
  if (!ok) return;
  pendingRebirth = true;
  renderEggs();
  show("hatch");
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
  checkAchievements();
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
  // 수확체감(catch-up): power 임계마다 훈련 효율 감소 → 신규 추격 여지
  const soft = growthMult(power(state));
  const mult = (0.6 + condition * 0.8) * streakBonus * soft;

  const careMult = evEffect("careMult", 1); // 잔치의 날: 포만·행복 회복 증가
  let text = "";
  if (kind === "feed") {
    state.food = clamp(state.food + Math.round(rand(22, 32) * careMult), 0, 100);
    state.hp += Math.max(1, Math.round(rand(2, 4) * soft));
    gainExp(Math.max(1, Math.round(6 * soft)));
    text = "냠냠! 포만감이 올랐어요.";
  } else if (kind === "play") {
    state.happy = clamp(state.happy + Math.round(rand(18, 28) * careMult), 0, 100);
    state.spd += Math.round(rand(0, 1) * mult);
    gainExp(Math.max(1, Math.round(8 * soft)));
    text = "신난다! 행복도가 올랐어요.";
  } else {
    // 스탯 훈련 (배고프거나 우울하면 효율↓, 약간의 포만감/행복 소모)
    const gain = Math.max(1, Math.round(rand(2, 4) * mult)) + evEffect("statBonus", 0); // 수련의 날
    if (kind === "atk") { state.atk += gain; text = `근력 훈련! 공격 +${gain}`; }
    if (kind === "def") { state.def += gain; text = `방어 훈련! 방어 +${gain}`; }
    if (kind === "spd") { state.spd += gain; text = `민첩 훈련! 속도 +${gain}`; }
    state.food = clamp(state.food - 8, 0, 100);
    state.happy = clamp(state.happy - 5, 0, 100);
    gainExp(Math.max(1, Math.round(14 * soft)));
  }

  // 퀘스트 진행도 반영
  questProgress("train_any");
  if (kind === "feed") { questProgress("feed"); state.lifetime.feeds++; }
  else if (kind === "play") { questProgress("play"); state.lifetime.plays++; }
  else { questProgress("train_stat"); questProgress("train_" + kind); state.lifetime.trains++; }
  if (state.food >= 80 && state.happy >= 80) questProgress("care_max");

  // 가득 찬 상태에서 처음 소모할 때만 충전 타이머 시작 (충전 중이면 진행도 유지)
  const wasFull = state.stamina >= STAMINA_MAX;
  state.stamina -= 1;
  if (wasFull) state.staminaAt = gameNow();
  checkAchievements();
  bounce();
  save();
  renderHome();
  msg(text, true);
}

function gainExp(amount) {
  state.exp += Math.round(amount * evEffect("expMult", 1)); // 일일 이벤트(풍요의 날) 반영
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
  addCoins(15); // 출석 보상 코인
  checkAchievements();
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

// ---------- 업적 ----------
let achToastQueue = [];

function applyAchievementReward(r) {
  if (r.type === "exp") gainExp(r.amt);
  else if (r.type === "action") addStamina(r.amt);
  else if (r.type === "happy") state.happy = clamp(state.happy + r.amt, 0, 100);
  else if (r.type === "food") state.food = clamp(state.food + r.amt, 0, 100);
}

// 미해금 업적을 순회하며 조건을 만족한 것을 해금한다.
// retro=true(최초 로드 시): 보상/토스트 없이 조용히 해금만(소급 적용).
// 저장은 호출 측 기존 save() 흐름에 맡긴다(이중 저장 방지).
function checkAchievements(retro) {
  if (!state || !state.achievements) return;
  ACHIEVEMENTS.forEach((a) => {
    if (state.achievements[a.id]) return;       // 이미 해금
    if (a.cur(state) < a.goal) return;          // 조건 미달
    state.achievements[a.id] = gameNow();        // 해금
    if (!retro) {
      if (a.reward) applyAchievementReward(a.reward);
      achToastQueue.push(a);
    }
  });
  if (!retro && achToastQueue.length) flushAchToasts();
}

// 해금 토스트를 큐에서 하나씩 순차 표시(한 액션에 여러 개 터질 수 있으므로).
function flushAchToasts() {
  if (typeof document === "undefined") { achToastQueue = []; return; }
  if (document.querySelector(".ach-toast")) return; // 이미 표시 중이면 대기
  const a = achToastQueue.shift();
  if (!a) return;
  const el = document.createElement("div");
  el.className = "ach-toast";
  const rewardText = a.reward ? ` · 🎁 ${REWARD_LABEL[a.reward.type](a.reward.amt)}` : "";
  el.innerHTML = `<span class="ach-toast-icon">${a.icon}</span>
    <div><div class="ach-toast-head">🏆 업적 달성!</div>
    <div class="ach-toast-name">${a.name}${rewardText}</div></div>`;
  document.body.appendChild(el);
  playFx("playReward");
  haptic([20, 30, 40]);
  setTimeout(() => {
    el.remove();
    if (achToastQueue.length) flushAchToasts();
    if (state) renderHome();
  }, 2400);
}

function renderAchievements() {
  const list = $("achievement-list");
  if (!list || !state) return;
  const unlocked = ACHIEVEMENTS.filter((a) => state.achievements[a.id]).length;
  const countEl = $("ach-count");
  if (countEl) countEl.textContent = `${unlocked}/${ACHIEVEMENTS.length}`;
  list.innerHTML = ACHIEVEMENTS.map((a) => {
    const got = !!state.achievements[a.id];
    const cur = Math.min(a.cur(state), a.goal);
    const pct = Math.round((cur / a.goal) * 100);
    return `<li class="ach-item ${got ? "unlocked" : ""}">
      <span class="ach-icon">${got ? a.icon : "🔒"}</span>
      <div class="ach-body">
        <div class="ach-name">${a.name}</div>
        <div class="ach-desc">${a.desc}</div>
        ${got ? "" : `<div class="ach-bar"><div style="width:${pct}%"></div></div>`}
      </div>
      ${got ? `<span class="ach-check">✔</span>` : `<span class="ach-frac">${cur}/${a.goal}</span>`}
    </li>`;
  }).join("");
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
  addCoins(10); // 퀘스트 보상 코인
  checkAchievements();
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
  const total = state.quests.length;
  const cleared = state.quests.filter((q) => q.claimed).length;
  const progEl = $("quest-progress");
  if (progEl) progEl.textContent = total ? `(${cleared}/${total} 완료)` : "";
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

// ---------- 성장 그래프 (의존성 없는 인라인 SVG) ----------
function renderStatChart() {
  const el = $("stat-chart");
  if (!el || !state) return;
  const note = $("stat-chart-note");
  const log = state.statLog || [];
  if (log.length === 0) {
    el.innerHTML = "";
    if (note) note.textContent = "훈련하면 전투력 추이가 쌓여요";
    return;
  }
  const W = 300, H = 110, padX = 8, padY = 14;
  const vals = log.map((e) => e.power);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const n = log.length;
  const xAt = (i) => (n === 1 ? W / 2 : padX + (i / (n - 1)) * (W - 2 * padX));
  const yAt = (v) => H - padY - ((v - min) / span) * (H - 2 * padY);
  const pts = log.map((e, i) => [xAt(i), yAt(e.power)]);
  const line = n > 1
    ? `<polyline points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" />`
    : "";
  const dots = pts.map(([x, y]) => `<rect x="${(x - 2).toFixed(1)}" y="${(y - 2).toFixed(1)}" width="4" height="4" fill="var(--accent2)" />`).join("");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" shape-rendering="crispEdges">${line}${dots}</svg>`;
  if (note) {
    note.textContent = n === 1
      ? `전투력 ${vals[0]} · 내일부터 추이가 그려져요`
      : `최근 ${n}일 · 전투력 ${vals[0]} → ${vals[n - 1]}`;
  }
}

// ---------- 일일 이벤트 ----------
async function refreshEvent() {
  currentEvent = await Online.event();
  renderEventBanner();
}
function renderEventBanner() {
  const el = $("event-banner");
  if (!el) return;
  if (currentEvent) {
    el.classList.remove("hidden");
    el.innerHTML = `<span class="event-icon">${currentEvent.icon}</span><span class="event-text"><b>${currentEvent.name}</b> · ${currentEvent.desc}</span>`;
  } else {
    el.classList.add("hidden");
    el.innerHTML = "";
  }
}

// ---------- 홈 렌더 ----------
function renderHome() {
  const staminaChanged = renderStamina();
  const sp = SPECIES[state.species];
  const stage = stageIndex(state.level);
  $("pet-sprite").textContent = sp.stages[stage];
  $("pet-name").textContent = state.name;
  renderPetCosmetics();
  const titleEl = $("pet-title");
  if (titleEl) { titleEl.textContent = state.title || ""; titleEl.classList.toggle("hidden", !state.title); }
  document.querySelectorAll(".coin-balance").forEach((el) => { el.textContent = state.coins || 0; });
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

  const allSkills = [...SKILL_KITS[sp.type]];
  const sig = SPECIES_SKILLS[state.species];
  if (sig) allSkills.push(sig);
  $("pet-skills").innerHTML =
    `<div class="passive-line">${PASSIVE[sp.type].label}</div>` +
    "보유 스킬 " + allSkills.map((s) => {
      const isSig = sig && s.id === sig.id;
      return `<span class="skill-chip${isSig ? " sig" : ""}">${ELEMENTS[s.type].icon} ${s.name}${isSig ? " ⭐" : ""}</span>`;
    }).join(" ");

  const noActions = state.stamina <= 0;
  $("train-grid").querySelectorAll("button").forEach((b) => {
    b.disabled = false;
    b.classList.toggle("no-stamina", noActions);
    b.setAttribute("aria-disabled", String(noActions));
  });

  renderEventBanner();
  renderStatChart();
  renderAttendance();
  renderQuests();
  renderAchievements();
  if (activeHomeTab === "arena") renderArenaLobby();
  if (staminaChanged) save();
}

function renderArenaLobby() {
  if (!state) return;
  renderAccount();
  refreshInbox();
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
let friendlyMode = false;       // 친선 재대결(보상·기록 없음)
let rerolls = 0;                // "다른 상대" 사용 횟수(매칭 세션당 최대 2회, 전투 후 리셋)
const REROLL_MAX = 2;
let lastFoeUnfavorable = false; // 불리 매칭 2연속 방지용 (저장 안 함)

// 내 현재 상태를 서버 스냅샷 형태로
function mySnapshot() {
  return { name: state.name, species: state.species, level: state.level,
    atk: state.atk, def: state.def, spd: state.spd, hp: state.hp + state.level * 6,
    dayCount: state.dayCount, rating: state.rating, title: state.title || "" };
}

// 내 속성 대비 상대 속성을 가중 랜덤으로 선택.
// 유리(내가 이김) 40% / 중립(동속성) 35% / 불리(상대가 이김) 25%.
// 단 불리 2연속 방지 + 강적일 땐 불리 매칭 회피.
function pickFoeType(myType, strong) {
  const iBeat = BEATS[myType];                                  // 내가 이기는 속성 → 유리
  const beatsMe = Object.keys(BEATS).find((k) => BEATS[k] === myType); // 나를 이기는 속성 → 불리
  // 중립 = iBeat/beatsMe를 제외한 나머지(동속성 포함). 7속성이면 4개.
  const neutrals = Object.keys(ELEMENTS).filter((t) => t !== iBeat && t !== beatsMe);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const roll = Math.random();
  let type = roll < 0.40 ? iBeat : roll < 0.75 ? pick(neutrals) : beatsMe;

  if (type === beatsMe && (lastFoeUnfavorable || strong)) {
    type = Math.random() < 0.5 ? iBeat : pick(neutrals); // 좌절 방지: 유리/중립으로 교체
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
  // 같은 type 안에서 종 무작위 선택 → AI 상대도 종별 시그니처 사용
  const typeKeys = Object.keys(SPECIES).filter((k) => SPECIES[k].type === type);
  const species = typeKeys[Math.floor(Math.random() * typeKeys.length)] || "ember";

  return {
    name: RIVAL_NAMES[idx], emoji: RIVAL_EMOJI[idx], type, species,
    hp: Math.max(40, stat("hp")), atk: Math.max(6, stat("atk")),
    def: Math.max(4, stat("def")), spd: Math.max(4, stat("spd")),
  };
}

function enterArena() {
  $("rating").textContent = state.rating;
  $("rank-tier").textContent = rankOf(state.rating);
  $("record").textContent = `${state.wins}승 ${state.losses}패`;
  Online.uploadSnapshot(mySnapshot()); // 내 고스트를 최신으로
  freshMatch(); // 첫 매칭 = 리롤 리셋
  show("arena");
}

// 새 매칭 세션: 리롤 카운터 리셋 후 첫 상대 매칭
function freshMatch() {
  rerolls = 0;
  updateRerollBtn();
  // 결과화면을 닫고 매칭화면 노출
  $("match-result").classList.add("hidden");
  $("match-find").classList.remove("hidden");
  findMatch();
}
// "다른 상대": 세션당 최대 REROLL_MAX회만 허용
function rerollMatch() {
  if (rerolls >= REROLL_MAX) return;
  rerolls += 1;
  updateRerollBtn();
  findMatch();
}
function updateRerollBtn() {
  const b = $("rematch-btn");
  if (!b) return;
  const left = REROLL_MAX - rerolls;
  b.disabled = left <= 0;
  b.textContent = left > 0 ? `🔄 다른 상대 (${left}회 남음)` : "🚫 다른 상대 (소진)";
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

// 서버 스냅샷 → 전투용 상대 객체.
// ghost=true는 "서버에서 받은 상대"(시드 NPC 포함), seeded=true는 서버 시드 캐릭터(NPC).
function opponentFromSnapshot(o) {
  const sp = SPECIES[o.species] || SPECIES.ember;
  return {
    playerId: o.playerId, name: o.name, species: o.species, type: sp.type, emoji: sp.stages[stageIndex(o.level)],
    atk: o.atk, def: o.def, spd: o.spd, hp: o.hp, ghost: true,
    seeded: typeof o.playerId === "string" && o.playerId.startsWith("ghost-"),
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
  const tag = o.seeded
    ? `<span class="ghost-tag npc">🤖 NPC</span>`
    : o.ghost
      ? `<span class="ghost-tag">👤 실제 플레이어</span>`
      : `<span class="ghost-tag ai">🤖 AI</span>`;
  $("opponent-card").innerHTML = `
    <div class="emoji">${o.emoji}</div>
    <h3>${o.name} <span class="elem-badge ${o.type}">${el.icon} ${el.label}</span></h3>
    ${tag}
    <div class="stats">🗡️${o.atk} 🛡️${o.def} 💨${o.spd} ❤️${o.hp}<br>전투력 약 ${power(o)}</div>
    <div class="matchup">${matchupHint(SPECIES[state.species].type, o.type)}</div>
    <div class="skills-line"><span class="passive-line">${PASSIVE[o.type].label}</span><br>스킬: ${SKILL_KITS[o.type].map((s) => s.name).join(" · ")}${o.species && SPECIES_SKILLS[o.species] ? ` · <b>${SPECIES_SKILLS[o.species].name} ⭐</b>` : ""}</div>
  `;
}

function startBattle() {
  if (!friendlyMode) { questProgress("pvp_play"); state.lifetime.pvp++; } // 친선전은 카운트 안 함
  $("match-find").classList.add("hidden");
  $("match-battle").classList.remove("hidden");

  const sp = SPECIES[state.species];
  const me = buildFighter({ name: state.name, species: state.species, emoji: sp.stages[stageIndex(state.level)], type: sp.type,
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
    const selfSide = turn === "me" ? "me" : "foe";
    const dot = upkeep(atkr);
    if (dot > 0) {
      floatBattleText(selfSide, `-${dot}`, "dmg-float");
      blog(`${atkr.name}이(가) 중독 피해 ${dot}을(를) 입었다!`, "system");
      updateHp(me, foe);
      if (atkr.hp <= 0) { setTimeout(() => resolve(turn !== "me"), 800); return; }
    }

    const skill = chooseSkill(atkr, dfdr);
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

      // 중독 부여 (명중 시에만)
      if (skill.dot && dfdr.hp > 0) {
        dfdr.dotTurns = skill.dot.turns;
        dfdr.dotDmg = Math.max(1, Math.round(dfdr.maxHp * skill.dot.frac));
        blog(`${dfdr.name}이(가) 중독되었다! (${skill.dot.turns}턴)`, "system");
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
  // 친선 재대결: 기록·보상·레이팅 없이 결과화면만 표시
  if (friendlyMode) {
    friendlyMode = false;
    playFx(won ? "playWin" : "playLose");
    resultOverlay(won);
    $("match-battle").classList.add("hidden");
    $("match-result").classList.remove("hidden");
    $("result-title").textContent = won ? "🏆 친선 승리!" : "💪 친선 패배";
    $("result-detail").textContent = "친선전 — 기록·보상 없음";
    tauntTarget = currentOpponent && currentOpponent.ghost ? { playerId: currentOpponent.playerId, name: currentOpponent.name } : null;
    renderResultSocial();
    return;
  }
  if (won) {
    state.wins++;
    questProgress("pvp_win");
    if (currentOpponent && power(currentOpponent) > power(state)) { questProgress("pvp_upset"); state.lifetime.upsets++; }
  } else state.losses++;
  playFx(won ? "playWin" : "playLose");
  haptic(won ? [45, 35, 80] : 55);
  resultOverlay(won);

  $("match-battle").classList.add("hidden");
  $("match-result").classList.remove("hidden");
  $("result-title").textContent = won ? "🏆 승리!" : "💀 패배";
  $("result-detail").textContent = "레이팅 반영 중...";

  // 온라인 매치면 서버가 Elo 계산 → 서버 레이팅 신뢰. 아니면 로컬 계산.
  let delta = null, newRating = null, tp = null;
  if (currentMatchId) {
    const r = await Online.submitResult(currentMatchId, won, 0);
    if (r) { newRating = r.newRating; delta = r.delta; tp = r.tp; }
  }
  currentMatchId = null;
  if (newRating == null) {
    delta = won ? rand(18, 28) : -rand(14, 24);
    newRating = Math.max(0, state.rating + delta);
  }
  state.rating = newRating;
  const base = won ? 8 : 1;
  const coinGain = Math.max(1, Math.round(base * ratingCoinMult(state.rating))); // 후발주자 catch-up: 낮은 레이팅이 더 많이 벌도록
  addCoins(coinGain);
  addBattleHistory(won, delta, newRating);
  checkAchievements();
  save();
  Online.uploadSnapshot(mySnapshot()); // 갱신된 레이팅으로 내 고스트 업데이트

  const sign = delta > 0 ? "+" : "";
  const tpText = tp ? ` · 🏅 +${tp}점` : "";
  $("result-detail").textContent = `${sign}${delta} 레이팅 (현재 ${state.rating}, ${rankOf(state.rating)})${tpText} · 🪙 +${coinGain}`;
  $("rating").textContent = state.rating;
  $("rank-tier").textContent = rankOf(state.rating);
  $("record").textContent = `${state.wins}승 ${state.losses}패`;
  // 결과화면 유지 — 실제 플레이어 상대면 도발/친선 재대결 노출
  tauntTarget = currentOpponent && currentOpponent.ghost ? { playerId: currentOpponent.playerId, name: currentOpponent.name } : null;
  renderResultSocial();
}

// ---------- 환영 / 도움말 모달 ----------
function showWelcome() { const b = $("welcome-backdrop"); if (b) b.classList.remove("hidden"); }
function dismissWelcome() {
  const b = $("welcome-backdrop");
  if (b) b.classList.add("hidden");
  if (state && !state.onboarded) { state.onboarded = true; save(); }
}

// ---------- 코인 / 상점 / 칭호 ----------
function addCoins(n) { if (state) state.coins = Math.max(0, (state.coins || 0) + n); }

// 상점 품목(클라 전용 — QoL/코스메틱, 영구 스탯 판매 없음)
// 스태미너는 무한 펌프 방지를 위해 가격↑ + 하루 5회 캡(STAMINA_BUY_DAILY_MAX).
const STAMINA_BUY_DAILY_MAX = 5;
const SHOP_ITEMS = [
  { id: "stamina", icon: "⚡", name: "스태미너 충전", desc: "스태미너 +5 (하루 5회 한정)", cost: 60, apply: () => addStamina(5) },
  { id: "snack",   icon: "🍖", name: "고급 간식",     desc: "포만 +40 · 행복 +20", cost: 20, apply: () => { state.food = clamp(state.food + 40, 0, 100); state.happy = clamp(state.happy + 20, 0, 100); } },
  { id: "exp",     icon: "⭐", name: "EXP 포션",       desc: "경험치 +60", cost: 40, apply: () => gainExp(60) },
];
function staminaBuysToday() {
  return state.staminaBuyDate === todayStr() ? (state.staminaBuyCount || 0) : 0;
}
function staminaBuysRemaining() {
  return Math.max(0, STAMINA_BUY_DAILY_MAX - staminaBuysToday());
}
const SHOP_TITLES = [
  { text: "🔥 열정의 조련사", cost: 100 },
  { text: "🛡️ 베테랑 조련사", cost: 300 },
  { text: "🌟 전설의 조련사", cost: 800 },
];

// 코스메틱 장비 — 순수 외형(스탯 영향 없음). 머리 슬롯 하나(모자/장식).
// 종/단계 이모지에 따라 머리 위치가 달라 다른 슬롯은 일관되게 표현이 어려워 제거.
const COSMETIC_SLOTS = ["head"];
const COSMETIC_ITEMS = [
  { id: "head_strawhat",  slot: "head", icon: "👒", name: "밀짚모자",   cost: 60  },
  { id: "head_flower",    slot: "head", icon: "🌺", name: "꽃",         cost: 70  },
  { id: "head_cap",       slot: "head", icon: "🧢", name: "야구모자",   cost: 80  },
  { id: "head_glasses",   slot: "head", icon: "👓", name: "안경",       cost: 90  },
  { id: "head_mushroom",  slot: "head", icon: "🍄", name: "버섯",       cost: 100 },
  { id: "head_helmet",    slot: "head", icon: "⛑️", name: "안전모",     cost: 110 },
  { id: "head_grad",      slot: "head", icon: "🎓", name: "학사모",     cost: 130 },
  { id: "head_pumpkin",   slot: "head", icon: "🎃", name: "호박",       cost: 150 },
  { id: "head_tophat",    slot: "head", icon: "🎩", name: "실크햇",     cost: 180 },
  { id: "head_sunglass",  slot: "head", icon: "😎", name: "선글라스",   cost: 200 },
  { id: "head_halo",      slot: "head", icon: "😇", name: "천사 후광",  cost: 240 },
  { id: "head_military",  slot: "head", icon: "🪖", name: "군모",       cost: 260 },
  { id: "head_crown",     slot: "head", icon: "👑", name: "왕관",       cost: 300 },
];
function cosmeticById(id) { return COSMETIC_ITEMS.find((c) => c.id === id) || null; }
// 폐기된 슬롯의 환불 단가 — migrateState에서 1회성 환불
const OBSOLETE_COSMETICS = {
  back_wings: 200, back_cape: 120, back_star: 90,
  tail_ribbon: 60, tail_bell: 90, tail_flame: 180,
};

let _shopPreviewHat = null; // null = 현재 장착 중인 모자 표시

function openShop() {
  _shopPreviewHat = null;
  show("shop");
  renderShop();
}
function renderShop() {
  if (!state) return;
  $("shop-coins").textContent = state.coins || 0;
  // 소비 아이템
  $("shop-items").innerHTML = SHOP_ITEMS.map((it) => {
    const capped = it.id === "stamina" && staminaBuysRemaining() <= 0;
    const disabled = state.coins < it.cost || capped;
    const label = capped ? "오늘 한도 ⛔" : `🪙${it.cost}`;
    const desc = it.id === "stamina"
      ? `${it.desc} · 오늘 ${staminaBuysToday()}/${STAMINA_BUY_DAILY_MAX}회`
      : it.desc;
    return `<li class="shop-row">
      <span class="shop-icon">${it.icon}</span>
      <span class="shop-info"><b>${it.name}</b><br><span class="shop-desc">${desc}</span></span>
      <button class="shop-buy" data-buy="${it.id}" ${disabled ? "disabled" : ""}>${label}</button>
    </li>`;
  }).join("");
  // 코스메틱 장비(모자) — 행을 탭하면 미리보기에 임시 장착
  $("shop-cosmetics").innerHTML = COSMETIC_ITEMS.map((c) => {
    const owned = state.cosmetics.owned.includes(c.id);
    const equipped = state.cosmetics.equipped[c.slot] === c.id;
    const previewing = _shopPreviewHat === c.id;
    let btn;
    if (equipped) btn = `<button class="shop-buy" data-cos-unequip="${c.slot}">해제</button>`;
    else if (owned) btn = `<button class="shop-buy" data-cos-equip="${c.id}">장착</button>`;
    else btn = `<button class="shop-buy" data-cos-buy="${c.id}" ${state.coins < c.cost ? "disabled" : ""}>🪙${c.cost}</button>`;
    return `<li class="shop-row${previewing ? " cos-active" : ""}" data-cos-preview="${c.id}">
      <span class="shop-icon">${c.icon}</span>
      <span class="shop-info"><b>${c.name}</b>${owned ? ' <span class="shop-desc">· 보유</span>' : ''}</span>
      ${btn}
    </li>`;
  }).join("");
  renderShopPreview();
  // 칭호
  $("shop-titles").innerHTML = SHOP_TITLES.map((t) => {
    const owned = (state.titles || []).includes(t.text);
    const equipped = state.title === t.text;
    let btn;
    if (equipped) btn = `<button class="shop-buy" data-unequip="1">해제</button>`;
    else if (owned) btn = `<button class="shop-buy" data-equip="${t.text}">장착</button>`;
    else btn = `<button class="shop-buy" data-title="${t.text}" data-cost="${t.cost}" ${state.coins < t.cost ? "disabled" : ""}>🪙${t.cost}</button>`;
    return `<li class="shop-row">
      <span class="shop-icon">👑</span>
      <span class="shop-info"><b>${t.text}</b>${owned ? ' <span class="shop-desc">(보유)</span>' : ""}</span>
      ${btn}
    </li>`;
  }).join("");
}
function buyItem(id) {
  const it = SHOP_ITEMS.find((x) => x.id === id);
  if (!it || state.coins < it.cost) return;
  if (it.id === "stamina") {
    if (staminaBuysRemaining() <= 0) {
      msg(`스태미너는 하루 ${STAMINA_BUY_DAILY_MAX}회까지만 구매할 수 있어요.`, false);
      renderShop();
      return;
    }
    const prev = staminaBuysToday();
    state.staminaBuyDate = todayStr();
    state.staminaBuyCount = prev + 1;
  }
  addCoins(-it.cost);
  it.apply();
  save();
  renderShop();
  renderHome();
  msg(`${it.name} 구매! (-🪙${it.cost})`, true);
  playFx("playReward");
}
function buyTitle(text, cost) {
  if (state.coins < cost || (state.titles || []).includes(text)) return;
  addCoins(-cost);
  state.titles.push(text);
  state.title = text; // 구매 즉시 장착
  save();
  renderShop();
  renderHome();
  msg(`칭호 획득: ${text}`, true);
  playFx("playReward");
}
function equipTitle(text) {
  if (!(state.titles || []).includes(text) && text !== "") return;
  state.title = text;
  save();
  renderShop();
  renderHome();
}

// ---------- 코스메틱 장비 ----------
// 사이드 프로파일 이모지의 머리 방향(Apple 렌더링 기준). 머리 장식 X 위치 조정.
//   "right" = 머리가 이미지 오른쪽(예: 🦖 T-rex)
//   "left"  = 머리가 이미지 왼쪽(예: 🐊 악어, 🐉 용)
const EMOJI_FACING = {
  "🦖": "right", "🦏": "right", "🦬": "right", "🐈": "right", "🐢": "right",
  "🦘": "right", "🦔": "right", "🐍": "right", "🐔": "right",
  "🐊": "left",  "🐋": "left",  "🐉": "left",  "🐎": "left",  "🦌": "left",
  "🐀": "left",  "🐅": "left",  "🦎": "left",  "🐟": "left",
  "🦅": "left",  "🦐": "left",  "🐇": "left",  "🐛": "left",
  "🦩": "left",  "🦢": "left",  "🐥": "left",  "🐤": "left", "🦂": "left",
};

function renderPetCosmetics() {
  if (!state || !state.cosmetics) return;
  const sp = SPECIES[state.species];
  const emoji = sp ? sp.stages[stageIndex(state.level)] : "";
  const facing = EMOJI_FACING[emoji] || "center";
  const headEl = $("cos-head");
  if (!headEl) return;

  // 매 렌더마다 inline 위치 리셋(이전 종/단계 override 청소)
  headEl.style.left = ""; headEl.style.right = ""; headEl.style.marginLeft = "";

  // 사이드 프로파일이면 머리 X 위치 보정
  if (facing === "right") {
    headEl.style.left = "72%"; headEl.style.marginLeft = "-13px";
  } else if (facing === "left") {
    headEl.style.left = "28%"; headEl.style.marginLeft = "-13px";
  }
  // facing === "center" 또는 미정: 기본 CSS(top center) 사용

  const id = state.cosmetics.equipped.head;
  const c = id ? cosmeticById(id) : null;
  headEl.textContent = c ? c.icon : "";
}
function buyCosmetic(id) {
  const c = cosmeticById(id);
  if (!c) return;
  if ((state.cosmetics.owned || []).includes(id)) return; // 중복 보유 방지
  if (state.coins < c.cost) return;
  addCoins(-c.cost);
  state.cosmetics.owned.push(id);
  state.cosmetics.equipped[c.slot] = id; // 구매 즉시 장착
  save();
  renderShop();
  renderHome();
  msg(`${c.name} 획득! 자동 장착됨 (-🪙${c.cost})`, true);
  playFx("playReward");
}
function equipCosmetic(id) {
  const c = cosmeticById(id);
  if (!c || !state.cosmetics.owned.includes(id)) return;
  state.cosmetics.equipped[c.slot] = id;
  save();
  renderShop();
  renderHome();
}
function unequipCosmetic(slot) {
  if (!COSMETIC_SLOTS.includes(slot)) return;
  state.cosmetics.equipped[slot] = null;
  save();
  renderShop();
  renderHome();
}
// 상점 미리보기 — 현재 종/단계 펫에 임시로 모자 얹어보기
function renderShopPreview() {
  if (!state) return;
  const petEl = $("cos-preview-pet"), hatEl = $("cos-preview-hat"), labelEl = $("cos-preview-label");
  if (!petEl || !hatEl) return;
  const sp = SPECIES[state.species];
  const emoji = sp ? sp.stages[stageIndex(state.level)] : "🐲";
  petEl.textContent = emoji;
  // 종 정면에 맞춘 모자 X 위치(머리 슬롯 정합 로직과 동일)
  const facing = EMOJI_FACING[emoji] || "center";
  hatEl.style.left = ""; hatEl.style.marginLeft = "";
  if (facing === "right") { hatEl.style.left = "72%"; hatEl.style.marginLeft = "-10px"; }
  else if (facing === "left") { hatEl.style.left = "28%"; hatEl.style.marginLeft = "-10px"; }
  // 미리보기 ID = 탭한 모자 우선, 없으면 현재 장착, 둘 다 없으면 빈
  const previewId = _shopPreviewHat || state.cosmetics.equipped.head;
  const c = previewId ? cosmeticById(previewId) : null;
  hatEl.textContent = c ? c.icon : "";
  if (_shopPreviewHat) {
    labelEl.textContent = c ? `미리보기: ${c.name}` : "미리보기";
  } else if (state.cosmetics.equipped.head) {
    labelEl.textContent = c ? `현재 장착: ${c.name}` : "장식 없음";
  } else {
    labelEl.textContent = "행을 탭하면 미리 써볼 수 있어요";
  }
}

// 지난주 챔피언 보상 수령(서버 멱등 + 클라 기록)
async function tryClaimChampion() {
  const reward = await Online.claimChampion();
  if (!reward) return;
  if (state.claimedChampionWeek === reward.weekId) return; // 클라 측 추가 가드
  addCoins(reward.coins);
  if (reward.title && !state.titles.includes(reward.title)) state.titles.push(reward.title);
  state.title = reward.title || state.title;
  state.claimedChampionWeek = reward.weekId;
  checkAchievements();
  save();
  Online.uploadSnapshot(mySnapshot());
  alert(`🏆 지난주 토너먼트 챔피언!\n보상: 🪙${reward.coins} + 칭호 "${reward.title}"`);
}

// ---------- 소셜: 도발 / 받은함 / 친선 재대결 ----------
const TAUNTS = [
  { id: "gg", text: "GG! 좋은 승부였어 👏" },
  { id: "again", text: "또 붙자! 다음엔 안 져 😤" },
  { id: "easy", text: "이지 게임이었네 😏" },
  { id: "rematch", text: "재대결 신청한다! 🔥" },
  { id: "respect", text: "강하다… 인정 👍" },
  { id: "cute", text: "네 몬스터 귀엽더라 🥰" },
];
let tauntTarget = null; // 도발 보낼 상대 {playerId, name} (직전 매치가 실제 플레이어일 때)

// 아레나 로비 소셜 바: 직전 상대와 친선 재대결 + (실제 플레이어면) 도발
function renderResultSocial() {
  const bar = $("result-social");
  if (!bar) return;
  if (!currentOpponent) { bar.classList.add("hidden"); bar.innerHTML = ""; return; }
  const canTaunt = Online.status.reachable && tauntTarget && tauntTarget.playerId && !String(tauntTarget.playerId).startsWith("ghost-");
  bar.classList.remove("hidden");
  let html = `<button id="friendly-rematch-btn" class="ghost">🔁 친선 재대결 (보상 없음)</button>`;
  if (canTaunt) {
    html += `<div class="taunt-title">💬 ${currentOpponent.name}에게 한마디</div><div class="taunt-btns">` +
      TAUNTS.map((t) => `<button class="taunt-btn" data-taunt="${t.id}">${t.text}</button>`).join("") + `</div>`;
  }
  bar.innerHTML = html;
}
async function sendTaunt(presetId) {
  if (!tauntTarget) return;
  const ok = await Online.sendTaunt(tauntTarget.playerId, presetId);
  if (ok) {
    tauntTarget = null;
    const bar = $("result-social");
    const t = bar && bar.querySelector(".taunt-btns");
    if (t) t.outerHTML = `<div class="taunt-title">메시지를 보냈어요! 📨</div>`;
  }
}

// 도발 메시지 알림 배지 — 미열람 메시지가 있고 아레나 탭이 아니면 점 표시.
// refreshInbox()와 별도 — 여기서는 ack 하지 않음(아레나 탭 진입 시 refreshInbox가 ack).
async function peekInboxBadge() {
  const btn = document.querySelector('.home-tab-btn[data-tab="arena"]');
  if (!btn) return;
  if (!Online.status.reachable || !Online.status.playerId) { btn.classList.remove("has-badge"); return; }
  const msgs = await Online.getMessages();
  const onArena = activeHomeTab === "arena" && !screens.home.classList.contains("hidden");
  btn.classList.toggle("has-badge", msgs.length > 0 && !onArena);
}

async function refreshInbox() {
  const box = $("inbox");
  if (!box) return;
  const msgs = await Online.getMessages();
  if (!msgs.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.classList.remove("hidden");
  box.innerHTML = `<div class="inbox-title">📨 받은 메시지 ${msgs.length}</div>` +
    msgs.map((m) => `<div class="inbox-row"><b>${m.fromName}</b>: ${m.text}</div>`).join("");
  Online.ackMessages(); // 표시 성공 후 읽음 처리(삭제)
}

// 친선 재대결: 메모리의 직전 상대와 다시 싸움(보상·기록·레이팅 없음)
function friendlyRematch() {
  if (!currentOpponent) return;
  friendlyMode = true;
  currentMatchId = null;
  show("arena");
  startBattle();
}

// ---------- 이벤트 바인딩 ----------
$("train-grid").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b && !b.disabled) train(b.dataset.train);
});

document.addEventListener("click", (e) => {
  // 화면 상단 뒤로가기(← 버튼) — 하단 버튼과 동일한 핸들러 트리거(중복 핸들러 X)
  const sb = e.target.closest(".screen-back");
  if (sb && sb.dataset.backTarget) {
    const target = $(sb.dataset.backTarget);
    if (target) target.click();
    return;
  }

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
  if (b.matches("[data-train], .quest-claim, #att-claim, #mute-btn, #haptic-btn")) return;
  playFx("playTick");
  haptic(8);
});

$("quest-list").addEventListener("click", (e) => {
  const b = e.target.closest(".quest-claim");
  if (b && !b.disabled) claimQuest(Number(b.dataset.quest));
});

$("att-claim").addEventListener("click", claimAttendance);
$("rebirth-btn").addEventListener("click", startRebirth);

$("home-screen").addEventListener("click", (e) => {
  const btn = e.target.closest(".home-tab-btn");
  if (btn) showHomeTab(btn.dataset.tab);
});

// ----- 인증 -----
async function doAuth(kind) {
  const u = $("auth-username").value.trim();
  const p = $("auth-password").value;
  if (!u || !p) { authMsg("아이디와 비밀번호를 입력하세요.", false); return; }
  authMsg(kind === "login" ? "로그인 중..." : "가입 중...", true);
  const r = kind === "login" ? await Online.login(u, p) : await Online.register(u, p);
  if (!r.ok) { authMsg(AUTH_ERR[r.error] || "오류: " + r.error, false); return; }
  // 로그인: 클라우드 세이브로 이어하기 / 회원가입: 현재 로컬 진행을 클라우드로 승계
  if (kind === "login") {
    const cloud = await Online.loadCloudSave();
    if (cloud) state = cloud;
  } else if (state) {
    Online.pushCloudSave(state);
  }
  $("auth-password").value = "";
  enterGameFromState();
}
$("auth-login").addEventListener("click", () => doAuth("login"));
$("auth-register").addEventListener("click", () => doAuth("register"));
$("auth-guest").addEventListener("click", () => enterGameFromState());
$("auth-password").addEventListener("keydown", (e) => { if (e.key === "Enter") doAuth("login"); });

async function doLogout() {
  if (!Online.status.loggedIn) return;
  if (!confirm("로그아웃할까요? (이 기기의 진행은 남고, 다시 로그인하면 이어집니다)")) return;
  await Online.logout();
  renderAccount();
  authMsg("", true);
  show("auth");
}
$("lobby-account").addEventListener("click", (e) => {
  const b = e.target.closest(".acct-link");
  if (!b) return;
  if (b.dataset.act === "login") { authMsg("", true); show("auth"); }
  else if (b.dataset.act === "logout") doLogout();
});
$("logout-btn").addEventListener("click", doLogout);

$("go-pvp").addEventListener("click", enterArena);
$("back-home").addEventListener("click", () => { renderHome(); showHomeTab("arena"); show("home"); });
$("fight-btn").addEventListener("click", startBattle);
$("again-btn").addEventListener("click", freshMatch);   // 다시 대전 = 새 매칭 세션(리롤 리셋)
$("rematch-btn").addEventListener("click", rerollMatch); // 다른 상대 = 리롤(최대 2회)
$("leaderboard-btn").addEventListener("click", () => { leaderboardReturn = "arena"; openLeaderboard(); });
$("home-leaderboard-btn").addEventListener("click", () => { leaderboardReturn = "home-arena"; openLeaderboard(); });
$("home-tournament-btn").addEventListener("click", openTournament);
$("tourney-back").addEventListener("click", () => {
  clearInterval(tourneyTimer);
  renderHome();
  showHomeTab("arena");
  show("home");
});
$("home-season-btn").addEventListener("click", openSeason);
$("season-back").addEventListener("click", () => {
  clearInterval(seasonTimer);
  renderHome();
  showHomeTab("arena");
  show("home");
});
$("home-boss-btn").addEventListener("click", openBoss);
$("boss-back").addEventListener("click", () => {
  clearInterval(bossTimer);
  renderHome();
  showHomeTab("arena");
  show("home");
});
$("boss-attack-btn").addEventListener("click", attackBoss);

// 친구 화면
$("home-friends-btn").addEventListener("click", openFriends);
$("friends-back").addEventListener("click", () => { renderHome(); showHomeTab("arena"); show("home"); });
$("copy-code-btn").addEventListener("click", async () => {
  const code = $("my-friend-code").textContent;
  if (!code || code === "..." || code === "오프라인") return;
  try { await navigator.clipboard.writeText(code); msg(`코드 복사됨: ${code}`, true); }
  catch { msg(`코드: ${code}`, true); } // 클립보드 거부되면 그냥 표시
});
$("add-friend-btn").addEventListener("click", tryAddFriend);
$("friend-code-input").addEventListener("keydown", (e) => { if (e.key === "Enter") tryAddFriend(); });
$("friend-list").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.friendTaunt) tauntFriend(b.dataset.friendTaunt, b.dataset.friendName);
  else if (b.dataset.friendFight) fightFriend(b.dataset.friendFight);
  else if (b.dataset.friendRemove) removeFriendClick(b.dataset.friendRemove, b.dataset.friendName);
});
$("boss-target").addEventListener("click", () => {
  if (!$("boss-target").classList.contains("attackable")) return;
  attackBoss();
});

// 도움말 / 환영 모달
$("help-btn").addEventListener("click", showWelcome);
$("welcome-close").addEventListener("click", dismissWelcome);
$("welcome-backdrop").addEventListener("click", (e) => { if (e.target.id === "welcome-backdrop") dismissWelcome(); });

// 상점
$("shop-btn").addEventListener("click", openShop);
$("shop-back").addEventListener("click", () => { renderHome(); showHomeTab("daily"); show("home"); });
$("shop-screen").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) {
    if (b.dataset.buy) buyItem(b.dataset.buy);
    else if (b.dataset.title) buyTitle(b.dataset.title, Number(b.dataset.cost));
    else if (b.dataset.equip) equipTitle(b.dataset.equip);
    else if (b.dataset.unequip) equipTitle("");
    else if (b.dataset.cosBuy) buyCosmetic(b.dataset.cosBuy);
    else if (b.dataset.cosEquip) equipCosmetic(b.dataset.cosEquip);
    else if (b.dataset.cosUnequip) unequipCosmetic(b.dataset.cosUnequip);
    return;
  }
  // 버튼 외 영역 클릭 — 모자 행이면 미리보기로 전환(같은 행 재탭 시 해제)
  const row = e.target.closest("[data-cos-preview]");
  if (row) {
    const id = row.dataset.cosPreview;
    _shopPreviewHat = _shopPreviewHat === id ? null : id;
    renderShop();
  }
});

// 소셜(결과화면): 친선 재대결 + 도발
$("result-social").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.id === "friendly-rematch-btn") friendlyRematch();
  else if (b.dataset.taunt) sendTaunt(b.dataset.taunt);
});
$("lb-back").addEventListener("click", () => {
  if (leaderboardReturn === "home-arena") {
    renderHome();
    showHomeTab("arena");
    show("home");
  } else {
    show("arena");
  }
});

$("haptic-btn").addEventListener("click", () => {
  if (SFX.toggleHapticMute) SFX.toggleHapticMute();
  updateMuteButton();
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
    const npc = typeof r.playerId === "string" && r.playerId.startsWith("ghost-");
    const nameHtml = npc ? `${r.name} <span class="npc-mini">🤖</span>` : r.name;
    return `<li class="lb-row${me}">
      <span class="lb-rank">${r.rank}</span>
      <span class="lb-emoji">${ELEMENTS[sp.type].icon}</span>
      <span class="lb-name">${nameHtml}</span>
      <span class="lb-rating">${r.rating} · ${r.wins}승 ${r.losses}패</span>
    </li>`;
  }).join("");
}

// ---------- 주간 토너먼트 ----------
let tourneyTimer = null;

async function openTournament() {
  show("tournament");
  await tryClaimChampion(); // 지난주 챔피언이면 보상 수령
  const list = $("tournament-list");
  list.innerHTML = `<li class="muted">불러오는 중...</li>`;
  $("tourney-me").textContent = "";
  $("tourney-champion").innerHTML = "";
  $("tourney-countdown").textContent = "";
  const data = await Online.tournament();
  if (!data) {
    list.innerHTML = `<li class="muted">서버에 연결할 수 없어요. (오프라인 매치는 점수가 적립되지 않아요)</li>`;
    return;
  }
  startTourneyCountdown(data.endsAt);
  if (data.lastChampion) {
    const sp = SPECIES[data.lastChampion.species] || SPECIES.ember;
    $("tourney-champion").innerHTML = `👑 지난주 챔피언 — ${ELEMENTS[sp.type].icon} ${data.lastChampion.name} (${data.lastChampion.points}점)`;
  }
  $("tourney-me").textContent = data.me
    ? `내 순위 ${data.me.rank}위 · ${data.me.points}점 (${data.me.wins}승)`
    : "이번 주 기록 없음 — 아레나에서 이기면 점수가 쌓여요!";
  const myId = Online.status.playerId;
  if (!data.rows.length) {
    list.innerHTML = `<li class="muted">아직 참가자가 없어요. 첫 주자가 되어보세요!</li>`;
    return;
  }
  list.innerHTML = data.rows.map((r) => {
    const sp = SPECIES[r.species] || SPECIES.ember;
    const me = r.playerId === myId ? " me" : "";
    const rank = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : r.rank;
    return `<li class="lb-row${me}">
      <span class="lb-rank">${rank}</span>
      <span class="lb-emoji">${ELEMENTS[sp.type].icon}</span>
      <span class="lb-name">${r.name}</span>
      <span class="lb-rating">${r.points}점 · ${r.wins}승</span>
    </li>`;
  }).join("");
}

function startTourneyCountdown(endsAt) {
  clearInterval(tourneyTimer);
  const el = $("tourney-countdown");
  const tick = () => {
    const ms = endsAt - Date.now();
    if (ms <= 0) { el.textContent = "⏰ 곧 새로운 주가 시작돼요!"; clearInterval(tourneyTimer); return; }
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const mn = Math.floor((ms % 3600000) / 60000);
    el.textContent = `⏳ 리셋까지 ${d}일 ${h}시간 ${mn}분`;
  };
  tick();
  tourneyTimer = setInterval(tick, 60000);
}

// ---------- 월간 시즌 ----------
let seasonTimer = null;

async function tryClaimSeason() {
  const reward = await Online.claimSeason();
  if (!reward) return;
  if (state.claimedSeasonMonth === reward.monthId) return; // 클라 측 추가 가드
  addCoins(reward.coins);
  if (reward.title && !state.titles.includes(reward.title)) state.titles.push(reward.title);
  if (reward.title) state.title = reward.title; // 새로 받은 시즌 칭호 자동 장착
  state.claimedSeasonMonth = reward.monthId;
  save();
  Online.uploadSnapshot(mySnapshot());
  alert(`🏅 ${reward.monthId} 시즌 ${reward.tier} 보상!\n🪙 +${reward.coins}` + (reward.title ? `\n칭호: ${reward.title}` : ""));
}

async function openSeason() {
  show("season");
  await tryClaimSeason();
  $("season-monthid").textContent = "...";
  $("season-mytier").textContent = "...";
  $("season-lastresult").innerHTML = "";
  const data = await Online.season();
  if (!data) {
    $("season-monthid").textContent = "오프라인";
    $("season-mytier").textContent = "";
    return;
  }
  startSeasonCountdown(data.endsAt);
  $("season-monthid").textContent = `${data.monthId} 시즌`;
  $("season-mytier").textContent = `현재 등급: ${data.myTier} (레이팅 ${data.myRating})`;
  if (data.lastResult) {
    const lr = data.lastResult;
    const claimedNote = data.claimed ? " (수령 완료)" : "";
    $("season-lastresult").innerHTML =
      `<div class="season-result-title">📦 직전 시즌(${lr.monthId}) 결과</div>` +
      `<div class="season-result-row">${lr.tier} · 레이팅 ${lr.rating}</div>` +
      `<div class="season-result-row">보상: 🪙 ${lr.coins}${lr.title ? " · 칭호 " + lr.title : ""}${claimedNote}</div>`;
  } else {
    $("season-lastresult").innerHTML = `<div class="muted">직전 시즌 기록 없음</div>`;
  }
}

function startSeasonCountdown(endsAt) {
  clearInterval(seasonTimer);
  const el = $("season-countdown");
  const tick = () => {
    const ms = endsAt - Date.now();
    if (ms <= 0) { el.textContent = "⏰ 곧 다음 시즌이 시작돼요!"; clearInterval(seasonTimer); return; }
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    el.textContent = `⏳ 시즌 종료까지 ${d}일 ${h}시간`;
  };
  tick();
  seasonTimer = setInterval(tick, 60000);
}

// ---------- 주간 보스 (비동기 협력 PvE) ----------
let bossTimer = null;
let bossBusy = false;
const ELEM_LABEL = { fire: "🔥", water: "💧", elec: "⚡", earth: "🌿" };

async function tryClaimBoss() {
  const reward = await Online.bossClaim();
  if (!reward) return;
  if (reward.coins) addCoins(reward.coins);
  if (reward.title && !state.titles.includes(reward.title)) state.titles.push(reward.title);
  save();
  Online.uploadSnapshot(mySnapshot());
  alert(`${reward.bossIcon || "🐲"} ${reward.bossName || "보스"} 정산!\n순위 ${reward.rank}위 · 누적 ${reward.damage} 데미지\n보상: 🪙 ${reward.coins}${reward.title ? "\n칭호: " + reward.title : ""}`);
}

async function openBoss() {
  show("boss");
  await tryClaimBoss();
  $("boss-name").textContent = "...";
  $("boss-icon").textContent = "🐲";
  $("boss-target").textContent = "🐲";
  $("boss-countdown").textContent = "";
  $("boss-me").textContent = "";
  $("boss-total-dmg").textContent = "0";
  $("boss-participants").textContent = "0";
  $("boss-my-dmg").textContent = "0";
  $("boss-top").innerHTML = `<li class="muted">불러오는 중...</li>`;
  $("boss-last-result").innerHTML = "";
  $("boss-attack-btn").disabled = true;
  await refreshBoss();
}

async function refreshBoss() {
  const data = await Online.bossState();
  if (!data) {
    $("boss-name").textContent = "오프라인";
    $("boss-top").innerHTML = `<li class="muted">접속 후 다시 시도해 주세요.</li>`;
    return;
  }
  startBossCountdown(data.endsAt);
  $("boss-name").textContent = data.boss.name + (data.boss.element ? ` ${ELEM_LABEL[data.boss.element] || ""}` : "");
  $("boss-icon").textContent = data.boss.icon || "🐲";
  $("boss-target").textContent = data.boss.icon || "🐲";
  $("boss-total-dmg").textContent = (data.totalDamage || 0).toLocaleString();
  $("boss-participants").textContent = (data.participants || 0);
  $("boss-my-dmg").textContent = (data.myDamage || 0).toLocaleString();
  const rankTxt = data.myRank > 0 ? `${data.myRank}위` : "순위권 외";
  $("boss-me").textContent = `${rankTxt} · 남은 공격 ${data.attacksLeft}회`;
  const attackable = !bossBusy && data.attacksLeft > 0 && Online.status.reachable;
  $("boss-attack-btn").disabled = !attackable;
  if (data.attacksLeft <= 0) $("boss-attack-btn").textContent = "이번 주 공격 한도 ⛔";
  else $("boss-attack-btn").textContent = `⚔️ 보스 공격 (스태미너 1)`;
  const target = $("boss-target");
  if (target) {
    target.classList.toggle("attackable", attackable);
    target.classList.toggle("disabled", !attackable);
  }
  const hint = $("boss-tap-hint");
  if (hint) hint.classList.toggle("hidden", !attackable);
  if (data.lastResult) {
    const lr = data.lastResult;
    const claimedNote = data.claimed ? " (수령 완료)" : "";
    $("boss-last-result").innerHTML =
      `<div class="season-result-title">📦 직전 주(${lr.weekId}) 결과</div>` +
      `<div class="season-result-row">${lr.bossIcon || ""} ${lr.bossName || ""} · ${lr.rank}위 · 누적 ${lr.damage} 데미지</div>` +
      `<div class="season-result-row">보상: 🪙 ${lr.coins}${lr.title ? " · 칭호 " + lr.title : ""}${claimedNote}</div>`;
  } else {
    $("boss-last-result").innerHTML = "";
  }
  if (!data.top.length) {
    $("boss-top").innerHTML = `<li class="muted">아직 공격한 사람이 없어요. 첫 타격을!</li>`;
  } else {
    $("boss-top").innerHTML = data.top.map((r) => {
      const sp = SPECIES[r.species] || SPECIES.ember;
      const me = r.playerId === myId ? " me" : "";
      const rk = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : r.rank;
      return `<li class="lb-row${me}">
        <span class="lb-rank">${rk}</span>
        <span class="lb-emoji">${ELEMENTS[sp.type].icon}</span>
        <span class="lb-name">${r.name}</span>
        <span class="lb-rating">${r.damage.toLocaleString()} dmg</span>
      </li>`;
    }).join("");
  }
}

async function attackBoss() {
  if (bossBusy) return;
  if (state.stamina <= 0) { msg("스태미너가 부족해요!", false); return; }
  if (!Online.status.reachable) { msg("오프라인이라 보스 공격을 보낼 수 없어요.", false); return; }
  bossBusy = true;
  $("boss-attack-btn").disabled = true;
  // 스태미너 차감(낙관적) — 서버 거부 시 환불
  const wasFull = state.stamina >= STAMINA_MAX;
  state.stamina -= 1;
  if (wasFull) state.staminaAt = gameNow();
  save();
  renderStamina();
  const attackId = "atk-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const res = await Online.bossAttack(attackId);
  if (!res || res._error || !res.ok) {
    // 환불
    state.stamina += 1;
    save();
    renderStamina();
    const err = res && res.error;
    if (err === "out_of_attacks") msg("이번 주 공격 한도를 모두 소진했어요.", false);
    else msg("공격 실패 — 잠시 후 다시 시도해 주세요.", false);
  } else {
    playFx("playHit");
    haptic(15);
    spawnBossHit(res.damage);
    // 낙관적 카운터 업데이트(서버 응답 그대로 반영)
    if (typeof res.totalDamage === "number") $("boss-my-dmg").textContent = res.totalDamage.toLocaleString();
  }
  bossBusy = false;
  await refreshBoss();
}

// 공격 시각 피드백: 보스 셰이크 + 플로팅 데미지 숫자
function spawnBossHit(dmg) {
  const t = $("boss-target");
  if (t) { t.classList.remove("hit"); void t.offsetWidth; t.classList.add("hit"); }
  const area = $("boss-float-area");
  if (!area) return;
  const el = document.createElement("div");
  el.className = "boss-float-dmg";
  el.textContent = `-${dmg}`;
  // X 위치를 살짝 무작위로(연속 공격 시 겹침 방지)
  el.style.left = `calc(50% + ${(Math.random() * 40 - 20).toFixed(0)}px)`;
  area.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

function startBossCountdown(endsAt) {
  clearInterval(bossTimer);
  const el = $("boss-countdown");
  const tick = () => {
    const ms = endsAt - Date.now();
    if (ms <= 0) { el.textContent = "⏰ 주간 정산이 곧 진행돼요!"; clearInterval(bossTimer); return; }
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const mn = Math.floor((ms % 3600000) / 60000);
    el.textContent = `⏳ 정산까지 ${d}일 ${h}시간 ${mn}분`;
  };
  tick();
  bossTimer = setInterval(tick, 60000);
}

// ---------- 친구 시스템 ----------
async function openFriends() {
  show("friends");
  $("my-friend-code").textContent = "...";
  $("friend-list").innerHTML = `<li class="muted">불러오는 중...</li>`;
  $("friend-count").textContent = "";
  const code = await Online.myCode();
  $("my-friend-code").textContent = code || "오프라인";
  $("copy-code-btn").disabled = !code;
  await refreshFriends();
}
async function refreshFriends() {
  const friends = await Online.friendsList();
  $("friend-count").textContent = `(${friends.length}명)`;
  if (!friends.length) {
    $("friend-list").innerHTML = `<li class="muted">아직 친구가 없어요. 코드를 공유하거나 친구 코드를 입력해보세요!</li>`;
    return;
  }
  // 본인 + 친구 통합 레이팅 정렬 → 친구 사이 내 순위 시각화
  const mySp = SPECIES[state.species] || SPECIES.ember;
  const meRow = {
    playerId: Online.status.playerId,
    name: state.name + " (나)",
    species: state.species,
    level: state.level,
    rating: state.rating,
    title: state.title || "",
    isMe: true,
  };
  const all = [meRow, ...friends].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  $("friend-list").innerHTML = all.map((f, i) => {
    const rank = i + 1;
    const sp = SPECIES[f.species] || SPECIES.ember;
    const emoji = sp.stages[Math.min(stageIndex(f.level || 1), sp.stages.length - 1)];
    const rankBadge = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
    if (f.isMe) {
      return `<li class="friend-row friend-me">
        <span class="friend-rank">${rankBadge}</span>
        <span class="friend-emoji">${emoji}</span>
        <div class="friend-info">
          <div class="friend-name">${f.name}${f.title ? ' <span class="shop-desc">' + f.title + '</span>' : ''}</div>
          <div class="friend-meta">Lv ${f.level || 1} · ${ELEMENTS[sp.type].icon} ${ELEMENTS[sp.type].label} · 레이팅 ${f.rating}</div>
        </div>
      </li>`;
    }
    return `<li class="friend-row" data-friend-id="${f.playerId}">
      <span class="friend-rank">${rankBadge}</span>
      <span class="friend-emoji">${emoji}</span>
      <div class="friend-info">
        <div class="friend-name">${f.name}${f.title ? ' <span class="shop-desc">' + f.title + '</span>' : ''}</div>
        <div class="friend-meta">Lv ${f.level || 1} · ${ELEMENTS[sp.type].icon} ${ELEMENTS[sp.type].label} · 레이팅 ${f.rating}</div>
      </div>
      <div class="friend-actions">
        <button data-friend-taunt="${f.playerId}" data-friend-name="${f.name}">💬</button>
        <button data-friend-fight="${f.playerId}">⚔️</button>
        <button class="danger" data-friend-remove="${f.playerId}" data-friend-name="${f.name}">✕</button>
      </div>
    </li>`;
  }).join("");
}
async function tryAddFriend() {
  const input = $("friend-code-input");
  const code = (input.value || "").trim().toUpperCase().replace(/[^A-Z2-9]/g, "");
  if (!code) return;
  if (code.length < 6) { msg("코드는 6자리예요", false); return; }
  const r = await Online.addFriend(code);
  if (!r.ok) {
    if (r.error === "no_code") msg("코드를 찾을 수 없어요", false);
    else if (r.error === "self") msg("본인은 추가할 수 없어요", false);
    else msg("친구 추가 실패", false);
    return;
  }
  input.value = "";
  if (r.already) msg("이미 친구입니다", true);
  else msg(`${r.friend ? r.friend.name : "친구"} 추가 완료!`, true);
  await refreshFriends();
}
async function removeFriendClick(friendId, name) {
  if (!confirm(`'${name}' 친구를 삭제할까요?`)) return;
  await Online.removeFriend(friendId);
  await refreshFriends();
}
async function tauntFriend(friendId, name) {
  // 친구 1명을 향해 도발 프리셋 선택 → 보내기
  const presetIds = TAUNTS.map((t) => t.id);
  const lines = TAUNTS.map((t, i) => `${i + 1}. ${t.text}`).join("\n");
  const pick = prompt(`'${name}'에게 보낼 메시지 번호:\n\n${lines}`);
  const idx = Number(pick);
  if (!Number.isFinite(idx) || idx < 1 || idx > presetIds.length) return;
  const ok = await Online.sendTaunt(friendId, presetIds[idx - 1]);
  msg(ok ? "메시지를 보냈어요 📨" : "전송 실패", ok);
}
async function fightFriend(friendId) {
  if (!Online.status.reachable) { msg("오프라인이라 친선전 불가", false); return; }
  if (state.stamina <= 0) { msg("스태미너가 부족해요!", false); return; }
  const snap = await Online.getPlayer(friendId);
  if (!snap) { msg("친구 정보를 가져올 수 없어요", false); return; }
  currentOpponent = opponentFromSnapshot(snap);
  friendlyMode = true;
  currentMatchId = null;
  show("arena");
  startBattle();
}

// ---------- 계정 UI ----------
function renderAccount() {
  const logoutBtn = $("logout-btn");
  if (logoutBtn) logoutBtn.classList.toggle("hidden", !Online.status.loggedIn);
  const el = $("lobby-account");
  if (!el) return;
  if (Online.status.loggedIn) {
    el.innerHTML = `👤 ${Online.status.username} <button class="acct-link" data-act="logout">로그아웃</button>`;
  } else {
    el.innerHTML = `게스트 <button class="acct-link" data-act="login">로그인/회원가입</button>`;
  }
}
function authMsg(text, ok) {
  const el = $("auth-msg");
  el.textContent = text;
  el.style.color = ok ? "var(--good)" : "var(--bad)";
}
const AUTH_ERR = {
  BAD_USERNAME: "아이디는 영문/숫자 3~16자여야 해요.",
  BAD_PASSWORD: "비밀번호는 6자 이상이어야 해요.",
  TAKEN: "이미 있는 아이디예요.",
  BAD_CREDENTIALS: "아이디 또는 비밀번호가 틀렸어요.",
  TOO_MANY: "로그인 시도가 너무 많아요. 잠시 후 다시.",
  NETWORK: "서버에 연결할 수 없어요.",
};

// state(클라우드/로컬)로 게임 진입. state 있으면 홈, 없으면 부화.
function enterGameFromState() {
  if (state) {
    migrateState();
    if (!state.quests) state.quests = generateQuests();
    if (state.attendanceClaimedDate === undefined) state.attendanceClaimedDate = null;
    checkAchievements(true); // 기존 세이브의 이미 달성한 업적은 보상/토스트 없이 소급 해금
    save();
    checkRollover();
    renderHome();
    showHomeTab(activeHomeTab);
    show("home");
  } else {
    renderEggs();
    show("hatch");
  }
  renderAccount();
  if (state) Online.uploadSnapshot(mySnapshot());
  // 폐기 코스메틱(등/꼬리) 환불 알림 — 1회성
  if (state && state.cosmeticRefundPending) {
    const r = state.cosmeticRefundPending;
    delete state.cosmeticRefundPending;
    save();
    setTimeout(() => alert(`등/꼬리 장식은 머리(모자) 슬롯으로 통합됐어요.\n기존에 구매하신 등/꼬리 아이템 가격은 모두 환불됐습니다: 🪙 +${r}`), 400);
  }
}

// ---------- 시작 ----------
async function init() {
  state = load();
  updateMuteButton();
  await Online.init();        // 토큰 복원 → 로그인 상태 결정
  updateOnlineStatus();
  await refreshEvent();       // 오늘의 일일 이벤트(오프라인이면 null)

  if (Online.status.loggedIn) {
    const cloud = await Online.loadCloudSave();
    if (cloud) state = cloud; // 클라우드 세이브로 이어하기(다른 기기 포함)
    enterGameFromState();
  } else if (state) {
    enterGameFromState();     // 게스트 + 로컬 세이브 → 바로 게임
  } else {
    renderAccount();
    show("auth");             // 신규 + 미로그인 → 로그인/회원가입/게스트 선택
  }
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

// 일일 이벤트 stale 방지: 5분마다 + 탭 복귀 시 재확인(자정 KST 넘어가면 교체)
setInterval(refreshEvent, 5 * 60 * 1000);
// 도발 메시지 배지: 60초마다 폴 + 탭 복귀 시
setInterval(peekInboxBadge, 60 * 1000);
peekInboxBadge();
document.addEventListener("visibilitychange", () => { if (!document.hidden) { refreshEvent(); checkAppVersion(); peekInboxBadge(); } });

// ---------- 자동 업데이트 감지 (배포 후 강력 새로고침 없이 자동 반영) ----------
// 서버 BUILD_ID가 바뀌면 배너 표시 + 안전한 시점에 자동 리로드.
let _bootBuild = null;
let _updateShown = false;
async function checkAppVersion() {
  try {
    const base = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || "";
    const r = await fetch(base + "/version", { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    if (!j || !j.build) return;
    if (!_bootBuild) { _bootBuild = j.build; return; }
    if (j.build !== _bootBuild) showUpdateBanner();
  } catch {}
}
function showUpdateBanner() {
  if (_updateShown) return;
  _updateShown = true;
  const inArena = !screens.arena.classList.contains("hidden"); // 전투 중이면 자동 리로드 보류
  const bar = document.createElement("div");
  bar.className = "update-bar";
  bar.innerHTML = `<span id="update-text">🔄 새 버전이 있어요</span><button id="update-now">지금 새로고침</button>`;
  document.body.appendChild(bar);
  $("update-now").addEventListener("click", () => location.reload());
  if (!inArena) {
    let n = 8;
    const txt = $("update-text");
    txt.textContent = `🔄 새 버전 — ${n}초 후 자동 새로고침`;
    const tick = setInterval(() => {
      n--;
      if (n <= 0) { clearInterval(tick); location.reload(); return; }
      txt.textContent = `🔄 새 버전 — ${n}초 후 자동 새로고침`;
    }, 1000);
  }
}
setInterval(checkAppVersion, 30 * 1000);
checkAppVersion(); // 부팅 시 1회 — 현재 빌드 기록
