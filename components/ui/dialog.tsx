"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

// 极简受控弹窗（无第三方依赖）
export function Dialog({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in"
      onMouseDown={onClose}
    >
      <div
        className={cn(
          "relative w-full max-w-lg rounded-xl border bg-card p-5 shadow-lg animate-in zoom-in-95",
          className,
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
          aria-label="关闭"
        >
          <X className="size-4" />
        </button>
        {children}
      </div>
    </div>
  );
}
