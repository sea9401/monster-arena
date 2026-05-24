// 에셋 없는 합성 사운드/햅틱 레이어
window.SoundFX = (() => {
  const MUTE_KEY = "muted";          // 사운드(이름 유지 — 기존 저장값 호환)
  const HAPTIC_MUTE_KEY = "hapticMuted";
  let ctx = null;
  let muted = localStorage.getItem(MUTE_KEY) === "1";
  let hapticMuted = localStorage.getItem(HAPTIC_MUTE_KEY) === "1";

  function audioCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function resume() {
    const c = audioCtx();
    if (c.state === "suspended") c.resume().catch(() => {});
  }

  function haptic(pattern) {
    if (hapticMuted) return;
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  function tone(freq, dur = 0.08, type = "sine", gain = 0.05, delay = 0) {
    if (muted) return;
    const c = audioCtx();
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function sweep(from, to, dur = 0.12, type = "sine", gain = 0.05) {
    if (muted) return;
    const c = audioCtx();
    const t = c.currentTime;
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function toggleMute() {
    muted = !muted;
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    if (!muted) resume();
    return muted;
  }
  function toggleHapticMute() {
    hapticMuted = !hapticMuted;
    localStorage.setItem(HAPTIC_MUTE_KEY, hapticMuted ? "1" : "0");
    if (!hapticMuted && navigator.vibrate) navigator.vibrate(15); // 켤 때 짧은 진동 피드백
    return hapticMuted;
  }

  const api = {
    resume,
    haptic,
    isMuted: () => muted,
    toggleMute,
    isHapticMuted: () => hapticMuted,
    toggleHapticMute,
    playTick: () => tone(620, 0.045, "triangle", 0.025),
    playLevelUp: () => { tone(520, 0.08, "sine", 0.045); tone(780, 0.10, "sine", 0.045, 0.08); tone(1040, 0.12, "sine", 0.04, 0.16); },
    playEvolve: () => { sweep(360, 1100, 0.28, "triangle", 0.055); tone(1320, 0.18, "sine", 0.04, 0.2); },
    playHit: () => { tone(150, 0.07, "square", 0.045); tone(95, 0.08, "sawtooth", 0.025, 0.02); },
    playSuperHit: () => { tone(110, 0.10, "square", 0.06); tone(220, 0.08, "sawtooth", 0.035, 0.03); },
    playDodge: () => sweep(900, 260, 0.10, "sine", 0.035),
    playWin: () => { tone(523, 0.10, "triangle", 0.045); tone(659, 0.10, "triangle", 0.045, 0.1); tone(784, 0.16, "triangle", 0.05, 0.2); },
    playLose: () => sweep(420, 120, 0.32, "sine", 0.045),
    playReward: () => { tone(880, 0.07, "triangle", 0.04); tone(1175, 0.09, "triangle", 0.04, 0.08); },
  };

  ["pointerdown", "touchstart", "keydown"].forEach((ev) => {
    window.addEventListener(ev, resume, { once: true, passive: true });
  });

  return api;
})();
