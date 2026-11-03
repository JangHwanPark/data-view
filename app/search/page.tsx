import { Suspense } from "react";
import { ValueSearch } from "@/components/value-search";

export default function SearchPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중...</p>}>
      <ValueSearch />
    </Suspense>
  );
}
