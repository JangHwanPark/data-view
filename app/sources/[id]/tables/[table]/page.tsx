import { Suspense } from "react";
import { TablePage as TableScreen } from "@/features/table";

export default function TablePage({ params }: PageProps<"/sources/[id]/tables/[table]">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">불러오는 중...</p>}>
      {params.then(({ id, table }) => (
        <TableScreen id={id} table={decodeURIComponent(table)} />
      ))}
    </Suspense>
  );
}
