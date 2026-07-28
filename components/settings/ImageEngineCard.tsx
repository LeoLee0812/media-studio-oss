"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { KeyInput, SourceBadge, useSectionSave } from "./shared";

// 生图引擎（中转 · gpt-image 系列）
export function ImageEngineCard({
  enabled,
  source,
  apiKey: initialApiKey,
  base: initialBase,
  model: initialModel,
  quality: initialQuality,
}: {
  enabled: boolean;
  source: "db" | "env" | "none";
  apiKey: string;
  base: string;
  model: string;
  quality: string;
}) {
  const [imageApiKey, setImageApiKey] = useState(initialApiKey);
  const [imageApiBase, setImageApiBase] = useState(initialBase);
  const [imageModel, setImageModel] = useState(initialModel);
  const [imageQuality, setImageQuality] = useState(initialQuality);
  const { saving, msg, save } = useSectionSave();
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState("");

  async function testConn() {
    setTesting(true);
    setTestMsg("");
    try {
      const res = await fetch("/api/config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "image", apiKey: imageApiKey || undefined, base: imageApiBase || undefined }),
      });
      const data = await res.json();
      setTestMsg(data.ok ? "连接成功 ✓" : `连接失败：${data.error || "未知错误"}`);
    } catch {
      setTestMsg("连接失败：网络错误");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">生图引擎（中转 · gpt-image 系列）</CardTitle>
        <SourceBadge enabled={enabled} source={source} />
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="space-y-1">
          <label className="text-muted-foreground">API Key（点右侧眼睛可见）</label>
          <KeyInput value={imageApiKey} onChange={setImageApiKey} placeholder="sk-..." />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-muted-foreground">API Base</label>
            <Input value={imageApiBase} onChange={(e) => setImageApiBase(e.target.value)} placeholder="https://yunwu.ai/v1" />
            <p className="text-xs text-muted-foreground">
              默认示例为 yunwu.ai，可换任意 OpenAI 兼容端点；本项目与任何中转站无利益关系。
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-muted-foreground">模型</label>
            <Input value={imageModel} onChange={(e) => setImageModel(e.target.value)} placeholder="gpt-image-2" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground">画质</label>
          <Select value={imageQuality} onChange={(e) => setImageQuality(e.target.value)} className="w-40">
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={saving}
            onClick={() =>
              save({
                ...(imageApiKey ? { imageApiKey } : {}),
                imageApiBase,
                imageModel,
                imageQuality,
              })
            }
          >
            {saving ? "保存中…" : "保存"}
          </Button>
          <Button size="sm" variant="outline" disabled={testing} onClick={testConn}>
            {testing ? "测试中…" : "测试连接"}
          </Button>
          {msg && <span className="text-muted-foreground">{msg}</span>}
        </div>
        {testMsg && (
          <p className={`text-xs break-all ${testMsg.startsWith("连接成功") ? "text-green-600" : "text-red-500"}`}>
            {testMsg}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          仅公众号稿件页显示封面图生成；生图走此端点，与文案引擎独立计费。
        </p>
      </CardContent>
    </Card>
  );
}
