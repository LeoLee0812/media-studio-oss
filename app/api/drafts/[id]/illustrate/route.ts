import { NextResponse } from "next/server";
import { getDraft, updateDraft } from "@/lib/queries";
import { llmConfigured, imageSearchConfigured } from "@/lib/config";
import { illustrateArticle } from "@/lib/illustrate-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// AI 配图（手动重配入口）：POST { title?, content? }
// 生成公众号正文时已自动配图（见 /api/generate）；此路由供稿件页对旧稿/改稿后重新配图。
// 核心流水线在 lib/illustrate-server.ts。
// 插好图的正文与新配图清单**同步落库**——此前不落库、等前端随保存提交，结果 meta.illustrations
// 永远停留在旧清单（保存路径根本不带它），「下载图片」会下到跟正文对不上的旧图。
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await llmConfigured())) {
    return NextResponse.json({ error: "未配置文案引擎 API Key" }, { status: 501 });
  }
  if (!(await imageSearchConfigured())) {
    return NextResponse.json(
      { error: "未配置搜图 API Key（设置页 → 文章配图搜图）" },
      { status: 501 },
    );
  }
  const { id } = await params;
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: "未找到" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const curTitle: string = typeof body?.title === "string" ? body.title : draft.title ?? "";
  const curContent: string =
    typeof body?.content === "string" && body.content ? body.content : draft.content ?? "";

  try {
    const result = await illustrateArticle({ title: curTitle, content: curContent });
    // 落库前重新读一次稿件：illustrateArticle 要跑 10-30 秒，期间封面生成等并发写可能已改过
    // meta（cover/image 路由同款做法），用入口时的旧快照合并会把它们覆盖掉
    const fresh = await getDraft(id);
    const meta = { ...(((fresh ?? draft).meta as object) ?? {}), illustrations: result.images };
    // 标题也一起落库：前端把「AI 配图成功」当成已保存并重置脏检查基线，
    // 若只存正文不存标题，用户未保存的标题改动会在无提示的情况下静默丢失
    await updateDraft(id, { title: curTitle, content: result.content, meta });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `AI 配图失败：${msg}，请重试` }, { status: 500 });
  }
}
