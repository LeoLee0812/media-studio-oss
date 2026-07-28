import { Skeleton } from "@/components/ui/skeleton";

// 选题看板加载骨架
export default function TopicsLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">选题看板</h1>
        <p className="text-sm text-muted-foreground">
          用左右箭头在 想法 → 已选 → 写作中 → 完成 之间流转。
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-lg border p-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
