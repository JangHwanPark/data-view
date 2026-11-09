"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Database, LayoutDashboard, Pencil, Trash2 } from "lucide-react";
import { ChartBuilder, type BuilderState } from "./chart-builder";
import { resolveSource, saveCharts, saveDashboard, useSavedCharts } from "./use-saved-charts";
import { useWorkspace } from "@/core/ui/workspace-provider";
import type { SavedChart } from "@/core/opfs";

// 차트 화면(32~34단계). 위는 빌더, 아래는 저장한 차트 목록. 주소의 ?edit=<id>로 저장한 차트를 열어 고친다.
export function ChartsPage() {
  const { sources } = useWorkspace();
  const { charts, dashboard } = useSavedCharts();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const editId = searchParams.get("edit");
  const editing = charts.find((c) => c.id === editId) ?? null;
  const [note, setNote] = useState<string | null>(null);

  const ready = sources.filter((s) => s.status === "ready");
  const editSource = editing ? resolveSource(editing, ready) : null;
  const initial: BuilderState | undefined = editing && editSource ? { sourceId: editSource.meta.id, table: editing.table, spec: editing.spec, live: editing.live } : undefined;
  const onDash = new Set(dashboard.items.map((i) => i.chartId));

  async function save(state: BuilderState, title: string) {
    const source = ready.find((s) => s.meta.id === state.sourceId);
    const now = new Date().toISOString();
    if (editing) {
      await saveCharts(charts.map((c) => (c.id === editing.id ? { ...c, title: c.customTitle ? c.title : title, sourceId: state.sourceId, sourceName: source?.meta.name ?? c.sourceName, table: state.table, spec: state.spec, live: state.live, updatedAt: now } : c)));
      setNote(`「${editing.customTitle ? editing.title : title}」을(를) 고쳐 저장했습니다.`);
      return;
    }
    const chart: SavedChart = { id: crypto.randomUUID().slice(0, 12), title, sourceId: state.sourceId, sourceName: source?.meta.name ?? "", table: state.table, spec: state.spec, live: state.live, createdAt: now };
    await saveCharts([...charts, chart]);
    setNote(`「${title}」을(를) 저장했습니다. 아래 목록에서 대시보드에 넣을 수 있습니다.`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">차트{editing ? ` · 「${editing.title}」 고치기` : ""}</h1>
        <p className="text-zinc-500">
          테이블 하나를 골라 묶을 컬럼과 값을 정하면 바로 그립니다. 예: 등급별 아이템 수, 레벨별 경험치 평균, 판매가 분포. 개발 DB에서 불러온 테이블은 「개발 DB에서 바로」로 지금 DB 값을 그릴 수 있습니다. 「차트 저장」으로 남겨 두면 대시보드에 모아 볼 수 있습니다.
        </p>
        {editing && (
          <Link href={pathname} className="w-fit text-xs text-blue-700 hover:underline dark:text-blue-400">
            새 차트 만들기로 돌아가기
          </Link>
        )}
        {editing && !editSource && <p className="text-xs text-amber-700">이 차트의 테이블({editing.sourceName} / {editing.table})을 지금 불러온 파일에서 찾지 못했습니다.</p>}
      </div>
      <ChartBuilder key={editing?.id ?? "new"} initial={initial} onSave={(s, t) => void save(s, t)} />
      {note && <p className="text-xs text-emerald-700 dark:text-emerald-400">{note}</p>}

      <section className="flex flex-col gap-2" aria-label="저장한 차트">
        <h2 className="font-medium">저장한 차트 {charts.length}개</h2>
        {charts.length === 0 ? (
          <p className="text-sm text-zinc-500">아직 저장한 차트가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 bg-white text-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {charts.map((c) => {
              const found = resolveSource(c, ready);
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <input
                    defaultValue={c.title}
                    aria-label="차트 이름"
                    onBlur={(e) => {
                      const title = e.target.value.trim();
                      if (title && title !== c.title) void saveCharts(charts.map((x) => (x.id === c.id ? { ...x, title, customTitle: true } : x)));
                    }}
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-zinc-300 focus:border-zinc-400 dark:hover:border-zinc-700"
                  />
                  {c.live && (
                    <span className="inline-flex items-center gap-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                      <Database className="size-3" aria-hidden />
                      실시간
                    </span>
                  )}
                  <span className={`text-xs ${found ? "text-zinc-500" : "text-amber-700"}`}>
                    {c.sourceName} / {c.table}
                    {found ? "" : " (지금 없음)"}
                  </span>
                  <Link href={`${pathname}?edit=${c.id}`} className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                    <Pencil className="size-3" aria-hidden />
                    열어 고치기
                  </Link>
                  <button
                    type="button"
                    onClick={() =>
                      void saveDashboard({
                        ...dashboard,
                        items: onDash.has(c.id) ? dashboard.items.filter((i) => i.chartId !== c.id) : [...dashboard.items, { chartId: c.id, wide: false }],
                      })
                    }
                    aria-pressed={onDash.has(c.id)}
                    className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs ${onDash.has(c.id) ? "border-blue-500 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200" : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"}`}
                  >
                    <LayoutDashboard className="size-3" aria-hidden />
                    {onDash.has(c.id) ? "대시보드에 있음" : "대시보드에 넣기"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`「${c.title}」 차트를 지울까요?`)) void saveCharts(charts.filter((x) => x.id !== c.id));
                    }}
                    aria-label={`${c.title} 지우기`}
                    className="rounded p-1 text-zinc-400 hover:text-red-600"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {charts.length > 0 && (
          <Link href="/dashboard" className="w-fit text-sm text-blue-700 hover:underline dark:text-blue-400">
            대시보드 열기
          </Link>
        )}
      </section>
    </div>
  );
}
