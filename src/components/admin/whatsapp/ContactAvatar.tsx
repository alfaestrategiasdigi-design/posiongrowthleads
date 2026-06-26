// Avatar component with profile-pic fallback to deterministic colored initials.
import { useState } from "react";

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316",
  "#eab308", "#22c55e", "#10b981", "#06b6d4", "#3b82f6",
];

function hashColor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function initials(name: string) {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const a = parts[0]?.[0] || "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] || "");
  return (a + b).toUpperCase().slice(0, 2);
}

type Props = {
  name: string;
  photoUrl?: string | null;
  size?: number;
  className?: string;
};

export default function ContactAvatar({ name, photoUrl, size = 40, className = "" }: Props) {
  const [failed, setFailed] = useState(false);
  const color = hashColor(name || "?");
  const showImg = photoUrl && !failed;

  return (
    <div
      className={`rounded-full flex items-center justify-center shrink-0 overflow-hidden text-white font-semibold ${className}`}
      style={{
        width: size,
        height: size,
        background: showImg ? "transparent" : color,
        fontSize: Math.max(11, size * 0.36),
      }}
      aria-label={name}
    >
      {showImg ? (
        <img
          src={photoUrl!}
          alt={name}
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
}
