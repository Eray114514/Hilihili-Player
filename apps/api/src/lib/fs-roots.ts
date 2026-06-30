import { existsSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { platform } from "node:os";
import type { DirectoryEntry } from "@hilihili/shared";

export function getBrowsableRoots(): DirectoryEntry[] {
  const allowedRoot = getAllowedRoot();
  if (allowedRoot) {
    return [{ name: basename(allowedRoot) || "安全演示库", path: allowedRoot, isDirectory: true }];
  }
  if (platform() === "win32") {
    const roots: DirectoryEntry[] = [];
    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (existsSync(drive)) {
        roots.push({ name: drive, path: drive, isDirectory: true });
      }
    }
    return roots;
  }

  return ["/", "/mnt", "/media", "/volume1"]
    .filter((path) => existsSync(path))
    .map((path) => ({ name: path, path, isDirectory: true }));
}

export function getAllowedRoot() {
  if (process.env.HILI_TEST_MODE !== "1" || !process.env.HILI_ALLOWED_MEDIA_ROOT) {
    return null;
  }
  return resolve(process.env.HILI_ALLOWED_MEDIA_ROOT);
}

export function isPathAllowed(targetPath: string) {
  const allowedRoot = getAllowedRoot();
  if (!allowedRoot) {
    return true;
  }
  const pathFromRoot = relative(allowedRoot, resolve(targetPath));
  return pathFromRoot === "" || (!isAbsolute(pathFromRoot) && !pathFromRoot.startsWith("..") && !pathFromRoot.includes(`..${sep}`));
}
