import { NextResponse } from "next/server";
import { createTopic, createDraft, updateTopic, createMaterial, updateMaterial } from "@/lib/queries";
import {
  distillResearch,
  extractUrls,
  fetchLinkSources,
  generateForPlatform,
  llmEnabled,
} from "@/lib/generate";
import { finalizeWechatDraft } from "@/lib/finalize-wechat";
import { resolveWritingStyle } from "@/lib/config";
import { normalizeStyle, type WritingStyle } from "@/lib/styles";
import type { Draft, Material, Platform } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 全面以公众号为中心（2026-07-14 起）：洗稿也只出公众号稿，其余平台规范保留在提示词页备用
const VALID: Platform[] = ["wechat"];

// 快速洗稿：粘贴原文 → 建 manual 素材 + 选题 → 生成公众号稿 → 返回选题与稿件
export async function POST(req: Request) {
  if (!(await llmEnabled())) {
    return NextResponse.json({ error: "未配置 DEEPSEEK_API_KEY" }, { status: 501 });
  }
  const body = await req.json().catch(() => ({})); // 非法 JSON 一律按空对象走后续校验（返回 400 而不是裸 500）
  const content: string = (body?.content ?? "").trim();
  const platforms: Platform[] = (body?.platforms ?? []).filter((p: string) =>
    VALID.includes(p as Platform),
  );
  // 板块 = 自由分类字符串：trim 后长度 1-30 才有效，其余归一化为 null（未分类）
  const rawPillar = typeof body?.pillar === "string" ? body.pillar.trim() : "";
  const pillar: string | null = rawPillar && rawPillar.length <= 30 ? rawPillar : null;
  const persona: string = body?.persona ?? "";
  const extra: string = body?.extra ?? "";
  // 真实经历（独立字段）：唯一允许写进第一人称经历的素材来源；为空时防编造骨架锁定生效
  const experience: string = body?.experience ?? "";
  const sourceUrl: string | undefined = body?.sourceUrl || undefined;
  // 写作风格：请求没带就用设置页的默认风格
  const style: WritingStyle =
    body?.style === undefined ? await resolveWritingStyle() : normalizeStyle(body.style);

  if (!content) return NextResponse.json({ error: "请粘贴原文" }, { status: 400 });
  if (platforms.length === 0) return NextResponse.json({ error: "至少选一个平台" }, { status: 400 });

  // 1) 建 manual 素材。dedupe_key 用 UUID：此前用 Date.now()，同一毫秒并发请求会撞键；
  //    再兜一层 on conflict do nothing，撞键时不炸 500 而是明确报错。
  const dedupe = `manual:${crypto.randomUUID()}`;
  const title = content.slice(0, 40).replace(/\n/g, " ");
  // 走 createMaterial 而不是在这儿手写 SQL：guardWrite 与 JSON 列编码都收口在那一层
  const created = await createMaterial({
    source: "manual",
    source_id: dedupe.split(":")[1],
    dedupe_key: dedupe,
    pillar,
    title,
    url: sourceUrl ?? null,
    content,
  });
  // 洗稿进来的素材直接算「已入选」，不用再去收件箱里点一次
  const material = created ? await updateMaterial(created.id, { status: "shortlisted" }) : null;
  if (!material) {
    return NextResponse.json({ error: "素材创建失败（去重键冲突），请重试" }, { status: 500 });
  }

  // 2) 建选题
  const topic = await createTopic({
    title,
    angle: extra || "快速洗稿",
    pillar,
    persona,
    material_ids: [material.id],
    status: "drafting",
  });

  // 3) 链接回溯（2026-07-19 起）：原文里的链接对大模型只是字符串（API 模型不联网），
  //    这里先服务端抓回内容（裸 fetch → Tavily 兜底）并提炼成调研笔记，喂进写作提示词。
  //    sourceUrl 也算一条。抓取/提炼失败不阻断出稿，只进 warnings。
  const linkWarnings: string[] = [];
  let research: string | undefined;
  {
    const urls = extractUrls([content, sourceUrl ?? ""].join("\n"));
    if (urls.length) {
      const { sources, failed } = await fetchLinkSources(urls);
      failed.forEach((u) => linkWarnings.push(`链接抓取失败，未纳入写作素材：${u}`));
      if (sources.length) {
        const distilled = await distillResearch({ topic, sources });
        // 提炼失败退回裸文本截断（与 /api/generate 的兜底同款）
        research =
          distilled ??
          sources.map((s) => `【回溯原文：${s.url}】\n${s.text.slice(0, 3000)}`).join("\n\n");
        // 调研落库进选题，稿件页/重新生成可复用，不用二次抓取
        await updateTopic(topic.id, {
          research: { text: research, fetchedAt: new Date().toISOString() },
        }).catch(() => {});
      }
    }
  }

  // 4) 逐平台生成（当前 VALID 只有公众号）：失败的平台进 errors，成功的照常入库
  const results = await Promise.allSettled(
    platforms.map(async (platform) => {
      const gen = await generateForPlatform({
        topic,
        materials: [material],
        platform,
        research,
        extra,
        experience,
        style,
      });
      return createDraft({
        topic_id: topic.id,
        platform,
        title: gen.title,
        content: gen.content,
        // meta.style（该平台实际生效的风格）由 generateForPlatform 写入
        meta: gen.meta,
        generator: "api",
        status: "draft",
      });
    }),
  );
  const drafts: Draft[] = [];
  const errors: Record<string, string> = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled") drafts.push(r.value);
    else errors[platforms[i]] = r.reason instanceof Error ? r.reason.message : String(r.reason);
  });

  // 公众号稿件收尾：配图 + 封面提示词（与 /api/generate 同一收口，见 lib/finalize-wechat.ts）——
  // 此前洗稿漏了这一步，洗出来的稿子没配图没封面，得到稿件页手动点。
  // 收尾各步的失败说明（warnings）带回前端展示，不再静默吞掉
  const warnings: string[] = [...linkWarnings];
  for (let i = 0; i < drafts.length; i++) {
    const r = await finalizeWechatDraft(drafts[i]);
    drafts[i] = r.draft;
    warnings.push(...r.warnings);
  }

  await updateTopic(topic.id, { status: drafts.length ? "drafting" : "idea" }).catch(() => {});

  return NextResponse.json({ topic, drafts, errors, warnings, firstDraftId: drafts[0]?.id ?? null });
}
