import { Suspense } from "react";
import { DocChecklist } from "@/components/docs/doc-checklist";

export default function DocChecklistPage({ params }: PageProps<"/docs/[id]/checklist">) {
  return (
    <Suspense fallback={<p className="text-zinc-500">불러오는 중...</p>}>
      {params.then(({ id }) => (
        <DocChecklist id={id} />
      ))}
    </Suspense>
  );
}
