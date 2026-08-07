import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// ===== 图片对象存储（Cloudflare 版）=====
//
// 为什么需要它：AI 生成的配图、以及正文里粘贴/拖拽进来的截图，都必须换成**公网直链**才能用——
// ① 公众号编辑器粘贴富文本时只会抓外链 <img> 转存到 mmbiz.qpic.cn，base64 内嵌粘不过去
//    （结论见 docs/wechat-assets.md）；
// ② base64 直接写进 ms_drafts.content 会让正文涨到 MB 级，响应体也会撑爆。
//
// 迁到 Cloudflare 后不再用 Vercel Blob，改成两档存储，运行时自动挑：
//   ① R2（绑定名 MEDIA_R2）—— 有就优先用，容量大、单价低，适合长期跑的自部署；
//   ② KV（绑定名 MEDIA_KV）—— 免费方案的默认档。免费额度 1GB 存储 / 1000 次写入每天，
//      配图这种低频写入完全够用；单值上限 25MB，前端已先压过一轮（lib/paste-image.ts）。
// 两档都没绑定就抛错，调用方会把原因原样回显到界面上，不静默吞掉。
//
// 存进去的对象统一由 app/f/[...key]/route.ts 这条路由读出来，所以直链形如
//   https://<你的域名>/f/pasted/1a2b3c4d.png
// 好处是不依赖任何第三方域名，公众号/知乎抓图时也只看到你自己的站。

const KV_BINDING = "MEDIA_KV";
const R2_BINDING = "MEDIA_R2";

export interface StoredBlobMeta {
  contentType: string;
  filename?: string;
}

// 这里只声明用到的那几个方法，不引入全局的 @cloudflare/workers-types：
// 那套类型会把 DOM 的 Request 一起覆盖掉（`await req.json()` 会退化成 unknown），
// 全项目三十来个 API 路由都要跟着改，得不偿失。
interface KvLike {
  put(key: string, value: ArrayBuffer | Uint8Array, opts?: { metadata?: unknown }): Promise<void>;
  getWithMetadata<M>(
    key: string,
    type: "arrayBuffer",
  ): Promise<{ value: ArrayBuffer | null; metadata: M | null }>;
}

interface R2Like {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    opts?: {
      httpMetadata?: { contentType?: string; cacheControl?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  } | null>;
}

interface CfBindings {
  [key: string]: unknown;
}

function bindings(): CfBindings {
  try {
    return (getCloudflareContext().env ?? {}) as unknown as CfBindings;
  } catch {
    // 不在 Workers 运行时（比如 next build 阶段的静态分析）——当作没有绑定
    return {};
  }
}

function kv(): KvLike | undefined {
  const b = bindings()[KV_BINDING];
  return b && typeof (b as KvLike).put === "function" ? (b as KvLike) : undefined;
}

function r2(): R2Like | undefined {
  const b = bindings()[R2_BINDING];
  return b && typeof (b as R2Like).put === "function" ? (b as R2Like) : undefined;
}

/** 当前站点的对外 origin。优先用真实请求的 Host（自定义域名访问时最准），兜底 SITE_URL。 */
export async function siteOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // 不在请求上下文里（定时任务等），落到 env
  }
  return (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function extFromType(contentType: string): string {
  const raw = contentType.split("/")[1]?.split(";")[0]?.toLowerCase() ?? "png";
  return raw === "jpeg" ? "jpg" : raw.replace(/[^a-z0-9]/g, "") || "png";
}

/** 对象 key 一律随机 ASCII，原始文件名（可能是中文）只放进 metadata，避免 URL 编码来回踩坑。 */
function makeKey(prefix: string, contentType: string): string {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `${prefix}/${rand}.${extFromType(contentType)}`;
}

export interface PutBlobInput {
  /** 目录前缀，如 pasted / ai-illustrations */
  prefix: string;
  body: ArrayBuffer | Uint8Array;
  contentType: string;
  /** 原始文件名，仅用于下载时的 Content-Disposition，可不传 */
  filename?: string;
}

export interface PutBlobResult {
  key: string;
  url: string;
  size: number;
}

export async function putBlob(input: PutBlobInput): Promise<PutBlobResult> {
  const body = input.body instanceof Uint8Array ? input.body : new Uint8Array(input.body);
  const key = makeKey(input.prefix, input.contentType);
  const meta: StoredBlobMeta = { contentType: input.contentType, filename: input.filename };

  const bucket = r2();
  if (bucket) {
    await bucket.put(key, body, {
      httpMetadata: { contentType: input.contentType, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: input.filename ? { filename: encodeURIComponent(input.filename) } : undefined,
    });
  } else {
    const store = kv();
    if (!store) {
      throw new Error(
        `没有可用的图片存储：请在 wrangler.jsonc 里绑定 KV（${KV_BINDING}）或 R2（${R2_BINDING}）后重新部署`,
      );
    }
    if (body.byteLength > 24 * 1024 * 1024) {
      throw new Error("图片超过 KV 单值 25MB 上限，请改绑 R2");
    }
    await store.put(key, body, { metadata: meta });
  }

  return { key, url: `${await siteOrigin()}/f/${key}`, size: body.byteLength };
}

export interface FetchedBlob {
  body: ArrayBuffer;
  contentType: string;
  filename?: string;
}

export async function getBlob(key: string): Promise<FetchedBlob | null> {
  const bucket = r2();
  if (bucket) {
    const obj = await bucket.get(key);
    if (obj) {
      return {
        body: await obj.arrayBuffer(),
        contentType: obj.httpMetadata?.contentType ?? "application/octet-stream",
        filename: obj.customMetadata?.filename ? decodeURIComponent(obj.customMetadata.filename) : undefined,
      };
    }
  }
  const store = kv();
  if (store) {
    const res = await store.getWithMetadata<StoredBlobMeta>(key, "arrayBuffer");
    if (res.value) {
      return {
        body: res.value,
        contentType: res.metadata?.contentType ?? "application/octet-stream",
        filename: res.metadata?.filename,
      };
    }
  }
  return null;
}

/** 有没有配好图片存储——设置页/错误提示可以据此给出人话解释。 */
export function hasBlobStore(): boolean {
  return Boolean(r2() || kv());
}
