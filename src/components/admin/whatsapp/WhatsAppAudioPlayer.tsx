import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";

/**
 * Player de áudio custom — preto + dourado, coerente com o tema WhatsApp Master.
 * Envolve um <audio> real para preservar streaming/download; só a UI é substituída.
 */
export function WhatsAppAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCurrent(a.currentTime || 0);
    const onLoad = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0);
    const onEnd = () => { setPlaying(false); setCurrent(0); };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onLoad);
    a.addEventListener("durationchange", onLoad);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onLoad);
      a.removeEventListener("durationchange", onLoad);
      a.removeEventListener("ended", onEnd);
    };
  }, [src]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play().then(() => setPlaying(true)).catch(() => {}); }
    else { a.pause(); setPlaying(false); }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    const track = trackRef.current;
    if (!a || !track || !duration) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * duration;
    setCurrent(a.currentTime);
  };

  const fmt = (s: number) => {
    if (!Number.isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  const pct = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 min-w-[220px] max-w-[320px] py-1">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"}
        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-black border transition-colors"
        style={{
          borderColor: "rgba(201,162,39,0.42)",
          color: "hsl(44 55% 60%)",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.6) inset",
        }}
      >
        {playing ? <Pause className="w-3.5 h-3.5" fill="currentColor" /> : <Play className="w-3.5 h-3.5 translate-x-[1px]" fill="currentColor" />}
      </button>
      <div
        ref={trackRef}
        onClick={seek}
        className="relative flex-1 h-[3px] rounded-full cursor-pointer group"
        style={{ background: "rgba(201,162,39,0.18)" }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${pct}%`,
            background: "hsl(44 55% 55% / 0.9)",
            boxShadow: "0 0 6px hsl(44 55% 55% / 0.35)",
          }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            left: `${pct}%`,
            background: "hsl(44 55% 65%)",
            boxShadow: "0 0 6px hsl(44 55% 55% / 0.6)",
          }}
        />
      </div>
      <span
        className="shrink-0 text-[10px] tabular-nums"
        style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: "hsl(44 55% 60% / 0.85)" }}
      >
        {fmt(duration > 0 ? (playing || current > 0 ? current : duration) : current)}
      </span>
    </div>
  );
}
