import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dataDir = join(root, ".hilihili-safe-demo");
const libraryRoot = join(dataDir, "safe-demo-library");
const env = {
  ...process.env,
  HILI_TEST_MODE: "1",
  HILI_DATA_DIR: dataDir,
  HILI_ALLOWED_MEDIA_ROOT: libraryRoot,
  HILI_API_HOST: "127.0.0.1",
  HILI_API_PORT: "4241",
  NEXT_PUBLIC_API_BASE_URL: "http://localhost:4241",
  PORT: "3100"
};

function run(args, options = {}) {
  const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "corepack";
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "corepack", "pnpm", ...args] : ["pnpm", ...args];
  return spawn(command, commandArgs, {
    cwd: root,
    env,
    stdio: "inherit",
    ...options
  });
}

const seed = run(["--filter", "@hilihili/worker", "demo:seed"]);
const seedExit = await new Promise((resolvePromise) => seed.on("exit", resolvePromise));
if (seedExit !== 0) {
  process.exit(Number(seedExit) || 1);
}

console.log("Safe demo: http://localhost:3100 (isolated from your real library)");
const services = run(["--parallel", "--filter", "@hilihili/web", "--filter", "@hilihili/api", "--filter", "@hilihili/worker", "dev"]);
services.on("exit", (code) => process.exit(code ?? 0));
