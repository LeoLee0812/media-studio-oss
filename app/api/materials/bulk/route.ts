import { NextResponse } from "next/server";
import { createMaterial } from "@/lib/queries";
import { BULK_BATCH_SIZE, MAX_CONTENT_CHARS, noteDedupeKey } from "@/lib/vault-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 本地笔记批量导入：前端在浏览器里读本地文件夹、解析成条目后分批 POST 到这里。
// 去重键 = local:<vault>/<相对路径>，同一份 vault 重复导入自动跳过（不覆盖已有素材）。
// 只读模式（READ_ONLY=1）下 middleware 已在更外层把非 GET 请求拦成 403，这里不用重复判断。

interface BulkItem {
  path?: unknown;
  title?: unknown;
  summary?: unknown;
  content?: unknown;
  tags?: unknown;
  pillar?: unknown;
  url?: unknown;
  published_at?: unknown;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const items: BulkItem[] = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ error: "没有可导入的条目" }, { status: 400 });
  if (items.length > BULK_BATCH_SIZE) {
    return NextResponse.json({ error: `单次最多 ${BULK_BATCH_SIZE} 条，请分批提交` }, { status: 400 });
  }
  // vault 名只用于拼去重键，做一次清洗防止奇怪字符进键值
  const vault = (str(body?.vault, 60) ?? "vault").replace(/[^\w\-.一-龥]/g, "_");
  // 整批统一板块（用户在弹窗里指定），留空则用每条自己的（相对路径首层目录）
  const overridePillar = str(body?.pillar, 30);

  let created = 0;
  let skipped = 0;
  const failed: { path: string; error: string }[] = [];
  const materials = [];

  for (const item of items) {
    const path = str(item.path, 400);
    const title = str(item.title, 200);
    if (!path || !title) {
      failed.push({ path: path ?? "(未知路径)", error: "缺少路径或标题" });
      continue;
    }
    try {
      const material = await createMaterial({
        source: "local",
        source_id: path,
        dedupe_key: noteDedupeKey(vault, path),
        title,
        summary: str(item.summary, 400),
        content: str(item.content, MAX_CONTENT_CHARS + 20),
        pillar: overridePillar ?? str(item.pillar, 30),
        url: str(item.url, 500),
        published_at: str(item.published_at, 40),
        tags: Array.isArray(item.tags)
          ? item.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12)
          : [],
        raw: { importedFrom: "local-folder", vault, path },
      });
      // createMaterial 冲突时返回 null，即这条之前已导入过
      if (material) {
        created++;
        materials.push(material);
      } else {
        skipped++;
      }
    } catch (e) {
      failed.push({ path, error: e instanceof Error ? e.message : "入库失败" });
    }
  }

  return NextResponse.json({ created, skipped, failed, materials });
}
