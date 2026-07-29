/**
 * marked 的中文强调补丁：修「紧邻中文的 `**加粗**` 配不上对、`**` 漏成字面量」。
 *
 * 【为什么会漏】
 * CommonMark 判断一对 `**` 能不能开合，靠的是 delimiter run 的 flanking 规则，而这套
 * 规则只把 **ASCII 标点**当标点、把中文当普通字符，对中日韩极不友好。拿真实稿子里的
 * `它在脑桥一个叫**中缝核（Raphe Nuclei）**的地方合成` 来说：
 *
 * - 开头那个 `**`：左边是「叫」、右边是「中」，两边都是普通字符，于是它同时是
 *   left-flanking 和 right-flanking。`**` 要能 open，必须「不是 right-flanking，
 *   或者左边是标点」——两条都不满足 → **开不了**。
 * - 结尾那个 `**`：左边是「）」（全角标点）、右边是「的」。要能 close 得是
 *   right-flanking：左边非空白，且（左边非标点 或 右边是空白/标点）——左边是标点、
 *   右边又不是空白也不是标点 → **合不上**。
 *
 * 两头都失败，marked 就把这段当普通文本，`**` 原样漏给读者。英文里 `**bold**` 前后
 * 通常有空格，所以这个坑只在中文稿里暴露，而且只在加粗内容以全角标点结尾时才必现。
 *
 * 【怎么修】
 * 注册一个 inline extension。marked 会**先**试自定义 extension 再试内置 tokenizer，
 * 所以这里用一套「只看空白、不看标点」的宽松规则抢先把 `***`/`**`/`~~` 吃掉，产出的是
 * **标准 token**（em / strong / del）——不是内联 HTML。这点很重要：下游一律照常工作，
 * 公众号排版的 addStyle、小红书的「加粗 → <mark> 高亮」、推特长篇的 <strong> 全不用改。
 *
 * 【边界】
 * - 定界符两侧不许贴空白（`** x **` 不算加粗，和 CommonMark 一致）
 * - 不许跨空行（加粗本来就不跨段落）
 * - 行内代码和代码块碰不到：代码块在 block 阶段就被吃掉了，行内代码的反引号在
 *   `**` 之前，codespan 会先消费整段
 * - `2**3` 这类单个 `**` 不成对，匹配不上；`****` 空内容也匹配不上
 * - 单星 `*斜体*` 故意不接管：`*` 还兼着无序列表标记和乘号，误伤面比收益大，
 *   而中文稿几乎不用斜体
 */
import { marked, type TokenizerAndRendererExtension, type Tokens } from "marked";

/** 内容不许以空白开头/结尾，也不许跨空行 */
const rule = (delim: string) =>
  new RegExp(
    `^${delim}(?!\\s)((?:(?!${delim}|\\n[ \\t]*\\n)[\\s\\S])+?)(?<!\\s)${delim}`,
  );

// 顺序即优先级：`***` 必须排在 `**` 前面，否则 `***血清素***` 会被 `**` 先咬掉一半，
// 切出 `<strong>*血清素</strong>*` 这种残骸。
const RULES: { delim: string; re: RegExp; type: "em" | "strong" | "del" }[] = [
  { delim: "\\*\\*\\*", re: rule("\\*\\*\\*"), type: "em" },
  { delim: "\\*\\*", re: rule("\\*\\*"), type: "strong" },
  { delim: "~~", re: rule("~~"), type: "del" },
];

const cjkEmphasis: TokenizerAndRendererExtension = {
  name: "cjkEmphasis",
  level: "inline",
  // 告诉 marked 下一个可能的起点，免得它把 `**` 之前的整段都当纯文本吞掉
  start(src: string) {
    const hits = [src.indexOf("**"), src.indexOf("~~")].filter((i) => i >= 0);
    return hits.length ? Math.min(...hits) : undefined;
  },
  tokenizer(src: string) {
    for (const { re, type } of RULES) {
      const m = re.exec(src);
      if (!m) continue;
      // `***x***` 拆成 em 包 strong：把内层 `**x**` 再喂回 inline lexer，
      // 会重新命中上面的 `**` 规则，粗斜体两层都不丢
      const inner = type === "em" ? `**${m[1]}**` : m[1];
      return {
        type,
        raw: m[0],
        text: inner,
        tokens: this.lexer.inlineTokens(inner),
      } as Tokens.Generic;
    }
    return undefined;
  },
};

let applied = false;

/**
 * 幂等地把补丁挂到 marked 单例上。marked 是模块级单例，`use` 是全局生效的，
 * 但三条渲染链路（公众号 / 小红书 / 推特长篇）各自 import marked，谁先加载不一定，
 * 所以每条链路都显式调一次，靠这里的 flag 去重。
 */
export function useCjkEmphasis(): void {
  if (applied) return;
  applied = true;
  marked.use({ extensions: [cjkEmphasis] });
}
