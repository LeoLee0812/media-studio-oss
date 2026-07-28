import { NextResponse } from "next/server";
import {
  generateCoverImage,
  generateCoverImageFromAnchor,
  generateCoverImageFromTemplate,
  generateCoverPrompt,
  imageEnabled,
  type CoverSpec,
} from "@/lib/cover";
import { llmEnabled } from "@/lib/generate";
import { getDraft, updateDraft, getSyncState, setSyncState } from "@/lib/queries";
import type { DraftMeta } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 封面图（base64）落 ms_sync_state，键按稿件分：图片不进 ms_drafts，避免拖慢稿件列表查询
const imageKey = (draftId: string) => `cover_image:${draftId}`;

interface StoredCover {
  b64: string;
  size: string;
  ratio: string;
  updatedAt: string;
}

// 读取已生成并落库的封面图：GET /api/cover/image?draftId=...
export async function GET(req: Request) {
  const draftId = new URL(req.url).searchParams.get("draftId");
  if (!draftId) return NextResponse.json({ error: "缺少 draftId" }, { status: 400 });
  const stored = (await getSyncState(imageKey(draftId)).catch(() => null)) as StoredCover | null;
  if (!stored?.b64) return NextResponse.json({ found: false });
  return NextResponse.json({ found: true, ...stored });
}

// 生成封面图，两条链路：
// - 模板直生（mode="template"，或稿件 meta.cover.mode 存的是 template）：不走文案引擎，
//   带该风格的模板参考图 + 标题直接调图像模型的 /images/edits。
// - 提示词链路（旧）：
//   · 传 draftId：从稿件 meta.cover 取提示词（没有则先按稿件现写一段），生成后图片落库、meta 更新，
//     选题页「正文+封面同步生成」走的就是这条路。
//   · 传 prompt：直接按给定提示词生图（稿件页手动编辑后的重新生成），带 draftId 时同样落库。
export async function POST(req: Request) {
  if (!(await imageEnabled())) {
    return NextResponse.json(
      { error: "未配置 IMAGE_API_KEY，生图功能不可用" },
      { status: 501 },
    );
  }
  const body = await req.json().catch(() => ({})); // 非法 JSON 一律按空对象走后续校验（返回 400 而不是裸 500）
  const draftId: string = (body?.draftId ?? "").trim();
  let prompt: string = (body?.prompt ?? "").trim();
  let ratio: string = body?.ratio ?? "";
  let style: string = body?.style ?? "";
  let mode: string = body?.mode ?? "";
  let title: string = (body?.title ?? "").trim();
  // 锚点直生要拿正文去拆字段；前端传的是编辑区实时内容，没传就回落到落库的稿件正文
  let content: string = (body?.content ?? "").trim();
  const extra: string = (body?.extra ?? "").trim();

  if (draftId) {
    const draft = await getDraft(draftId);
    if (!draft) return NextResponse.json({ error: "稿件不存在" }, { status: 404 });
    const cover = ((draft.meta as DraftMeta | null)?.cover ?? {}) as {
      prompt?: string;
      style?: string;
      ratio?: string;
      mode?: string;
    };
    ratio = ratio || cover.ratio || "2.35:1";
    style = style || cover.style || "viral_tech";
    mode = mode || cover.mode || "";
    title = title || draft.title || "";
    content = content || draft.content || "";
    if (!prompt) prompt = (cover.prompt ?? "").trim();
    // 稿件还没有提示词（且不是模板直生 / 锚点直生）：按当前稿件即时生成一段（文案引擎），再去生图
    if (!prompt && mode !== "template" && mode !== "anchor") {
      if (!(await llmEnabled())) {
        return NextResponse.json({ error: "稿件没有封面提示词，且未配置文案引擎" }, { status: 400 });
      }
      prompt = await generateCoverPrompt({
        title: draft.title ?? "",
        content: draft.content ?? "",
        style,
        ratio,
      });
    }
  }
  ratio = ratio || "2.35:1";
  if (mode === "template" || mode === "anchor") {
    if (!title) return NextResponse.json({ error: "直生链路需要标题（title）" }, { status: 400 });
    if (mode === "anchor" && !(await llmEnabled())) {
      return NextResponse.json({ error: "锚点直生要靠文案引擎拆封面字段，未配置文案引擎" }, { status: 400 });
    }
  } else if (!prompt) {
    return NextResponse.json({ error: "提示词不能为空" }, { status: 400 });
  }

  try {
    // 锚点直生把拆出来的字段一并回给前端，方便用户看清这张图是按什么字段画的
    let spec: CoverSpec | undefined;
    let b64: string;
    let size: string;
    if (mode === "template") {
      ({ b64, size } = await generateCoverImageFromTemplate({ title, style, ratio, extra }));
    } else if (mode === "anchor") {
      ({ b64, size, spec } = await generateCoverImageFromAnchor({
        title,
        content,
        style,
        ratio,
        extra,
      }));
    } else {
      ({ b64, size } = await generateCoverImage({ prompt, ratio }));
    }
    if (draftId) {
      const updatedAt = new Date().toISOString();
      // 图片本体落 sync_state；链路/提示词/风格/比例照旧落稿件 meta.cover
      await setSyncState(imageKey(draftId), { b64, size, ratio, updatedAt } satisfies StoredCover).catch(
        () => {},
      );
      const draft = await getDraft(draftId);
      if (draft) {
        const cover =
          mode === "template" || mode === "anchor"
            ? { mode, style: style || "viral_tech", ratio, generatedAt: updatedAt, spec }
            : { prompt, style: style || "viral_tech", ratio, generatedAt: updatedAt };
        const meta = { ...((draft.meta as object) ?? {}), cover };
        await updateDraft(draftId, { meta }).catch(() => {});
      }
    }
    return NextResponse.json({ b64, size, ratio, prompt, mode, spec });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
