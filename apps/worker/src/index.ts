import { getSqlite } from "@hilihili/db";
import {
  detectHlsEncoder,
  enqueueScan,
  enqueueWarmupTranscodes,
  isScanBusy,
  processNextScanRun,
  processNextTranscodeTask,
  recoverInterruptedTranscodeTasks
} from "@hilihili/media";
import { createLogger } from "@hilihili/shared/log";
import { watch, type FSWatcher } from "chokidar";

const log = createLogger("worker");

const intervalMs = Number(process.env.HILI_SCAN_INTERVAL_MS ?? 900000);
const watchEnabled = process.env.HILI_WATCH_MEDIA !== "false";
const watchers = new Map<string, { rootPath: string; watcher: FSWatcher }>();
const changedLibraries = new Set<string>();
let changeTimer: NodeJS.Timeout | null = null;
let firstChangeAt: number | null = null;
const DEBOUNCE_MS = 1500;
const MAX_DEBOUNCE_MS = 10000;
// 转码并发默认 1：扫不到扫描机会时再考虑并行，避免把 NAS 的 CPU 吃干净
const TRANSCODE_CONCURRENCY = Math.max(1, Math.min(2, Number(process.env.HILI_TRANSCODE_CONCURRENCY ?? 1)));
// 收到退出信号后，等在跑的扫描/转码收尾的上限
const SHUTDOWN_GRACE_MS = 10000;

const controller = new AbortController();

getSqlite();

// 恢复上次中断的 scan_runs：将卡在 'running' 状态的记录标记为 'failed'，
// 否则 processNextScanRun 只查找 'queued' 状态的记录，这些孤儿记录会永远阻塞队列。
const stuckRuns = getSqlite().prepare("SELECT id FROM scan_runs WHERE status = 'running'").all() as { id: string }[];
for (const run of stuckRuns) {
  getSqlite().prepare("UPDATE scan_runs SET status = 'failed', message = ?, finished_at = ? WHERE id = ?")
    .run("Interrupted by worker restart", new Date().toISOString(), run.id);
  log.info("recovered stuck scan run", { runId: run.id });
}
// 转码任务同理：running 放回 queued，并清掉半成品临时目录
recoverInterruptedTranscodeTasks();

let processing = false;

async function drainQueue() {
  if (processing) {
    return;
  }
  processing = true;
  try {
    while (await processNextScanRun()) {
      log.info("scan run complete");
    }
  } catch (error) {
    log.error("scan failed", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    processing = false;
    if (changedLibraries.size > 0) scheduleChangedScans();
  }
}

let activeTranscodeLoops = 0;

async function drainTranscodeQueue() {
  if (activeTranscodeLoops >= TRANSCODE_CONCURRENCY) return;
  // 扫描期间让路：转码要吃满 CPU，而缩略图阶段也要跑 ffmpeg，同时跑会互相饿死
  if (processing || isScanBusy()) return;
  activeTranscodeLoops += 1;
  try {
    while (!controller.signal.aborted) {
      if (!(await processNextTranscodeTask(controller.signal))) break;
    }
  } catch (error) {
    log.error("transcode queue failed", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    activeTranscodeLoops -= 1;
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
        log.warn("media watcher failed; periodic scans remain active", { rootPath: library.root_path, error: error instanceof Error ? error.message : String(error) });
        watcher.close().catch(() => {});
        watchers.delete(library.id);
      });
      watchers.set(library.id, { rootPath: library.root_path, watcher });
    } catch (error) {
      log.warn("unable to watch; periodic scans remain active", { rootPath: library.root_path, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

enqueueScan();
void drainQueue();
refreshWatchers();
// 启动时补一小批预热转码，让「最近看过的内容」在用户下一次打开前就绪
enqueueWarmupTranscodes();
void drainTranscodeQueue();
setInterval(() => void drainQueue(), 10000);
setInterval(() => void drainTranscodeQueue(), 10000);
setInterval(() => enqueueScan(), intervalMs);
setInterval(refreshWatchers, 30000);
// 探测一次转码器能力（QSV / libx264），把结果提前打进日志，方便排查硬编是否可用
void detectHlsEncoder()
  .then((encoder) => log.info("transcode encoder ready", { encoder }))
  .catch((error) => log.warn("transcode encoder probe failed", { error: error instanceof Error ? error.message : String(error) }));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down", { signal });
  // 通知在跑的转码中断：ffmpeg 会收到 SIGTERM，任务回队列等下次启动继续
  controller.abort();
  for (const current of watchers.values()) {
    current.watcher.close().catch(() => {});
  }
  watchers.clear();
  // 给当前 drainQueue / 转码收尾一个上限，而不是写死等 2 秒就退出
  const deadline = Date.now() + SHUTDOWN_GRACE_MS;
  while ((processing || activeTranscodeLoops > 0) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));