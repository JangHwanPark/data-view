import { Suspense } from "react";
import { SourceDetail } from "@/components/source-detail";

export default function SourcePage({ params }: PageProps<"/sources/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중...</p>}>
      {params.then(({ id }) => (
        <SourceDetail id={id} />
      ))}
    </Suspense>
  );
}
