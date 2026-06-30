"use client";

import { CheckCircle2, ChevronLeft, Folder, LoaderCircle, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getJson, postJson, type FsListResponse, type FsRootsResponse, type LibrariesResponse, type ScanRunsResponse } from "@/lib/api";
import type { ScanRun } from "@hilihili/shared";

export function DirectoryPicker() {
  const [roots, setRoots] = useState<FsRootsResponse["roots"]>([]);
  const [listing, setListing] = useState<FsListResponse | null>(null);
  const [libraries, setLibraries] = useState<LibrariesResponse["libraries"]>([]);
  const [runs, setRuns] = useState<ScanRun[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const refreshStatus = useCallback(async () => {
    const [libraryData, runData] = await Promise.all([getJson<LibrariesResponse>("/libraries"), getJson<ScanRunsResponse>("/scan/runs")]);
    setLibraries(libraryData.libraries);
    setRuns(runData.runs);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getJson<FsRootsResponse>("/fs/roots"),
      getJson<LibrariesResponse>("/libraries"),
      getJson<ScanRunsResponse>("/scan/runs")
    ]).then(async ([rootData, libraryData, runData]) => {
      if (!active) return;
      setRoots(rootData.roots);
      setLibraries(libraryData.libraries);
      setRuns(runData.runs);
      if (rootData.roots[0]) {
        const data = await getJson<FsListResponse>(`/fs/list?path=${encodeURIComponent(rootData.roots[0].path)}`);
        if (active) { setListing(data); setSelectedPath(data.path); }
      }
    });
    const timer = window.setInterval(() => void refreshStatus(), 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [refreshStatus]);

  async function openPath(path: string) {
    const data = await getJson<FsListResponse>(`/fs/list?path=${encodeURIComponent(path)}`);
    setListing(data);
    setSelectedPath(data.path);
  }

  async function addLibrary() {
    if (!selectedPath) return;
    await postJson<{ scanRunId: string }>("/libraries", { rootPath: selectedPath });
    setMessage("媒体库已添加，正在后台扫描");
    await refreshStatus();
  }

  async function scanAll() {
    await postJson<{ scanRunId: string }>("/scan/runs", {});
    setMessage("扫描任务已加入队列");
    await refreshStatus();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="overflow-hidden rounded-xl border border-white/8 bg-white/[0.025]">
        <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
          <div><h2 className="font-semibold">选择媒体目录</h2><p className="mt-1 text-sm text-white/42">{selectedPath ?? "选择一个目录"}</p></div>
          <button className="icon-button" onClick={() => void refreshStatus()} title="刷新"><RefreshCw size={18} /></button>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-[160px_minmax(0,1fr)]">
          <div className="flex gap-2 overflow-x-auto md:block md:space-y-2">
            {roots.map((root) => <button key={root.path} onClick={() => void openPath(root.path)} className="w-full shrink-0 rounded-lg bg-white/6 px-3 py-2 text-left text-sm hover:bg-white/10">{root.name}</button>)}
          </div>
          <div className="min-h-[360px] rounded-xl bg-black/20 p-3">
            {listing?.parent ? <button className="mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/65 hover:bg-white/8" onClick={() => void openPath(listing.parent!)}><ChevronLeft size={17} /> 上一级</button> : null}
            <div className="grid gap-1">
              {listing?.entries.map((entry) => <button key={entry.path} onClick={() => void openPath(entry.path)} className="flex min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/8"><Folder className="shrink-0 text-[var(--accent-2)]" size={19} /><span className="truncate text-sm">{entry.name}</span></button>)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-white/8 px-4 py-4">
          <button className="primary-button" onClick={() => void addLibrary()}><Plus size={17} /> 添加并扫描</button>
          <button className="secondary-button" onClick={() => void scanAll()}><RefreshCw size={17} /> 扫描全部</button>
          {message ? <span className="text-sm text-[var(--accent)]">{message}</span> : null}
        </div>
      </section>

      <section className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
        <div className="flex items-center justify-between"><h2 className="font-semibold">媒体库与任务</h2><span className="text-xs text-white/35">自动刷新</span></div>
        <div className="mt-4 space-y-3">
          {libraries.length === 0 ? <p className="py-8 text-center text-sm text-white/40">还没有添加媒体库</p> : libraries.map((library) => {
            const run = runs.find((item) => item.libraryId === library.id) ?? runs.find((item) => item.libraryId === null);
            return <div key={library.id} className="rounded-xl bg-black/22 p-3"><div className="flex items-start gap-3"><div className="mt-0.5"><RunIcon run={run} /></div><div className="min-w-0 flex-1"><div className="font-medium">{library.name}</div><div className="mt-1 truncate text-xs text-white/38" title={library.rootPath}>{library.rootPath}</div>{run ? <RunProgress run={run} /> : <p className="mt-3 text-xs text-white/35">尚未扫描</p>}</div></div></div>;
          })}
        </div>
      </section>
    </div>
  );
}

function RunIcon({ run }: { run?: ScanRun }) {
  if (!run || run.status === "complete") return <CheckCircle2 className="text-emerald-400" size={19} />;
  if (run.status === "failed") return <TriangleAlert className="text-red-400" size={19} />;
  return <LoaderCircle className="animate-spin text-[var(--accent)]" size={19} />;
}

function RunProgress({ run }: { run: ScanRun }) {
  const thumbnailDone = run.thumbnailsReady + run.thumbnailsFailed;
  const progress = run.thumbnailsTotal > 0 ? Math.round((thumbnailDone / run.thumbnailsTotal) * 100) : run.status === "complete" ? 100 : 12;
  const label = run.status === "queued" ? "等待扫描" : run.status === "running" ? (run.thumbnailsTotal > 0 ? `生成缩略图 ${thumbnailDone}/${run.thumbnailsTotal}` : `正在索引 · 已发现 ${run.itemsIndexed}`) : run.status === "failed" ? `失败：${run.message ?? "未知错误"}` : `完成 · ${run.itemsIndexed} 个内容`;
  // 扫描自检：失败/跳过计数仅在 >0 时展示，便于发现"个别条目异常但整体完成"的情况。
  const warnings: string[] = [];
  if (run.itemsFailed > 0) warnings.push(`${run.itemsFailed} 失败`);
  if (run.itemsSkipped > 0) warnings.push(`${run.itemsSkipped} 跳过`);
  const warning = warnings.length > 0 ? warnings.join(" · ") : null;
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex justify-between text-xs text-white/48"><span>{label}</span><span>{progress}%</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${progress}%` }} /></div>
      {warning ? <div className={`mt-1.5 text-xs ${run.itemsFailed > 0 ? "text-red-400" : "text-white/40"}`}>{warning}</div> : null}
    </div>
  );
}
