// Asset-free completion sounds synthesized with the Web Audio API.
// A single shared AudioContext is lazily created and resumed on first use.

export const SOUND_OPTIONS = ["none", "chime", "bell", "digital"];

let audioContext = null;

function getContext() {
  if (typeof window === "undefined") {
    return null;
  }

  const Ctx = window.AudioContext || window.webkitAudioContext;

  if (!Ctx) {
    return null;
  }

  if (!audioContext) {
    audioContext = new Ctx();
  }

  return audioContext;
}

// Call from within a user gesture (e.g. pressing Start) so the browser/Electron
// autoplay policy unlocks the context before the timer finishes later.
export function primeAudio() {
  const ctx = getContext();

  if (ctx && ctx.state === "suspended") {
    void ctx.resume();
  }
}

function ping(ctx, { freq, delay, duration, type, level }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const startAt = ctx.currentTime + delay;
  const peak = Math.max(0.0001, level);

  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.03);
}

export function playSound(type, volume = 0.6) {
  if (!type || type === "none") {
    return;
  }

  const ctx = getContext();

  if (!ctx) {
    return;
  }

  if (ctx.state === "suspended") {
    void ctx.resume();
  }

  const master = Math.max(0, Math.min(1, Number(volume)));

  if (!(master > 0)) {
    return;
  }

  if (type === "chime") {
    // Gentle ascending arpeggio (E5 → G#5 → B5).
    [659.25, 830.61, 987.77].forEach((freq, index) => {
      ping(ctx, { freq, delay: index * 0.16, duration: 0.7, type: "sine", level: master * 0.5 });
    });
    return;
  }

  if (type === "bell") {
    // Bell-like tone from a fundamental plus two inharmonic partials (D5).
    [
      { mult: 1, level: 0.5 },
      { mult: 2.01, level: 0.28 },
      { mult: 3.02, level: 0.16 }
    ].forEach((partial) => {
      ping(ctx, {
        freq: 587.33 * partial.mult,
        delay: 0,
        duration: 1.4,
        type: "sine",
        level: master * partial.level
      });
    });
    return;
  }

  if (type === "digital") {
    // Short square-wave blips (A5 → D6 → G6).
    [880, 1174.66, 1567.98].forEach((freq, index) => {
      ping(ctx, { freq, delay: index * 0.1, duration: 0.12, type: "square", level: master * 0.16 });
    });
  }
}
