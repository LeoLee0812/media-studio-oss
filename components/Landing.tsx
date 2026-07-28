import Link from "next/link";
import {
  Radio,
  ArrowRight,
  Inbox,
  Lightbulb,
  Search,
  PenLine,
  Image as ImageIcon,
  BookHeart,
  Copy,
  ShieldCheck,
  Rss,
  Keyboard,
  Sparkles,
} from "lucide-react";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

// 未登录时 "/" 展示的落地页。纯静态，不碰数据库——门禁之外的人不该看到任何素材内容。

// 流水线四阶段：跟 docs/content-strategy.md 里的真实链路一致
const STAGES = [
  {
    icon: Inbox,
    step: "01",
    name: "采集",
    desc: "RSS 订阅每天自动进池，手动录入随时补充",
  },
  {
    icon: Lightbulb,
    step: "02",
    name: "选题",
    desc: "从素材里挑一个切入角度。素材是起点不是成品，绝不原样搬运",
  },
  {
    icon: Search,
    step: "03",
    name: "回溯",
    desc: "顺着原始链接抓回第一手原文，不让模型对着二手摘要编",
  },
  {
    icon: PenLine,
    step: "04",
    name: "成稿",
    desc: "扩写深化 + 配图 + 封面，出一篇能直接发的公众号稿",
  },
];

// 素材来源：与 lib/types.ts 的 SOURCE_LABELS 对齐
const SOURCES = [
  { icon: Rss, name: "RSS 订阅", desc: "自选信源每日自动入池" },
  { icon: Keyboard, name: "手动录入", desc: "随时塞一条进来" },
];

const GUARDS = [
  {
    icon: ShieldCheck,
    title: "不许编造经历",
    desc: "模型不能替你虚构第一人称经历。你不填真实经历，它就走现象解读，绝不硬编一段「我上周遇到」。",
  },
  {
    icon: Sparkles,
    title: "反 AI 味净化",
    desc: "成稿统一过一遍净化器：夸大的象征、宣发腔、三段式排比、破折号滥用，逐条清掉。",
  },
  {
    icon: ImageIcon,
    title: "配图与封面一条龙",
    desc: "落库即触发配图与封面生图，不用出稿之后再单独跑一趟。",
  },
  {
    icon: Copy,
    title: "一键复制不掉格式",
    desc: "公众号按微信排版走；小红书按它的粘贴白名单重排，标题、列表、高亮、emoji 全带得过去。",
  },
];

