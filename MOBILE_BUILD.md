# Monster Arena — 모바일 앱 빌드 가이드 (Capacitor / Android)

웹 자산(`www/`)을 그대로 네이티브 앱으로 감싼다. 서버는 이미 https://arena.msmsge.com 에
배포돼 있고, `www/config.js`의 `API_BASE`가 그 주소로 설정돼 있어 **앱은 첫 실행부터 라이브
서버(PvP·랭킹·친구·보스)에 붙는다.** 언어도 기기 설정에 따라 한/영/일/중 자동 선택된다.

## 환경
- 코드 작성/동기화(npm·npx)는 어디서든 가능. **네이티브 빌드는 Android Studio(Windows/Mac)** 필요.
- WSL에는 Android SDK/Java/gradle가 없어 빌드 불가 — `android/` 생성·동기화까지만 하고 빌드는 Studio에서.
- (WSL은 npm registry 접근이 막혀 있을 수 있음 → 인터넷 되는 환경에서 `npm install` 수행.)

## 1. 의존성 설치 + Android 프로젝트 생성 (인터넷 되는 PC에서)
```
npm install
npx cap add android      # android/ gradle 프로젝트 생성 (SDK 없어도 생성은 됨)
npx cap sync             # www/ + 플러그인을 android/로 복사
```

## 2. 앱 아이콘 / 스플래시 (전 해상도 자동 생성)
소스 이미지: `assets/icon.png`(1024) · `assets/splash.png`(2732). (재생성: `node scripts/generate-icons.js`)
```
npx @capacitor/assets generate --android
```

## 3. Android Studio에서 빌드/실행
1. Android Studio → File > Open → `android/` 폴더 선택
2. Gradle Sync 완료 대기
3. 기기/에뮬레이터 선택 후 Run ▶

## 4. 웹 자산 수정 후
`www/` 내용을 바꿨으면 반드시 동기화:
```
npm run cap:sync         # = npx cap sync
```

## 서버 주소(API_BASE)
- 기본값: `www/config.js` → `https://arena.msmsge.com` (라이브). **그대로 두면 됨.**
- 셀프호스팅: 이 값만 본인 서버 https 주소로 변경.
- **HTTPS라 cleartext 설정 불필요.** (만약 `http://` 평문 서버를 쓴다면 그때만
  `android/app/src/main/AndroidManifest.xml`의 `<application>`에 `android:usesCleartextTraffic="true"` 추가.)

## 네이티브 동작(웹과 다른 점, 이미 코드에 반영됨)
- `IS_NATIVE`(window.Capacitor 감지)로 분기:
  - 서비스워커/버전 자동-새로고침 배너는 **웹 전용** → 앱에선 스킵(번들 자산이라 무의미).
  - 안드로이드 **하드웨어 뒤로가기** → 앱 종료 대신 모달 닫기/홈 이동(@capacitor/app `backButton`).
  - **세로 모드 고정** → 시작 시 `@capacitor/screen-orientation`로 portrait 잠금(런타임 보강).
- 웹 푸시(🔔 알림)는 네이티브 웹뷰에서 `PushManager` 미지원 → 설정에서 "미지원"으로 표시(정상).
  네이티브 푸시가 필요하면 `@capacitor/push-notifications` + FCM 별도 작업.

## 세로 모드 고정 (1차 방어 — AndroidManifest)
런타임 잠금만으로도 동작하지만, 회전 순간의 깜빡임을 없애려면 `android/` 생성 후
`android/app/src/main/AndroidManifest.xml`의 `<activity ... android:name=".MainActivity">`에 추가:
```
android:screenOrientation="portrait"
```

## 버전 표기
- 앱 내 표기: ⚙️ 설정 하단 `Monster Arena v1.0.0 · App`.
- 값은 `www/game.js`의 `APP_VERSION` 상수. **릴리스마다 갱신**하고,
  `android/app/build.gradle`의 `versionName`/`versionCode`(Play 업로드용)과 동기화 권장.

## Play Store 배포(요약)
1. Android Studio → Build > Generate Signed Bundle/APK → **Android App Bundle(.aab)**
2. 업로드 키스토어 생성·보관(분실 시 업데이트 불가).
3. Play Console에서 앱 생성 → .aab 업로드 → 스토어 등록정보(스크린샷/설명/개인정보처리방침) 작성.
4. `appId`(패키지명): `com.monstera.arena` — 한 번 정하면 변경 불가.
5. iOS는 Mac + Xcode 필요(`npx cap add ios`).

## 파일 구조
- `www/`            웹 자산 (Capacitor webDir)
- `www/config.js`   API_BASE (= https://arena.msmsge.com)
- `server/`         Node http 서버 (셀프호스팅/개발용)
- `android/`        Capacitor Android 프로젝트 (Studio로 빌드)
- `capacitor.config.json`  appId/appName/webDir/배경색
