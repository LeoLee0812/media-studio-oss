import { NextResponse } from "next/server";
import { getDraft, updateDraft } from "@/lib/queries";
import { llmConfigured, imageConfigured } from "@/lib/config";
import {
  planAiIllustrationAnchors,
  buildAiIllustrationPrompt,
  generateAiIllustrationImage,
  aiIllustrationFilename,
  resolveAiIllustrateStyle,
  uploadIllustrationToBlob,
  MAX_AI_ILLUSTRATIONS,
  type AnchorPlan,
} from "@/lib/illustrate-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// AI 生成配图（并存的第二条正文配图链路，不搜图）：POST { title?, content?, styleKey?, maxImages? }
// 与 illustrate（图库搜图）的差异：不挑视觉呼吸感位置，而是拆认知锚点（核心判断/断点/
// 对比/常见坑），按所选风格（手绘知识风 / 怪诞小人风）用 gpt-image-2 现生现画，
// 每张图都带信息价值而非纯装饰。核心流水线在 lib/illustrate-ai.ts。
// 成本提醒：一张图真金白银，单次硬上限 MAX_AI_ILLUSTRATIONS 张，且只在本路由被手动调用时触发。
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
    // ① 拆认知锚点（一次 LLM 调用，不产生图像成本）
    const anchors = await planAiIllustrationAnchors({ title: curTitle, content: curContent, maxImages });

    // ② 逐个锚点拼提示词 + 生图（真金白银，严格按 anchors.length ≤ maxImages 顺序执行，不并发放大瞬时成本）
    const blocks = curContent.split(/\n{2,}/);
    const succeeded: { anchor: AnchorPlan; url: string; size: string; filename: string }[] = [];
    const failedCaptions: string[] = [];
    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[i];
      try {
        const prompt = await buildAiIllustrationPrompt({ title: curTitle, anchor, styleKey });
        const { b64, size } = await generateAiIllustrationImage({ prompt, ratio: "16:9" });
        // 生完立刻传 Blob 换直链：base64 既粘不进公众号也会撑爆正文和响应体，
        // 全链路只在这一行之内碰 base64，往后一律只传 URL
        const filename = aiIllustrationFilename(i, anchor.caption);
        const url = await uploadIllustrationToBlob({ b64, filename });
        succeeded.push({ anchor, url, size, filename });
      } catch (e) {
        console.error("[illustrate-ai] 单张生图/上传失败：", e);
        failedCaptions.push(anchor.caption);
      }
    }
    if (succeeded.length === 0) {
      throw new Error("认知锚点已拆出，但生图全部失败，请重试");
    }

    // ③ 从后往前插入正文（Blob 公网直链，编号不受影响，与图库配图链路同规则）
    const parts = [...blocks];
    for (let i = succeeded.length - 1; i >= 0; i--) {
      const { anchor, url } = succeeded[i];
      parts.splice(anchor.after, 0, `![${anchor.caption}](${url})`);
    }
    const newContent = parts.join("\n\n");

    // 落库前重新读一次稿件：生图链路要跑数十秒到几分钟，期间封面/图库配图等并发写可能已改过
    // meta（与 illustrate 路由同款做法），用入口时的旧快照合并会把它们覆盖掉
    const fresh = await getDraft(id);
    const aiIllustrations = succeeded.map((s) => ({
      filename: s.filename,
      caption: s.anchor.caption,
      coreIdea: s.anchor.coreIdea,
      visualAnchor: s.anchor.visualAnchor,
      url: s.url,
      styleKey,
    }));
    const meta = { ...(((fresh ?? draft).meta as object) ?? {}), aiIllustrations };
    await updateDraft(id, { title: curTitle, content: newContent, meta });

    return NextResponse.json({
      content: newContent,
      images: succeeded.map((s) => ({
        filename: s.filename,
        caption: s.anchor.caption,
        coreIdea: s.anchor.coreIdea,
        visualAnchor: s.anchor.visualAnchor,
        url: s.url,
        size: s.size,
      })),
      failedCount: failedCaptions.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `AI 生成配图失败：${msg}，请重试` }, { status: 500 });
  }
}
