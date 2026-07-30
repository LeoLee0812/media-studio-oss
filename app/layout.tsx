import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { AUTH_COOKIE, hasWorkspaceAccess, isGateEnabled } from "@/lib/auth";
import { isReadOnly } from "@/lib/read-only";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Media Studio · 素材→稿件广播工作台",
  description: "自媒体矩阵的素材采集、选题、扩写深化到四平台稿件一键复制的私有工作台。",
};

// 进页前同步定妆：深色类 + 皮肤属性都在首帧前写到 <html> 上，避免闪白 / 闪错配色。
// 皮肤清单见 lib/skins.ts，这里内联字面量是因为脚本要在 React 之前跑，不能 import。
const themeInit = `(function(){try{var d=document.documentElement;
var t=localStorage.getItem("theme");
if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches)){d.classList.add("dark")}
var s=localStorage.getItem("skin");
d.dataset.skin=["mono","ember","broadcast","newsroom","signal","xp"].indexOf(s)>=0?s:"mono";
}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // 未登录只可能停在落地页 / 登录页，两者都自带顶栏，这里不再渲染工作台导航。
  // 公开模式（无访问密码）下人人都算有权限，导航照常渲染，只是不给「退出登录」。
  const authed = await hasWorkspaceAccess((await cookies()).get(AUTH_COOKIE)?.value);
  const gated = isGateEnabled();
  const readOnly = isReadOnly();
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {authed && <SiteHeader showLogout={gated} readOnly={readOnly} />}
        {/* 登录后小屏有固定 tab 栏，留出它的高度 + iOS 安全区；落地页没有 tab 栏，不留白 */}
        <main className={authed ? "flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0" : "flex-1"}>
          {children}
        </main>
      </body>
    </html>
  );
}
