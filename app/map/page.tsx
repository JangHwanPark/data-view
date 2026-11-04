import { Suspense } from "react";
import { DomainMap } from "@/components/map/domain-map";

export default function MapPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중...</p>}>
      <DomainMap />
    </Suspense>
  );
}
