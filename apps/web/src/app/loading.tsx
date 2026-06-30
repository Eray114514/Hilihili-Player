import { AppShell } from "@/components/AppShell";

export default function Loading() {
  return (
    <AppShell>
      <div className="grid skeleton-shimmer grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {Array.from({ length: 12 }, (_, index) => (
          <div key={index}>
            <div className="aspect-video rounded-xl bg-white/5" />
            <div className="mt-2 h-4 rounded bg-white/5" />
            <div className="mt-2 h-3 w-1/2 rounded bg-white/[0.035]" />
          </div>
        ))}
      </div>
    </AppShell>
  );
}
