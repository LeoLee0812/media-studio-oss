import { NextResponse } from "next/server";
import { generateObject, jsonSchema } from "ai";
import { getDraft, getSyncState, setSyncState } from "@/lib/queries";
import { llmConfigured } from "@/lib/config";
import { getFlashModel } from "@/lib/llm";
import { getPrompt } from "@/lib/prompt-store";
import { numberedParagraphs, xhsContentHash, type ParaEmoji } from "@/lib/xhs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 实测 4200 字的稿子首次生成要 108 秒（flash 对长文就是这么慢），120 秒太贴上限
export const maxDuration = 300;

// 小红书「醒目化」素材：高亮句 + 段落 emoji，带服务端中转缓存。
//
// POST { content? } → { phrases, emojis, cached }：
//   先查缓存（按正文指纹 xhsContentHash 比对），命中直接返回（毫秒级）；
//   未命中才烧两个 flash 调用（30-40 秒），算完写缓存再返回。
// GET ?hash=... → { ready, phrases?, emojis? }：
//   轻量查询「这份正文的结果是否已就绪」，前端用它做按钮态与秒复制，不触发计算。
//
// 缓存存 ms_sync_state 的 xhs_assist:<draftId> 键（同一稿件只留最新一份正文的结果）。
// 这是「点复制不再占剪贴板」的关键：生成链路结束时预热一次，用户点复制时命中缓存秒贴；
// 没预热到的场景，第一次点复制只是把生成踢到后台，完成后前端提示、用户再点一次即秒贴。
//
// 小红书长文编辑器没有「加粗」，唯一的行内强调手段是 <mark> 高亮；策略是高亮优先——
// 逐段挑 1-2 句中心句；emoji 是配角，只给部分段落点缀（可段首可段尾）。
// 两件事**并行发两个 flash 调用**（deepseek-v4-flash）：合成一次调用输出太长会拖到超时。
// 不落稿件：这些只作用于复制出去的那份 HTML，稿件正文一个字都不动。
//
// 为什么这里**不走 styledGenerateObject**（硬性约定的例外，改动前先读完这段）：
// 收口的职责是给「模型新写出来的稿件正文」注入风格并做成稿净化（破折号→逗号、双引号→「」等）。
// 而这个接口的输出不是新正文：高亮是从既有正文里摘出来的**原文片段**，必须与正文逐字一致才能
// 在 HTML 里定位并包 <mark>；一旦过净化，片段里的标点会被改写，反而与原文对不上、全部作废。
// 模型也无从「虚构正文」——高亮片段逐条校验是否在原文里精确出现，emoji 只认段落编号。

const assistKey = (draftId: string) => `xhs_assist:${draftId}`;

interface StoredAssist {
  hash: string;
  phrases: string[];
  emojis: ParaEmoji[];
  updatedAt: string;
  // 并发互斥标记：正在为哪份正文（hash）生成、何时开始。带 TTL 兜底（请求异常退出不会死锁）。
  // 没有它时，选题页自动预热和用户点复制若几乎同时打进来，会各烧一遍两个 flash 调用，
  // 且两次温度采样结果不同、后写覆盖先写——库里留的高亮跟用户已复制的那份对不上。
  generatingHash?: string;
  generatingAt?: string;
}

// 生成中标记的有效期：超过它就当上一次生成已死，放行新请求（实测长文首次生成 ~108 秒）
const GENERATING_TTL_MS = 150_000;

function isGenerating(stored: StoredAssist | null, hash: string): boolean {
  if (!stored || stored.generatingHash !== hash || !stored.generatingAt) return false;
  const t = new Date(stored.generatingAt).getTime();
  return Number.isFinite(t) && Date.now() - t < GENERATING_TTL_MS;
}

const HIGHLIGHT_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    phrases: {
      type: "array",
      description: "要高亮的片段，每条必须是正文里逐字出现的连续片段，6-40 字",
      items: { type: "string" },
    },
  },
  required: ["phrases"],
  additionalProperties: false,
});

