import { getSqlite } from "@hilihili/db";
import { scanEnabledLibraries } from "@hilihili/media";

const intervalMs = Number(process.env.HILI_SCAN_INTERVAL_MS ?? 900000);

getSqlite();

async function runScan() {
  try {
    const count = await scanEnabledLibraries();
    console.log(`[worker] scan complete: ${count} item(s) indexed`);
  } catch (error) {
    console.error("[worker] scan failed", error);
  }
}

await runScan();
setInterval(runScan, intervalMs);
