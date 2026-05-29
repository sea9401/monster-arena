// API 서버 주소. 네이티브 앱(Capacitor)은 https://localhost에서 로드되므로
// 반드시 절대 URL이 필요하다(빈 값이면 앱은 오프라인 AI 폴백만 동작).
// 웹(arena.msmsge.com)에서도 같은 오리진이라 그대로 동작한다.
// 셀프호스팅 시 이 값만 본인 서버 주소로 바꾸면 됨.
window.APP_CONFIG = {
  API_BASE: "https://arena.msmsge.com",

  // AdMob 보상형 전면(Rewarded Interstitial) 광고 단위 ID.
  // 현재는 구글 공식 "테스트" ID(항상 테스트 광고만 표시) — 개발/테스트 중 유지.
  // ⚠️ 프로덕션(정식 출시) 빌드 때 아래 실제 ID로 교체:
  //    실제 보상형 전면 단위 ID: "ca-app-pub-5651570635070764/9153991350"
  //    (실제 ID를 테스트 중 쓰면 본인 광고 노출=정책 위반 + 심사 전엔 빈 광고)
  ADMOB_REWARDED_INTERSTITIAL_ID: "ca-app-pub-3940256099942544/5354046379",
};
