import { PROMPT_DEFS, getPromptDefault, getPromptOverrides } from "@/lib/prompt-store";
import { PromptsClient, type PromptItem } from "@/components/PromptsClient";

export const dynamic = "force-dynamic";

// 提示词中心页：所有 AI 系统提示词的可视化编辑入口
export default async function PromptsPage() {
  const overrides = await getPromptOverrides();
  const items: PromptItem[] = await Promise.all(
    PROMPT_DEFS.map(async (d) => ({
      id: d.id,
      label: d.label,
      group: d.group,
      description: d.description,
      defaultText: await getPromptDefault(d.id),
      override: typeof overrides[d.id] === "string" ? overrides[d.id] : null,
    })),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">提示词</h1>
        <p className="text-sm text-muted-foreground">
          这里是所有 AI 功能背后的系统提示词。改完点保存立即生效；「恢复默认」会清掉自定义、回到内置模板。
        </p>
      </div>
      <PromptsClient items={items} />
    </div>
  );
}
