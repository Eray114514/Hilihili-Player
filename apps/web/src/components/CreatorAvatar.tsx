import Link from "next/link";

export function CreatorAvatar({ creatorId, name, size = "md" }: { creatorId: string | null; name: string; size?: "sm" | "md" | "lg" }) {
  const className = `${size === "sm" ? "h-9 w-9 text-sm" : size === "lg" ? "h-14 w-14 text-lg" : "h-11 w-11 text-base"} grid shrink-0 place-items-center rounded-full font-semibold text-white shadow-inner ring-1 ring-white/12`;
  const avatar = <span className={className} style={{ background: avatarGradient(name) }} aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || "UP"}</span>;
  return creatorId ? <Link href={`/creator/${creatorId}`} aria-label={`查看 ${name} 的主页`}>{avatar}</Link> : avatar;
}

function avatarGradient(value: string) {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `linear-gradient(145deg, hsl(${hue} 62% 54%), hsl(${(hue + 36) % 360} 55% 34%))`;
}
