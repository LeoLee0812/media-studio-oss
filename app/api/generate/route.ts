import { NextResponse } from "next/server";
import {
  getTopic,
  getMaterials,
  createDraft,
  updateTopic,
} from "@/lib/queries";
import { finalizeWechatDraft } from "@/lib/finalize-wechat";
import {
  generateForPlatform,
  distillResearch,
  fetchOriginal,
  llmEnabled,
} from "@/lib/generate";
import { resolveWritingStyle } from "@/lib/config";
import { normalizeStyle, type WritingStyle } from "@/lib/styles";
import type { Draft } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 解析 ms_topics.research jsonb，只取调研文本 text。
// 历史形态兼容：纯字符串 / { text } / { text, master, masterAt, masterStyle }。
// 母稿两步制已砍（2026-07-14），master 等历史键原样保留在 rest 里写回，不再读也不清除。
function parseResearch(raw: unknown): { text: string; rest: Record<string, unknown> } {
  if (typeof raw === "string") return { text: raw, rest: {} };
  if (raw && typeof raw === "object") {
    const { text, ...rest } = raw as Record<string, unknown>;
    return { text: String(text ?? ""), rest };
  }
  return { text: "", rest: {} };
}

// 生成稿件（单步，只出公众号）：
// 自动回溯调研（research.text 为空时抓原文提炼）→ 四阶段单步直出公众号成稿 → 配图 + 封面提示词。
// 母稿两步制已砍：单平台出稿下两步制只多烧一篇母稿的 tokens，没有收益。
export async function POST(req: Request) {
  if (!(await llmEnabled())) {
    return NextResponse.json(
      { error: "未配置文案引擎 API Key，生成功能不可用" },
      { status: 501 },
    );
  }

  const body = await req.json().catch(() => ({})); // 非法 JSON 一律按空对象走后续校验（返回 400 而不是裸 500）
  const topicId: string = body?.topicId;
  const extra: string = body?.extra ?? "";
  // 真实经历（独立字段）：唯一允许写进第一人称经历的素材来源；为空时防编造骨架锁定生效。
  const experience: string = body?.experience ?? "";
  // 写作风格：请求没带就用设置页的默认风格
  const style: WritingStyle =
    body?.style === undefined ? await resolveWritingStyle() : normalizeStyle(body.style);

  if (!topicId) return NextResponse.json({ error: "缺少 topicId" }, { status: 400 });

  const topic = await getTopic(topicId);
  if (!topic) return NextResponse.json({ error: "选题不存在" }, { status: 404 });

  const materials = await getMaterials(topic.material_ids ?? []);

  // 调研文本：优先用已有 research.text；为空则对有 url 的素材回溯原文并提炼
  const parsed = parseResearch(topic.research);
  let research = parsed.text;
  let researchRest = parsed.rest;

  if (!research) {
    const withUrl = materials.filter((m) => m.url);
    const sources: { url: string; text: string }[] = [];
    for (const m of withUrl.slice(0, 3)) {
      const txt = await fetchOriginal(m.url!);
      if (txt) sources.push({ url: m.url!, text: txt });
    }
    if (sources.length) {
      // 先把裸网页文本提炼成结构化调研笔记（关键数据+出处/原话/案例/争议点），
      // 写作 prompt 吃提炼结果；提炼失败才退回裸文本截断兜底
      const distilled = await distillResearch({ topic, sources });
      research =
        distilled ??
        sources
          .map((s) => `【回溯原文：${s.url}】\n${s.text.slice(0, 3000)}`)
          .join("\n\n");
      researchRest = { ...researchRest, fetchedAt: new Date().toISOString() };
      // 回溯+提炼结果落库，避免下次重复抓取
      await updateTopic(topicId, {
        research: { ...researchRest, text: research },
      }).catch(() => {});
    }
  }

  // 单步生成公众号稿
  const drafts: Draft[] = [];
  const errors: Record<string, string> = {};
  try {
    const gen = await generateForPlatform({
      topic,
      materials,
      platform: "wechat",
      research,
      extra,
      experience,
      style,
    });
    drafts.push(
      await createDraft({
        topic_id: topicId,
        platform: "wechat",
        title: gen.title,
        content: gen.content,
        // meta.style（实际生效的风格）由 generateForPlatform 写入，稿件页 AI 修改/AI 标题据此沿用
        meta: gen.meta,
        generator: "api",
        status: "draft",
      }),
    );
  } catch (e) {
    errors["wechat"] = e instanceof Error ? e.message : String(e);
  }

  // 公众号稿件收尾：配图 + 封面提示词（共用收口，见 lib/finalize-wechat.ts）。
  // 收尾各步的失败说明（warnings）带回前端展示，不再静默吞掉
  const warnings: string[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const r = await finalizeWechatDraft(drafts[i]);
    drafts[i] = r.draft;
    warnings.push(...r.warnings);
  }

  // 选题状态推进：idea / selected 都推进到 drafting（主流程从 inbox 立的选题是 selected）
  if (drafts.length > 0 && ["idea", "selected"].includes(topic.status)) {
    await updateTopic(topicId, { status: "drafting" }).catch(() => {});
  }

  return NextResponse.json({ drafts, errors, warnings });
}
