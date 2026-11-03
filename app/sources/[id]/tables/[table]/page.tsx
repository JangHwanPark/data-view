import { Suspense } from "react";
import { TablePreview } from "@/components/table-preview";

export default function TablePage({ params }: PageProps<"/sources/[id]/tables/[table]">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중...</p>}>
      {params.then(({ id, table }) => (
        <TablePreview id={id} table={decodeURIComponent(table)} />
      ))}
    </Suspense>
  );
}
