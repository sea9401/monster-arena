// 온라인 PvP 어댑터 (opt-in 레이어)
// 모든 호출은 실패해도 throw하지 않고 null을 반환 → game.js가 AI 폴백.
// API_BASE 우선순위: config → (http로 서빙 시) same-origin → 그 외 오프라인.
const Online = (() => {
  const cfg = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || "";
  const API_BASE = cfg || (location.protocol.startsWith("http") ? location.origin : null);
  const PID_KEY = "monster-arena-pid";

  const status = { reachable: false, playerId: null };

  function getPlayerId() {
    let id = localStorage.getItem(PID_KEY);
    if (!id) { id = "p-" + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(PID_KEY, id); }
    return id;
  }

  async function call(path, opts = {}, timeoutMs = 2500) {
    if (!API_BASE) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(API_BASE + path, {
        ...opts,
        signal: ctrl.signal,
        headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      });
      if (!res.ok) return { _error: res.status, ...(await res.json().catch(() => ({}))) };
      return await res.json();
    } catch {
      return null; // 네트워크 실패/타임아웃 → 오프라인 취급
    } finally { clearTimeout(t); }
  }

  // 서버 연결 + 플레이어 등록. 성공 시 status.reachable=true.
  async function init() {
    status.playerId = getPlayerId();
    const health = await call("/health", {}, 2000);
    status.reachable = !!(health && health.ok);
    if (status.reachable) await call("/players/register", { method: "POST", body: JSON.stringify({ playerId: status.playerId }) });
    return status.reachable;
  }

  // 내 몬스터 스냅샷 업로드 (실패 무시)
  async function uploadSnapshot(snap) {
    if (!status.reachable || !status.playerId) return;
    await call(`/players/${status.playerId}/snapshot`, { method: "PUT", body: JSON.stringify(snap) });
  }

  // 매칭: { matchId, opponent } 또는 null(폴백)
  async function findMatch(rating) {
    if (!status.reachable) return null;
    const r = await call("/matches/find", { method: "POST", body: JSON.stringify({ playerId: status.playerId, rating }) });
    if (!r || r._error || !r.opponent) return null;
    return r;
  }

  // 결과 제출: { newRating, delta } 또는 null
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

  return { status, init, uploadSnapshot, findMatch, submitResult, leaderboard };
})();
