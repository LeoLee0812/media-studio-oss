// 全站门禁的令牌逻辑。
// cookie 值 = HMAC-SHA256(key=AUTH_SECRET, message=ACCESS_PASSWORD) 的 hex。
// 使用 Web Crypto，middleware（edge）与 route handler（node）通用。

export const AUTH_COOKIE = "ms_auth";

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
