# Monster Arena — 모바일 빌드 가이드

## 환경
- WSL2(Linux): npm, npx까지 가능. Android SDK 없어 네이티브 빌드 불가.
- 네이티브 빌드는 Windows/Mac의 Android Studio에서 진행.

## WSL에서 준비(이미 완료된 경우 skip)
```
npm install
npx cap add android
npx cap sync
```
npx cap add android 는 SDK 없이도 android/ gradle 프로젝트를 생성한다. 빌드는 Studio에서.

## Android Studio 빌드
1. Android Studio 실행
2. File > Open > android/ 폴더 선택
3. Gradle Sync 완료 대기
4. 기기/에뮬레이터 선택 후 Run

## 온라인 PvP 서버 설정
www/config.js의 API_BASE를 수정:
- 오프라인(AI): API_BASE: ""
- 로컬 서버: API_BASE: "http://192.168.0.10:3000"
- 배포 서버: API_BASE: "https://your-server.example.com"

http 서버 접근 시 android/app/src/main/AndroidManifest.xml에 아래 속성 필요:
android:usesCleartextTraffic="true"

## 파일 구조
- www/          웹 자산 (Capacitor webDir)
- server/       Node http 서버 (개발/셀프호스팅용)
- android/      Capacitor Android 프로젝트 (Android Studio로 빌드)
- capacitor.config.json
- www/config.js API_BASE 설정

## 추천 빌드 경로
로컬 Android Studio. android/ 폴더 열면 즉시 빌드 가능.

## 앱 아이콘 / 스플래시
소스 이미지는 `assets/icon.png`(1024) `assets/splash.png`(2732)에 있다.
(재생성: `node scripts/generate-icons.js`)
android/ 생성 후 전 해상도 자동 적용:
```
npm i -D @capacitor/assets
npx @capacitor/assets generate --android
```

## cap sync
웹 자산 수정 후 반드시 실행:
npm run cap:sync

## 이번 스캐폴딩 실행 기록
- `npm install`: 현재 샌드박스의 네트워크 제한으로 120초 동안 응답이 없어 타임아웃됨.
- `npx cap add android`: 실패.
  - 오류: `EAI_AGAIN getaddrinfo registry.npmjs.org`
  - 원인: npm registry DNS 조회 실패.
- `npx cap sync`: `android/` 폴더가 생성되지 않아 스킵.
- `android/app/src/main/AndroidManifest.xml`: 파일이 없어 자동 수정 스킵. Android 프로젝트 생성 후 `<application>` 태그에 `android:usesCleartextTraffic="true"`를 수동 확인.
