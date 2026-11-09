import { Suspense } from "react";
import { DocView } from "@/features/docs";

export default function DocPage({ params }: PageProps<"/docs/[id]">) {
  return (
    <Suspense fallback={<p className="text-zinc-500">불러오는 중...</p>}>
      {params.then(({ id }) => (
        <DocView id={id} />
      ))}
    </Suspense>
  );
}
