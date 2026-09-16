import { existsSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { platform } from "node:os";
import type { DirectoryEntry } from "@hilihili/shared";

/**
 * 可浏览的根目录白名单。
 *
 * `/fs/roots` 与 `/fs/list` 是给「设置页选目录」用的，默认会枚举整盘（Windows 下列 A:-Z:）。
 * 之前只有 HILI_TEST_MODE=1 时才生效，等于对外网/组网暴露了整机文件浏览能力。
 * 现在改为：只要配置了白名单就强制生效（不再依赖测试模式）。
 *
 * 配置来源：
 *   - HILI_FS_ROOTS：逗号分隔的容器内路径，Docker 部署由 compose 注入 /media
 *   - HILI_ALLOWED_MEDIA_ROOT：历史变量，等价于单个根（safe demo 模式在用）
 * 两者都不配置时保持原有不受限行为（本地开发场景）。
 */
export function getAllowedRoots(): string[] {
  const raw = process.env.HILI_FS_ROOTS ?? process.env.HILI_ALLOWED_MEDIA_ROOT;
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => resolve(value));
}

export function getBrowsableRoots(): DirectoryEntry[] {
  const allowedRoots = getAllowedRoots();
  if (allowedRoots.length > 0) {
    return allowedRoots
      .filter((root) => existsSync(root))
      .map((root) => ({ name: basename(root) || root, path: root, isDirectory: true }));
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

function isUnder(root: string, targetPath: string) {
  const pathFromRoot = relative(root, targetPath);
  return pathFromRoot === "" || (!isAbsolute(pathFromRoot) && !pathFromRoot.startsWith("..") && !pathFromRoot.includes(`..${sep}`));
}

export function isPathAllowed(targetPath: string) {
  const allowedRoots = getAllowedRoots();
  if (allowedRoots.length === 0) {
    return true;
  }
  const resolved = resolve(targetPath);
  return allowedRoots.some((root) => isUnder(root, resolved));
}