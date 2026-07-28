import { notFound } from "next/navigation";
import { getDraft, getTopic } from "@/lib/queries";
import { DraftEditor } from "@/components/DraftEditor";

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

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <DraftEditor draft={draft} topic={topic} />
    </div>
  );
}
