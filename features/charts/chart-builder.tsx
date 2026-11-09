"use client";

import { useEffect, useState } from "react";
import { BarChart3, Database, Loader2, Table2 } from "lucide-react";
import { ChartSvg } from "./chart-svg";
import { RowFilterBar } from "@/features/table";
import { useKoreanNames } from "@/core/ui/use-korean-names";
import { sourceVersion, useWorkspace } from "@/core/ui/workspace-provider";
import { KIND_LABEL, MAX_LIMIT, MEASURE_LABEL, type ChartKind, type ChartSpec, type Measure } from "@/shared/lib/chart-spec";
import { loadChart, type ChartData } from "./chart-data";
import { isFileSource } from "@/core/opfs";
import { loadColumns } from "@/core/schema";
import type { QueryColumn } from "@/shared/lib/query-result";

// 차트 빌더(PLAN 32단계). 테이블 하나를 골라 「등급별 아이템 수」, 「레벨별 경험치 평균」, 「판매가 분포」 같은 그림을 만든다.
// DB에서 불러온 테이블은 「개발 DB에서 바로」를 고르면 스냅샷이 아니라 DB에 지금 묻는다(실시간 조회).

export interface ChartTarget {
  sourceId: string;
  table: string;
}

export interface BuilderState extends ChartTarget {
  spec: ChartSpec;
  live: boolean;
}

export function defaultSpec(columns: QueryColumn[]): ChartSpec {
  const x = columns.find((c, i) => i > 0 && c.type !== "number") ?? columns[1] ?? columns[0];
  return { kind: "bar", x: x?.name ?? "", measure: "count", filters: [], limit: 20 };
}

export function chartTitle(korean: string | undefined, table: string, spec: ChartSpec) {
  const name = korean ? `${korean}(${table})` : table;
  if (spec.kind === "histogram") return `${name} · ${spec.x} 분포`;
  const measure = spec.measure === "count" ? "행 수" : `${spec.y} ${MEASURE_LABEL[spec.measure]}`;
  return `${name} · ${spec.x}별 ${measure}`;
}

