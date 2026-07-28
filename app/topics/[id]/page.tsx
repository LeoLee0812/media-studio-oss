import { notFound } from "next/navigation";
import { getTopic, getMaterials, listDrafts } from "@/lib/queries";
import { llmEnabled } from "@/lib/generate";
import { resolveWritingStyle } from "@/lib/config";
import { TopicDetail } from "@/components/TopicDetail";

export const dynamic = "force-dynamic";

export default async function TopicDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const topic = await getTopic(id);
  if (!topic) notFound();
  const [materials, drafts, llmOn, defaultStyle] = await Promise.all([
    getMaterials(topic.material_ids ?? []),
    listDrafts({ topic_id: id }),
    llmEnabled(),
    resolveWritingStyle(),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <TopicDetail
        topic={topic}
        materials={materials}
        drafts={drafts}
        llmEnabled={llmOn}
        defaultStyle={defaultStyle}
      />
    </div>
  );
}
