"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Database, LayoutDashboard, Loader2, Maximize2, Minimize2, Pencil, RefreshCw, X } from "lucide-react";
import { ChartSvg } from "@/components/charts/chart-svg";
import { resolveSource, saveDashboard, useSavedCharts } from "@/components/charts/use-saved-charts";
import { sourceVersion, useWorkspace } from "@/components/workspace-provider";
import { MEASURE_LABEL } from "@/lib/chart-spec";
import { loadChart, type ChartData } from "@/lib/client/chart-data";
import { isFileSource, type SavedChart } from "@/lib/client/opfs";

// 대시보드(PLAN 34단계). 저장한 차트를 카드로 모아 본다. 순서와 넓이를 바꾸고, 모두 새로고침하거나 정한 간격마다 저절로 새로고침한다.
// 「개발 DB에서 바로」로 저장한 차트는 새로고침할 때마다 DB에 다시 묻는다.

const REFRESH = [0, 1, 5, 15];

export function DashboardView() {
  const { charts, dashboard, loaded } = useSavedCharts();
  const { sources, initialized } = useWorkspace();
  const [tick, setTick] = useState(0);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const ready = sources.filter((s) => s.status === "ready");
  const busy = !initialized || sources.some((s) => s.status === "loading");

  useEffect(() => {
    if (!dashboard.refreshMinutes) return;
    const timer = setInterval(() => {
      setTick((t) => t + 1);
      setRefreshedAt(new Date());
    }, dashboard.refreshMinutes * 60_000);
    return () => clearInterval(timer);
  }, [dashboard.refreshMinutes]);

  const items = dashboard.items.map((i) => ({ ...i, chart: charts.find((c) => c.id === i.chartId) })).filter((i): i is typeof i & { chart: SavedChart } => !!i.chart);
  const move = (index: number, delta: number) => {
    const next = [...dashboard.items];
    const [it] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, it);
    void saveDashboard({ ...dashboard, items: next });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="inline-flex items-center gap-2 text-lg font-semibold">
            <LayoutDashboard className="size-5" aria-hidden />
            대시보드
          </h1>
          <p className="text-zinc-500">저장한 차트를 모아 봅니다. 차트 화면에서 「차트 저장」 뒤 「대시보드에 넣기」로 더합니다.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => {
              setTick((t) => t + 1);
              setRefreshedAt(new Date());
            }}
            className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            모두 새로고침
          </button>
          <label className="inline-flex items-center gap-1 text-xs text-zinc-500">
            저절로 새로고침
            <select
              value={dashboard.refreshMinutes}
              onChange={(e) => void saveDashboard({ ...dashboard, refreshMinutes: Number(e.target.value) })}
              aria-label="저절로 새로고침"
              className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              {REFRESH.map((m) => (
                <option key={m} value={m}>
                  {m ? `${m}분마다` : "끄기"}
                </option>
              ))}
            </select>
          </label>
          {refreshedAt && <span className="text-xs text-zinc-500">{refreshedAt.toLocaleTimeString()}에 새로고침</span>}
        </div>
      </div>

      {!loaded || busy ? (
        <p className="inline-flex items-center gap-1 text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          불러오는 중
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
          대시보드가 비어 있습니다. <Link href="/charts" className="text-blue-700 hover:underline dark:text-blue-400">차트 화면</Link>에서 차트를 저장하고 「대시보드에 넣기」를 눌러 주세요.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {items.map((item, i) => (
            <article key={item.chartId} className={`flex min-w-0 flex-col gap-2 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900 ${item.wide ? "lg:col-span-2" : ""}`} aria-label={item.chart.title}>
              <div className="flex flex-wrap items-start gap-1">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-medium" style={{ color: "var(--viz-text-primary)" }} title={item.chart.title}>
                    {item.chart.title}
                  </h2>
                  <p className="text-xs text-zinc-500">
                    {item.chart.sourceName} / {item.chart.table}
                  </p>
                </div>
                <span className="inline-flex gap-0.5">
                  <IconBtn label="앞으로" onClick={() => move(i, -1)} disabled={i === 0}>
                    <ArrowUp className="size-3.5" aria-hidden />
                  </IconBtn>
                  <IconBtn label="뒤로" onClick={() => move(i, 1)} disabled={i === items.length - 1}>
                    <ArrowDown className="size-3.5" aria-hidden />
                  </IconBtn>
                  <IconBtn label={item.wide ? "좁게" : "넓게"} onClick={() => void saveDashboard({ ...dashboard, items: dashboard.items.map((x) => (x.chartId === item.chartId ? { ...x, wide: !x.wide } : x)) })}>
                    {item.wide ? <Minimize2 className="size-3.5" aria-hidden /> : <Maximize2 className="size-3.5" aria-hidden />}
                  </IconBtn>
                  <Link href={`/charts?edit=${item.chartId}`} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="차트 화면에서 고치기" aria-label="차트 화면에서 고치기">
                    <Pencil className="size-3.5" aria-hidden />
                  </Link>
                  <IconBtn label="대시보드에서 빼기" onClick={() => void saveDashboard({ ...dashboard, items: dashboard.items.filter((x) => x.chartId !== item.chartId) })}>
                    <X className="size-3.5" aria-hidden />
                  </IconBtn>
                </span>
              </div>
              <ChartCard chart={item.chart} tick={tick} ready={ready} />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800">
      {children}
    </button>
  );
}

function ChartCard({ chart, tick, ready }: { chart: SavedChart; tick: number; ready: ReturnType<typeof useWorkspace>["sources"] }) {
  const source = resolveSource(chart, ready);
  const liveConnection = chart.live && source && !isFileSource(source.meta) ? source.meta.connectionId : null;
  const key = source ? JSON.stringify([sourceVersion(source), source.meta.id, chart.table, chart.spec, liveConnection, tick]) : null;
  const [data, setData] = useState<{ key: string; result: ChartData | { error: string } } | null>(null);
  useEffect(() => {
    if (!key || !source) return;
    let active = true;
    loadChart(source.meta.id, chart.table, chart.spec, liveConnection)
      .then((result) => active && setData({ key, result }))
      .catch((e) => active && setData({ key, result: { error: e instanceof Error ? e.message : String(e) } }));
    return () => {
      active = false;
    };
    // 차트, 소스, 새로고침 횟수는 key에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!source) return <p className="text-sm text-amber-700">이 차트의 테이블({chart.sourceName} / {chart.table})을 지금 불러온 파일에서 찾지 못했습니다.</p>;
  const result = data?.key === key ? data.result : data?.result ?? null; // 새로고침 중에는 앞 결과를 그대로 보여준다
  if (!result)
    return (
      <p className="inline-flex items-center gap-1 py-6 text-sm text-zinc-500">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {liveConnection ? "개발 DB에 묻는 중" : "세는 중"}
      </p>
    );
  if ("error" in result) return <p className="text-sm text-red-600">차트 값을 구하지 못했습니다. {result.error}</p>;
  const valueLabel = chart.spec.kind === "histogram" ? "행 수" : chart.spec.measure === "count" ? "행 수" : `${chart.spec.y} ${MEASURE_LABEL[chart.spec.measure]}`;
  return (
    <>
      <p className="text-xs text-zinc-500">
        {result.live ? (
          <span className="mr-1 inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400">
            <Database className="size-3" aria-hidden />
            개발 DB 실시간 {new Date(result.queriedAt).toLocaleTimeString()}
          </span>
        ) : (
          `불러온 데이터 · ${new Date(result.queriedAt).toLocaleTimeString()} · `
        )}
        대상 {result.rows.toLocaleString()}행{data?.key !== key ? " · 새로고침 중" : ""}
      </p>
      <ChartSvg kind={chart.spec.kind} points={result.points} valueLabel={valueLabel} xLabel={chart.spec.x} />
    </>
  );
}
