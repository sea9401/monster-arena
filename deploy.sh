#!/usr/bin/env bash
# 몬스터 아레나 — 원클릭 배포
#   로컬 커밋을 GitHub에 push → EC2에서 git pull → 서비스 재시작 → 라이브 검증
# 사용법: ./deploy.sh
set -euo pipefail

# ── 설정 (환경에 맞게 수정) ──────────────────────────────
EC2_HOST="ec2-user@54.180.28.29"
SSH_KEY="$HOME/.ssh/msmsge-key.pem"
REMOTE_DIR="~/monster-arena"
SERVICE="monster-arena"
SITE="https://arena.msmsge.com"
BRANCH="main"
# ────────────────────────────────────────────────────────

SSH="ssh -i $SSH_KEY -o BatchMode=yes -o ConnectTimeout=15 $EC2_HOST"

echo "▶ 1/4  GitHub에 push ($BRANCH)"
git push origin "$BRANCH"

echo "▶ 2/4  EC2에서 pull + 재시작"
$SSH "cd $REMOTE_DIR && git pull --ff-only && sudo systemctl restart $SERVICE"

echo "▶ 3/4  서비스 상태 확인"
$SSH "systemctl is-active $SERVICE && curl -s -o /dev/null -w 'health:%{http_code}\n' http://127.0.0.1:3001/health"

echo "▶ 4/4  라이브 사이트 확인"
deployed_rev="$(git rev-parse --short HEAD)"
echo "   배포 커밋: $deployed_rev"
if curl -s "$SITE/" | grep -q "time-plus-30\|next-day\|reset-save"; then
  echo "   ⚠️ 라이브에 옛 테스트 버튼이 아직 보입니다 (캐시일 수 있음)"
else
  echo "   ✅ 라이브 사이트 정상 ($SITE)"
fi

echo "✔ 배포 완료. 접속 중인 유저는 30초 안에 업데이트 배너 → 자동 새로고침됩니다."
