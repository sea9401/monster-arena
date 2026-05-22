// 밸런스 시뮬레이터 (개발용, 게임 동작과 무관)
// game.js의 핵심 수식을 그대로 복제해 헤드리스로 육성/전투를 수천 판 돌린다.
// 실행: node sim.js   /   POLICY=balanced node sim.js
const POLICY = process.env.POLICY || "balanced";
const DMG_K = Number(process.env.DMG_K || 0.6);

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- game.js와 동일한 상수/수식 ----
const SPECIES = {
  ember: { type: "fire",     base: { atk: 12, def: 8,  spd: 9,  hp: 60 }, primary: "atk" },
  aqua:  { type: "water",    base: { atk: 8,  def: 13, spd: 7,  hp: 80 }, primary: "def" },
  spark: { type: "electric", base: { atk: 10, def: 7,  spd: 14, hp: 55 }, primary: "spd" },
};
const BEATS = { water: "fire", fire: "electric", electric: "water" };
const TYPE_ADV = 1.12, TYPE_DIS = 0.90;
function typeMult(a, d) {
  if (BEATS[a] === d) return TYPE_ADV;
  if (BEATS[d] === a) return TYPE_DIS;
  return 1;
}
// 종 패시브
const PASSIVE = {
  fire:     { dmgDealt: 1.06 },
  water:    { dmgTaken: 0.92 },
  electric: { evaBonus: 0.10 },
};
const SKILL_KITS = {
  fire: [
    { id: "f_basic", type: "fire", power: 1.0, cd: 0 },
    { id: "f_strike", type: "fire", power: 1.28, cd: 2 },
    { id: "f_overheat", type: "fire", power: 1.1, cd: 3, buffAtk: { mult: 1.2, turns: 2 } },
  ],
  water: [
    { id: "w_basic", type: "water", power: 1.0, cd: 0 },
    { id: "w_shield", type: "water", power: 0.85, cd: 3, shield: { reduce: 0.25, turns: 2 } },
    { id: "w_heal", type: "water", power: 0.8, cd: 4, heal: 0.12 },
  ],
  electric: [
    { id: "e_basic", type: "electric", power: 1.0, cd: 0 },
    { id: "e_thrust", type: "electric", power: 1.25, cd: 2, speedScale: 1.28 },
    { id: "e_chain", type: "electric", power: 1.0, cd: 3, extraHit: { chance: 0.4, power: 0.55 } },
  ],
};
const expToNext = (level) => 80 + level * 40;
const PW = { hp: 0.5, atk: 1.75, def: 1.70, spd: 1.75 };
const power = (p) => Math.round(p.hp * PW.hp + p.atk * PW.atk + p.def * PW.def + p.spd * PW.spd);

// ---- 육성 시뮬레이션 ----
function gainExp(t, amount) {
  t.exp += amount;
  while (t.exp >= expToNext(t.level)) {
    t.exp -= expToNext(t.level);
    t.level += 1;
    t.atk += 2; t.def += 2; t.spd += 1; t.hp += 8;
  }
}
function trainOnce(t, kind) {
  const condition = (t.food / 100) * 0.5 + (t.happy / 100) * 0.5;
  const streakBonus = 1 + Math.min(t.streak - 1, 14) * 0.03;
  const mult = (0.6 + condition * 0.8) * streakBonus;
  if (kind === "feed") { t.food = clamp(t.food + rand(22, 32), 0, 100); t.hp += rand(2, 4); gainExp(t, 6); }
  else if (kind === "play") { t.happy = clamp(t.happy + rand(18, 28), 0, 100); t.spd += Math.round(rand(0, 1) * mult); gainExp(t, 8); }
  else {
    const gain = Math.max(1, Math.round(rand(2, 4) * mult));
    t[kind] += gain;
    t.food = clamp(t.food - 8, 0, 100);
    t.happy = clamp(t.happy - 5, 0, 100);
    gainExp(t, 14);
  }
}
function raise(speciesKey, days) {
  const sp = SPECIES[speciesKey];
  const t = { ...sp.base, level: 1, exp: 0, food: 70, happy: 70, streak: 1, species: speciesKey };
  for (let d = 1; d <= days; d++) {
    for (let a = 0; a < 5; a++) {
      if (t.food < 55) trainOnce(t, "feed");
      else if (t.happy < 45) trainOnce(t, "play");
      else if (POLICY === "balanced") trainOnce(t, ["atk", "def", "spd"][a % 3]);
      else trainOnce(t, sp.primary);
    }
    t.streak += 1;
    t.food = clamp(t.food - 18, 0, 100);
    t.happy = clamp(t.happy - 6, 0, 100);
  }
  return t;
}

