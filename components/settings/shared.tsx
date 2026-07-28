"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatRelativeTime } from "@/lib/format";
import { Eye, EyeOff } from "lucide-react";

// 各配置子组件共享的类型与小控件，从 SettingsClient 拆出来，避免每个 Card 重复定义。

// 采集状态（ms_sync_state 的 rss 键），RssFeedsCard 用
export interface SyncInfo {
  lastRunAt?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  lastFetched?: number | null;
  lastInserted?: number | null;
}

// 配置来源徽章：未配置 / 已配置（网页）/ 已配置（env）
export function SourceBadge({ enabled, source }: { enabled: boolean; source: string }) {
  if (!enabled) return <Badge variant="muted">未配置</Badge>;
  return <Badge variant="default">{source === "db" ? "已配置（网页）" : "已配置（env）"}</Badge>;
}

// 时间展示：相对时间 + 悬浮显示原始 ISO；空值给占位
export function TimeText({ iso, className }: { iso?: string | null; className?: string }) {
  if (!iso) return <span className={className ?? "text-muted-foreground"}>从未</span>;
  return (
    <span className={className ?? "text-muted-foreground"} title={iso} suppressHydrationWarning>
      {formatRelativeTime(iso)}
    </span>
  );
}

// 带「点击可见」的密钥输入框
export function KeyInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-9"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        aria-label={show ? "隐藏 API Key" : "显示 API Key"}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

// 单个配置域的保存辅助：每张卡片各自持有一份 saving/msg 状态，互不干扰。
// 保存成功后统一 router.refresh()，与拆分前行为保持一致。
export function useSectionSave() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function save(patch: Record<string, unknown>, onSuccess?: () => void) {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg("已保存");
        onSuccess?.();
        router.refresh();
      } else {
        setMsg(data.error || "保存失败");
      }
    } catch {
      setMsg("保存失败");
    } finally {
      setSaving(false);
    }
  }

  return { saving, msg, setMsg, save };
}
