import { resolveImageSearchConfig } from "./config";

// ===== 文章配图搜图（服务端专用）=====
// 走国际免费图库：Pexels 与 Pixabay 并发竞速，谁先返回有效结果用谁（key 与 ppt-master skill 同一套）。
// 只做「关键词 → 一张最合适的横图」这一件事；候选去重靠 usedUrls 由调用方跨图维护。

export interface FoundImage {
  url: string;
  width: number;
  height: number;
  /** 摄影师/作者 + 平台，用于必要时标注出处 */
  credit: string;
  provider: "pexels" | "pixabay";
}

interface PexelsPhoto {
  width: number;
  height: number;
  photographer: string;
  src: { original?: string; large2x?: string; large?: string };
}

interface PixabayHit {
  imageWidth: number;
  imageHeight: number;
  user: string;
  largeImageURL?: string;
  webformatURL?: string;
}

const FETCH_TIMEOUT = 8000;

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function searchPexels(keyword: string, apiKey: string, usedUrls: Set<string>): Promise<FoundImage | null> {
  const u = new URL("https://api.pexels.com/v1/search");
  u.searchParams.set("query", keyword);
  u.searchParams.set("per_page", "8");
  u.searchParams.set("orientation", "landscape");
  u.searchParams.set("size", "large");
  // Pexels 的 Authorization 直接放 key 值，不带 Bearer 前缀
  const data = (await fetchJson(u.toString(), { Authorization: apiKey })) as { photos?: PexelsPhoto[] };
  for (const p of data.photos ?? []) {
    // large ≈ 940px 宽，公众号正文足够且体积友好
    const url = p.src.large || p.src.large2x || p.src.original;
    if (!url || usedUrls.has(url)) continue;
    return { url, width: p.width, height: p.height, credit: `${p.photographer} / Pexels`, provider: "pexels" };
  }
  return null;
}

async function searchPixabay(keyword: string, apiKey: string, usedUrls: Set<string>): Promise<FoundImage | null> {
  const u = new URL("https://pixabay.com/api/");
  u.searchParams.set("key", apiKey);
  u.searchParams.set("q", keyword);
  u.searchParams.set("image_type", "photo");
  u.searchParams.set("per_page", "8");
  u.searchParams.set("safesearch", "true");
  u.searchParams.set("orientation", "horizontal");
  const data = (await fetchJson(u.toString())) as { hits?: PixabayHit[] };
  for (const h of data.hits ?? []) {
    const url = h.largeImageURL || h.webformatURL;
    if (!url || usedUrls.has(url)) continue;
    return { url, width: h.imageWidth, height: h.imageHeight, credit: `${h.user} / Pixabay`, provider: "pixabay" };
  }
  return null;
}

// 按关键词找一张未用过的横图。两个图库**并发竞速**（速度优先，不是主备兜底）：
// 谁先返回有效结果就用谁；快的那家失败或没结果时自然等慢的那家（Promise.any 语义）。
// 都失败/都没结果时返回 null（调用方跳过该插图点）。
export async function searchOneImage(keyword: string, usedUrls: Set<string>): Promise<FoundImage | null> {
  const { pexelsKey, pixabayKey } = await resolveImageSearchConfig();
  const attempts: Promise<FoundImage>[] = [];
  if (pexelsKey) {
    attempts.push(
      searchPexels(keyword, pexelsKey, usedUrls).then((hit) => {
        if (!hit) throw new Error("无结果");
        return hit;
      }),
    );
  }
  if (pixabayKey) {
    attempts.push(
      searchPixabay(keyword, pixabayKey, usedUrls).then((hit) => {
        if (!hit) throw new Error("无结果");
        return hit;
      }),
    );
  }
  if (attempts.length === 0) return null;
  try {
    return await Promise.any(attempts);
  } catch (e) {
    // AggregateError：两家各自的失败原因都在 errors 里，一次性打出来便于排查
    const errors = e instanceof AggregateError ? e.errors : [e];
    console.error("[image-search] 两个图库均未命中", keyword, ...errors);
    return null;
  }
}

// 图片代理下载的域名白名单（防 SSRF：只放行两个图库的图片 CDN）
export function isAllowedImageHost(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return (
      host === "images.pexels.com" ||
      host === "pixabay.com" ||
      host === "cdn.pixabay.com" ||
      host.endsWith(".pixabay.com") ||
      // AI 生成配图存在自家 Vercel Blob 上，本地备份同样走这个代理
      host.endsWith(".public.blob.vercel-storage.com")
    );
  } catch {
    return false;
  }
}
