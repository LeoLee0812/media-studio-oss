// ===== 邮件通知（Resend）=====
// 用 fetch 直调 Resend API，不加 SDK 依赖。
// 设计原则：通知是旁路，绝不能搞挂主流程——任何失败只 console.error，不抛异常。

import { resolveResendConfig } from "./config";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
// 发件人需要用你在 Resend 验证过的域名地址；未验证域名可先用测试地址 onboarding@resend.dev
const FROM = process.env.NOTIFY_FROM || "Media Studio <onboarding@resend.dev>";
// 单用户工具，收件人走 env 配置
const DEFAULT_TO = process.env.NOTIFY_TO || "";

// HTML 转义：错误原文/素材标题进邮件正文前必须过一遍
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 发送邮件。成功返回 true；未配置 key 或发送失败返回 false（静默，不抛）。
export async function sendEmail(opts: {
  subject: string;
  html: string;
  to?: string;
}): Promise<boolean> {
  try {
    const { apiKey } = await resolveResendConfig();
    if (!apiKey) {
      console.error("[notify] 未配置 Resend API Key（配置中心 resendApiKey 或 env RESEND_API_KEY），跳过邮件:", opts.subject);
      return false;
    }
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [opts.to ?? DEFAULT_TO],
        subject: opts.subject,
        html: opts.html,
      }),
      cache: "no-store",
      // 邮件是旁路，不允许拖太久
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[notify] Resend 发送失败 ${res.status}: ${text.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[notify] 发送邮件异常（已吞掉，不影响主流程）:", e);
    return false;
  }
}
