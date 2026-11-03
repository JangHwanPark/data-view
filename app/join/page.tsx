import { Suspense } from "react";
import { JoinBuilder } from "@/components/join-builder";

export default function JoinPage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중...</p>}>
      <JoinBuilder />
    </Suspense>
  );
}
