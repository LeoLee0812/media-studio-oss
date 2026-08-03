import { notFound } from "next/navigation";
import { getDraft, getTopic } from "@/lib/queries";
import { DraftEditor } from "@/components/DraftEditor";
import { getImagePreset } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function DraftDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const draft = await getDraft(id);
  if (!draft) notFound();
  const topic = draft.topic_id ? await getTopic(draft.topic_id) : null;
  // AI 配图下拉框的初始选中项跟随设置页预设（逐篇仍可临时改）
  const preset = await getImagePreset();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <DraftEditor draft={draft} topic={topic} presetAiStyle={preset.aiStyleKey} />
    </div>
  );
}
