export type SubtitleCue = {
  start: number;
  end: number;
  primaryText: string;
  secondaryText: string;
};

export function decodeSubtitle(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder("utf-16le").decode(bytes);
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder("utf-16be").decode(bytes);
    }

    const sampleLength = Math.min(bytes.length, 200);
    let evenZeros = 0;
    let oddZeros = 0;
    for (let index = 0; index < sampleLength; index += 1) {
      if (bytes[index] !== 0) continue;
      if (index % 2 === 0) evenZeros += 1;
      else oddZeros += 1;
    }
    if (oddZeros > sampleLength / 8) return new TextDecoder("utf-16le").decode(bytes);
    if (evenZeros > sampleLength / 8) return new TextDecoder("utf-16be").decode(bytes);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("gb18030").decode(bytes);
    } catch {
      return new TextDecoder().decode(bytes);
    }
  }
}

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

    const textLines = lines.slice(timeIndex + 1).map((line) => line.replace(/\{[^}]*\}/g, "").trim()).filter(Boolean);
    if (textLines.length === 0) continue;

    const primaryText = textLines[0];
    const secondaryText = textLines[1] ?? "";

    cues.push({ start, end, primaryText, secondaryText });
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
