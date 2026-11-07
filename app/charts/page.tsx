import { Suspense } from "react";
import { ChartsPage } from "@/components/charts/charts-page";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중...</p>}>
      <ChartsPage />
    </Suspense>
  );
}
