import { listMaterialsLite, listTopics } from "@/lib/queries";
import { llmEnabled } from "@/lib/generate";
import { InboxClient } from "@/components/InboxClient";
import type { TopicStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

// listMaterialsLite 的默认上限；拉满说明库里还有更旧的素材没进来
const MATERIALS_LIMIT = 2000;

// 「挂到选题」只列活跃选题：想法/已选/写作中（完成、放弃的不该再收素材）
const ACTIVE_TOPIC_STATUSES: TopicStatus[] = ["idea", "selected", "drafting"];

export default async function InboxPage() {
  // 一次性拉全部素材（轻量列）+ 选题；筛选/搜索全部在客户端瞬时完成，切筛选不再往返查库
  const [materials, topics, llmOn] = await Promise.all([
    listMaterialsLite(MATERIALS_LIMIT),
    listTopics(),
    llmEnabled(),
  ]);

  // 服务端过滤出活跃选题，按最近更新倒序（最常用的排前面）
  const activeTopics = topics
    .filter((t) => ACTIVE_TOPIC_STATUSES.includes(t.status))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  // 达到上限说明被截断：最旧的素材没加载进来，给个显式提示
  const truncated = materials.length >= MATERIALS_LIMIT;

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">素材流</h1>
        <p className="text-sm text-muted-foreground">从素材里发现选题，别原样搬运。</p>
      </div>
      {truncated && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          素材库已超展示上限（{MATERIALS_LIMIT} 条），最旧的素材未加载。
        </p>
      )}
      <InboxClient materials={materials} topics={activeTopics} llmEnabled={llmOn} />
    </div>
  );
}
