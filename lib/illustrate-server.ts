import { generateObject, jsonSchema } from "ai";
import { getLlmModel } from "./llm";
import { getPrompt } from "./prompt-store";
import { searchOneImage } from "./image-search";
import { illustrationFilename } from "./illustrate";

// ===== 文章配图核心流水线（服务端）=====
// ① LLM 在编号段落间挑 2-4 个插图点，产出图库英文搜索词 + 中文图注
// ② 逐点搜 Pexels（主）/Pixabay（兜底）拿真实图片 URL
// ③ 标准 markdown 图片插回正文
// 两个入口共用：/api/generate 生成公众号正文时同步配图；
// /api/drafts/[id]/illustrate 稿件页手动重配。
// 图片文件本体由前端经 /api/images/proxy 下载到本地绑定文件夹。

const ILLUSTRATE_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    images: {
      type: "array",
      description: "2-4 个插图点，按出现顺序",
      items: {
        type: "object",
        properties: {
          after: { type: "integer", description: "插在编号为 after 的段落之后" },
          keyword: { type: "string", description: "给国际图库的英文搜索词，2-4 个词" },
          caption: { type: "string", description: "展示给读者的中文图注，8-20 字" },
        },
        required: ["after", "keyword", "caption"],
        additionalProperties: false,
      },
    },
  },
  required: ["images"],
  additionalProperties: false,
});

interface PlannedImage {
  after: number;
  keyword: string;
  caption: string;
}

export interface IllustrationItem {
  filename: string;
  url: string;
  caption: string;
  keyword: string;
  credit: string;
  provider: string;
}

export interface IllustrateResult {
  content: string;
  images: IllustrationItem[];
}

// 给正文配图：成功返回插好图的新正文 + 图片清单；选点/搜图全军覆没时抛错（调用方决定是否阻断）
export async function illustrateArticle(params: {
  title: string;
  content: string;
}): Promise<IllustrateResult> {
  const { title, content } = params;
  if (!content.trim()) throw new Error("正文为空，无从配图");

  // 按空行切段并编号；段落数组同时用于回插，切分规则前后必须一致
  const blocks = content.split(/\n{2,}/);
  const numbered = blocks
    .map((b, i) => `[${i + 1}] ${b.replace(/\n/g, " ").slice(0, 120)}`)
    .join("\n");

  const system = await getPrompt("illustrate_system");
  const prompt = [
    `文章标题：${title || "（无标题）"}`,
    `正文段落（共 ${blocks.length} 段，每段只截取了开头做定位用）：`,
    numbered,
    "请给出插图点。after 必须是上面出现过的段落编号。",
  ].join("\n\n");

  const { object } = await generateObject({
    model: await getLlmModel({ structured: true }),
    schema: ILLUSTRATE_SCHEMA,
    system,
    prompt,
    temperature: 0.5,
  });
  // 顶层字段名容错：schema 要求 images，但经聚合中转（yunwu）的模型对 json_schema 的
  // 字段名约束不严格，实测会自作主张返回 illustrations 之类的键。内容是好的，只是键名漂了，
  // 所以取不到 images 时退而找对象里第一个数组值，别让整轮配图白跑。
  const raw = object as Record<string, unknown>;
  const rawList = Array.isArray(raw.images)
    ? raw.images
    : ((Object.values(raw).find(Array.isArray) as unknown[]) ?? []);
  let planned = (rawList as Partial<PlannedImage>[])
    // after 同样容错：约束不严的通道可能给数字字符串（"12"），Number() 收编
    .map((p) => ({ ...p, after: Number(p.after) }))
    .filter(
      (p): p is PlannedImage =>
        Number.isInteger(p.after) &&
        p.after >= 1 &&
        p.after < blocks.length && // 不允许插在最后一段之后
        typeof p.keyword === "string" &&
        p.keyword.trim() !== "" &&
        typeof p.caption === "string" &&
        p.caption.trim() !== "",
    )
    .slice(0, 4);
  if (planned.length === 0) {
    // 把原始返回落日志：这一步失败历史上都是「返回结构漂移」，没有原文根本没法定位
    console.error("[illustrate] 模型插图点全部无效，原始返回：", JSON.stringify(object).slice(0, 800));
    throw new Error("AI 没有给出有效插图点");
  }

  // 同一段落后只保留一张，并按位置排序
  const seen = new Set<number>();
  planned = planned
    .filter((p) => (seen.has(p.after) ? false : (seen.add(p.after), true)))
    .sort((a, b) => a.after - b.after);

  // 逐点搜图（跨图去重）；搜不到的点直接跳过
  const usedUrls = new Set<string>();
  const found: (PlannedImage & { url: string; credit: string; provider: string })[] = [];
  for (const p of planned) {
    const hit = await searchOneImage(p.keyword.trim(), usedUrls);
    if (!hit) continue;
    usedUrls.add(hit.url);
    found.push({ ...p, caption: p.caption.trim(), keyword: p.keyword.trim(), url: hit.url, credit: hit.credit, provider: hit.provider });
  }
  if (found.length === 0) throw new Error("图库没搜到合适的图片");

  // 从后往前插，编号不受影响；文件名按文档内出现顺序编号（与前端复制/下载时的规则一致）
  const images: IllustrationItem[] = found.map((f, i) => ({
    filename: illustrationFilename(i, f.caption),
    url: f.url,
    caption: f.caption,
    keyword: f.keyword,
    credit: f.credit,
    provider: f.provider,
  }));
  const parts = [...blocks];
  for (let i = found.length - 1; i >= 0; i--) {
    parts.splice(found[i].after, 0, `![${found[i].caption}](${found[i].url})`);
  }

  return { content: parts.join("\n\n"), images };
}
