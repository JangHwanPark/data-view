import { Suspense } from "react";
import { MissingIds } from "@/components/check/missing-ids";

export default function MissingIdsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중...</p>}>
      <MissingIds />
    </Suspense>
  );
}
