import { listTopics } from "@/lib/queries";
import { TopicsBoard } from "@/components/TopicsBoard";

export const dynamic = "force-dynamic";

export default async function TopicsPage() {
  const topics = await listTopics();
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">选题看板</h1>
        <p className="text-sm text-muted-foreground">
          用左右箭头在 想法 → 已选 → 写作中 → 完成 之间流转。
        </p>
      </div>
      <TopicsBoard topics={topics} />
    </div>
  );
}
