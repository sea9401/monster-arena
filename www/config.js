// API 서버 주소. 네이티브 앱(Capacitor)은 https://localhost에서 로드되므로
// 반드시 절대 URL이 필요하다(빈 값이면 앱은 오프라인 AI 폴백만 동작).
// 웹(arena.msmsge.com)에서도 같은 오리진이라 그대로 동작한다.
// 셀프호스팅 시 이 값만 본인 서버 주소로 바꾸면 됨.
window.APP_CONFIG = {
  API_BASE: "https://arena.msmsge.com",
  // AdMob 보상형 광고 단위 ID. 아래는 구글 공식 "테스트" ID(항상 테스트 광고만 표시).
  // ⚠️ 출시 전 본인 AdMob의 실제 보상형 광고 단위 ID로 교체할 것.
  //    (앱 ID는 android/app/src/main/AndroidManifest.xml의 APPLICATION_ID meta-data)
  ADMOB_REWARDED_ID: "ca-app-pub-3940256099942544/5224354917",
};