// ---- 전투 엔진 (game.js와 동일 로직) ----
function buildFighter(base) {
  const p = PASSIVE[base.type] || {};
  return Object.assign({}, base, {
    kit: SKILL_KITS[base.type], cd: {}, atkBuffTurns: 0, atkBuffMult: 1, shieldTurns: 0, shieldReduce: 0,
    pDmgDealt: p.dmgDealt || 1, pDmgTaken: p.dmgTaken || 1, pEva: p.evaBonus || 0,
  });
}
function upkeep(f) {
  for (const k in f.cd) if (f.cd[k] > 0) f.cd[k]--;
  if (f.atkBuffTurns > 0 && --f.atkBuffTurns === 0) f.atkBuffMult = 1;
  if (f.shieldTurns > 0 && --f.shieldTurns === 0) f.shieldReduce = 0;
}
function chooseSkill(self) {
  const ready = self.kit.filter((s) => (self.cd[s.id] || 0) === 0);
  const heal = ready.find((s) => s.heal);
  if (heal && self.hp < self.maxHp * 0.4) return heal;
  const shield = ready.find((s) => s.shield);
  if (shield && self.shieldTurns === 0 && Math.random() < 0.5) return shield;
  return ready.reduce((best, s) => (s.power > best.power ? s : best), ready[0]);
}
// 회피: 방어자 spd 우위 + 전기 패시브, 상한 22%
function evades(atkr, dfdr) {
  let ev = clamp((dfdr.spd - atkr.spd) * 0.0020, -0.08, 0.22) + dfdr.pEva;
  return Math.random() < Math.min(ev, 0.27);
}
// 비율형 방어 데미지식 + 상성 + 패시브 + 방어태세
function skillDamage(atkr, dfdr, skill) {
  let pw = skill.power;
  if (skill.speedScale && atkr.spd > dfdr.spd) pw = skill.speedScale;
  const atkVal = atkr.atk * atkr.atkBuffMult * (rand(85, 115) / 100);
  let raw = (atkVal * pw * DMG_K * 100) / (100 + dfdr.def * 0.8);
  raw *= typeMult(skill.type, dfdr.type) * atkr.pDmgDealt * dfdr.pDmgTaken;
  if (dfdr.shieldTurns > 0) raw *= 1 - dfdr.shieldReduce;
  return Math.max(1, Math.round(raw));
}
function firstMover(me, foe) {
  return me.spd > foe.spd ? "me" : foe.spd > me.spd ? "foe" : (Math.random() < 0.5 ? "me" : "foe");
}
// 한 판: me 승리면 true. round 반환은 length 측정용으로 obj 반환.
function runMatch(me, foe) {
  let turn = firstMover(me, foe), round;
  for (round = 1; round <= 80; round++) {
    const atkr = turn === "me" ? me : foe, dfdr = turn === "me" ? foe : me;
    upkeep(atkr);
    const skill = chooseSkill(atkr);
    atkr.cd[skill.id] = skill.cd;
    if (!evades(atkr, dfdr)) {
      dfdr.hp -= skillDamage(atkr, dfdr, skill);
      if (skill.extraHit && dfdr.hp > 0 && Math.random() < skill.extraHit.chance && !evades(atkr, dfdr))
        dfdr.hp -= skillDamage(atkr, dfdr, { type: skill.type, power: skill.extraHit.power });
    }
    if (skill.buffAtk) { atkr.atkBuffTurns = skill.buffAtk.turns; atkr.atkBuffMult = skill.buffAtk.mult; }
    if (skill.shield) { atkr.shieldTurns = skill.shield.turns; atkr.shieldReduce = skill.shield.reduce; }
    if (skill.heal) atkr.hp = Math.min(atkr.maxHp, atkr.hp + Math.round(atkr.maxHp * skill.heal));
    if (dfdr.hp <= 0) return { win: turn === "me", round };
    turn = turn === "me" ? "foe" : "me";
  }
  return { win: me.hp >= foe.hp, round };
}
function fighterFrom(t) {
  const maxHp = t.hp + t.level * 6;
  return buildFighter({ type: SPECIES[t.species].type, atk: t.atk, def: t.def, spd: t.spd, hp: maxHp, maxHp });
}
function fixedFighter(speciesKey) {
  return buildFighter({ type: SPECIES[speciesKey].type, atk: 70, def: 70, spd: 70, hp: 200, maxHp: 200 });
}

