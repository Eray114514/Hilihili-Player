import { AppShell } from "@/components/AppShell";
import { DirectoryPicker } from "@/components/DirectoryPicker";

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="mb-7">
        <h1 className="text-2xl font-semibold md:text-3xl">设置</h1>
        <p className="mt-2 text-sm text-white/50">添加本机或 NAS 目录后会立即在后台扫描，并自动为缺少封面的视频生成缩略图。</p>
      </div>
      <DirectoryPicker />
    </AppShell>
  );
}
