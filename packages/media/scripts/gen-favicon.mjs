import { readFile, writeFile, mkdtemp, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const svgPath = join(root, "apps", "web", "public", "icon.svg");
const icoPath = join(root, "apps", "web", "src", "app", "favicon.ico");
const applePath = join(root, "apps", "web", "public", "apple-touch-icon.png");

const svgBuffer = await readFile(svgPath);

const sizes = [16, 32, 48, 64];
const tmpDir = await mkdtemp(join(tmpdir(), "hili-favicon-"));
const tmpFiles = [];

for (const size of sizes) {
  const file = join(tmpDir, `icon-${size}.png`);
  const buf = await sharp(svgBuffer).resize(size, size).png().toBuffer();
  await writeFile(file, buf);
  tmpFiles.push(file);
}

const icoBuf = await pngToIco(tmpFiles);
await writeFile(icoPath, icoBuf);

const appleBuf = await sharp(svgBuffer).resize(180, 180).png().toBuffer();
await writeFile(applePath, appleBuf);

for (const file of tmpFiles) {
  await unlink(file);
}

console.log(`Wrote ${icoPath}`);
console.log(`Wrote ${applePath}`);
