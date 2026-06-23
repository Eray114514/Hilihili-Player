import { createId, getSqlite, nowIso } from "@hilihili/db";
import { createDemoLibrary, enqueueScan } from "@hilihili/media";
import { join, resolve } from "node:path";

if (process.env.HILI_TEST_MODE !== "1") {
  throw new Error("Refusing to seed demo media outside HILI_TEST_MODE=1");
}

const dataDir = resolve(process.env.HILI_DATA_DIR ?? ".hilihili-safe-demo");
const libraryRoot = join(dataDir, "safe-demo-library");
await createDemoLibrary(libraryRoot);

const db = getSqlite();
const existing = db.prepare("SELECT id FROM libraries WHERE root_path = ?").get(libraryRoot) as { id: string } | undefined;
const libraryId = existing?.id ?? createId("lib");
if (!existing) {
  db.prepare("INSERT INTO libraries (id, name, root_path, enabled, created_at) VALUES (?, ?, ?, 1, ?)")
    .run(libraryId, "Hilihili 安全演示库", libraryRoot, nowIso());
}
enqueueScan(libraryId);
console.log(`Safe demo library ready: ${libraryRoot}`);
