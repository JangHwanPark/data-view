"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Download, Loader2, Undo2 } from "lucide-react";
import { buildColumns, DataTable } from "@/core/ui/data-table";
import { sourceTableLabel, tableOptions } from "@/features/relations";
import { sourceVersion, useWorkspace } from "@/core/ui/workspace-provider";
import { runQuery } from "@/core/duckdb";
import { downloadXlsx, XLSX_MAX_ROWS } from "@/shared/lib/export-xlsx";
import {
  buildJoinQuery,
  joinCandidates,
  joinedTables,
  MISSING,
  parseSpec,
  splitMissing,
  type JoinSpec,
} from "./join";
import { loadColumns, tableKey } from "@/core/schema";
import type { QueryColumn, QueryResult } from "@/shared/lib/query-result";

const PREVIEW_LIMIT = 1000;
const MISSING_LABEL = "못 찾은 ID";

const selectClass =
  "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

interface Loaded {
  key: string;
  result: QueryResult;
  tableColumns: ReturnType<typeof buildColumns>;
  total: number;
  missingCounts: number[];
}

export function JoinBuilder() {
  const { sources, relations, initialized } = useWorkspace();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // 만든 조합은 URL에 둔다. 새로고침해도 남고 주소를 나눌 수 있다.
  const spec = parseSpec(searchParams.get("spec"));
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [columns, setColumns] = useState<Map<string, QueryColumn[]> | null>(null);
  const [loaded, setLoaded] = useState<Loaded | { key: string; error: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const loading = !initialized || sources.some((s) => s.status === "loading");
  const ready = sources.filter((s) => s.status === "ready");
  const schemaVersion = ready
    .map(sourceVersion)
    .join("|");

  useEffect(() => {
    if (loading) return;
    let active = true;
    loadColumns()
      .then((map) => active && setColumns(map))
      .catch(() => active && setColumns(new Map()));
    return () => {
      active = false;
    };
  }, [loading, schemaVersion]);

  const query = spec && columns ? buildJoinQuery(spec, relations, columns, onlyMissing) : null;
  const requestKey = query ? JSON.stringify([query.sql, schemaVersion]) : null;
  const current = loaded && loaded.key === requestKey ? loaded : null;

  useEffect(() => {
    if (!query || !requestKey) return;
    let active = true;
    (async () => {
      const result = await runQuery(query.sql, PREVIEW_LIMIT);
      const count = await runQuery(query.countSql, 1);
      const missing = await runQuery(query.missingSql, 1);
      if (!active) return;
      const shown = withMissingColumn(result);
      setLoaded({
        key: requestKey,
        result: shown,
        tableColumns: buildColumns(shown.columns),
        total: Number(count.rows[0]?.[0] ?? 0),
        missingCounts: (missing.rows[0] ?? []).map(Number),
      });
    })().catch((e) => {
      if (active) setLoaded({ key: requestKey, error: e instanceof Error ? e.message : String(e) });
    });
    return () => {
      active = false;
    };
    // query는 requestKey로 대표된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  function setSpec(next: JoinSpec | null) {
    const q = next ? `?spec=${encodeURIComponent(JSON.stringify(next))}` : "";
    window.history.replaceState(null, "", `${pathname}${q}`);
  }

  async function exportAll() {
    if (!query || !spec) return;
    setExporting(true);
    setExportError(null);
    try {
      const result = withMissingColumn(await runQuery(query.sql, XLSX_MAX_ROWS));
      downloadXlsx(result, `붙여보기_${spec.start.table}.xlsx`, "붙여보기");
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  if (loading || !columns) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold">여러 테이블 붙여 보기</h1>
        <p className="inline-flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          불러오는 중...
        </p>
      </div>
    );
  }

  const options = tableOptions(ready);
  const tables = spec ? joinedTables(spec, relations) : null;
  const labels = query?.labels ?? [];
  const candidates = spec ? joinCandidates(spec, relations) : [];
  const label = (t: { sourceId: string; table: string }) =>
    sourceTableLabel(sources.find((s) => s.meta.id === t.sourceId), t.table);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">여러 테이블 붙여 보기</h1>
        <p className="text-sm text-zinc-500">
          시작할 시트를 고르고, 그 시트가 참조하는 ID를 따라 다른 시트를 차례로 붙이면 여러 파일을 하나의 표로 볼 수 있습니다. 예: 퀘스트 → 보상 그룹 → 보상 → 아이템
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-16 text-zinc-500">시작</span>
          <select
            aria-label="시작 시트"
            className={selectClass}
            value={spec ? tableKey(spec.start.sourceId, spec.start.table) : ""}
            onChange={(e) => {
              const o = options.find((x) => x.key === e.target.value);
              setSpec(o ? { start: { sourceId: o.sourceId, table: o.table }, steps: [] } : null);
            }}
          >
            <option value="">시트 선택</option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {spec && !tables && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            붙일 때 쓴 참조 관계 중 지워진 것이 있습니다. 시작 시트를 다시 골라 주세요.
          </p>
        )}

        {spec && tables && spec.steps.map((step, k) => {
          const rel = relations.find((r) => r.id === step.relationId)!;
          const [here, there] = step.direction === "out" ? [rel.from.column, rel.to.column] : [rel.to.column, rel.from.column];
          const Icon = step.direction === "out" ? ArrowRight : ArrowLeft;
          const last = k === spec.steps.length - 1;
          return (
            <div key={k} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-16 text-zinc-500">{k + 1}단계</span>
              <span className="font-medium">{label(tables[k + 1])}</span>
              <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                ({labels[step.attachTo]}.{here}
                <Icon className="size-3" aria-hidden />
                {labels[k + 1]}.{there})
              </span>
              {last && (
                <button
                  type="button"
                  onClick={() => setSpec({ ...spec, steps: spec.steps.slice(0, -1) })}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Undo2 className="size-3" aria-hidden />
                  빼기
                </button>
              )}
            </div>
          );
        })}

        {spec && tables && (
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-16 text-zinc-500">붙이기</span>
            <select
              aria-label="붙일 시트"
              className={selectClass}
              value=""
              disabled={candidates.length === 0}
              onChange={(e) => {
                const c = candidates[Number(e.target.value)];
                if (c) setSpec({ ...spec, steps: [...spec.steps, { relationId: c.relationId, direction: c.direction, attachTo: c.attachTo }] });
              }}
            >
              <option value="">{candidates.length ? "이어진 시트 중 붙일 시트 선택" : "더 붙일 수 있는 시트가 없습니다"}</option>
              {candidates.map((c, i) => {
                const [here, there] = c.direction === "out" ? [c.relation.from.column, c.relation.to.column] : [c.relation.to.column, c.relation.from.column];
                return (
                  <option key={i} value={i}>
                    {label(c.table)} ({labels[c.attachTo]}.{here} = {c.table.table}.{there})
                    {c.direction === "in" ? ", 한 행이 여러 행으로 늘 수 있음" : ""}
                  </option>
                );
              })}
            </select>
          </label>
        )}
      </div>

      {spec && tables && !current && (
        <p className="inline-flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          합치는 중...
        </p>
      )}
      {current && "error" in current && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <p>표를 합치지 못했습니다.</p>
          <details className="mt-2">
            <summary className="cursor-pointer">자세히</summary>
            <pre className="mt-1 whitespace-pre-wrap text-xs">{current.error}</pre>
          </details>
        </div>
      )}

      {current && "result" in current && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-zinc-500">
              {current.total.toLocaleString()}행, 컬럼{" "}
              {current.result.columns.filter((c) => c.name !== MISSING_LABEL).length}개
              {current.result.truncated && ` (앞의 ${PREVIEW_LIMIT.toLocaleString()}행만 표시)`}
            </span>
            {current.missingCounts.map((n, k) =>
              n > 0 ? (
                <span key={k} className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="size-3.5" aria-hidden />
                  {labels[k + 1]}에서 못 찾은 행 {n.toLocaleString()}
                </span>
              ) : null,
            )}
            {spec && spec.steps.length > 0 && (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
                ID를 못 찾은 행만 보기
              </label>
            )}
            <button
              type="button"
              disabled={exporting || current.total === 0}
              onClick={() => void exportAll()}
              className="ml-auto inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {exporting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
              엑셀로 내보내기
            </button>
          </div>
          {exportError && <p className="text-xs text-red-600">엑셀 파일을 만들지 못했습니다. ({exportError})</p>}
          {current.total > XLSX_MAX_ROWS && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              엑셀 한 시트에 들어가는 {XLSX_MAX_ROWS.toLocaleString()}행까지만 내보냅니다.
            </p>
          )}
          <DataTable
            columns={current.result.columns}
            tableColumns={current.tableColumns}
            rows={current.result.rows}
          />
        </div>
      )}
    </div>
  );
}

// 맨 끝의 누락 표시 열을 맨 앞으로 옮기고 읽기 쉬운 이름과 값으로 바꾼다.
function withMissingColumn(result: QueryResult): QueryResult {
  const last = result.columns.length - 1;
  if (result.columns[last]?.name !== MISSING) return result;
  return {
    ...result,
    columns: [{ name: MISSING_LABEL, type: "string" }, ...result.columns.slice(0, last)],
    rows: result.rows.map((row) => {
      const missing = splitMissing(row[last]);
      return [missing.length ? missing.join(", ") : null, ...row.slice(0, last)];
    }),
  };
}
