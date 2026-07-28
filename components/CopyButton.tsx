"use client";
import { useRef, useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";

// 一键复制按钮，复制成功后 CSS 弹一下 + 文案反馈（原 gsap 动效改为 CSS keyframes，省掉整个 gsap 依赖）
export function CopyButton({
  text,
  label = "复制",
  className,
  variant = "default",
  size = "sm",
  onCopied,
}: {
  text: string;
  label?: string;
  className?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  // 复制成功后的回调（如：稿件页借此弹出「标记已发布」快捷操作）
  onCopied?: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [done, setDone] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 降级：用临时 textarea
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setDone(true);
    if (ref.current) {
      // 重新触发动画：先移除类强制 reflow，再加回
      ref.current.classList.remove("copy-pop");
      void ref.current.offsetWidth;
      ref.current.classList.add("copy-pop");
    }
    setTimeout(() => setDone(false), 1600);
    onCopied?.();
  }

  return (
    <Button ref={ref} onClick={copy} className={className} variant={done ? "secondary" : variant} size={size}>
      {done ? <Check /> : <Copy />}
      {done ? "已复制" : label}
    </Button>
  );
}
