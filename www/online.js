// 온라인 어댑터 (opt-in 레이어) — PvP + 계정/클라우드 세이브
// 모든 호출은 실패해도 throw하지 않고 null을 반환 → game.js가 폴백.
// API_BASE 우선순위: config → (http로 서빙 시) same-origin → 그 외 오프라인.
const Online = (() => {
  const cfg = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || "";
  const API_BASE = cfg || (location.protocol.startsWith("http") ? location.origin : null);
  const PID_KEY = "monster-arena-pid";
  const TOKEN_KEY = "monster-arena-token";

  const status = { reachable: false, playerId: null, token: null, username: null, loggedIn: false };

  function getPlayerId() {
    let id = localStorage.getItem(PID_KEY);
    if (!id) { id = "p-" + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(PID_KEY, id); }
    return id;
  }
  function setPlayerId(id) { status.playerId = id; localStorage.setItem(PID_KEY, id); }
  function setToken(t) {
    status.token = t || null;
    if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY);
  }

  async function call(path, opts = {}, timeoutMs = 4000) {
    if (!API_BASE) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers = {};
      if (opts.body) headers["Content-Type"] = "application/json";
      if (status.token) headers["Authorization"] = "Bearer " + status.token;
      const res = await fetch(API_BASE + path, { ...opts, signal: ctrl.signal, headers });
      if (!res.ok) return { _error: res.status, ...(await res.json().catch(() => ({}))) };
      return await res.json();
    } catch {
      return null;
    } finally { clearTimeout(t); }
  }

  // 서버 연결 + (익명) 플레이어 등록 + 저장된 토큰 복원
  async function init() {
    status.playerId = getPlayerId();
    status.token = localStorage.getItem(TOKEN_KEY) || null;
    const health = await call("/health", {}, 2500);
    status.reachable = !!(health && health.ok);
    if (!status.reachable) return false;
    // 토큰 있으면 세션 확인 → 로그인 상태 복원
    if (status.token) {
      const me = await call("/auth/me");
      if (me && !me._error && me.playerId) {
        status.loggedIn = true; status.username = me.username; setPlayerId(me.playerId);
      } else { setToken(null); }
    }
    // 익명 플레이어 레코드 보장(매칭/리더보드용)
    await call("/players/register", { method: "POST", body: JSON.stringify({ playerId: status.playerId }) });
    flushPending(); // 오프라인 중 쌓인 AI 매치 결과 반영 (백그라운드 — 시작 막지 않음)
    return true;
  }

  // ----- 계정 -----
  async function register(username, password) {
    const r = await call("/auth/register", { method: "POST", body: JSON.stringify({ username, password, playerId: status.playerId }) });
    if (!r) return { ok: false, error: "NETWORK" };
    if (r._error) return { ok: false, error: r.error || "ERR_" + r._error };
    setToken(r.token); setPlayerId(r.playerId); status.username = r.username; status.loggedIn = true;
    return { ok: true };
  }
  async function login(username, password) {
    const r = await call("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    if (!r) return { ok: false, error: "NETWORK" };
    if (r._error) return { ok: false, error: r.error || "ERR_" + r._error };
    setToken(r.token); setPlayerId(r.playerId); status.username = r.username; status.loggedIn = true;
    return { ok: true };
  }
  async function logout() {
    await call("/auth/logout", { method: "POST" });
    setToken(null); status.loggedIn = false; status.username = null;
  }

  // ----- 클라우드 세이브 -----
  async function loadCloudSave() {
    if (!status.loggedIn) return null;
    const r = await call("/save");
    return r && !r._error ? r.state : null;
  }
  async function pushCloudSave(state) {
    if (!status.reachable || !status.loggedIn) return;
    await call("/save", { method: "PUT", body: JSON.stringify({ state }) });
  }

  // ----- PvP -----
  async function uploadSnapshot(snap) {
    if (!status.reachable || !status.playerId) return;
    await call(`/players/${status.playerId}/snapshot`, { method: "PUT", body: JSON.stringify(snap) });
  }
  async function findMatch(rating) {
    if (!status.reachable) return null;
    const r = await call("/matches/find", { method: "POST", body: JSON.stringify({ playerId: status.playerId, rating }) });
    if (!r || r._error || !r.opponent) return null;
    return r;
  }
  async function submitResult(matchId, won, rounds) {
    if (!status.reachable || !matchId) return null;
    const r = await call(`/matches/${matchId}/result`, { method: "POST", body: JSON.stringify({ playerId: status.playerId, winner: won ? "player" : "opponent", rounds }) });
    if (!r || r._error) return null;
    return r;
  }
  // 서버 매치ID 없는 로컬/AI 매치(upset 대체·오프라인 폴백)도 본인 정산만 서버에 반영.
  // nonce는 멱등키 — 연결 시 즉시 제출과 오프라인 큐 재시도가 같은 nonce를 써서 중복 집계 방지.
  async function submitSoloResult(won, opponentRating, nonce) {
    if (!status.reachable || !status.playerId) return null;
    const r = await call("/matches/solo-result", { method: "POST", body: JSON.stringify({ playerId: status.playerId, winner: won ? "player" : "opponent", opponentRating, nonce }) });
    if (!r || r._error || !r.ok) return null;
    return r;
  }
  // ----- 오프라인 매치 큐 (재접속 시 집계) -----
  const PENDING_KEY = "monster-arena-pending";
  function loadPending() { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]"); } catch { return []; } }
  function savePending(arr) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(arr.slice(-100))); } catch {} }
  // 오프라인이라 즉시 제출 못 한 AI 매치를 적재. 레이팅은 로컬에서 이미 반영됨 → 플러시 때 noRating으로 점수·전적만.
  function queueSoloResult(won, opponentRating, nonce) {
    const arr = loadPending();
    arr.push({ won: !!won, opponentRating: opponentRating == null ? null : opponentRating, nonce: nonce || null, at: Date.now() });
    savePending(arr);
  }
  // 재접속 시 큐 플러시. 멱등(nonce) + 실패분만 보존 → 다음 접속에 재시도. 백그라운드 호출(블로킹 X).
  async function flushPending() {
    if (!status.reachable || !status.playerId) return;
    const arr = loadPending();
    if (!arr.length) return;
    const remain = [];
    for (const it of arr) {
      const r = await call("/matches/solo-result", { method: "POST", body: JSON.stringify({ playerId: status.playerId, winner: it.won ? "player" : "opponent", opponentRating: it.opponentRating, nonce: it.nonce, noRating: true }) });
      if (!(r && !r._error && r.ok)) remain.push(it);
    }
    savePending(remain);
  }
  async function leaderboard(limit = 20) {
    if (!status.reachable) return null;
    const r = await call(`/leaderboard?limit=${limit}`);
    return r && r.rows ? r.rows : null;
  }
  async function tournament() {
    if (!status.reachable) return null;
    const r = await call(`/tournament?playerId=${encodeURIComponent(status.playerId)}`);
    return r && !r._error ? r : null;
  }
  async function event() {
    if (!status.reachable) return null;
    const r = await call("/event");
    return r && !r._error ? r : null;
  }
  async function season() {
    if (!status.reachable) return null;
    const r = await call(`/season?playerId=${encodeURIComponent(status.playerId)}`);
    return r && !r._error ? r : null;
  }
  async function claimSeason() {
    if (!status.reachable || !status.playerId) return null;
    const r = await call("/season/claim", { method: "POST", body: JSON.stringify({ playerId: status.playerId }) });
    return r && !r._error ? r.reward : null;
  }
  async function claimChampion() {
    if (!status.reachable || !status.playerId) return null;
    const r = await call("/tournament/claim", { method: "POST", body: JSON.stringify({ playerId: status.playerId }) });
    return r && !r._error ? r.reward : null;
  }
  async function myCode() {
    if (!status.reachable || !status.playerId) return null;
    const r = await call(`/me/code?playerId=${encodeURIComponent(status.playerId)}`);
    return r && r.code ? r.code : null;
  }
  async function friendsList() {
    if (!status.reachable || !status.playerId) return [];
    const r = await call(`/friends?playerId=${encodeURIComponent(status.playerId)}`);
    return r && r.friends ? r.friends : [];
  }
  async function addFriend(code) {
    if (!status.reachable || !status.playerId) return { ok: false, error: "NETWORK" };
    const r = await call("/friends/add", { method: "POST", body: JSON.stringify({ playerId: status.playerId, code }) });
    if (!r) return { ok: false, error: "NETWORK" };
    if (r._error) return { ok: false, error: r.error || ("ERR_" + r._error) };
    return r;
  }
  async function removeFriend(friendId) {
    if (!status.reachable || !status.playerId) return false;
    const r = await call("/friends/remove", { method: "POST", body: JSON.stringify({ playerId: status.playerId, friendId }) });
    return !!(r && r.ok);
  }
  async function getPlayer(id) {
    if (!status.reachable || !id) return null;
    const r = await call(`/players/${encodeURIComponent(id)}`);
    return r && !r._error ? r : null;
  }
  async function sendGift(friendId) {
    if (!status.reachable || !status.playerId) return { ok: false, error: "NETWORK" };
    const r = await call("/gifts/send", { method: "POST", body: JSON.stringify({ playerId: status.playerId, friendId }) });
    if (!r) return { ok: false, error: "NETWORK" };
    if (r._error) return { ok: false, error: r.error || ("ERR_" + r._error) };
    return r;
  }
  async function claimGifts() {
    if (!status.reachable || !status.playerId) return [];
    const r = await call(`/gifts?playerId=${encodeURIComponent(status.playerId)}`);
    return r && r.gifts ? r.gifts : [];
  }
  async function giftsSentToday() {
    if (!status.reachable || !status.playerId) return [];
    const r = await call(`/gifts/sent-today?playerId=${encodeURIComponent(status.playerId)}`);
    return r && r.sent ? r.sent : [];
  }
  async function patFriend(friendId) {
    if (!status.reachable || !status.playerId) return { ok: false, error: "NETWORK" };
    const r = await call("/pat", { method: "POST", body: JSON.stringify({ playerId: status.playerId, friendId }) });
    if (!r) return { ok: false, error: "NETWORK" };
    if (r._error) return { ok: false, error: r.error || ("ERR_" + r._error) };
    return r;
  }
  async function patSentToday() {
    if (!status.reachable || !status.playerId) return [];
    const r = await call(`/pat/today?playerId=${encodeURIComponent(status.playerId)}`);
    return r && r.sent ? r.sent : [];
  }
  async function bossState() {
    if (!status.reachable) return null;
    const r = await call(`/boss/state?playerId=${encodeURIComponent(status.playerId)}`);
    return r && !r._error ? r : null;
  }
  async function bossAttack(attackId) {
    if (!status.reachable || !status.playerId) return null;
    const r = await call("/boss/attack", { method: "POST", body: JSON.stringify({ playerId: status.playerId, attackId }) });
    return r && !r._error ? r : (r || null);
  }
  async function bossClaim() {
    if (!status.reachable || !status.playerId) return null;
    const r = await call("/boss/claim", { method: "POST", body: JSON.stringify({ playerId: status.playerId }) });
    return r && !r._error ? r.reward : null;
  }
  async function sendTaunt(toPlayerId, presetId) {
    if (!status.reachable || !status.playerId) return false;
    const r = await call("/messages", { method: "POST", body: JSON.stringify({ from: status.playerId, toPlayerId, presetId }) });
    return !!(r && r.ok);
  }
  async function getMessages() {
    if (!status.reachable || !status.playerId) return [];
    const r = await call(`/messages?playerId=${encodeURIComponent(status.playerId)}`);
    return r && r.messages ? r.messages : [];
  }
  async function ackMessages() {
    if (!status.reachable || !status.playerId) return;
    await call("/messages/ack", { method: "POST", body: JSON.stringify({ playerId: status.playerId }) });
  }

  // ----- 푸시 알림 -----
  async function pushVapidKey() {
    if (!status.reachable) return null;
    const r = await call("/push/vapid");
    return r && r.publicKey ? r.publicKey : null;
  }
  async function pushSubscribe(subscription) {
    if (!status.reachable || !status.playerId) return false;
    const r = await call("/push/subscribe", { method: "POST", body: JSON.stringify({ playerId: status.playerId, subscription }) });
    return !!(r && r.ok);
  }
  async function pushUnsubscribe() {
    if (!status.reachable || !status.playerId) return;
    await call("/push/unsubscribe", { method: "POST", body: JSON.stringify({ playerId: status.playerId }) });
  }

  return { status, init, register, login, logout, loadCloudSave, pushCloudSave,
    uploadSnapshot, findMatch, submitResult, submitSoloResult, queueSoloResult, leaderboard, tournament, event,
    claimChampion, sendTaunt, getMessages, ackMessages, season, claimSeason,
    bossState, bossAttack, bossClaim,
    myCode, friendsList, addFriend, removeFriend, getPlayer,
    sendGift, claimGifts, giftsSentToday,
    patFriend, patSentToday,
    pushVapidKey, pushSubscribe, pushUnsubscribe };
})();
