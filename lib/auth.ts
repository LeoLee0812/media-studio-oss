// 全站门禁的令牌逻辑。
// cookie 值 = HMAC-SHA256(key=AUTH_SECRET, message=ACCESS_PASSWORD) 的 hex。
// 使用 Web Crypto，middleware（edge）与 route handler（node）通用。

export const AUTH_COOKIE = "ms_auth";

/**
 * 门禁是否启用：没配 ACCESS_PASSWORD 就是「公开模式」，全站免登录直接可用。
 * 公开演示站（如本仓库的在线体验站）走这条路；自部署想加锁只要配上 ACCESS_PASSWORD。
 * 公开模式下配置接口不会回传明文 API key（见 app/api/config/route.ts）。
 */
export function isGateEnabled(): boolean {
  return (process.env.ACCESS_PASSWORD ?? "").length > 0;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 计算当前配置下的合法令牌
export async function expectedToken(): Promise<string> {
  const password = process.env.ACCESS_PASSWORD ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(password));
  return toHex(sig);
}

// 校验用户提交的密码是否正确（登录时用）。
// 与 verifyToken 同款恒时比较：长度一致后逐字符 XOR 累积，避免 === 短路带来的时序侧信道。
export function verifyPassword(input: string): boolean {
  const password = process.env.ACCESS_PASSWORD ?? "";
  if (typeof input !== "string" || input.length === 0 || password.length === 0) return false;
  if (input.length !== password.length) return false;
  let diff = 0;
  for (let i = 0; i < input.length; i++) {
    diff |= input.charCodeAt(i) ^ password.charCodeAt(i);
  }
  return diff === 0;
}

// 校验 cookie 令牌是否合法
export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const expected = await expectedToken();
  // 长度一致再逐字符比较，避免明显的时序差异
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 当前访客有没有工作台权限：公开模式（没配 ACCESS_PASSWORD）人人都有，
 * 否则看 cookie 令牌。页面/布局判断一律用它，别再直接调 verifyToken，
 * 否则公开模式下会被判成「未登录」——导航栏消失、落地页顶掉仪表盘。
 */
export async function hasWorkspaceAccess(token: string | undefined): Promise<boolean> {
  if (!isGateEnabled()) return true;
  return verifyToken(token);
}
