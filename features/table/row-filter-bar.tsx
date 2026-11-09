"use client";

import { useState } from "react";
import { Filter, Plus, X } from "lucide-react";
import { describeFilter, NO_VALUE, OP_LABEL, type FilterOp, type RowFilter } from "@/core/row-filter";

// 여러 조건 거르기 줄(30단계, 5-6). 조건을 더하면 바로 표에 적용된다. 조건끼리는 「그리고」다.
export function RowFilterBar({ columns, filters, onChange }: { columns: string[]; filters: RowFilter[]; onChange: (next: RowFilter[]) => void }) {
  const [draft, setDraft] = useState<RowFilter>({ column: "", op: "eq", value: "" });
  const column = draft.column || columns[0] || "";
  const needsValue = !NO_VALUE.includes(draft.op);
  const canAdd = !!column && (!needsValue || draft.value.trim() !== "");

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 text-zinc-500">
        <Filter className="size-3.5" aria-hidden />
        조건 거르기
      </span>
      {filters.map((f, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
          {i > 0 && <span className="text-blue-500">그리고</span>}
          <span className="font-mono">{describeFilter(f)}</span>
          <button type="button" onClick={() => onChange(filters.filter((_, j) => j !== i))} aria-label={`${describeFilter(f)} 조건 지우기`} className="rounded hover:bg-blue-100 dark:hover:bg-blue-900">
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <form
        className="inline-flex flex-wrap items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canAdd) return;
          onChange([...filters, { ...draft, column, value: needsValue ? draft.value.trim() : "" }]);
          setDraft({ column, op: draft.op, value: "" });
        }}
      >
        <select value={column} onChange={(e) => setDraft({ ...draft, column: e.target.value })} aria-label="거를 컬럼" className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-950">
          {columns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={draft.op} onChange={(e) => setDraft({ ...draft, op: e.target.value as FilterOp })} aria-label="비교 방법" className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-950">
          {(Object.keys(OP_LABEL) as FilterOp[]).map((op) => (
            <option key={op} value={op}>
              {OP_LABEL[op]}
            </option>
          ))}
        </select>
        {needsValue && (
          <input
            value={draft.value}
            onChange={(e) => setDraft({ ...draft, value: e.target.value })}
            placeholder="값 (예: 0)"
            aria-label="거를 값"
            className="w-24 rounded border border-zinc-300 bg-white px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-950"
          />
        )}
        <button type="submit" disabled={!canAdd} className="inline-flex items-center gap-0.5 rounded border border-zinc-300 px-1.5 py-0.5 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800">
          <Plus className="size-3" aria-hidden />
          조건 더하기
        </button>
      </form>
      {filters.length > 1 && (
        <button type="button" onClick={() => onChange([])} className="text-zinc-500 hover:underline">
          모두 지우기
        </button>
      )}
    </div>
  );
}
