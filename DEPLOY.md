# Monster Arena 서버 배포 가이드

> 두 가지 경로: **(A) 기존 EC2에 직접 배포(추천 — 상시 가동·디스크 영속)** / (B) Render(아래 별도 섹션).

## EC2 배포 (JSON 저장, systemd + nginx) — 추천

이미 다른 게임이 도는 EC2에 **별도 포트 + 서브도메인**으로 얹는다. 무의존성 Node라 빌드 불필요, EBS 디스크라 JSON 데이터가 재시작에도 보존된다.

준비 파일: `deploy/monster-arena.service`(systemd), `deploy/nginx-monster-arena.conf`(nginx). 두 파일 안의 `<USER>`/경로/포트(3001)/도메인을 본인 환경에 맞게 수정.

```bash
# 1) 코드 가져오기 (예: ec2-user 홈)
cd ~ && git clone https://github.com/<본인>/monster-arena.git
cd monster-arena

# 2) Node 20 설치 (없으면) — Amazon Linux/Ubuntu 예시 (nodesource)
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -   # Ubuntu면 deb.nodesource.com
sudo yum install -y nodejs   # Ubuntu: sudo apt install -y nodejs
which node                    # 경로를 .service의 ExecStart에 반영

# 3) systemd 서비스 등록 (.service 안의 User/경로/PORT/DATA_FILE 확인)
sudo cp deploy/monster-arena.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now monster-arena
journalctl -u monster-arena -f   # 로그 확인 (포트 3001 가동 확인)

# 4) nginx 프록시 + TLS (server_name을 본인 서브도메인으로, DNS A레코드는 EC2 IP)
sudo cp deploy/nginx-monster-arena.conf /etc/nginx/conf.d/monster-arena.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d arena.example.com   # 443/TLS 자동 구성

# 5) 확인
curl https://arena.example.com/health
```

**보안그룹**: 80/443만 외부 개방. 노드 포트(3001)는 SG에서 막아 외부 비공개(요청은 nginx만 거쳐 들어옴). CORS `*`는 웹 same-origin + 모바일 앱 접근 위해 유지.

**데이터**: `DATA_FILE=/home/ec2-user/monster-arena-data/data.json`(체크아웃 밖). 서버가 디렉터리 자동 생성. EBS라 재시작에도 보존. 백업하려면 이 파일만 주기적으로 복사.

**업데이트**: `git pull && sudo systemctl restart monster-arena` (DATA_FILE이 체크아웃 밖이라 데이터 안전).

**모바일 연결**: `www/config.js`의 `API_BASE`를 `https://arena.example.com`으로.

---

## (대안) 플랫폼: Render

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
