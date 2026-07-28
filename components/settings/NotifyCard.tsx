"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SourceBadge, useSectionSave } from "./shared";

// 邮件通知（Resend）：key 配置 + 每日采集摘要开关
export function NotifyCard({
  enabled,
  source,
  dailySummary: initialDailySummary,
}: {
  enabled: boolean;
  source: "db" | "env" | "none";
  dailySummary: boolean;
}) {
  const [resendApiKey, setResendApiKey] = useState("");
  const [dailySummary, setDailySummary] = useState(initialDailySummary);
  const { saving, msg, save } = useSectionSave();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">邮件通知（Resend）</CardTitle>
        <SourceBadge enabled={enabled} source={source} />
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="space-y-1">
          <label className="text-muted-foreground">Resend API Key</label>
          <Input
            type="password"
            placeholder={enabled ? "已配置，留空则不修改" : "re_..."}
            value={resendApiKey}
            onChange={(e) => setResendApiKey(e.target.value)}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={dailySummary}
            onChange={(e) => setDailySummary(e.target.checked)}
            className="size-4 accent-blue-500"
          />
          <span>每日采集摘要邮件（当天有新增素材时发送）</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={saving}
            onClick={() =>
              save(
                {
                  ...(resendApiKey ? { resendApiKey } : {}),
                  dailySummary,
                },
                // Resend key 不回显，保存后清空输入框；文案/生图 key 支持点击可见，保留在输入框里
                () => setResendApiKey(""),
              )
            }
          >
            {saving ? "保存中…" : "保存"}
          </Button>
          {msg && <span className="text-muted-foreground">{msg}</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          采集失败告警邮件在配置了 key 后自动生效；摘要邮件受上方开关控制。收件人固定为站长邮箱。
        </p>
      </CardContent>
    </Card>
  );
}
