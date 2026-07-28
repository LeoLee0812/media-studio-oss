import { NextResponse } from "next/server";
import { getStoredConfig, resolveProviderConfig, isSafePublicUrl } from "@/lib/config";
import { fetchProviderModels } from "@/lib/llm-models";
import { isLlmProvider } from "@/lib/llm-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ===== 拉取某家引擎当前公开的模型列表 =====
// POST { provider, apiKey? } → { ok, models: string[], error? }
// 与「测试连接」同款「待保存值优先」：输入框里还没保存的 key 一起传来，空则用该家已存/env 的 key。
// 统一返回 200 + { ok }，让前端在同一处展示错误原文。
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isLlmProvider(body.provider)) {
    return NextResponse.json({ ok: false, models: [], error: "provider 不合法" }, { status: 400 });
  }
  const inputKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const stored = await getStoredConfig();
  // baseUrl 同款「待保存值优先」：设置页正在编辑、还没保存的中转站 Base URL 一起传来
  const inputBase = typeof body.baseUrl === "string" ? body.baseUrl.trim().replace(/\/+$/, "") : "";
  if (inputBase && !isSafePublicUrl(inputBase)) {
    return NextResponse.json({ ok: false, models: [], error: "Base URL 非法：必须是 http(s) 且不能指向内网/环回地址" });
  }
  const resolved = await resolveProviderConfig(body.provider, stored);
  const apiKey = inputKey || resolved.apiKey;
  if (!apiKey) {
    return NextResponse.json({ ok: false, models: [], error: "尚未配置 API Key，请先填入再获取" });
  }
  return NextResponse.json(await fetchProviderModels(body.provider, apiKey, inputBase || resolved.baseUrl));
}
