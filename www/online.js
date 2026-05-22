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
  async function leaderboard(limit = 20) {
    if (!status.reachable) return null;
    const r = await call(`/leaderboard?limit=${limit}`);
    return r && r.rows ? r.rows : null;
  }

  return { status, init, register, login, logout, loadCloudSave, pushCloudSave,
    uploadSnapshot, findMatch, submitResult, leaderboard };
})();
