// ===== 封面图前端工具（仅在客户端组件中使用）=====
// 1) canvas 按目标比例居中裁剪（图像模型只出固定尺寸，精确比例靠裁剪）
// 2) File System Access API：绑定一次本地文件夹（如 桌面/公众号-封面），
//    句柄存 IndexedDB；用户在权限弹窗选「每次访问都允许」后，之后生成完可静默写入。
// 3) saveCoverImage：优先写入已绑定文件夹，失败/未绑定则退回浏览器默认下载。

// File System Access API 的最小类型声明（lib.dom 尚未内置 showDirectoryPicker）
interface FsPermissionDescriptor {
  mode?: "read" | "readwrite";
}
export interface CoverDirHandle {
  readonly name: string;
  queryPermission(desc?: FsPermissionDescriptor): Promise<PermissionState>;
  requestPermission(desc?: FsPermissionDescriptor): Promise<PermissionState>;
  getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<{
    createWritable(): Promise<{
      write(data: Blob): Promise<void>;
      close(): Promise<void>;
    }>;
  }>;
  /** 取/建子目录句柄（按笔记分文件夹用） */
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<CoverDirHandle>;
}
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: {
      id?: string;
      mode?: "read" | "readwrite";
      startIn?: string;
    }) => Promise<CoverDirHandle>;
  }
}

// 按目标比例居中裁剪，返回 dataURL
export async function cropToRatio(b64: string, ratio: string): Promise<string> {
  const [rw, rh] = ratio.split(":").map(Number);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = `data:image/png;base64,${b64}`;
  });
  const target = rw / rh;
  let w = img.width;
  let h = img.height;
  if (w / h > target) w = Math.round(h * target);
  else h = Math.round(w / target);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 不可用");
  ctx.drawImage(img, (img.width - w) / 2, (img.height - h) / 2, w, h, 0, 0, w, h);
  return canvas.toDataURL("image/png");
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const mime = head.match(/data:([^;]+)/)?.[1] ?? "image/png";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// ---- IndexedDB 里持久化目录句柄 ----

const DB_NAME = "ms-cover";
const STORE = "handles";
const KEY = "coverDir";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDel(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// 浏览器是否支持选目录（Chrome/Edge 桌面版）
export function folderPickerSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

// 绑定封面保存目录（必须由用户点击触发）。权限弹窗里选「每次访问时允许」可实现之后静默写入。
export async function chooseCoverFolder(): Promise<string> {
  if (!window.showDirectoryPicker) throw new Error("当前浏览器不支持选择文件夹（需 Chrome/Edge 桌面版）");
  const handle = await window.showDirectoryPicker({
    id: "cover-export",
    mode: "readwrite",
    startIn: "desktop",
  });
  await idbSet(KEY, handle);
  return handle.name;
}

// 已绑定目录的名字（未绑定返回 null）
export async function getCoverFolderName(): Promise<string | null> {
  try {
    const h = await idbGet<CoverDirHandle>(KEY);
    return h?.name ?? null;
  } catch {
    return null;
  }
}

export async function clearCoverFolder(): Promise<void> {
  await idbDel(KEY).catch(() => {});
}

// 校验/申请目录写权限。注意：requestPermission 需要用户手势，静默调用可能被拒——
// 长耗时链路（生图 1-2 分钟）结束后早已跨出手势窗口，此时权限若已过期只能静默失败。
async function verifyPermission(handle: CoverDirHandle): Promise<boolean> {
  try {
    if ((await handle.queryPermission({ mode: "readwrite" })) === "granted") return true;
    return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
  } catch {
    return false;
  }
}

// 保存结果：dest 是最终去向；走下载兜底时 fallback 说明原因，调用方据此给出可操作的提示
// （此前所有提示都是笼统的「走了浏览器下载」，用户分不清是要重新授权还是别的问题）。
export interface SaveOutcome {
  dest: "folder" | "download";
  fallback?: "unbound" | "permission" | "write-error";
}

// 把下载兜底原因翻译成一句可操作的中文提示（没有兜底时返回空串）
export function fallbackHint(o: SaveOutcome): string {
  switch (o.fallback) {
    case "permission":
      return "文件夹授权已过期——到稿件页点「下载图片」，在点击手势里可重新弹出授权";
    case "unbound":
      return "未绑定本地文件夹，绑定后可自动落盘";
    case "write-error":
      return "写入文件夹失败，已改走浏览器下载";
    default:
      return "";
  }
}

// 文件/文件夹名安全化：去掉文件系统不认的字符，控制长度（笔记标题当文件夹名用）
export function sanitizeFsName(raw: string, maxLen = 24): string {
  return (
    raw
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLen)
      .trim() || "未命名"
  );
}

// 保存任意图片 Blob：优先写入已绑定文件夹（静默），未绑定/无权限/写失败则退回浏览器下载。
// 封面图和文章配图共用同一个绑定文件夹。
// subdirs：绑定文件夹下的子目录路径（逐级自动创建），用于「每篇笔记一个文件夹」的结构：
//   绑定文件夹/<笔记名>/封面-xxx.png
//   绑定文件夹/<笔记名>/子图/配图N-xxx.jpg
// 浏览器下载兜底无法建目录（<a download> 指定不了子文件夹是安全策略），把路径拍平进文件名。
export async function saveImageBlob(
  blob: Blob,
  filename: string,
  subdirs: string[] = [],
): Promise<SaveOutcome> {
  const dirs = subdirs.map((d) => sanitizeFsName(d)).filter(Boolean);
  let fallback: NonNullable<SaveOutcome["fallback"]> = "unbound";
  try {
    let handle = await idbGet<CoverDirHandle>(KEY);
    if (handle) {
      if (await verifyPermission(handle)) {
        try {
          for (const dir of dirs) {
            handle = await handle.getDirectoryHandle(dir, { create: true });
          }
          const file = await handle.getFileHandle(filename, { create: true });
          const writable = await file.createWritable();
          await writable.write(blob);
          await writable.close();
          return { dest: "folder" };
        } catch {
          fallback = "write-error";
        }
      } else {
        fallback = "permission";
      }
    }
  } catch {
    fallback = "write-error";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = dirs.length ? `${dirs.join("-")}-${filename}` : filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { dest: "download", fallback };
}

// 保存封面（dataURL 入口，转 Blob 后走统一保存）
export async function saveCoverImage(
  dataUrl: string,
  filename: string,
  subdirs: string[] = [],
): Promise<SaveOutcome> {
  return saveImageBlob(dataUrlToBlob(dataUrl), filename, subdirs);
}
