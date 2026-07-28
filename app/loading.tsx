import { Skeleton } from "@/components/ui/skeleton";

// 仪表盘（及未单独定义 loading 的路由）加载骨架
export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <Skeleton className="h-8 w-40" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
