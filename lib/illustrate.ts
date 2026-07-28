// ===== 文章配图共享规则（服务端 / 客户端通用，保持纯函数）=====
// 配图落地方案：正文里插标准 markdown 图片（预览可见真实效果），
// 图片文件另行下载到本地绑定文件夹；「复制到公众号」时图片替换为
// 本地文件名占位提示（公众号后台粘贴带不过去外链图片，需手动上传）。
// 文件名由「文档内图片序号 + 图注」确定性生成——下载时与复制时
// 各自独立计算也能对上号，前提是两边共用下面这一个函数。

/** 图注 → 文件名安全片段：只留中英文与数字，截前 12 个字符 */
function captionSlug(caption: string): string {
  return caption.replace(/[^一-龥a-zA-Z0-9]/g, "").slice(0, 12);
}

/** 第 index 张（0 起）配图的本地文件名 */
export function illustrationFilename(index: number, caption: string): string {
  const slug = captionSlug(caption) || "图片";
  return `配图${index + 1}-${slug}.jpg`;
}
