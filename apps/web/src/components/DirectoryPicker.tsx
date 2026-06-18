"use client";

import { ChevronLeft, Folder, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { getJson, postJson, type FsListResponse, type FsRootsResponse, type LibrariesResponse } from "@/lib/api";

export function DirectoryPicker() {
  const [roots, setRoots] = useState<FsRootsResponse["roots"]>([]);
  const [listing, setListing] = useState<FsListResponse | null>(null);
  const [libraries, setLibraries] = useState<LibrariesResponse["libraries"]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const [rootData, libraryData] = await Promise.all([
      getJson<FsRootsResponse>("/fs/roots"),
      getJson<LibrariesResponse>("/libraries")
    ]);
    setRoots(rootData.roots);
    setLibraries(libraryData.libraries);
    if (!listing && rootData.roots[0]) {
      await openPath(rootData.roots[0].path);
    }
  }

  async function openPath(path: string) {
    const data = await getJson<FsListResponse>(`/fs/list?path=${encodeURIComponent(path)}`);
    setListing(data);
    setSelectedPath(data.path);
  }

  async function addLibrary() {
    if (!selectedPath) {
      return;
    }
    await postJson("/libraries", { rootPath: selectedPath });
    setMessage("媒体库已添加");
    await refresh();
  }

  async function scanAll() {
    setMessage("正在扫描...");
    const result = await postJson<{ itemsIndexed: number }>("/scan/runs", {});
    setMessage(`扫描完成，索引 ${result.itemsIndexed} 个内容`);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="rounded-lg border border-white/8 bg-white/[0.035]">
        <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
          <div>
            <h2 className="font-semibold">可视化目录选择</h2>
            <p className="mt-1 text-sm text-white/45">{selectedPath ?? "选择一个目录"}</p>
          </div>
          <button className="icon-button" onClick={refresh} title="刷新">
            <RefreshCw size={18} />
          </button>
        </div>

        <div className="grid gap-3 p-4 md:grid-cols-[160px_minmax(0,1fr)]">
          <div className="flex gap-2 overflow-x-auto md:block md:space-y-2">
            {roots.map((root) => (
              <button key={root.path} onClick={() => openPath(root.path)} className="w-full shrink-0 rounded-lg bg-white/6 px-3 py-2 text-left text-sm hover:bg-white/10">
                {root.name}
              </button>
            ))}
          </div>

          <div className="min-h-[360px] rounded-lg bg-black/22 p-3">
            {listing?.parent ? (
              <button className="mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/8" onClick={() => openPath(listing.parent!)}>
                <ChevronLeft size={17} /> 上一级
              </button>
            ) : null}
            <div className="grid gap-1">
              {listing?.entries.map((entry) => (
                <button key={entry.path} onClick={() => openPath(entry.path)} className="flex min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/8">
                  <Folder className="shrink-0 text-[var(--accent-2)]" size={19} />
                  <span className="truncate text-sm">{entry.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-white/8 px-4 py-4">
          <button className="primary-button" onClick={addLibrary}>
            <Plus size={17} /> 添加当前目录
          </button>
          <button className="secondary-button" onClick={scanAll}>
            <RefreshCw size={17} /> 扫描全部媒体库
          </button>
          {message ? <span className="text-sm text-[var(--accent)]">{message}</span> : null}
        </div>
      </section>

      <section className="rounded-lg border border-white/8 bg-white/[0.035] p-4">
        <h2 className="font-semibold">已添加媒体库</h2>
        <div className="mt-4 space-y-3">
          {libraries.length === 0 ? <p className="text-sm text-white/45">还没有添加媒体库。</p> : null}
          {libraries.map((library) => (
            <div key={library.id} className="rounded-lg bg-black/24 p-3">
              <div className="font-medium">{library.name}</div>
              <div className="mt-1 break-all text-xs text-white/45">{library.rootPath}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
