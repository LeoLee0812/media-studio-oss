import { NextResponse } from "next/server";
import {
  ingestRss,
  planRssShards,
  writeRssSyncState,
  type RssFeedResult,
} from "@/lib/ingest";
import { translateNewMaterials } from "@/lib/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 手动触发 RSS 采集（设置页按钮），同时也是每日 cron 的采集入口。
//
// 这条路由有两副面孔，靠请求体里有没有 feedUrls 区分：
//   ① 编排层（不带 feedUrls）——把订阅源切片，逐片 HTTP 回调自己，合并结果后写同步状态、跑翻译；
//   ② 分片执行层（带 feedUrls）——老老实实抓这几个源、批量入库、返回逐源明细。
//
// 为什么要这么绕：Cloudflare Workers 单次调用只允许 50 个子请求（免费版），
// **重定向也算**，十来个订阅源一起抓必然报 Too many subrequests。回调自己等于
// 换一次全新的调用、拿一份全新的 50 次预算，编排层自己只花「片数」个子请求。
// 详见 lib/ingest.ts 里 ingestRss 上方的长注释。

function selfBase(req: Request): string {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

// 分片请求要能过 middleware 的门禁：用窄用途的 CRON_SECRET（它本来就只放行 /api/ingest/* 与 /api/cron/*）
function authHeaders(): Record<string, string> {
  const s = process.env.CRON_SECRET;
  return s ? { authorization: `Bearer ${s}`, "content-type": "application/json" } : { "content-type": "application/json" };
}

export async function POST(req: Request) {
  let body: { feedUrls?: string[] } = {};
  try {
    body = (await req.json()) as { feedUrls?: string[] };
  } catch {
    // 没有请求体 = 编排模式，正常情况
  }

  // ---- ② 分片执行层 ----
  if (Array.isArray(body.feedUrls) && body.feedUrls.length > 0) {
    try {
      const result = await ingestRss({ feedUrls: body.feedUrls, skipSyncState: true });
      return NextResponse.json(result);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
  }

  // ---- ① 编排层 ----
  try {
    const shards = await planRssShards();

    // 只有一片就别绕一圈了，直接本地跑完（自部署源少的场景是常态）
    if (shards.length <= 1) {
      const result = await ingestRss();
      const translate = await translateNewMaterials().catch(() => null);
      return NextResponse.json({ ...result, shards: shards.length, translate });
    }

    const base = selfBase(req);
    const feeds: RssFeedResult[] = [];
    // 串行而不是并行：并行时几片会同时抢 transaction pooler 的连接（硬约定 #4 的红线），
    // 而且串行也更好定位是哪一片出的错
    for (const feedUrls of shards) {
      try {
        const res = await fetch(`${base}/api/ingest/rss`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ feedUrls }),
          signal: AbortSignal.timeout(120_000),
        });
        const json = (await res.json()) as { feeds?: RssFeedResult[]; error?: string };
        if (json.feeds) feeds.push(...json.feeds);
        else feedUrls.forEach((url) => feeds.push({ url, fetched: 0, inserted: 0, error: json.error ?? `分片返回 HTTP ${res.status}` }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        feedUrls.forEach((url) => feeds.push({ url, fetched: 0, inserted: 0, error: `分片调用失败：${msg}` }));
      }
    }

    await writeRssSyncState(feeds, feeds.length);
    const translate = await translateNewMaterials().catch(() => null);
    return NextResponse.json({
      fetched: feeds.reduce((s, f) => s + f.fetched, 0),
      inserted: feeds.reduce((s, f) => s + f.inserted, 0),
      feeds,
      shards: shards.length,
      translate,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
