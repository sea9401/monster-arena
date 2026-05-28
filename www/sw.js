// 몬스터 아레나 서비스워커 — 최소 PWA 설치 가능 요건 충족 + 오프라인 fallback.
// 캐시 전략: network-first → 실패 시 cache fallback (정적 자산).
// 게임 코드는 매 배포 갱신되므로 cache는 stale-but-better-than-blank 폴백 용도.
const CACHE = "monster-arena-v1";
const SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/game.js",
  "/sound.js",
  "/online.js",
  "/config.js",
  "/i18n.js",
  "/i18n-en.js",
  "/manifest.json",
  "/assets/icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // API 호출(/health, /matches, ...)은 네트워크 전용 — 캐시 X
  const url = new URL(req.url);
  if (req.method !== "GET" || url.pathname.startsWith("/api/") ||
      ["/health","/version","/leaderboard","/tournament","/season","/boss","/friends","/gifts","/pat","/matches","/players","/auth","/save","/event","/messages","/me","/push"].some((p) => url.pathname.startsWith(p))) {
    return; // 기본 네트워크 처리
  }
  // 정적 자산: network-first, 실패 시 캐시
  e.respondWith(
    fetch(req).then((res) => {
      // 200 응답이면 캐시 갱신
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then((cached) => cached || caches.match("/index.html")))
  );
});

// ---------- 푸시 알림 ----------
self.addEventListener("push", (e) => {
  let data = { title: "🐲 몬스터 아레나", body: "새 소식이 있어요!", url: "/" };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/assets/icon.png",
      badge: "/assets/icon.png",
      data: { url: data.url || "/" },
      vibrate: [80, 40, 80],
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
