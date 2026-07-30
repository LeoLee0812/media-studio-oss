"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LogOut,
  Radio,
  Home,
  LayoutDashboard,
  Inbox,
  Lightbulb,
  FileText,
  Recycle,
  MessageSquareQuote,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  // 是否在小屏顶部导航保留（高频项挪去底部 tab 栏，顶部只留洗稿+设置）
  mobileTop?: boolean;
}

const NAV: NavItem[] = [
  { href: "/home", label: "首页", icon: Home, mobileTop: true },
  { href: "/", label: "仪表盘", icon: LayoutDashboard },
  { href: "/inbox", label: "素材流", icon: Inbox },
  { href: "/topics", label: "选题", icon: Lightbulb },
  { href: "/drafts", label: "稿件", icon: FileText },
  { href: "/rewrite", label: "快速洗稿", icon: Recycle, mobileTop: true },
  { href: "/prompts", label: "提示词", icon: MessageSquareQuote, mobileTop: true },
  { href: "/settings", label: "设置", icon: Settings, mobileTop: true },
];

// 小屏底部 tab 栏的五个高频项
const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "仪表盘", icon: LayoutDashboard },
  { href: "/inbox", label: "素材流", icon: Inbox },
  { href: "/topics", label: "选题", icon: Lightbulb },
  { href: "/drafts", label: "稿件", icon: FileText },
];

// GitHub 品牌图标：lucide 1.x 起移除了品牌类图标，这里内联官方 mark 的 SVG
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1.17-.02-2.12-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.67.8.56A11.52 11.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

// 当前路由是否命中导航项（"/" 需要精确匹配）
function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SiteHeader({ showLogout = true }: { showLogout?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname === "/login") return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4">
          <Link href="/" className="mr-4 flex items-center gap-2 font-semibold">
            <Radio className="size-5" />
            <span className="max-[400px]:hidden">Media Studio</span>
          </Link>
          <nav className="flex flex-1 items-center justify-end gap-0.5 overflow-x-auto sm:justify-start">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap",
                    // 高频项在小屏藏进底部 tab 栏，顶部只留洗稿+设置
                    !item.mobileTop && "hidden sm:block",
                    active
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <a
            href="https://github.com/LeoLee0812/media-studio-oss"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-accent"
            aria-label="GitHub 仓库"
          >
            <GithubMark className="size-4" />
          </a>
          <ThemeSwitcher />
          {/* 公开模式（没配访问密码）没有登录态，也就没有「退出」可言 */}
          {showLogout && (
            <button
              onClick={logout}
              className="rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-accent"
              aria-label="退出登录"
            >
              <LogOut className="size-4" />
            </button>
          )}
        </div>
      </header>

      {/* 小屏底部固定 tab 栏（含 iOS 安全区），sm 及以上隐藏 */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        <div className="grid grid-cols-5">
          {TABS.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
