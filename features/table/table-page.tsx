"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Columns3, Network, Table2 } from "lucide-react";
import { ColumnTable } from "./column-table";
import { TableRelationView } from "@/features/relations";
import { TablePreview } from "./table-preview";
import { InferredMark } from "@/core/ui/table-name";
import { RowSourceSwitch } from "./row-source-switch";
import { useKoreanNames } from "@/core/ui/use-korean-names";
import { parseView, readLastView, rememberView, subscribeLastView, type TableView } from "@/core/table-view";

// 테이블 화면(설계 4.13 G1, G2). 관계도, 데이터, 컬럼 표(24단계) 세 보기로 나눈다.
// 주소에 view가 없으면, 기획서의 "행 열기"(row)나 따라가기(trail)는 데이터로, 그 밖은 마지막으로 고른 보기(처음에는 관계도)로 연다.
export function TablePage({ id, table }: { id: string; table: string }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // 서버에서 그릴 때는 브라우저 저장소가 없으므로 관계도로 그리고, 브라우저에서 기억한 보기로 바꾼다.
  const last = useSyncExternalStore(subscribeLastView, readLastView, () => "graph" as TableView);
  const explicit = parseView(searchParams.get("view"));
  const view: TableView = explicit ?? (searchParams.get("row") || searchParams.get("trail") ? "data" : last);

  function choose(next: TableView) {
    rememberView(next);
    // 보기를 바꿀 때 서버에 요청하지 않도록 주소만 바꾼다. 데이터 보기의 row, trail은 관계도로 갈 때 버린다.
    window.history.pushState(null, "", `${pathname}?view=${next}`);
  }

  const korean = useKoreanNames().get(`${id}/${table}`);

  return (
    <div className="flex flex-col gap-3">
      {korean && (
        <p className="-mb-2 flex items-center text-sm text-zinc-600 dark:text-zinc-300" title={korean.inferred ? undefined : "엑셀 #Design 시트 머리말"}>
          <span className="mr-1.5 text-xs text-zinc-400">한글 이름</span>
          {korean.text}
          <InferredMark name={korean} />
        </p>
      )}
      <RowSourceSwitch id={id} table={table} />
      <nav className="flex gap-1 border-b border-zinc-200 text-sm dark:border-zinc-800" aria-label="테이블 보기">
        {(
          [
            { key: "graph", label: "참조 관계 그림", icon: Network },
            { key: "data", label: "데이터", icon: Table2 },
            { key: "columns", label: "컬럼 표", icon: Columns3 },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => choose(key)}
            aria-current={view === key ? "page" : undefined}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-1.5 ${
              view === key ? "border-zinc-900 font-medium dark:border-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </nav>
      {view === "graph" ? (
        <TableRelationView id={id} table={table} />
      ) : view === "columns" ? (
        <ColumnTable id={id} table={table} />
      ) : (
        <TablePreview id={id} table={table} />
      )}
    </div>
  );
}
