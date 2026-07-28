import { NextResponse } from "next/server";
import { resolveLlmConfig, resolveImageConfig, resolveProviderConfig, isSafePublicUrl } from "@/lib/config";
import { fetchProviderModels } from "@/lib/llm-models";
import { isLlmProvider } from "@/lib/llm-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ===== 配置连通性测试 =====
// POST { kind: 'llm' | 'image', provider?, apiKey?, base? }
// 「待保存值优先、否则当前生效配置」：前端把输入框里还没保存的 key/base 一起传来，
// 空则用 resolve* 的当前生效值。发最小 GET /models 请求验证 key 是否可用。
// 统一返回 200 + { ok, error? }，错误原文截断透传，方便排查。

// 对目标发一次带 Bearer 的 GET /models，返回 ok/错误原文（生图中转站用，非注册表内的引擎）
async function probeModels(base: string, apiKey: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (res.ok) return { ok: true };
  const text = (await res.text().catch(() => "")).slice(0, 300);
  return { ok: false, error: `HTTP ${res.status}${text ? ` ${text}` : ""}` };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = body.kind;
  const inputKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";

  try {
    if (kind === "llm") {
      // provider 可由前端显式指定（测当前编辑中的引擎），缺省用生效配置的 provider
      const provider = isLlmProvider(body.provider) ? body.provider : (await resolveLlmConfig()).provider;
      const resolved = await resolveProviderConfig(provider);
      const apiKey = inputKey || resolved.apiKey;
      if (!apiKey) return NextResponse.json({ ok: false, error: "尚未配置 API Key，请先填入再测试" });
      // relay（聚合中转）引擎支持带上还没保存的 Base URL 一起测；用户可写 → 过 SSRF 校验
      const inputBase = typeof body.baseUrl === "string" ? body.baseUrl.trim().replace(/\/+$/, "") : "";
      if (inputBase && !isSafePublicUrl(inputBase)) {
        return NextResponse.json({ ok: false, error: "Base URL 非法：必须是 http(s) 且不能指向内网/环回地址" });
      }
      // 各家都走 GET /models，成功即证明 key 可用；顺带把模型数报给前端
      const r = await fetchProviderModels(provider, apiKey, inputBase || resolved.baseUrl);
      return NextResponse.json({ ok: r.ok, error: r.error, modelCount: r.models.length });
    }

    if (kind === "image") {
      const cur = await resolveImageConfig();
      const apiKey = inputKey || cur.apiKey;
      const base = ((typeof body.base === "string" && body.base.trim()) || cur.base).replace(/\/$/, "");
      if (!apiKey) return NextResponse.json({ ok: false, error: "尚未配置 API Key，请先填入再测试" });
      // base 用户可写且服务端会带 key 去请求 → 必须过 SSRF 校验
      if (!isSafePublicUrl(base)) {
        return NextResponse.json({ ok: false, error: "API Base 非法：必须是 http(s) 且不能指向内网/环回地址" });
      }
      return NextResponse.json(await probeModels(base, apiKey));
    }

    return NextResponse.json({ ok: false, error: "kind 必须是 llm 或 image" }, { status: 400 });
  } catch (e) {
    // 网络错误/超时等：原文透传给前端展示
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg });
  }
}
