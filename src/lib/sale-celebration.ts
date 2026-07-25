import confetti from "canvas-confetti";

const MUTE_KEY = "posion.sale_sound_muted";

export function isSaleSoundMuted(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MUTE_KEY) === "1";
}

export function setSaleSoundMuted(muted: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  window.dispatchEvent(new CustomEvent("posion:sale-sound-changed"));
}

/** Short synthesized "cha-ching" via WebAudio — no external asset. */
function playChaChing() {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const tones: Array<[number, number]> = [
      [880, 0],
      [1174.66, 0.08],
      [1567.98, 0.16],
    ];
    tones.forEach(([freq, t]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.25, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.4);
    });

    setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch {
    /* ignore */
  }
}

/** Fires confetti + optional sound. Safe to call from any component. */
export function celebrateSale() {
  try {
    const end = Date.now() + 900;
    const colors = ["#10b981", "#f59e0b", "#3b82f6", "#ec4899"];
    (function frame() {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors,
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors,
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
    confetti({
      particleCount: 120,
      spread: 90,
      origin: { y: 0.6 },
      colors,
    });
  } catch {
    /* ignore */
  }
  if (!isSaleSoundMuted()) playChaChing();
}
