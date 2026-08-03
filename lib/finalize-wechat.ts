import type { Draft } from "./types";
import { imageSearchConfigured, imageConfigured, llmConfigured, getImagePreset } from "./config";
import { illustrateArticle } from "./illustrate-server";
import { illustrateArticleWithAi } from "./illustrate-ai";
import { templateAvailability } from "./cover";
import { updateDraft } from "./queries";

// ===== 公众号稿件的生成收尾：配图 + 封面提示词 =====
// 正文落库后同一步完成「AI 配图 + 封面绘图提示词」，做到正文/配图/封面一次生成：
// ① AI 配图：插图 markdown 直接写回正文，图片清单存 meta.illustrations（前端随后自动下载原图）
// ② 封面绘图提示词（默认 2.35:1）写进 meta.cover，前端紧接着调 /api/cover/image 自动生图
// 各步失败都不阻断正文产出，但**必须把失败说出来**（warnings 随 API 响应回前端）——
// 此前只 console.error，用户看到的就是「配图/封面凭空消失」，完全不知道发生过什么。
//
// 收口约定：所有产出公众号稿的 API 路径（/api/generate、/api/rewrite）落库后都必须调它，
// 不许在调用点各写一份——曾经洗稿路径就是漏了这一步，洗出来的稿子没配图没封面。

export interface FinalizeResult {
  draft: Draft;
  // 各步的失败说明（空数组 = 全部成功）。调用方应把它带回前端展示。
  warnings: string[];
}

export async function finalizeWechatDraft(d: Draft): Promise<FinalizeResult> {
  if (d.platform !== "wechat") return { draft: d, warnings: [] };

  const warnings: string[] = [];
  const meta = { ...((d.meta as object) ?? {}) } as Record<string, unknown>;
  let content = d.content ?? "";

  // 配图与封面都按设置页的预设走（lib/config.ts 的 resolveImagePreset）：
  // 用户预设一次「搜图 / AI 生图 / 不配图 + 封面风格」，此后每篇自动照办，
  // 不再是「先出稿，再回稿件页逐篇挑一次」。逐篇临时改仍在稿件页可做。
  const preset = await getImagePreset();
  meta.imagePreset = { mode: preset.mode, aiStyle: preset.aiStyleKey, coverStyle: preset.coverStyle.key };

  if (preset.mode === "off") {
    warnings.push("按预设「不配图」跳过了自动配图（稿件页可手动配图）");
  } else if (preset.mode === "ai") {
    // AI 生图解：慢（每张 30-60 秒）且真金白银，张数由预设的 aiCount 收紧
    if (!(await llmConfigured())) {
      warnings.push("预设为 AI 生成配图，但未配置文案引擎 Key（拆不出认知锚点），本篇没有配图");
    } else if (!(await imageConfigured())) {
      warnings.push("预设为 AI 生成配图，但未配置生图中转 Key，本篇没有配图");
    } else {
      try {
        const r = await illustrateArticleWithAi({
          title: d.title ?? "",
          content,
          styleKey: preset.aiStyleKey,
          maxImages: preset.aiCount,
        });
        content = r.content;
        meta.aiIllustrations = r.images.map((i) => ({
          filename: i.filename,
          caption: i.caption,
          coreIdea: i.coreIdea,
          visualAnchor: i.visualAnchor,
          url: i.url,
          styleKey: preset.aiStyleKey,
        }));
        if (r.failedCount) warnings.push(`AI 配图有 ${r.failedCount} 张生图失败已跳过`);
      } catch (e) {
        console.error("[finalize-wechat] AI 自动配图失败（不阻断）", e);
        warnings.push(
          `AI 自动配图失败：${e instanceof Error ? e.message : String(e)}（稿件页可手动重做）`,
        );
      }
    }
  } else if (await imageSearchConfigured()) {
    try {
      const result = await illustrateArticle({ title: d.title ?? "", content });
      content = result.content;
      meta.illustrations = result.images;
    } catch (e) {
      console.error("[finalize-wechat] 自动配图失败（不阻断）", e);
      warnings.push(
        `自动配图失败：${e instanceof Error ? e.message : String(e)}（稿件页可手动「AI 配图」）`,
      );
    }
  } else {
    warnings.push("未配置搜图 API Key，本篇没有自动配图");
  }

  try {
    // 落库风格用设置页预设的封面风格（默认仍是玻璃气泡风，2026-07-28 用户拍板）；语义推荐不
    // 决定落库值，只在稿件页作为切换建议展示。再按该风格有没有模板参考图定链路：
    // 有参考图走模板直生，没有走锚点直生（靠风格定义 + 版式骨架，同样不用文案引擎先写提示词）。
    // 两条直生链路的 meta.cover 都只记 mode + 风格，前端随后调 /api/cover/image 时才真正生图。
    const tpl = await templateAvailability();
    const chosen = preset.coverStyle;
    const mode = (tpl[chosen.key] ?? 0) > 0 ? "template" : "anchor";
    meta.cover = { mode, style: chosen.key, ratio: chosen.defaultRatio };
  } catch (e) {
    console.error("[finalize-wechat] 封面提示词失败（不阻断）", e);
    warnings.push("封面提示词生成失败（稿件页可手动生成封面）");
  }

  try {
    const updated = await updateDraft(d.id, { content, meta });
    if (updated) return { draft: updated, warnings };
    warnings.push("配图/封面已生成但落库未生效（稿件不存在？），稿件页可手动重做");
  } catch (e) {
    // 最后一步落库失败会把前面辛苦生成的配图/封面整体丢弃——必须让前端知道
    console.error("[finalize-wechat] 配图/封面落库失败（不阻断）", e);
    warnings.push("配图/封面已生成但保存失败（数据库抖动），稿件页可手动重新配图/生成封面");
  }
  return { draft: d, warnings };
}
