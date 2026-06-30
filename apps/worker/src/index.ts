import { getSqlite } from "@hilihili/db";
import { enqueueScan, processNextScanRun } from "@hilihili/media";
import { watch, type FSWatcher } from "chokidar";

const intervalMs = Number(process.env.HILI_SCAN_INTERVAL_MS ?? 900000);
const watchEnabled = process.env.HILI_WATCH_MEDIA !== "false";
const watchers = new Map<string, { rootPath: string; watcher: FSWatcher }>();
const changedLibraries = new Set<string>();
let changeTimer: NodeJS.Timeout | null = null;
let firstChangeAt: number | null = null;
const DEBOUNCE_MS = 1500;
const MAX_DEBOUNCE_MS = 10000;

getSqlite();

// 恢复上次中断的 scan_runs：将卡在 'running' 状态的记录标记为 'failed'，
// 否则 processNextScanRun 只查找 'queued' 状态的记录，这些孤儿记录会永远阻塞队列。
const stuckRuns = getSqlite().prepare("SELECT id FROM scan_runs WHERE status = 'running'").all() as { id: string }[];
for (const run of stuckRuns) {
  getSqlite().prepare("UPDATE scan_runs SET status = 'failed', message = ?, finished_at = ? WHERE id = ?")
    .run("Interrupted by worker restart", new Date().toISOString(), run.id);
  console.log(`[worker] recovered stuck scan run: ${run.id}`);
}

let processing = false;

async function drainQueue() {
  if (processing) {
    return;
  }
  processing = true;
  try {
    while (await processNextScanRun()) {
      console.log("[worker] scan run complete");
    }
  } catch (error) {
    console.error("[worker] scan failed", error);
  } finally {
    processing = false;
    if (changedLibraries.size > 0) scheduleChangedScans();
  }
}

function scheduleChangedScans() {
  if (firstChangeAt === null) firstChangeAt = Date.now();
  if (changeTimer) clearTimeout(changeTimer);
  const elapsed = Date.now() - firstChangeAt;
  const delay = Math.min(DEBOUNCE_MS, Math.max(0, MAX_DEBOUNCE_MS - elapsed));
  changeTimer = setTimeout(() => {
    changeTimer = null;
    firstChangeAt = null;
    if (processing) return;
    for (const libraryId of changedLibraries) enqueueScan(libraryId);
    changedLibraries.clear();
    void drainQueue();
  }, delay);
}

function refreshWatchers() {
  if (!watchEnabled) return;
  const libraries = getSqlite().prepare("SELECT id, root_path FROM libraries WHERE enabled = 1").all() as { id: string; root_path: string }[];
  const activeIds = new Set(libraries.map((library) => library.id));

  for (const [id, current] of watchers) {
    if (!activeIds.has(id)) {
      current.watcher.close().catch(() => {});
      watchers.delete(id);
    }
  }

  for (const library of libraries) {
    const current = watchers.get(library.id);
    if (current?.rootPath === library.root_path) continue;
    current?.watcher.close().catch(() => {});
    try {
      const watcher = watch(library.root_path, {
        ignored: (path) => path.includes("node_modules") || path.includes(".git"),
        ignoreInitial: true,
        persistent: false
      });
      watcher.on("all", () => {
        changedLibraries.add(library.id);
        scheduleChangedScans();
      });
      watcher.on("error", (error) => {
        console.warn(`[worker] media watcher failed for ${library.root_path}; periodic scans remain active`, error);
        watcher.close().catch(() => {});
        watchers.delete(library.id);
      });
      watchers.set(library.id, { rootPath: library.root_path, watcher });
    } catch (error) {
      console.warn(`[worker] unable to watch ${library.root_path}; periodic scans remain active`, error);
    }
  }
}

enqueueScan();
void drainQueue();
refreshWatchers();
setInterval(() => void drainQueue(), 10000);
setInterval(() => enqueueScan(), intervalMs);
setInterval(refreshWatchers, 30000);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] received ${signal}, shutting down...`);
  for (const current of watchers.values()) {
    current.watcher.close().catch(() => {});
  }
  watchers.clear();
  // 给当前 drainQueue 一个短超时完成
  await new Promise((resolve) => setTimeout(resolve, 2000));
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
