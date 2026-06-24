import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const sandbox = mkdtempSync(join(tmpdir(), "hilihili-media-test-"));
process.env.HILI_DATA_DIR = join(sandbox, "data");
const [{ createId, getSqlite, nowIso }, { resolveContentDate, scanLibrary }] = await Promise.all([
  import("@hilihili/db"),
  import("./index.js")
]);

test("date resolver accepts metadata, bracketed, compact and short dates", () => {
  assert.equal(resolveContentDate({ date: "2024-05-15" }, "anything"), "2024-05-15T00:00:00.000Z");
  assert.equal(resolveContentDate({}, "[2024-06] 标题"), "2024-06-01T00:00:00.000Z");
  assert.equal(resolveContentDate({}, "20240516 标题"), "2024-05-16T00:00:00.000Z");
  assert.equal(resolveContentDate({}, "690101 标题"), "2069-01-01T00:00:00.000Z");
  assert.equal(resolveContentDate({}, "700101 标题"), "1970-01-01T00:00:00.000Z");
});

test("scanner creates posts, galleries and stable playable items", async () => {
  const root = join(sandbox, "library");
  const creator = join(root, "科技", "测试UP");
  const post = join(creator, "[2024-05-15] 图文动态");
  const gallery = join(creator, "图片");
  const hidden = join(creator, "[2024-05-14] 隐藏内容");
  const ignored = join(root, "_工具", "不会出现");
  mkdirSync(post, { recursive: true });
  mkdirSync(gallery, { recursive: true });
  mkdirSync(hidden, { recursive: true });
  mkdirSync(ignored, { recursive: true });
  writeFileSync(join(creator, "info.json"), JSON.stringify({ alias: "test-up" }));
  writeFileSync(join(post, "post.txt"), "动态正文");
  writeFileSync(join(post, "1.jpg"), "image-one");
  writeFileSync(join(post, "2.jpg"), "image-two");
  writeFileSync(join(post, "P1.mp4"), "video-one");
  writeFileSync(join(gallery, "1.jpg"), "gallery-one");
  writeFileSync(join(gallery, "2.jpg"), "gallery-two");
  writeFileSync(join(creator, "测试UP_单P.mp4"), "flat-video");
  writeFileSync(join(creator, "测试UP_单P.info.json"), JSON.stringify({ title: "单P覆盖标题", date: "2024-05-16" }));
  writeFileSync(join(hidden, "P1.mp4"), "hidden-video");
  writeFileSync(join(hidden, "info.json"), JSON.stringify({ hidden: true }));
  writeFileSync(join(ignored, "P1.mp4"), "ignored-video");
  writeFileSync(join(root, "_tags.json"), JSON.stringify({
    "科技": ["分区标签"],
    "科技/测试UP": ["UP标签"],
    "科技/测试UP/[2024-05-15] 图文动态": ["内容标签"]
  }));

  const db = getSqlite();
  const libraryId = createId("lib");
  db.prepare("INSERT INTO libraries (id, name, root_path, enabled, created_at) VALUES (?, ?, ?, 1, ?)").run(libraryId, "测试库", root, nowIso());
  assert.equal(await scanLibrary(libraryId), 4);
  assert.equal(await scanLibrary(libraryId), 4);

  const rows = db.prepare("SELECT id, kind, title, post_body, hidden FROM media_items ORDER BY kind, title").all() as { id: string; kind: string; title: string; post_body: string | null; hidden: number }[];
  assert.equal(rows.length, 4, "repeat scans must not duplicate items");
  const postRow = rows.find((row) => row.kind === "post");
  assert.equal(postRow?.post_body, "动态正文");
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM media_parts WHERE item_id = ?").get(postRow?.id) as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM media_images WHERE item_id = ?").get(postRow?.id) as { count: number }).count, 2);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM media_tags WHERE media_item_id = ?").get(postRow?.id) as { count: number }).count, 3);
  assert.equal(rows.find((row) => row.kind === "video")?.title, "单P覆盖标题");
  assert.equal(rows.find((row) => row.title === "隐藏内容")?.hidden, 1);
  assert.equal(rows.some((row) => row.title.includes("不会出现")), false);
  assert.equal((db.prepare("SELECT alias FROM creators WHERE name = '测试UP'").get() as { alias: string }).alias, "test-up");

  const singleVideo = rows.find((row) => row.title === "单P覆盖标题");
  const singlePart = db.prepare("SELECT id FROM media_parts WHERE item_id = ?").get(singleVideo?.id) as { id: string };
  db.prepare("INSERT INTO watch_progress (item_id, part_id, position_seconds, finished, updated_at) VALUES (?, ?, 12, 0, ?)")
    .run(singleVideo?.id, singlePart.id, nowIso());

  const originalVideo = join(creator, "测试UP_单P.mp4");
  const movedCreator = join(root, "生活", "新UP");
  const movedVideo = join(movedCreator, "已归类.mp4");
  mkdirSync(movedCreator, { recursive: true });
  renameSync(originalVideo, movedVideo);
  assert.equal(await scanLibrary(libraryId), 4);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM media_items").get() as { count: number }).count, 4, "moving a file must not leave a stale feed item");

  rmSync(movedVideo);
  assert.equal(await scanLibrary(libraryId), 3);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM media_items").get() as { count: number }).count, 3, "deleted files must be removed from the index");
});
