import { Skeleton, CardGridSkeleton } from "@/components/ui/skeleton";

// 素材流加载骨架：切页/改筛选时立即展示，替代白屏卡顿
export default function InboxLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">素材流</h1>
        <p className="text-sm text-muted-foreground">从素材里发现选题，别原样搬运。</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-48" />
      </div>
      <CardGridSkeleton count={6} />
    </div>
  );
}
