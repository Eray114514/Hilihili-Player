import { getSqlite } from "@hilihili/db";
import { enqueueScan, processNextScanRun } from "@hilihili/media";

const intervalMs = Number(process.env.HILI_SCAN_INTERVAL_MS ?? 900000);

getSqlite();

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
  }
}

enqueueScan();
await drainQueue();
setInterval(() => void drainQueue(), 1000);
setInterval(() => enqueueScan(), intervalMs);