// 未登录时 "/" 直接渲染；登录后从导航"首页"进 /home 也能看，此时工作台顶栏已在，
// 落地页自己的顶栏就不再渲染，CTA 也改跳工作台内部页面而不是登录页
export function Landing({ authed = false }: { authed?: boolean }) {
  const enterHref = authed ? "/" : "/login";
  const inboxHref = authed ? "/inbox" : "/login?from=/inbox";
  return (
    <div className="flex min-h-screen flex-col">
      {/* 落地页自己的顶栏：未登录没有导航可点，只留品牌 + 主题 + 入口 */}
      {!authed && (
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center px-4">
            <div className="flex items-center gap-2 font-semibold">
              <Radio className="size-5" />
              <span>Media Studio</span>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <ThemeSwitcher />
              <Link
                href="/login"
                className="ml-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                进入工作台
              </Link>
            </div>
          </div>
        </header>
      )}

      <main className="flex-1">
        {/* ── Hero ── */}
        <section className="relative overflow-hidden border-b">
          {/* 淡网格 + 顶部主色光晕，两层都用主题变量，换皮肤时自动跟着变 */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
              backgroundSize: "56px 56px",
              maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 100%)",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-72 opacity-[0.14]"
            style={{ background: "radial-gradient(ellipse 60% 100% at 50% 0%, var(--primary), transparent 70%)" }}
          />

          <div className="relative mx-auto max-w-5xl px-4 pb-16 pt-16 text-center sm:pt-24">
            <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium shadow-sm">
              <span className="size-1.5 rounded-full bg-primary" />
              私有工作台
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">每日自动采集</span>
            </div>

            {/* 两行各自成块，不靠 <br> 硬断——窄屏时让它自然折，宽屏时稳定两行 */}
            <h1 className="mt-8 text-3xl font-bold leading-[1.25] tracking-tight sm:text-4xl lg:text-5xl">
              <span className="block">
                把一条素材，写成
                <span className="mx-1.5 inline-flex items-center gap-1.5 align-middle sm:mx-2 sm:gap-2">
                  <span className="inline-flex size-8 items-center justify-center rounded-xl bg-card shadow-sm ring-1 ring-border sm:size-10">
                    <svg viewBox="0 0 24 24" className="size-4.5 sm:size-5.5" fill="#07C160" aria-hidden>
                      <path d="M9.3 3C4.9 3 1.3 6.1 1.3 9.9c0 2.2 1.2 4.1 3.1 5.4l-.8 2.4 2.8-1.4c.9.2 1.8.4 2.9.4h.5a5.9 5.9 0 0 1-.2-1.6c0-3.6 3.4-6.5 7.7-6.5h.6C17.2 5.3 13.7 3 9.3 3Zm-2.7 3.4a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm5.5 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
                      <path d="M22.7 15.1c0-3-3-5.4-6.6-5.4-3.7 0-6.7 2.4-6.7 5.4s3 5.5 6.7 5.5c.8 0 1.5-.1 2.2-.3l2.3 1.1-.7-1.9c1.7-1 2.8-2.6 2.8-4.4Zm-8.8-1.3a.8.8 0 1 1 0-1.7.8.8 0 0 1 0 1.7Zm4.5 0a.8.8 0 1 1 0-1.7.8.8 0 0 1 0 1.7Z" />
                    </svg>
                  </span>
                  <span style={{ color: "#07C160" }}>公众号</span>
                </span>
                和
                <span className="mx-1.5 inline-flex items-center gap-1.5 align-middle sm:mx-2 sm:gap-2">
                  {/* 「种草笔记」的意象代表小红书。做成实心色块 + 白图标（像个 app icon），
                      描边图标在这个尺寸下压不住旁边的微信绿气泡，实心才配得上标题的重量 */}
                  <span
                    className="inline-flex size-8 items-center justify-center rounded-xl shadow-sm sm:size-10"
                    style={{ background: "#FF2442" }}
                  >
                    <BookHeart className="size-4.5 text-white sm:size-5.5" strokeWidth={2.2} />
                  </span>
                  <span style={{ color: "#FF2442" }}>小红书</span>
                </span>
              </span>
              <span className="mt-2 block">能直接发的稿子</span>
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-base text-muted-foreground sm:text-lg">
              素材是起点，不是成品。采集、选题、回溯原文、扩写深化、微信排版、封面生图，六件事在同一个工作台里做完，写完一键复制走。
            </p>

            {/* 流水线胶囊条：对应参考稿里那条 endpoint 复制条的位置 */}
            <div className="mx-auto mt-8 inline-flex flex-wrap items-center justify-center gap-1.5 rounded-full border bg-card px-4 py-2 text-sm shadow-sm">
              {["素材", "选题", "回溯", "扩写", "成稿"].map((label, i, arr) => (
                <span key={label} className="inline-flex items-center gap-1.5">
                  <span className={i === arr.length - 1 ? "font-semibold text-primary" : "text-foreground"}>
                    {label}
                  </span>
                  {i < arr.length - 1 && <ArrowRight className="size-3.5 text-muted-foreground" />}
                </span>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href={enterHref}
                className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-6 font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
              >
                进入工作台
                <ArrowRight className="size-4" />
              </Link>
              <div className="relative">
                <span className="absolute -top-2.5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground shadow">
                  今天已经在跑了
                </span>
                <Link
                  href={inboxHref}
                  className="inline-flex h-11 items-center rounded-md border bg-card px-6 font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  看今天的素材
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── 流水线宽卡片：对应参考稿里 hero 下方那张大卡 ── */}
        <section className="mx-auto max-w-6xl px-4 py-14">
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="border-b bg-gradient-to-b from-accent/40 to-transparent px-6 py-5">
              <h2 className="text-xl font-bold">四阶段流水线</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                每一篇稿子都从左走到右。跳过中间任何一步，出来的都是搬运。
              </p>
            </div>
            <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
              {STAGES.map((stage) => {
                const Icon = stage.icon;
                return (
                  <div key={stage.step} className="bg-card p-6">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="size-4.5" />
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{stage.step}</span>
                    </div>
                    <div className="mt-4 font-semibold">{stage.name}</div>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{stage.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── 素材来源 ── */}
        <section className="border-y bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="text-center text-2xl font-bold sm:text-3xl">素材从两个口子进来</h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
              不用自己去翻。每天早上池子里已经躺着一批新的，挑就行。
            </p>
            <div className="mt-10 grid gap-3 sm:grid-cols-2">
              {SOURCES.map((source) => {
                const Icon = source.icon;
                return (
                  <div
                    key={source.name}
                    className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/40"
                  >
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium">{source.name}</div>
                      <div className="truncate text-sm text-muted-foreground">{source.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── 它替你把关的事 ── */}
        <section className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">它替你把关的四件事</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            让模型写稿不难，难的是让它写出来的东西你敢发。
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {GUARDS.map((guard) => {
              const Icon = guard.icon;
              return (
                <div key={guard.title} className="rounded-xl border bg-card p-6 shadow-sm">
                  <span className="inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </span>
                  <h3 className="mt-4 font-semibold">{guard.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{guard.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── 底部 CTA ── */}
        <section className="border-t bg-muted/30">
          <div className="mx-auto max-w-3xl px-4 py-16 text-center">
            <h2 className="text-2xl font-bold sm:text-3xl">今天的素材已经在池子里了</h2>
            <p className="mt-3 text-muted-foreground">挑一条，二十分钟后你会有一篇能发的稿子。</p>
            <Link
              href={enterHref}
              className="mt-8 inline-flex h-11 items-center gap-2 rounded-md bg-primary px-6 font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
            >
              进入工作台
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 text-sm text-muted-foreground sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <Radio className="size-4" />
            <span>Media Studio</span>
          </div>
          <span>素材 → 稿件广播工作台 · 私有部署</span>
        </div>
      </footer>
    </div>
  );
}
