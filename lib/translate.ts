import { generateObject, jsonSchema } from "ai";
import { sql } from "./db";
import { guardRead, guardWrite } from "./queries";
import { getTranslateModel } from "./llm";
import { getPrompt } from "./prompt-store";

// ===== 英文素材批量翻译 =====
// RSS 源大半是英文，素材流页面扫一眼全是英文标题很累。采集入库后把英文条目的
// 标题+摘要批量翻成中文：中文写回 title/summary，英文原文挪进 title_en——
// 沿用「title 中文 + title_en 英文」双字段约定，前端零改动。
//
// 防错位设计（批量翻译最常见的坑是漏译和顺序错位）：
// - 每批 ≤20 条，请求与返回都带素材 id，按 id 回写而不是按数组位置对应
// - 返回里缺的条目直接跳过（title_en 仍为 null，下轮采集会再次进入候选）
// - 单批失败只丢那一批，不影响其他批次；整体失败也不影响采集主流程

const BATCH_SIZE = 20;

// 单批翻译的结构化返回：id 必须原样回传
const TRANSLATE_SCHEMA = jsonSchema<{
  translations: { id: string; title: string; summary?: string }[];
}>({
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
        },
        required: ["id", "title"],
        additionalProperties: false,
      },
    },
  },
  required: ["translations"],
  additionalProperties: false,
});

// 判定「像英文」：CJK 字符占比低于 1/10 视为英文条目。
// 用占比而不是「含英文单词」，避免中文标题里夹的产品名（如 GPT-5）被误判。
export function looksEnglish(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const cjk = (t.match(/[一-鿿぀-ヿ]/g) ?? []).length;
  return cjk / t.length < 0.1;
}

interface Candidate {
  id: string;
  title: string;
  summary: string | null;
}

export interface TranslateResult {
  candidates: number; // 本次找到的英文候选条数
  translated: number; // 成功写回的条数
  failed: number; // 批次失败或模型漏译的条数
  skipped?: string; // 翻译未执行的原因（关了开关 / 没 key）
}

// 翻译近期入库、还没翻过的英文素材。
// 候选条件：title_en 为空（翻过的都会写 title_en）+ 时效性来源 + 未处理 + 标题像英文。
// 幂等：按 id 回写后 title_en 非空，天然不会重复进入候选。
export async function translateNewMaterials(limit = 150): Promise<TranslateResult> {
  const model = await getTranslateModel();
  if (!model) return { candidates: 0, translated: 0, failed: 0, skipped: "翻译引擎未启用或未配置 key" };

  const rows = await guardRead("translateCandidates", () => sql<Candidate>`
    select id, title, summary from ms_materials
    where title_en is null
      and title is not null
      and status = 'new'
      and source = 'rss'
    order by created_at desc
    limit ${limit}`);
  const candidates = rows.filter((r) => looksEnglish(`${r.title} ${r.summary ?? ""}`));
  if (candidates.length === 0) return { candidates: 0, translated: 0, failed: 0 };

  const system = await getPrompt("translate_system");
  const batches: Candidate[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }

  // 批次并发跑（翻译是 IO 等待为主，串行会把 cron 拖得很长）；单批失败只记数不抛
  let translated = 0;
  let failed = 0;
  await Promise.all(
    batches.map(async (batch) => {
      try {
        const input = batch.map((c) => ({
          id: c.id,
          title: c.title,
          summary: c.summary ? c.summary.slice(0, 1200) : undefined,
        }));
        const { object } = await generateObject({
          model,
          schema: TRANSLATE_SCHEMA,
          system,
          prompt: `翻译以下 ${input.length} 条素材：\n${JSON.stringify(input, null, 2)}`,
        });
        const byId = new Map(batch.map((c) => [c.id, c]));
        for (const t of object.translations ?? []) {
          const src = byId.get(t.id);
          if (!src || !t.title?.trim()) continue;
          await guardWrite("applyTranslation", () => sql`
            update ms_materials
            set title = ${t.title.trim()},
                title_en = ${src.title},
                summary = ${t.summary?.trim() || src.summary}
            where id = ${src.id} and title_en is null`);
          byId.delete(t.id);
          translated++;
        }
        failed += byId.size; // 模型漏译的：保持英文原样，下轮再试
      } catch {
        failed += batch.length; // 整批失败：同样保持原样
      }
    }),
  );

  return { candidates: candidates.length, translated, failed };
}
