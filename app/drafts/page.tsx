import { listDrafts } from "@/lib/queries";
import { DraftsList } from "@/components/DraftsList";
import {
  DRAFT_STATUS_LABELS,
  PLATFORM_LABELS,
  type DraftStatus,
  type Platform,
} from "@/lib/types";

export const dynamic = "force-dynamic";

// 查询参数校验：只接受合法枚举值，非法值当作未过滤（避免脏参数打进 SQL 枚举列报错）
function pick<T extends string>(labels: Record<T, string>, v: string | undefined): T | undefined {
  return v && v in labels ? (v as T) : undefined;
}

export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  // 支持 ?status=draft 等外链过滤（仪表盘会直接链过来）
  const status = pick<DraftStatus>(DRAFT_STATUS_LABELS, sp.status);
  const platform = pick<Platform>(PLATFORM_LABELS, sp.platform);
  // 板块是自由分类字符串：非空即接受（参数化查询，无注入风险），超长截断 30 字符
  const pillar = sp.pillar?.trim().slice(0, 30) || undefined;
  const drafts = await listDrafts({ status, platform, pillar });

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">稿件</h1>
        <p className="text-sm text-muted-foreground">发布跟踪：按状态 / 平台 / 板块筛选。</p>
      </div>
      <DraftsList
        drafts={drafts}
        filters={{ status, platform, pillar }}
      />
    </div>
  );
}
