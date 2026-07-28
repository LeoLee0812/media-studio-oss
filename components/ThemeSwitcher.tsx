"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Moon, Sun, Palette, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { SKINS, DEFAULT_SKIN, SKIN_STORAGE_KEY, THEME_STORAGE_KEY, isSkinId, type SkinId } from "@/lib/skins";

// 订阅 <html> 的属性变化：明暗（class）与皮肤（data-skin）都写在根元素上，
// 这样切换后任何用到状态的组件都能同步，不必把状态提到全局。
function subscribeRoot(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-skin"] });
  return () => observer.disconnect();
}

export function ThemeSwitcher() {
  // SSR 时按「浅色 + 默认皮肤」渲染，水合后由 MutationObserver 同步真实值
  const dark = useSyncExternalStore(
    subscribeRoot,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  const skin = useSyncExternalStore(
    subscribeRoot,
    () => {
      const value = document.documentElement.dataset.skin ?? null;
      return isSkinId(value) ? value : DEFAULT_SKIN;
    },
    () => DEFAULT_SKIN as SkinId,
  );

  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // 点击面板外 / 按 Esc 关闭
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggleTheme() {
    const isDark = document.documentElement.classList.toggle("dark");
    localStorage.setItem(THEME_STORAGE_KEY, isDark ? "dark" : "light");
  }

  function pickSkin(id: SkinId) {
    document.documentElement.setAttribute("data-skin", id);
    localStorage.setItem(SKIN_STORAGE_KEY, id);
    setOpen(false);
  }

  return (
    <div ref={panelRef} className="relative flex items-center">
      <button
        onClick={toggleTheme}
        className="rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-accent"
        aria-label="切换明暗"
      >
        {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>

      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-accent",
          open && "bg-accent text-foreground",
        )}
        aria-label="切换主题风格"
        aria-expanded={open}
      >
        <Palette className="size-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">主题风格</div>
          {SKINS.map((item) => {
            const active = item.id === skin;
            return (
              <button
                key={item.id}
                onClick={() => pickSkin(item.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors",
                  active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
              >
                <span className="flex shrink-0 overflow-hidden rounded-full border border-border">
                  {item.swatch.map((color) => (
                    <span key={color} className="size-2.5" style={{ background: color }} />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-tight">{item.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.desc}</span>
                </span>
                {active && <Check className="size-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
