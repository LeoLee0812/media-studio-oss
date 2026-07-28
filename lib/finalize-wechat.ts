import type { Draft } from "./types";
import { imageSearchConfigured } from "./config";
import { illustrateArticle } from "./illustrate-server";
import { COVER_STYLES, recommendCoverStyles, templateAvailability } from "./cover";
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

  if (await imageSearchConfigured()) {
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
    // 按稿件内容推荐风格（纯关键词打分，不花 token），再按该风格有没有模板参考图定链路：
    // 有参考图走模板直生，没有走锚点直生（靠风格定义 + 版式骨架，同样不用文案引擎先写提示词）。
    // 两条直生链路的 meta.cover 都只记 mode + 风格，前端随后调 /api/cover/image 时才真正生图。
    const tpl = await templateAvailability();
    const recommended = recommendCoverStyles(d.title ?? "", content, 1)[0] ?? COVER_STYLES[0];
    const mode = (tpl[recommended.key] ?? 0) > 0 ? "template" : "anchor";
    meta.cover = { mode, style: recommended.key, ratio: recommended.defaultRatio };
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
