import { Skeleton, CardGridSkeleton } from "@/components/ui/skeleton";

// 稿件列表加载骨架
export default function DraftsLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">稿件</h1>
        <p className="text-sm text-muted-foreground">发布跟踪：按状态 / 平台 / 板块筛选。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
      </div>
      <CardGridSkeleton count={4} />
    </div>
  );
}
