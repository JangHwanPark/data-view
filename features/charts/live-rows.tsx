"use client";

import { useState } from "react";
import { Database, Loader2, RefreshCw, X } from "lucide-react";
import { RecordTable } from "@/core/ui/record-table";
import { loadLiveRows } from "./chart-data";
import type { RowFilter } from "@/core/row-filter";
import type { QueryResult } from "@/shared/lib/query-result";

// DB 실시간 조회(32단계). 개발 DB에서 불러온 테이블은 스냅샷(불러온 시각의 값)을 보여준다.
// 이 단추는 지금 DB에 바로 물어 앞 200행을 보여준다(조건 거르기가 있으면 그 조건으로). 스냅샷은 바꾸지 않는다.
const typeOf = (t: string): QueryResult["columns"][number]["type"] =>
  /int|decimal|double|float|numeric|real|bit/i.test(t) ? "number" : /date|time/i.test(t) ? "date" : /char|text|enum|set|json/i.test(t) ? "string" : "unknown";

export function LiveRows({ connectionId, table, filters, loadedAt }: { connectionId: string; table: string; filters: RowFilter[]; loadedAt?: string }) {
  const [state, setState] = useState<{ result: QueryResult; at: string; ms: number } | { error: string } | "loading" | null>(null);
  async function load() {
    setState("loading");
    try {
      const r = await loadLiveRows(connectionId, table, filters);
      setState({ result: { columns: r.columns.map((c) => ({ name: c.name, type: typeOf(c.dataType) })), rows: r.rows, rowCount: r.rows.length, truncated: r.truncated, elapsedMs: r.ms }, at: r.queriedAt, ms: r.ms });
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (state === null) {
    return (
      <button type="button" onClick={() => void load()} className="inline-flex w-fit items-center gap-1 rounded border border-emerald-600 px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/40" title="불러온 스냅샷이 아니라 개발 DB에 지금 묻습니다">
        <Database className="size-3.5" aria-hidden />
        개발 DB에서 지금 값 보기
      </button>
    );
  }
  return (
    <section className="flex flex-col gap-1.5 rounded-md border border-emerald-300 bg-emerald-50/40 p-2 text-xs dark:border-emerald-900 dark:bg-emerald-950/20" aria-label="개발 DB 실시간 값">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 font-medium text-emerald-800 dark:text-emerald-300">
          <Database className="size-3.5" aria-hidden />
          개발 DB 실시간
        </span>
        {state !== "loading" && "result" in state && (
          <span className="text-zinc-600 dark:text-zinc-400">
            {new Date(state.at).toLocaleString()}에 읽음 · 앞 {state.result.rowCount.toLocaleString()}행{state.result.truncated ? "(더 있음)" : ""} · {state.ms}ms
            {filters.length ? " · 조건 거르기 적용" : ""}
            {loadedAt ? ` · 아래 표는 ${new Date(loadedAt).toLocaleString()}에 불러온 값` : ""}
          </span>
        )}
        <span className="ml-auto inline-flex gap-1">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/40">
            <RefreshCw className="size-3" aria-hidden />
            다시 읽기
          </button>
          <button type="button" onClick={() => setState(null)} aria-label="닫기" className="rounded p-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/40">
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
      </div>
      {state === "loading" ? (
        <p className="inline-flex items-center gap-1 text-zinc-500">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          개발 DB에 묻는 중
        </p>
      ) : "error" in state ? (
        <p className="text-red-600">개발 DB에서 읽지 못했습니다. {state.error}</p>
      ) : (
        <div className="max-h-80 overflow-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <RecordTable result={state.result} />
        </div>
      )}
    </section>
  );
}
