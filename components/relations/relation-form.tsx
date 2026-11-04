"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Loader2, Plus } from "lucide-react";
import { useWorkspace, type WorkspaceSource } from "@/components/workspace-provider";
import { StatsText, tableOptions } from "@/components/relations/relation-parts";
import {
  newRelationId,
  relationStats,
  sameEndpoints,
  type ColumnRef,
  type RelationStats,
} from "@/lib/client/relations";
import type { QueryColumn } from "@/lib/query-result";

interface Props {
  sources: WorkspaceSource[];
  columns: Map<string, QueryColumn[]>;
}

const selectClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function RelationForm({ sources, columns }: Props) {
  const { relations, addRelations } = useWorkspace();
  const options = tableOptions(sources);
  const [fromTable, setFromTable] = useState("");
  const [fromColumn, setFromColumn] = useState("");
  const [toTable, setToTable] = useState("");
  const [toColumn, setToColumn] = useState("");
  // 결과를 고른 조합의 키와 같이 저장하고, 키가 지금 선택과 다르면 계산 중으로 본다.
  const [result, setResult] = useState<{ key: string; value: RelationStats | "error" } | null>(null);

  const from = toRef(fromTable, fromColumn);
  const to = toRef(toTable, toColumn);
  const complete = from && to;
  const sameColumn = complete && fromTable === toTable && fromColumn === toColumn;
  const duplicate = complete && relations.some((r) => sameEndpoints(r, { from, to }));
  const selectionKey = complete && !sameColumn ? JSON.stringify([fromTable, fromColumn, toTable, toColumn]) : null;
  const stats = !selectionKey ? null : result?.key === selectionKey ? result.value : "loading";

  useEffect(() => {
    if (!selectionKey || !from || !to) return;
    let active = true;
    relationStats(from, to)
      .then((value) => active && setResult({ key: selectionKey, value }))
      .catch(() => active && setResult({ key: selectionKey, value: "error" }));
    return () => {
      active = false;
    };
    // from, to는 selectionKey와 같은 값에서 만들어지므로 키로만 다시 계산한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  function toRef(tableKeyValue: string, column: string): ColumnRef | null {
    const option = options.find((o) => o.key === tableKeyValue);
    if (!option || !column) return null;
    return { sourceId: option.sourceId, table: option.table, column };
  }

  async function save() {
    if (!from || !to) return;
    await addRelations([{ id: newRelationId(), from, to }]);
    setFromColumn("");
    setToColumn("");
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">직접 잇기</h2>
      <p className="text-sm text-zinc-500">
        다른 테이블의 ID를 쓰는 열(예: 퀘스트의 reward_group_id)을 왼쪽에, 그 ID가 있는 열(예: 보상 그룹의 reward_group_id)을 오른쪽에 고릅니다.
      </p>
      <div className="grid grid-cols-1 items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 md:grid-cols-[1fr_auto_1fr] dark:border-zinc-800 dark:bg-zinc-900">
        <EndpointPicker
          title="ID를 쓰는 쪽"
          options={options}
          columns={columns}
          table={fromTable}
          column={fromColumn}
          onTable={(v) => {
            setFromTable(v);
            setFromColumn("");
          }}
          onColumn={setFromColumn}
        />
        <ArrowRight className="mx-auto mb-2 hidden size-5 text-zinc-400 md:block" aria-hidden />
        <EndpointPicker
          title="ID가 있는 쪽"
          options={options}
          columns={columns}
          table={toTable}
          column={toColumn}
          onTable={(v) => {
            setToTable(v);
            setToColumn("");
          }}
          onColumn={setToColumn}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!complete || !!sameColumn || !!duplicate || stats === "loading"}
          onClick={() => void save()}
          className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          <Plus className="size-4" aria-hidden />
          연결 저장
        </button>
        {sameColumn && <p className="text-sm text-red-600">같은 열끼리는 이을 수 없습니다.</p>}
        {duplicate && <p className="text-sm text-zinc-500">이미 있는 연결입니다.</p>}
        {stats === "loading" && (
          <p className="inline-flex items-center gap-1 text-sm text-zinc-500">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            값이 얼마나 맞는지 세는 중
          </p>
        )}
        {stats === "error" && <p className="text-sm text-red-600">값이 얼마나 맞는지 세지 못했습니다.</p>}
        {stats && typeof stats === "object" && <StatsText stats={stats} />}
      </div>
    </section>
  );
}

interface PickerProps {
  title: string;
  options: ReturnType<typeof tableOptions>;
  columns: Map<string, QueryColumn[]>;
  table: string;
  column: string;
  onTable: (value: string) => void;
  onColumn: (value: string) => void;
}

function EndpointPicker({ title, options, columns, table, column, onTable, onColumn }: PickerProps) {
  const cols = columns.get(table) ?? [];
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-zinc-500">{title}</span>
      <select aria-label={`${title} 시트`} className={selectClass} value={table} onChange={(e) => onTable(e.target.value)}>
        <option value="">파일/시트 선택</option>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        aria-label={`${title} 열`}
        className={selectClass}
        value={column}
        disabled={!table}
        onChange={(e) => onColumn(e.target.value)}
      >
        <option value="">열 선택</option>
        {cols.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
