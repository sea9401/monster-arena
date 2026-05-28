// 다국어(i18n) — gettext식: 한국어 원문이 곧 키.
// t("부화했어요!")처럼 기존 한국어를 그대로 키로 쓰고, 비한국어 로케일이면 사전에서 치환.
// 미번역 문자열은 한국어로 폴백되므로 마이그레이션 중에도 절대 깨지지 않음.
// 일본어(ja)·중국어(zh)는 추후 TRANS.ja/TRANS.zh 추가하면 자동으로 선택지에 노출됨.
(function () {
  "use strict";

  // 로케일별 메타(드롭다운 표기). 사전(TRANS)에 존재하는 로케일만 선택 가능.
  const LOCALE_META = {
    ko: { label: "한국어", flag: "🇰🇷" },
    en: { label: "English", flag: "🇺🇸" },
    ja: { label: "日本語", flag: "🇯🇵" },
    zh: { label: "中文", flag: "🇨🇳" },
  };

  // ko→대상언어 번역 사전. 키는 한국어 원문(보간 자리표시자 {name} 포함).
  // window.I18N_TRANS로 분리 파일에서 주입(en은 i18n-en.js 등). 없으면 빈 객체.
  const TRANS = window.I18N_TRANS || { en: {} };

  const STORE_KEY = "ma-locale";

  function detectLocale() {
    const stored = localStorage.getItem(STORE_KEY);
    if (stored && (stored === "ko" || TRANS[stored])) return stored;
    const navs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "ko"]);
    for (const n of navs) {
      const p = String(n).toLowerCase().slice(0, 2);
      if (p === "ko") return "ko";
      if (TRANS[p]) return p; // 사전 보유 언어면 채택
    }
    return "ko";
  }

  let LOCALE = detectLocale();

  function interpolate(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m));
  }

  // 번역 함수. ko 로케일이면 원문 그대로(+보간). 그 외엔 사전 룩업 후 폴백.
  function t(ko, params) {
    if (ko == null) return ko;
    if (LOCALE === "ko") return interpolate(ko, params);
    const dict = TRANS[LOCALE];
    const hit = dict && Object.prototype.hasOwnProperty.call(dict, ko) ? dict[ko] : ko;
    return interpolate(hit, params);
  }

  function getLocale() { return LOCALE; }
  function availableLocales() {
    return ["ko", ...Object.keys(TRANS).filter((l) => l !== "ko")];
  }
  function localeMeta(loc) { return LOCALE_META[loc] || { label: loc, flag: "🌐" }; }

  // data-i18n: 요소의 원본 텍스트를 키로 캐시 후 현재 로케일로 치환.
  //   <span data-i18n>랭킹</span>            → textContent 번역
  //   <input data-i18n-ph>            → placeholder 번역
  //   data-i18n-html: innerHTML 보존이 필요한 경우(주의해서 사용)
  function applyStaticI18n(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      if (el.dataset.i18nKey === undefined) el.dataset.i18nKey = el.textContent.trim();
      el.textContent = t(el.dataset.i18nKey);
    });
    scope.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      if (el.dataset.i18nPhKey === undefined) el.dataset.i18nPhKey = el.getAttribute("placeholder") || "";
      el.setAttribute("placeholder", t(el.dataset.i18nPhKey));
    });
    scope.querySelectorAll("[data-i18n-html]").forEach((el) => {
      if (el.dataset.i18nHtmlKey === undefined) el.dataset.i18nHtmlKey = el.innerHTML.trim();
      el.innerHTML = t(el.dataset.i18nHtmlKey);
    });
    document.documentElement.lang = LOCALE;
  }

  // 로케일 변경 → 저장 + 정적 치환 + 콜백(동적 화면 리렌더). game.js가 onChange 등록.
  let onChangeCb = null;
  function onLocaleChange(cb) { onChangeCb = cb; }
  function setLocale(loc) {
    if (loc !== "ko" && !TRANS[loc]) return;
    LOCALE = loc;
    localStorage.setItem(STORE_KEY, loc);
    applyStaticI18n();
    if (onChangeCb) onChangeCb(loc);
  }

  window.I18N = { t, getLocale, setLocale, availableLocales, localeMeta, applyStaticI18n, onLocaleChange };
  // 짧은 전역 별칭(코드 가독성)
  window.t = t;
})();