export function ChartBuilder({ initial, onSave }: { initial?: BuilderState; onSave?: (state: BuilderState, title: string) => void }) {
  const { sources } = useWorkspace();
  const names = useKoreanNames();
  const ready = sources.filter((s) => s.status === "ready");
  const version = ready.map(sourceVersion).join("|");
  const [columns, setColumns] = useState<Map<string, QueryColumn[]> | null>(null);
  // 고치는 차트(initial)는 소스를 다 읽은 뒤에 정해질 수 있어서, 사용자가 바꾸기 전까지는 initial을 그대로 쓴다.
  const [state, setState] = useState<BuilderState | null>(null);
  const [data, setData] = useState<{ key: string; result: ChartData | { error: string } } | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    if (!version) return;
    let active = true;
    loadColumns().then((m) => active && setColumns(m));
    return () => {
      active = false;
    };
  }, [version]);

  // 처음에는 첫 테이블로 시작한다.
  const first = ready[0] && ready[0].tables[0] ? { sourceId: ready[0].meta.id, table: ready[0].tables[0] } : null;
  const current: BuilderState | null = state ?? initial ?? (first && columns ? { ...first, spec: defaultSpec(columns.get(`${first.sourceId}/${first.table}`) ?? []), live: false } : null);
  const source = current ? ready.find((s) => s.meta.id === current.sourceId) : undefined;
  const cols = current ? (columns?.get(`${current.sourceId}/${current.table}`) ?? []) : [];
  const numeric = cols.filter((c) => c.type === "number");
  const liveConnection = current?.live && source && !isFileSource(source.meta) ? source.meta.connectionId : null;
  const key = current && cols.length ? JSON.stringify([version, current.sourceId, current.table, current.spec, liveConnection]) : null;

  useEffect(() => {
    if (!key || !current) return;
    let active = true;
    const timer = setTimeout(() => {
      loadChart(current.sourceId, current.table, current.spec, liveConnection)
        .then((result) => active && setData({ key, result }))
        .catch((e) => active && setData({ key, result: { error: e instanceof Error ? e.message : String(e) } }));
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // current와 liveConnection은 key에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!ready.length) return <p className="text-zinc-500">불러온 테이블이 없습니다. 오른쪽 위의 파일 불러오기에서 테이블을 불러와 주세요.</p>;
  if (!current || !columns) {
    return (
      <p className="inline-flex items-center gap-1 text-zinc-500">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        컬럼을 읽는 중
      </p>
    );
  }

  const setSpec = (patch: Partial<ChartSpec>) => setState({ ...current, spec: { ...current.spec, ...patch } });
  const result = data?.key === key ? data.result : null;
  const korean = names.get(`${current.sourceId}/${current.table}`)?.text;
  const title = chartTitle(korean, current.table, current.spec);
  const valueLabel = current.spec.measure === "count" ? "행 수" : `${current.spec.y} ${MEASURE_LABEL[current.spec.measure]}`;
  const select = "rounded border border-zinc-300 bg-white px-1.5 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-zinc-500">테이블</span>
          <select
            className={select}
            value={`${current.sourceId}/${current.table}`}
            onChange={(e) => {
              const [sourceId, ...rest] = e.target.value.split("/");
              const table = rest.join("/");
              setState({ sourceId, table, spec: defaultSpec(columns.get(`${sourceId}/${table}`) ?? []), live: false });
            }}
            aria-label="테이블"
          >
            {ready.map((s) => (
              <optgroup key={s.meta.id} label={s.meta.name}>
                {s.tables.map((t) => (
                  <option key={t} value={`${s.meta.id}/${t}`}>
                    {names.get(`${s.meta.id}/${t}`) ? `${names.get(`${s.meta.id}/${t}`)!.text} (${t})` : t}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-zinc-500">그림</span>
          <select className={select} value={current.spec.kind} onChange={(e) => setSpec({ kind: e.target.value as ChartKind, ...(e.target.value === "histogram" ? { measure: "count" as Measure, x: numeric[0]?.name ?? current.spec.x } : {}) })} aria-label="그림 종류">
            {(Object.keys(KIND_LABEL) as ChartKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-zinc-500">{current.spec.kind === "histogram" ? "나눌 숫자 컬럼" : current.spec.kind === "line" ? "가로축 컬럼" : "묶을 컬럼"}</span>
          <select className={select} value={current.spec.x} onChange={(e) => setSpec({ x: e.target.value })} aria-label="묶을 컬럼">
            {(current.spec.kind === "histogram" ? numeric : cols).map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {current.spec.kind !== "histogram" && (
          <>
            <label className="flex flex-col gap-0.5">
              <span className="text-xs text-zinc-500">값</span>
              <select className={select} value={current.spec.measure} onChange={(e) => setSpec({ measure: e.target.value as Measure, y: e.target.value === "count" ? undefined : (current.spec.y ?? numeric[0]?.name) })} aria-label="값">
                {(Object.keys(MEASURE_LABEL) as Measure[]).filter((m) => m === "count" || numeric.length).map((m) => (
                  <option key={m} value={m}>
                    {MEASURE_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            {current.spec.measure !== "count" && (
              <label className="flex flex-col gap-0.5">
                <span className="text-xs text-zinc-500">숫자 컬럼</span>
                <select className={select} value={current.spec.y ?? ""} onChange={(e) => setSpec({ y: e.target.value })} aria-label="숫자 컬럼">
                  {numeric.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        {current.spec.kind === "bar" && (
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-zinc-500">막대 수</span>
            <input type="number" min={1} max={MAX_LIMIT} value={current.spec.limit} onChange={(e) => setSpec({ limit: Number(e.target.value) || 20 })} className={`${select} w-20`} aria-label="막대 수" />
          </label>
        )}
        {source && !isFileSource(source.meta) && (
          <div className="flex flex-col gap-0.5" role="group" aria-label="데이터 위치">
            <span className="text-xs text-zinc-500">데이터 위치</span>
            <span className="inline-flex overflow-hidden rounded border border-zinc-300 text-xs dark:border-zinc-700">
              {(
                [
                  [false, `불러온 데이터${source.meta.loadedAt ? ` (${new Date(source.meta.loadedAt).toLocaleString()})` : ""}`],
                  [true, "개발 DB에서 바로"],
                ] as const
              ).map(([live, label]) => (
                <button key={String(live)} type="button" aria-pressed={current.live === live} onClick={() => setState({ ...current, live })} className={`px-2 py-1.5 ${current.live === live ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
                  {label}
                </button>
              ))}
            </span>
          </div>
        )}
      </div>
      <RowFilterBar columns={cols.map((c) => c.name)} filters={current.spec.filters} onChange={(filters) => setSpec({ filters })} />

      <section className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900" aria-label="차트">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-medium" style={{ color: "var(--viz-text-primary)" }}>
            {title}
          </h2>
          {result && !("error" in result) && (
            <span className="text-xs text-zinc-500">
              {result.live ? (
                <span className="mr-1 inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400">
                  <Database className="size-3" aria-hidden />
                  개발 DB 실시간 {new Date(result.queriedAt).toLocaleTimeString()}
                </span>
              ) : (
                "불러온 데이터 · "
              )}
              대상 {result.rows.toLocaleString()}행 · {result.ms}ms
            </span>
          )}
          <span className="ml-auto inline-flex gap-1">
            <button type="button" onClick={() => setShowTable(!showTable)} aria-pressed={showTable} className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
              {showTable ? <BarChart3 className="size-3.5" aria-hidden /> : <Table2 className="size-3.5" aria-hidden />}
              {showTable ? "그림으로 보기" : "표로 보기"}
            </button>
            {onSave && (
              <button type="button" onClick={() => onSave(current, title)} className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
                차트 저장
              </button>
            )}
          </span>
        </div>
        {!result ? (
          <p className="inline-flex items-center gap-1 py-8 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {liveConnection ? "개발 DB에 묻는 중" : "세는 중"}
          </p>
        ) : "error" in result ? (
          <p className="text-sm text-red-600">차트 값을 구하지 못했습니다. {result.error}</p>
        ) : showTable ? (
          <ChartTable points={result.points} xLabel={current.spec.x} valueLabel={current.spec.kind === "histogram" ? "행 수" : valueLabel} />
        ) : (
          <ChartSvg kind={current.spec.kind} points={result.points} valueLabel={valueLabel} xLabel={current.spec.x} />
        )}
        {result && !("error" in result) && result.other && result.other.count > 0 && (
          <p className="text-xs text-zinc-500">
            그 밖 {result.other.count.toLocaleString()}개 묶음{Number.isFinite(result.other.value) ? `(${valueLabel} 합 ${result.other.value.toLocaleString()})` : ""}은 그리지 않았습니다. 막대 수를 늘리거나 조건으로 좁혀 보세요.
          </p>
        )}
      </section>
    </div>
  );
}

export function ChartTable({ points, xLabel, valueLabel }: { points: { label: string; value: number }[]; xLabel: string; valueLabel: string }) {
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800">
          <tr>
            <th className="px-2 py-1 font-medium">{xLabel}</th>
            <th className="px-2 py-1 text-right font-medium">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="px-2 py-1">{p.label}</td>
              <td className="px-2 py-1 text-right tabular-nums">{Number.isInteger(p.value) ? p.value.toLocaleString() : p.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
