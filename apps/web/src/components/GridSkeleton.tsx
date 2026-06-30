// 通用视频网格骨架，count 控制卡片数量，默认 12
export function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid skeleton-shimmer grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {Array.from({ length: count }, (_, index) => (
        <div key={index}>
          <div className="aspect-video rounded-xl bg-white/5" />
          <div className="mt-2 h-4 rounded bg-white/5" />
          <div className="mt-2 h-3 w-1/2 rounded bg-white/[0.035]" />
        </div>
      ))}
    </div>
  );
}
