import { AppShell } from "@/components/AppShell";
import { DirectoryPicker } from "@/components/DirectoryPicker";

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="mb-7">
        <h1 className="text-2xl font-semibold md:text-3xl">设置</h1>
        <p className="mt-2 text-sm text-white/50">添加本机或 NAS 挂载目录，Hilihili 会直接读取文件系统构建索引。</p>
      </div>
      <DirectoryPicker />
    </AppShell>
  );
}