const EMOJI_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    emojis: {
      type: "array",
      description: "给部分段落配的 emoji（不必每段都有）",
      items: {
        type: "object",
        properties: {
          index: { type: "number", description: "输入里给出的段落编号" },
          emoji: { type: "string", description: "1-2 个与该段内容相关的 emoji" },
          pos: {
            type: "string",
            enum: ["start", "end"],
            description: "emoji 放段首还是段尾，按语感选",
          },
        },
        required: ["index", "emoji", "pos"],
        additionalProperties: false,
      },
    },
  },
  required: ["emojis"],
  additionalProperties: false,
});

/** 只留 emoji 字符，挡掉模型偶尔混进来的文字说明；最多 2 个 */
function cleanEmoji(raw: string): string {
  return [...raw.matchAll(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/gu)]
    .map((m) => m[0])
    .slice(0, 2)
    .join("");
}

// 查询缓存就绪状态（不触发计算）：前端打开稿件页/点复制前用它判断能否秒贴。
// hash 必填：不带 hash 无从校验缓存是否对应当前正文，「有任意历史缓存就算就绪」是错误契约。
// pending 表示这份正文正有一次生成在跑（并发锁），前端可轮询等它。
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const hash = new URL(req.url).searchParams.get("hash") ?? "";
  if (!hash) return NextResponse.json({ error: "缺少 hash 参数" }, { status: 400 });
  const stored = (await getSyncState(assistKey(id)).catch(() => null)) as StoredAssist | null;
  if (!stored || stored.hash !== hash) {
    return NextResponse.json({ ready: false, pending: isGenerating(stored, hash) });
  }
  return NextResponse.json({ ready: true, phrases: stored.phrases, emojis: stored.emojis });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: "未找到" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  // 前端可能正在编辑还没保存，优先用它传来的正文
  const content: string =
    typeof body?.content === "string" && body.content ? body.content : draft.content ?? "";
  if (!content.trim()) {
    return NextResponse.json({ error: "稿件正文为空" }, { status: 400 });
  }

  // 缓存命中即秒回：预热过（生成链路收尾会打一次）或同一篇稿第二次点复制都走这里
  const hash = xhsContentHash(content);
  const stored = (await getSyncState(assistKey(id)).catch(() => null)) as StoredAssist | null;
  if (stored?.hash === hash) {
    return NextResponse.json({ phrases: stored.phrases, emojis: stored.emojis, cached: true });
  }

  // 并发锁：同一份正文已有一次生成在跑 → 202，让调用方轮询 GET 等结果，不重复烧模型
  if (isGenerating(stored, hash)) {
    return NextResponse.json({ pending: true }, { status: 202 });
  }

  if (!(await llmConfigured())) {
    return NextResponse.json({ error: "未配置文案引擎 API Key" }, { status: 501 });
  }

  // 写生成中标记（保留旧结果字段：GET 按 hash 比对，不受影响）。
  // 读-判-写之间有毫秒级竞态窗口，单人工具可接受——挡住的是「预热与点复制相隔数秒」这类真实场景。
  await setSyncState(assistKey(id), {
    ...(stored ?? { hash: "", phrases: [], emojis: [], updatedAt: "" }),
    generatingHash: hash,
    generatingAt: new Date().toISOString(),
  } satisfies StoredAssist).catch(() => {});

  // 段落编号：跟前端插 emoji 时用的是同一个函数（lib/xhs.ts），编号错位就会插到别的段落上
  const paras = numberedParagraphs(content);
  const validIndex = new Set(paras.map((p) => p.index));

  const [hlSystem, emojiSystem] = await Promise.all([
    getPrompt("xhs_highlight_system"),
    getPrompt("xhs_emoji_system"),
  ]);
  const model = await getFlashModel({ structured: true });

  const highlightTask = generateObject({
    model,
    schema: HIGHLIGHT_SCHEMA,
    temperature: 0.4,
    system: hlSystem,
    prompt: `文章正文：\n\n${content}\n\n请按规则挑出高亮片段。`,
  }).then((r) => r.object as { phrases?: unknown });

  const emojiTask = generateObject({
    model,
    schema: EMOJI_SCHEMA,
    temperature: 0.6,
    system: emojiSystem,
    prompt: [
      "带编号的正文段落：",
      "",
      paras.map((p) => `[${p.index}] ${p.text}`).join("\n\n"),
      "",
      "请给其中值得点缀的段落配 emoji（不必每段都有），并给出放段首还是段尾。",
    ].join("\n"),
  }).then((r) => r.object as { emojis?: unknown });

  // 一边挂了不拖累另一边：高亮没了还有 emoji，emoji 没了还有高亮，都没了也不阻断复制
  const [hlRes, emojiRes] = await Promise.allSettled([highlightTask, emojiTask]);

  // 高亮：逐字校验，对不上原文的直接丢（模型偶尔会顺手把标点改了或自己润色一句）
  let phrases: string[] = [];
  let rawHlCount = 0;
  if (hlRes.status === "fulfilled") {
    const raw = Array.isArray(hlRes.value.phrases) ? hlRes.value.phrases : [];
    rawHlCount = raw.length;
    const seen = new Set<string>();
    phrases = raw
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter((p) => p.length >= 4 && p.length <= 48 && content.includes(p))
      .filter((p) => {
        if (seen.has(p)) return false;
        seen.add(p);
        return true;
      });
  } else {
    console.error("[xhs] 高亮失败", hlRes.reason);
  }

  // emoji：编号必须是我们发出去的那批；同一个 emoji 全文最多留两次，挡住「通篇 ✨」这种偷懒
  const emojis: ParaEmoji[] = [];
  if (emojiRes.status === "fulfilled") {
    const raw = Array.isArray(emojiRes.value.emojis) ? emojiRes.value.emojis : [];
    const usedIndex = new Set<number>();
    const emojiUse = new Map<string, number>();
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const index = Number((item as { index?: unknown }).index);
      const emoji = cleanEmoji(String((item as { emoji?: unknown }).emoji ?? ""));
      const pos = (item as { pos?: unknown }).pos === "end" ? ("end" as const) : ("start" as const);
      if (!emoji || !Number.isInteger(index) || !validIndex.has(index)) continue;
      if (usedIndex.has(index)) continue;
      const times = emojiUse.get(emoji) ?? 0;
      if (times >= 2) continue;
      usedIndex.add(index);
      emojiUse.set(emoji, times + 1);
      emojis.push({ index, emoji, pos });
    }
  } else {
    console.error("[xhs] emoji 失败", emojiRes.reason);
  }

  // 写中转缓存。落盘前**重新读一次**最新记录，不能用请求入口的旧快照——
  // 生成要跑 30-100 秒，期间另一份正文（不同 hash）的请求可能已经写入了合法结果，
  // 拿旧快照回写会把人家刚算好的缓存整条覆盖掉。
  const latest = (await getSyncState(assistKey(id)).catch(() => null)) as StoredAssist | null;
  if (phrases.length || emojis.length) {
    // 成功：写入本次结果；若期间有别的 hash 又占了锁，把它的锁标记原样带过去（别抹掉）
    const carryLock =
      latest?.generatingHash && latest.generatingHash !== hash && isGenerating(latest, latest.generatingHash)
        ? { generatingHash: latest.generatingHash, generatingAt: latest.generatingAt }
        : {};
    await setSyncState(assistKey(id), {
      hash,
      phrases,
      emojis,
      updatedAt: new Date().toISOString(),
      ...carryLock,
    } satisfies StoredAssist).catch(() => {});
  } else if (latest?.generatingHash === hash) {
    // 两边全挂：只在「锁还是自己占的」时清锁并保留最新已有结果（谁的锁谁负责清），
    // 避免把「空结果」当就绪缓存住；锁已易主/已被别人写入结果时什么都不动
    await setSyncState(assistKey(id), {
      hash: latest.hash ?? "",
      phrases: latest.phrases ?? [],
      emojis: latest.emojis ?? [],
      updatedAt: latest.updatedAt ?? "",
    } satisfies StoredAssist).catch(() => {});
  }

  return NextResponse.json({
    phrases,
    emojis,
    cached: false,
    paragraphs: paras.length,
    droppedHighlights: rawHlCount - phrases.length,
  });
}
