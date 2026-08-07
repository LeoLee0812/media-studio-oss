import { getCloudflareContext } from "@opennextjs/cloudflare";

// ===== 调用自己 =====
//
// 采集被拆成「编排 + 分片」后，编排层要再打自己一次，好让每片各拿一份新的子请求预算
// （Cloudflare 免费版单次调用只有 50 个子请求，重定向也算，见 lib/ingest.ts）。
//
// 【坑】直接 fetch 自己的公网域名会 522。Worker 请求自己所在 zone 的域名等于绕回边缘，
// Cloudflare 不保证这条回环，实测稳定超时。正确做法是用 **service binding 指向自己**
// （wrangler.jsonc 的 services.WORKER_SELF_REFERENCE），走内部直连：不出网、不额外计费、
// 不依赖 DNS 与证书状态。
//
// 没绑定时退回公网 fetch —— 首次部署（worker 还不存在，绑不了自己）或本地 next dev 会走到这条。

interface SelfFetcher {
  fetch(req: Request): Promise<Response>;
}

function selfBinding(): SelfFetcher | undefined {
  try {
    const env = getCloudflareContext().env as unknown as Record<string, unknown>;
    const b = env?.WORKER_SELF_REFERENCE as SelfFetcher | undefined;
    return b && typeof b.fetch === "function" ? b : undefined;
  } catch {
    return undefined;
  }
}

/** 打自己的某条路由。path 以 / 开头；origin 用调用方那条请求的 origin。 */
export async function fetchSelf(origin: string, path: string, init?: RequestInit): Promise<Response> {
  const req = new Request(`${origin.replace(/\/+$/, "")}${path}`, init);
  const binding = selfBinding();
  return binding ? binding.fetch(req) : fetch(req);
}

/** 分片/定时任务过 middleware 门禁用的窄用途凭据（只放行 /api/ingest/* 与 /api/cron/*）。 */
export function cronAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const s = process.env.CRON_SECRET;
  return s ? { authorization: `Bearer ${s}`, ...extra } : { ...extra };
}
