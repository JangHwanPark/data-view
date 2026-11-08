import { Suspense } from "react";
import { PatchChecklist } from "@/components/compare/patch-checklist";

export default function PatchChecklistPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중...</p>}>
      <PatchChecklist />
    </Suspense>
  );
}
