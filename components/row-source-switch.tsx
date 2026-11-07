"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Database, FileSpreadsheet, FileText } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";

// 행 출처 전환(PLAN.md 27단계, 3-9). 같은 이름의 테이블을 엑셀과 DB(또는 CSV)로 둘 다 열었으면,
// 한 화면에서 엑셀 행과 DB 행을 바꿔 본다. 보기(연결 그림, 데이터, 컬럼 표)와 거르기, 따라가기는 그대로 둔다.
// DB 행을 볼 때 엑셀에서 ;로 막아 둔 행은 줄을 그어 보여준다(데이터 표).

const KIND_LABEL: Record<string, string> = { excel: "엑셀", csv: "CSV", mysql: "DB" };
const KIND_ICON = { excel: FileSpreadsheet, csv: FileText, mysql: Database } as const;

export function RowSourceSwitch({ id, table }: { id: string; table: string }) {
  const { sources } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const twins = sources.filter((s) => s.status === "ready" && s.tables.some((t) => t.toLowerCase() === table.toLowerCase()));
  if (twins.length < 2 || !twins.some((s) => s.meta.id === id)) return null;

  function go(sourceId: string) {
    const other = sources.find((s) => s.meta.id === sourceId)!;
    const name = other.tables.find((t) => t.toLowerCase() === table.toLowerCase())!;
    const query = searchParams.toString();
    router.push(`${pathname.replace(/^\/sources\/[^/]+\/tables\/[^/]+/, `/sources/${sourceId}/tables/${encodeURIComponent(name)}`)}${query ? `?${query}` : ""}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="행 출처">
      <span className="text-zinc-500">행 출처</span>
      {twins.map((s) => {
        const Icon = KIND_ICON[s.meta.kind as keyof typeof KIND_ICON] ?? FileText;
        const active = s.meta.id === id;
        return (
          <button
            key={s.meta.id}
            type="button"
            onClick={() => !active && go(s.meta.id)}
            aria-pressed={active}
            title={s.meta.name}
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 ${
              active ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            }`}
          >
            <Icon className="size-3" aria-hidden />
            {KIND_LABEL[s.meta.kind] ?? s.meta.kind} 행<span className="opacity-60">· {s.meta.name}</span>
          </button>
        );
      })}
    </div>
  );
}
