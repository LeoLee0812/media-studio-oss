// 皮肤注册表。皮肤（配色）与明暗是两个正交维度：
//   <html data-skin="broadcast" class="dark">  →  电台皮肤的深色版
// 变量定义在 app/themes.css（XP 的形状层另见 app/theme-xp.css）。
// 新增皮肤只要在这里加一条 + 在 themes.css 里补一组 html[data-skin="x"] 变量。

export type SkinId = "mono" | "ember" | "broadcast" | "newsroom" | "signal" | "xp";

export interface Skin {
  id: SkinId;
  name: string;
  desc: string;
  /** 切换面板里的三色预览：[背景, 主色, 强调] */
  swatch: [string, string, string];
}

export const SKINS: Skin[] = [
  {
    id: "mono",
    name: "单色",
    desc: "黑白灰，克制，默认",
    swatch: ["#ffffff", "#1a1a1a", "#8a8a8a"],
  },
  {
    id: "ember",
    name: "朱砂",
    desc: "砖红 + 暖白，锐利的 CTA",
    swatch: ["#f7f7f7", "#d0240f", "#f3b8ae"],
  },
  {
    id: "broadcast",
    name: "电台",
    desc: "琥珀暖褐，老式调音台",
    swatch: ["#faf6ef", "#c9741f", "#e8a54a"],
  },
  {
    id: "newsroom",
    name: "编辑部",
    desc: "米黄纸配靛蓝墨，衬线标题",
    swatch: ["#f5f1e6", "#2f4a91", "#c23b2e"],
  },
  {
    id: "signal",
    name: "信号",
    desc: "深板岩配青绿霓虹，为深色而生",
    swatch: ["#1b2430", "#4fd6c4", "#e05aa8"],
  },
  {
    id: "xp",
    name: "Windows XP",
    desc: "Luna 蓝，斜面按钮，回到 2001",
    swatch: ["#ece9d8", "#0053ee", "#3aa346"],
  },
];

export const DEFAULT_SKIN: SkinId = "mono";

export const SKIN_STORAGE_KEY = "skin";
export const THEME_STORAGE_KEY = "theme";

export function isSkinId(value: string | null): value is SkinId {
  return !!value && SKINS.some((s) => s.id === value);
}
