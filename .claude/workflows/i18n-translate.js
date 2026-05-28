export const meta = {
  name: 'i18n-translate',
  description: 'Translate Monster Arena Korean game strings to English (parallel batches + consistency review)',
  phases: [
    { title: 'Translate', detail: '8 parallel batches ko→en with shared glossary' },
    { title: 'Review', detail: 'consistency pass over merged dictionary' },
  ],
}

// 배치 파일은 /tmp/ma-i18n-batch-{0..7}.json (각 [{ko,ctx},...]). 에이전트가 직접 Read.
const N = 8

const GLOSSARY = `Fixed terminology (use EXACTLY these, keep any emoji in place):
- 몬스터 아레나 = Monster Arena
- 전투력 = Power ; 스태미너 = Stamina ; 코인 = coins ; 레이팅 = Rating
- 포만감 = Fullness ; 행복도 = Happiness ; 경험치/EXP = EXP
- 공격 = ATK ; 방어 = DEF ; 속도 = SPD ; 체력 = HP
- 부화 = Hatch ; 알 = Egg ; 환생 = Rebirth ; 진화 = Evolve ; 종족/종 = Species
- 연속 출석 = check-in streak ; 출석 = check-in ; 퀘스트 = Quest ; 업적 = Achievement
- 도감 = Encyclopedia ; 룰렛 = Roulette ; 상점 = Shop ; 칭호 = Title ; 모자 = Hat
- 아레나 = Arena ; 매칭 = Match ; 대전/전투 = Battle ; 승 = Win ; 패 = Loss
- 보스 = Boss ; 토너먼트 = Tournament ; 시즌 = Season ; 랭킹/리더보드 = Ranking/Leaderboard
- 친구 = Friend ; 도발 = Taunt ; 친선전 = Friendly match ; 선물 = Gift ; 쓰다듬기 = Pet
- 산책 = Walk ; 회피 = Dodge ; 중독 = Poison ; 실드/방패 = Shield
- 브론즈/실버/골드/플래티넘/챔피언 = Bronze/Silver/Gold/Platinum/Champion
- 아기 = Baby ; 성장기 = Teen ; 성체 = Adult (evolution stages)
Tone: concise mobile-game UI English. Keep it short — these are buttons, toasts, labels.
Preserve {placeholder} tokens EXACTLY (do not translate or reorder their braces).
Preserve leading/trailing emoji and punctuation.`

const SCHEMA = {
  type: 'object',
  properties: {
    pairs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { ko: { type: 'string' }, en: { type: 'string' } },
        required: ['ko', 'en'],
      },
    },
  },
  required: ['pairs'],
}

const idx = Array.from({ length: N }, (_, i) => i)
const results = await parallel(idx.map((i) => () =>
  agent(
    `You are localizing a Korean monster-raising/PvP mobile game (Monster Arena) into English for a Google Play release.\n\n` +
    `STEP 1: Read the file /tmp/ma-i18n-batch-${i}.json — it is a JSON array of objects { ko, ctx }.\n` +
    `STEP 2: Translate each "ko" Korean string to natural, concise English UI text. "ctx" is the source line where it's used (for disambiguation only — translate the ko value, not ctx).\n\n` +
    GLOSSARY +
    `\n\nReturn one pair per input with the ORIGINAL ko verbatim as the key. Do not skip any.`,
    { label: `translate:batch${i}`, phase: 'Translate', schema: SCHEMA }
  )
))

const merged = {}
results.filter(Boolean).forEach((r) => (r.pairs || []).forEach((p) => { if (p && p.ko != null) merged[p.ko] = p.en }))
log(`merged ${Object.keys(merged).length} translations`)

const review = await agent(
  `You are a localization QA reviewer for a Korean→English mobile game dictionary.\n` +
  GLOSSARY +
  `\n\nBelow is the full ko→en dictionary as JSON. Find entries that (a) violate the fixed glossary, (b) translate a recurring game term inconsistently vs other entries, or (c) are awkward/wrong for short UI text. ` +
  `Return ONLY the entries you would change, as pairs with the original ko key and corrected en. If all fine, return empty pairs.\n\n` +
  `Dictionary (JSON):\n${JSON.stringify(merged)}`,
  { label: 'review:consistency', phase: 'Review', schema: SCHEMA }
)
let fixes = 0
if (review && review.pairs) review.pairs.forEach((p) => { if (p && p.ko != null && merged[p.ko] !== p.en) { merged[p.ko] = p.en; fixes++ } })
log(`review applied ${fixes} corrections`)

return { dict: merged, count: Object.keys(merged).length }
