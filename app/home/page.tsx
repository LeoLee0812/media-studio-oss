import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AUTH_COOKIE, hasWorkspaceAccess } from "@/lib/auth";
import { Landing } from "@/components/Landing";

export const metadata: Metadata = {
  title: "首页 · Media Studio",
};

// 首页（落地页）的固定入口：未登录时 "/" 也会展示同一份内容，
// 但登录后 "/" 变成仪表盘就看不到了，这里让它随时可回访（导航"首页"指向这里）。
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const authed = await hasWorkspaceAccess((await cookies()).get(AUTH_COOKIE)?.value);
  return <Landing authed={authed} />;
}
