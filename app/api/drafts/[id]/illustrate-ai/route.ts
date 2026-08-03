import { NextResponse } from "next/server";
import { getDraft, updateDraft } from "@/lib/queries";
import { llmConfigured, imageConfigured } from "@/lib/config";
import {
  illustrateArticleWithAi,
  resolveAiIllustrateStyle,
  MAX_AI_ILLUSTRATIONS,
} from "@/lib/illustrate-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// AI 生成配图（并存的第二条正文配图链路，不搜图）：POST { title?, content?, styleKey?, maxImages? }
// 与 illustrate（图库搜图）的差异：不挑视觉呼吸感位置，而是拆认知锚点（核心判断/断点/
// 对比/常见坑），按所选风格（手绘知识风 / 怪诞小人风）用 gpt-image-2 现生现画，
// 每张图都带信息价值而非纯装饰。编排本体在 lib/illustrate-ai.ts 的 illustrateArticleWithAi，
// 与生文流水线（lib/finalize-wechat.ts 按设置页预设自动配图）共用同一份实现。
// 成本提醒：一张图真金白银，单次硬上限 MAX_AI_ILLUSTRATIONS 张。
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await llmConfigured())) {
    return NextResponse.json({ error: "未配置文案引擎 API Key" }, { status: 501 });
  }
  if (!(await imageConfigured())) {
    return NextResponse.json(
      { error: "未配置生图中转 API Key（设置页 → AI 封面图 / 生图中转）" },
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
  const styleKey = resolveAiIllustrateStyle(body?.styleKey).key;
  const maxImages = Math.max(
    1,
    Math.min(Number(body?.maxImages) || MAX_AI_ILLUSTRATIONS, MAX_AI_ILLUSTRATIONS),
  );

  try {
    const { content: newContent, images, failedCount } = await illustrateArticleWithAi({
      title: curTitle,
      content: curContent,
      styleKey,
      maxImages,
    });

    // 落库前重新读一次稿件：生图链路要跑数十秒到几分钟，期间封面/图库配图等并发写可能已改过
    // meta（与 illustrate 路由同款做法），用入口时的旧快照合并会把它们覆盖掉
    const fresh = await getDraft(id);
    const aiIllustrations = images.map((i) => ({
      filename: i.filename,
      caption: i.caption,
      coreIdea: i.coreIdea,
      visualAnchor: i.visualAnchor,
      url: i.url,
      styleKey,
    }));
    const meta = { ...(((fresh ?? draft).meta as object) ?? {}), aiIllustrations };
    await updateDraft(id, { title: curTitle, content: newContent, meta });

    return NextResponse.json({ content: newContent, images, failedCount });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `AI 生成配图失败：${msg}，请重试` }, { status: 500 });
  }
}