// 라이벌 생성 (game.js makeOpponent과 동일: 배분 합=1 정규화, factor 0.82~1.12)
let lastUnfav = false;
function pickFoeType(myType, strong) {
  const iBeat = BEATS[myType];
  const beatsMe = Object.keys(BEATS).find((k) => BEATS[k] === myType);
  const r = Math.random();
  let type = r < 0.40 ? iBeat : r < 0.75 ? myType : beatsMe;
  if (type === beatsMe && (lastUnfav || strong)) type = Math.random() < 0.5 ? iBeat : myType;
  lastUnfav = type === beatsMe;
  return type;
}
function makeOpponent(myPower, myType) {
  const factor = rand(80, 108) / 100;
  const tp = Math.max(40, Math.round(myPower * factor));
  const type = pickFoeType(myType, factor >= 1.05);
  const sh = { hp: rand(23, 31), atk: rand(26, 35), def: rand(19, 27), spd: rand(15, 22) };
  const sum = sh.hp + sh.atk + sh.def + sh.spd;
  const stat = (k) => Math.round(((sh[k] / sum) * tp) / PW[k]);
  const maxHp = Math.max(40, stat("hp"));
  return buildFighter({ type, atk: Math.max(6, stat("atk")), def: Math.max(4, stat("def")), spd: Math.max(4, stat("spd")), hp: maxHp, maxHp });
}

// ---- 리포트 ----
const keys = ["ember", "aqua", "spark"];
const label = { ember: "불(공격)", aqua: "물(방어)", spark: "전기(속도)" };
const days = 14;
console.log(`(육성 정책: ${POLICY})\n`);

console.log("=== 성장 곡선 (전투력) ===");
console.log("Day :  " + keys.map((k) => label[k].padStart(10)).join(""));
for (const d of [3, 7, 14, 21, 30]) {
  const row = keys.map((k) => { let s = 0; for (let i = 0; i < 200; i++) s += power(raise(k, d)); return String(Math.round(s / 200)).padStart(10); });
  console.log(("D" + d).padEnd(5) + ":  " + row.join(""));
}

console.log("\n=== 14일 평균 스탯 ===");
for (const k of keys) {
  let s = { atk: 0, def: 0, spd: 0, hp: 0, level: 0 };
  for (let i = 0; i < 300; i++) { const t = raise(k, days); s.atk += t.atk; s.def += t.def; s.spd += t.spd; s.hp += t.hp; s.level += t.level; }
  console.log(`${label[k].padEnd(11)}: Lv${(s.level / 300).toFixed(1)} atk${Math.round(s.atk / 300)} def${Math.round(s.def / 300)} spd${Math.round(s.spd / 300)} hp${Math.round(s.hp / 300)}`);
}

console.log("\n=== 동일 스탯(70/70/70, hp200) 순수 전투 (행=공격측, %) ===");
const N = 4000;
console.log("        vs " + keys.map((k) => label[k].padStart(11)).join(""));
for (const a of keys) {
  const row = keys.map((b) => { let w = 0; for (let i = 0; i < N; i++) if (runMatch(fixedFighter(a), fixedFighter(b)).win) w++; return ((w / N * 100).toFixed(1) + "%").padStart(11); });
  console.log(label[a].padEnd(11) + ":" + row.join(""));
}

console.log("\n=== 실전 아레나: 14일 육성 후 파워스케일 라이벌 (매칭유형별 분해) ===");
for (const k of keys) {
  const myType = SPECIES[k].type;
  const tally = { fav: [0, 0], neu: [0, 0], unf: [0, 0], all: [0, 0] }; // [wins, count]
  const M = 12000;
  for (let i = 0; i < M; i++) {
    const t = raise(k, days);
    const foe = makeOpponent(power(t), myType);
    const m = typeMult(myType, foe.type);
    const rel = m > 1 ? "fav" : m < 1 ? "unf" : "neu";
    const win = runMatch(fighterFrom(t), foe).win ? 1 : 0;
    tally[rel][0] += win; tally[rel][1]++;
    tally.all[0] += win; tally.all[1]++;
  }
  const pct = ([w, c]) => c ? (w / c * 100).toFixed(0) + "%" : "-";
  const share = ([, c]) => (c / M * 100).toFixed(0) + "%";
  console.log(`${label[k].padEnd(11)}: 종합 ${pct(tally.all).padStart(4)} | 유리 ${pct(tally.fav).padStart(4)}(${share(tally.fav)}) 중립 ${pct(tally.neu).padStart(4)}(${share(tally.neu)}) 불리 ${pct(tally.unf).padStart(4)}(${share(tally.unf)})`);
}

console.log("\n=== 전투 길이/타임아웃 (랜덤 매칭) ===");
{
  let tt = 0, to = 0, M = 6000;
  for (let i = 0; i < M; i++) {
    const a = keys[rand(0, 2)], b = keys[rand(0, 2)];
    const r = runMatch(fighterFrom(raise(a, days)), fighterFrom(raise(b, days)));
    tt += r.round; if (r.round > 80) to++;
  }
  console.log(`평균 ${(tt / M).toFixed(1)}턴, 타임아웃 ${(to / M * 100).toFixed(1)}%`);
}
