export type SubtitleCue = {
  start: number;
  end: number;
  text: string;
};

export function parseSubtitle(content: string): SubtitleCue[] {
  const cleaned = content.trim().replace(/^\uFEFF/, "");
  const isVtt = cleaned.startsWith("WEBVTT");
  const blocks = cleaned.split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (isVtt && lines[0].startsWith("WEBVTT")) continue;

    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex === -1 || timeIndex >= lines.length - 1) continue;

    const timeLine = lines[timeIndex];
    const match = timeLine.match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
    if (!match) continue;

    const start = parseTime(match[1]);
    const end = parseTime(match[2]);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;

    const text = lines.slice(timeIndex + 1).join("\n").replace(/\{[^}]*\}/g, "").trim();
    if (!text) continue;

    cues.push({ start, end, text });
  }

  return cues;
}

function parseTime(value: string): number {
  const cleaned = value.replaceAll(",", ".").trim();
  const parts = cleaned.split(":").map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return Number(cleaned);
}

export function findActiveCue(cues: SubtitleCue[], time: number): SubtitleCue | null {
  return cues.find((cue) => time >= cue.start && time < cue.end) ?? null;
}
