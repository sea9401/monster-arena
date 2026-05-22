# Monster Arena 서버 배포 가이드

## 플랫폼 추천: Render

| 항목 | Render | Fly.io | Railway |
| --- | --- | --- | --- |
| 무의존성 Node 서버 | 적합 | 적합 | 적합 |
| 친구 수십 명 규모 | 적합 | 적합 | 적합 |
| HTTPS 자동 | 지원 | 지원 | 지원 |
| JSON 파일 영속 | Hobby 플랜 Persistent Disk | Volume 설정 필요 | Volume/서비스 스토리지 설정 필요 |
| git 없이 CLI deploy | Blueprint/CLI 가능, GitHub 연동이 가장 쉬움 | CLI 배포 강함 | CLI/GitHub 가능 |
| 무료/저가 티어 | 무료 가능, 디스크는 Hobby 필요 | 저가 사용량 기반 | 무료/크레딧 정책 변동 가능 |

최종 추천: Render. 이유는 자동 HTTPS, GitHub 연동 또는 CLI 배포, Hobby 플랜에서 월 비용으로 persistent disk 사용 가능, 무료 플랜은 15분 슬립이 있지만 프로토타입에 수용 가능하기 때문입니다. 무료 플랜 콜드스타트는 보통 첫 요청에 약 30초 지연될 수 있습니다.

## 데이터 영속성

- 무료 플랜: `DATA_FILE`을 설정하지 않으면 `server/data.json`에 저장됩니다. 인스턴스가 사는 동안은 유지되지만 재시작/재배포 시 초기화됩니다(프로토타입 수용). 시드 고스트는 매번 재생성되니 매칭은 계속 됩니다.
- Hobby 플랜(영속): `render.yaml`의 `disk` 블록과 `DATA_FILE` env **둘 다** 주석 해제하면 `/var/data`에 영구 저장됩니다.
- `DATA_FILE`을 env로 분리해 두어 마운트 경로만 바꾸면 대응됩니다(서버가 해당 디렉터리를 자동 생성).

## 콜드스타트 (무료 플랜 슬립)

- 15분 비활성 시 슬립, 첫 요청은 약 30초 지연 가능.
- 게임에 오프라인 AI 폴백이 있으므로 초기화 중 AI 모드로 플레이 가능 → 친구 규모 프로토타입에서는 수용 가능.
- 대응 필요 시: UptimeRobot 등으로 14분마다 `/health` 핑(무료).

## 배포 절차 (git 없이 Render CLI)

1. `git init && git add -A && git commit -m 'initial'`
2. GitHub 레포 생성 후 push 또는 Render CLI 사용: `render blueprint apply`
3. Render 대시보드에서 New Web Service → GitHub 연결 → `render.yaml` 자동 감지 (무료 플랜은 추가 env 설정 불필요)
4. 배포 URL, 예: `https://monster-arena.onrender.com` 으로 접속하면 웹에서 바로 플레이 가능
5. 모바일 앱은 `www/config.js`의 `API_BASE`를 그 URL로 설정
6. `https://<배포URL>/health` 로 동작 확인

## 보안 체크리스트

- CORS `*` 유지: 웹 same-origin + 모바일 앱 접근 필요하므로 현 단계 수용. 추후 origin 화이트리스트 권장.
- 레이트리밋/스냅샷 가드 이미 구현됨.
- `NODE_ENV=production` 설정.
- `.env` 파일 git 제외(`.gitignore` 포함).
- HTTPS: Render 자동 제공(TLS).
- 추가 권장: `/admin` 류 엔드포인트가 생기면 토큰 인증 추가.

## 파일 변경 요약

- `server/server.js`: `DATA_FILE` 환경변수 지원 추가.
- `package.json`: `npm start`와 Node 20 이상 엔진 조건 추가.
- `render.yaml`: Render Web Service 배포 설정 추가.
- `.gitignore`: 로컬 데이터/로그/환경파일 제외.
- `DEPLOY.md`: Render 중심 배포 및 운영 안내.
