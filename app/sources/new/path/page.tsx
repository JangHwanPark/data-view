import { Suspense } from "react";
import { PathImportPage } from "@/features/sources";

export default function NewFromPathPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중...</p>}>
      <PathImportPage />
    </Suspense>
  );
}
