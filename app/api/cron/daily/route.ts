import { NextResponse } from "next/server";
import { runDailyIngest, type DailyIngestResult, type RssIngestResult } from "@/lib/ingest";
import { sendEmail, escapeHtml } from "@/lib/notify";
import { isReadOnly } from "@/lib/read-only";
import { fetchSelf, cronAuthHeaders } from "@/lib/self-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 全站唯一的每日定时任务入口（wrangler.jsonc 的 triggers.crons 触发 worker.ts 的 scheduled，
// 由它带 Bearer CRON_SECRET 打到这里）：
//   /api/cron/daily        —— 编排入口（RSS 采集 + 翻译 + 清理 + 摘要/告警邮件）
//   /api/ingest/rss   POST —— 纯手动 RSS 采集（设置页按钮）
//   /api/cron/cleanup POST —— 纯手动清理（设置页按钮）
// 各步错误隔离；有失败步骤时发告警邮件（notify 静默失败，不影响响应）。

// 从每日结果里汇总各步错误，供告警邮件用
function collectErrors(result: DailyIngestResult): string[] {
  const errors: string[] = [];
  if ("error" in result.rss) {
    errors.push(`RSS 采集失败：${result.rss.error}`);
  } else {
    // feed 级局部失败也提一嘴（不影响 ok 判定）
    for (const f of result.rss.feeds) {
      if (f.error) errors.push(`RSS 源「${f.label ?? f.url}」失败：${f.error}`);
    }
  }
  // 清理失败不影响 ok 判定（素材照常采集），但要告警：不修就是无限增长
  if ("error" in result.cleanup) errors.push(`素材清理失败：${result.cleanup.error}`);
  return errors;
}

const siteUrl = process.env.SITE_URL || "http://localhost:3000";

// RSS 这一步不本地直跑，而是打 /api/ingest/rss 的编排层：
// 那条路由会把订阅源切片、逐片换一次新的 Worker 调用，绕开单次 50 个子请求的上限
// （详见 lib/ingest.ts 里 ingestRss 上方的注释）。
function rssViaOrchestrator(req: Request): () => Promise<RssIngestResult> {
  const u = new URL(req.url);
  return async () => {
    const res = await fetchSelf(`${u.protocol}//${u.host}`, "/api/ingest/rss", {
      method: "POST",
      headers: cronAuthHeaders(),
      signal: AbortSignal.timeout(240_000),
    });
    const json = (await res.json()) as RssIngestResult & { error?: string };
    if (json.error) throw new Error(json.error);
    return json;
  };
}

export async function GET(req: Request) {
  // 只读演示站：采集会写库，直接跳过。返回 200 而不是 403，
  // 否则 Cloudflare 的定时触发器每天记一次失败，看着像故障。
  if (isReadOnly()) {
    return NextResponse.json({ ok: true, skipped: true, reason: "只读模式，已跳过每日采集" });
  }
  try {
    const result = await runDailyIngest(rssViaOrchestrator(req));
    const errors = collectErrors(result);
    if (errors.length > 0) {
      await sendEmail({
        subject: "Media Studio 每日采集有步骤失败",
        html: `<div style="font-family:system-ui,sans-serif;line-height:1.6">
          <p>每日采集任务部分失败（${new Date().toISOString()}）：</p>
          <ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>
          <p><a href="${siteUrl}/settings">→ 打开设置页查看采集状态</a></p>
        </div>`,
      });
    }
    return NextResponse.json(result);
  } catch (e) {
    // 编排本身炸了（理论上各步已隔离，这里是最后兜底）：发告警再返回 500
    const msg = e instanceof Error ? e.message : String(e);
    await sendEmail({
      subject: "Media Studio 每日采集任务失败",
      html: `<div style="font-family:system-ui,sans-serif;line-height:1.6">
        <p>每日采集任务整体失败（${new Date().toISOString()}）：</p>
        <p style="color:#b91c1c">${escapeHtml(msg)}</p>
        <p><a href="${siteUrl}/settings">→ 打开设置页查看采集状态</a></p>
      </div>`,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
