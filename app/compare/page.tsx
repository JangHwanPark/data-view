import { Suspense } from "react";
import { CompareView } from "@/components/compare/compare-view";

export default function ComparePage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중...</p>}>
      <CompareView />
    </Suspense>
  );
}
