export const meta = {
  name: 'i18n-ja-zh',
  description: 'Translate Monster Arena strings to Japanese + Chinese (parallel batches, ko+en reference)',
  phases: [
    { title: 'Translate', detail: '8 parallel batches → ja + zh with glossaries' },
  ],
}

// 배치 파일 /tmp/ma-bi-{0..7}.json : [{ko, en}, ...]. 에이전트가 직접 Read.
const N = 8

const GLOSSARY = `This is a Korean monster-raising + PvP mobile game (Monster Arena) for a Google Play release.
You are given each string in Korean (ko) WITH its finished English (en) translation as reference.
Produce a Japanese (ja) and Simplified Chinese (zh) translation for each.

RULES (critical):
- Preserve EVERY placeholder token EXACTLY: \${a}, \${state.name}, {name}, etc. Do not translate, reorder, or alter the braces or the identifier inside.
- Preserve emoji, leading/trailing punctuation, and any HTML tags (<div class="...">, <b>, <span>, <button ...>) byte-for-byte; only translate the human-readable text between/around them.
- Preserve newlines (\\n) where present.
- Tone: concise mobile-game UI text (buttons, toasts, labels). Match the brevity of the English.

Fixed terminology:
JAPANESE (ja):
모ンスター아레나=モンスターアリーナ; 전투력=戦闘力; 스태미너=スタミナ; 코인=コイン; 레이팅=レーティング;
포만감=満腹度; 행복도=幸福度; 공격=攻撃; 방어=防御; 속도=速度; 체력=HP;
부화=ふ化; 알=タマゴ; 환생=転生; 진화=進化; 종족=種族; 출석=ログインボーナス; 퀘스트=クエスト; 업적=実績;
도감=図鑑; 룰렛=ルーレット; 상점=ショップ; 칭호=称号; 모자=帽子; 아레나=アリーナ; 매칭=マッチング;
전투/대전=バトル; 승=勝; 패=敗; 보스=ボス; 토너먼트=トーナメント; 시즌=シーズン; 랭킹/리더보드=ランキング;
친구=フレンド; 도발=挑発; 친선전=親善試合; 선물=ギフト; 쓰다듬기=なでる; 산책=お散歩; 회피=回避; 중독=毒; 실드=シールド;
브론즈/실버/골드/플래티넘/챔피언=ブロンズ/シルバー/ゴールド/プラチナ/チャンピオン; 아기/청소년/성체=ベビー/ティーン/アダルト
CHINESE (zh, Simplified):
몬스터아레나=怪兽竞技场; 전투력=战斗力; 스태미너=体力; 코인=金币; 레이팅=评分;
포만감=饱食度; 행복도=幸福度; 공격=攻击; 방어=防御; 속도=速度; 체력=HP;
부화=孵化; 알=蛋; 환생=转生; 진화=进化; 종족=种族; 출석=签到; 퀘스트=任务; 업적=成就;
도감=图鉴; 룰렛=转盘; 상점=商店; 칭호=称号; 모자=帽子; 아레나=竞技场; 매칭=匹配;
전투/대전=战斗; 승=胜; 패=负; 보스=Boss; 토너먼트=锦标赛; 시즌=赛季; 랭킹/리더보드=排行榜;
친구=好友; 도발=挑衅; 친선전=友谊赛; 선물=礼物; 쓰다듬기=抚摸; 산책=散步; 회피=闪避; 중독=中毒; 실드=护盾;
브론즈/실버/골드/플래티넘/챔피언=青铜/白银/黄金/铂金/冠军; 아기/청소년/성체=幼年/少年/成年`

const SCHEMA = {
  type: 'object',
  properties: {
    pairs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { ko: { type: 'string' }, ja: { type: 'string' }, zh: { type: 'string' } },
        required: ['ko', 'ja', 'zh'],
      },
    },
  },
  required: ['pairs'],
}

const idx = Array.from({ length: N }, (_, i) => i)
const results = await parallel(idx.map((i) => () =>
  agent(
    `${GLOSSARY}\n\nSTEP 1: Read /tmp/ma-bi-${i}.json — a JSON array of { ko, en }.\n` +
    `STEP 2: For each entry, output { ko (verbatim), ja, zh }. Do not skip any entry.`,
    { label: `ja-zh:batch${i}`, phase: 'Translate', schema: SCHEMA }
  )
))

const ja = {}, zh = {}
results.filter(Boolean).forEach((r) => (r.pairs || []).forEach((p) => {
  if (p && p.ko != null) { ja[p.ko] = p.ja; zh[p.ko] = p.zh }
}))
log(`ja: ${Object.keys(ja).length} | zh: ${Object.keys(zh).length}`)
return { ja, zh, jaCount: Object.keys(ja).length, zhCount: Object.keys(zh).length }
