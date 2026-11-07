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
  type FromSide,
  type RelationStats,
} from "@/lib/client/relations";
import type { QueryColumn } from "@/lib/query-result";

// 쓰는 쪽이 ID를 적는 방식(설계 4.8). 게임 테이블에서 흔한 네 가지다.
type Mode = "single" | "numbered" | "split" | "typed";
const MODES: { key: Mode; label: string; example: string }[] = [
  { key: "single", label: "한 칸에 ID 하나", example: "item_id = 1001" },
  { key: "numbered", label: "번호 붙은 여러 컬럼", example: "material_id_1 ~ material_id_5" },
  { key: "split", label: "한 칸에 여러 ID", example: "skill_ids = 1001|1002|1003" },
  { key: "typed", label: "종류 + ID", example: "reward_type = ITEM 일 때 reward_id" },
];
const SEPARATORS = ["|", ",", ";", "/"];

// material_id_1을 고르면 material_id_1, material_id_2 ...처럼 번호만 다른 열을 찾는다.
function numberedSiblings(column: string, all: string[]) {
  const m = column.match(/^(.*?)(\d+)$/);
  if (!m) return [column];
  const prefix = m[1];
  return all.filter((c) => new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d+$`).test(c));
}

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
  const [mode, setMode] = useState<Mode>("single");
  const [picked, setPicked] = useState<string[] | null>(null); // 번호 붙은 열 중 고른 것. null이면 자동으로 찾은 전부
  const [separator, setSeparator] = useState("|");
  const [whenColumn, setWhenColumn] = useState("");
  const [whenValue, setWhenValue] = useState("");
  // 결과를 고른 조합의 키와 같이 저장하고, 키가 지금 선택과 다르면 계산 중으로 본다.
  const [result, setResult] = useState<{ key: string; value: RelationStats | "error" } | null>(null);

  const fromColumnNames = (columns.get(fromTable) ?? []).map((c) => c.name);
  const siblings = fromColumn ? numberedSiblings(fromColumn, fromColumnNames) : [];
  const base = toRef(fromTable, fromColumn);
  // 고른 방식에 따라 쓰는 쪽을 만든다. 조건이 덜 채워졌으면 null이다.
  const from: FromSide | null = !base
    ? null
    : mode === "numbered"
      ? (picked ?? siblings).length > 1
        ? { ...base, column: (picked ?? siblings)[0], columns: picked ?? siblings }
        : null
      : mode === "split"
        ? separator
          ? { ...base, separator }
          : null
        : mode === "typed"
          ? whenColumn && whenValue.trim()
            ? { ...base, when: { column: whenColumn, value: whenValue.trim() } }
            : null
          : base;
  const to = toRef(toTable, toColumn);
  const complete = from && to;
  const sameColumn = complete && fromTable === toTable && fromColumn === toColumn;
  const duplicate = complete && relations.some((r) => sameEndpoints(r, { from, to }));
  const selectionKey = complete && !sameColumn ? JSON.stringify([from, toTable, toColumn]) : null;
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
    setPicked(null);
    setWhenValue("");
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">직접 잇기</h2>
      <p className="text-sm text-zinc-500">
        다른 테이블의 ID를 참조하는 컬럼(예: 퀘스트의 reward_group_id)을 왼쪽에, 그 ID가 있는 컬럼(예: 보상 그룹의 reward_group_id)을 오른쪽에 고릅니다.
      </p>
      <div className="grid grid-cols-1 items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 md:grid-cols-[1fr_auto_1fr] dark:border-zinc-800 dark:bg-zinc-900">
        <EndpointPicker
          title="ID를 참조하는 쪽"
          options={options}
          columns={columns}
          table={fromTable}
          column={fromColumn}
          onTable={(v) => {
            setFromTable(v);
            setFromColumn("");
          }}
          onColumn={(v) => {
            setFromColumn(v);
            setPicked(null);
          }}
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

      <fieldset className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <legend className="px-1 text-xs font-medium text-zinc-500">ID를 적는 방식</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {MODES.map((m) => (
            <label key={m.key} className="inline-flex items-baseline gap-1.5">
              <input type="radio" name="relation-mode" checked={mode === m.key} onChange={() => setMode(m.key)} />
              <span>{m.label}</span>
              <span className="font-mono text-xs text-zinc-400">{m.example}</span>
            </label>
          ))}
        </div>
        {mode === "numbered" && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {!fromColumn ? (
              <span className="text-zinc-500">왼쪽에서 번호 붙은 컬럼 하나(예: material_id_1)를 고르면 같은 이름의 번호 컬럼을 모두 찾습니다.</span>
            ) : siblings.length < 2 ? (
              <span className="text-amber-700 dark:text-amber-400">{fromColumn}와 번호만 다른 컬럼이 없습니다. 이름 끝이 숫자인 컬럼을 골라 주세요.</span>
            ) : (
              <>
                <span className="text-zinc-500">함께 볼 컬럼</span>
                {siblings.map((c) => (
                  <label key={c} className="inline-flex items-center gap-1 font-mono">
                    <input
                      type="checkbox"
                      checked={(picked ?? siblings).includes(c)}
                      onChange={(e) => {
                        const now = picked ?? siblings;
                        setPicked(e.target.checked ? siblings.filter((x) => now.includes(x) || x === c) : now.filter((x) => x !== c));
                      }}
                    />
                    {c}
                  </label>
                ))}
              </>
            )}
          </div>
        )}
        {mode === "split" && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-zinc-500">ID 사이를 나누는 글자</span>
            {SEPARATORS.map((sep) => (
              <label key={sep} className="inline-flex items-center gap-1 font-mono">
                <input type="radio" name="relation-sep" checked={separator === sep} onChange={() => setSeparator(sep)} />
                {sep}
              </label>
            ))}
            <input
              aria-label="다른 구분 글자"
              value={SEPARATORS.includes(separator) ? "" : separator}
              onChange={(e) => setSeparator(e.target.value)}
              placeholder="다른 글자"
              className="w-20 rounded border border-zinc-300 bg-white px-1.5 py-0.5 font-mono dark:border-zinc-700 dark:bg-zinc-950"
            />
          </div>
        )}
        {mode === "typed" && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-zinc-500">이 컬럼이</span>
            <select aria-label="종류 컬럼" className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-950" value={whenColumn} onChange={(e) => setWhenColumn(e.target.value)} disabled={!fromTable}>
              <option value="">종류 컬럼 선택(예: reward_type)</option>
              {fromColumnNames.filter((c) => c !== fromColumn).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="text-zinc-500">값</span>
            <input
              aria-label="종류 값"
              value={whenValue}
              onChange={(e) => setWhenValue(e.target.value)}
              placeholder="예: ITEM"
              className="w-28 rounded border border-zinc-300 bg-white px-1.5 py-0.5 font-mono dark:border-zinc-700 dark:bg-zinc-950"
            />
            <span className="text-zinc-500">인 행만 오른쪽 테이블을 가리킵니다. 종류마다(ITEM, CURRENCY …) 참조 관계를 하나씩 만들어 주세요.</span>
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!complete || !!sameColumn || !!duplicate || stats === "loading"}
          onClick={() => void save()}
          className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          <Plus className="size-4" aria-hidden />
          참조 관계 저장
        </button>
        {sameColumn && <p className="text-sm text-red-600">같은 열끼리는 이을 수 없습니다.</p>}
        {duplicate && <p className="text-sm text-zinc-500">이미 있는 참조 관계입니다.</p>}
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
        aria-label={`${title} 컬럼`}
        className={selectClass}
        value={column}
        disabled={!table}
        onChange={(e) => onColumn(e.target.value)}
      >
        <option value="">컬럼 선택</option>
        {cols.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
