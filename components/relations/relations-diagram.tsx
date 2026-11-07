"use client";

import { useEffect, useState } from "react";
import {
  applyNodeChanges,
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowRight, Loader2, Plus } from "lucide-react";
import { TableNodeView, type TableNodeType } from "@/components/relations/table-node";
import { ColumnLabel, endpointExists, sourceTableLabel, StatsText } from "@/components/relations/relation-parts";
import { RelationsTabs } from "@/components/relations/relations-tabs";
import { useResolvedTheme } from "@/components/theme-toggle";
import { sourceVersion, useWorkspace } from "@/components/workspace-provider";
import { layeredLayout } from "@/lib/client/diagram-layout";
import { readDiagramLayout, writeDiagramLayout, type DiagramLayout } from "@/lib/client/opfs";
import {
  newRelationId,
  relationStats,
  sameEndpoints,
  type ColumnRef,
  type RelationStats,
} from "@/lib/client/relations";
import { loadColumns, loadRowCounts, tableKey } from "@/lib/client/schema";
import type { QueryColumn } from "@/lib/query-result";

const nodeTypes = { table: TableNodeView };
// 시트가 이보다 많으면 초점 보기를 기본으로 하고 전체 보기는 파일별로 접어 둔다(설계 4.10).
const MANY_TABLES = 30;

// 위치, 크기, 선택 상태처럼 React Flow가 바꾸는 값만 따로 들고, 나머지는 렌더 때마다 만든다.
type NodeOverride = Pick<TableNodeType, "position" | "measured" | "selected" | "dragging">;

export function RelationsDiagram() {
  const { sources, relations, initialized, addRelations } = useWorkspace();
  const theme = useResolvedTheme();
  const [columns, setColumns] = useState<Map<string, QueryColumn[]> | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<DiagramLayout | null>(null);
  const [overrides, setOverrides] = useState<Record<string, NodeOverride>>({});
  const [showAll, setShowAll] = useState(false);
  const [pending, setPending] = useState<{ from: ColumnRef; to: ColumnRef } | null>(null);
  // 시트가 많을 때의 보기(31단계, 설계 4.10). 초점 보기는 고른 테이블에서 1~2단계 떨어진 테이블만, 전체 보기는 고른 파일만 그린다.
  const [mode, setMode] = useState<"focus" | "all" | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [depth, setDepth] = useState<1 | 2>(1);
  const [shownSources, setShownSources] = useState<Set<string> | null>(null);

  const loading = !initialized || sources.some((s) => s.status === "loading");
  const ready = sources.filter((s) => s.status === "ready");
  const schemaVersion = ready
    .map(sourceVersion)
    .join("|");

  useEffect(() => {
    readDiagramLayout()
      .then(setSaved)
      .catch(() => setSaved({}));
  }, []);

  useEffect(() => {
    if (loading) return;
    let active = true;
    (async () => {
      const map = await loadColumns();
      // 시트가 많을 때(31단계) 테이블마다 count를 돌리지 않고 DuckDB 메타데이터로 한 번에 읽는다.
      const nextCounts: Record<string, number> = Object.fromEntries(await loadRowCounts());
      if (!active) return;
      setColumns(map);
      setCounts(nextCounts);
    })().catch(() => {
      if (active) setColumns(new Map());
    });
    return () => {
      active = false;
    };
  }, [loading, schemaVersion]);

  const allTables = ready.flatMap((s) => s.tables.map((table) => ({ source: s, table, key: tableKey(s.meta.id, table) })));
  // 끊긴 관계(파일 교체로 열이 없어진 것)는 그리지 않는다.
  const allDrawable = columns
    ? relations.filter((r) => endpointExists(r.from, columns) && endpointExists(r.to, columns))
    : [];
  const many = allTables.length > MANY_TABLES;
  const view = mode ?? (many ? "focus" : "all");
  // 초점: 고르지 않았으면 참조 관계가 가장 많은 테이블.
  const degree = new Map<string, number>();
  for (const r of allDrawable) for (const k of [tableKey(r.from.sourceId, r.from.table), tableKey(r.to.sourceId, r.to.table)]) degree.set(k, (degree.get(k) ?? 0) + 1);
  const center = focusKey && allTables.some((t) => t.key === focusKey) ? focusKey : ([...degree].sort((a, b) => b[1] - a[1])[0]?.[0] ?? allTables[0]?.key ?? null);
  // 한 단계씩 넓힌다. 이번 단계에 새로 들어온 테이블에서만 다음 단계로 간다.
  const near = new Set<string>(center ? [center] : []);
  let frontier = new Set(near);
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>();
    for (const r of allDrawable) {
      const a = tableKey(r.from.sourceId, r.from.table);
      const b = tableKey(r.to.sourceId, r.to.table);
      if (frontier.has(a) && !near.has(b)) next.add(b);
      if (frontier.has(b) && !near.has(a)) next.add(a);
    }
    next.forEach((k) => near.add(k));
    frontier = next;
  }
  const sourcesShown = shownSources ?? new Set(many ? [] : ready.map((s) => s.meta.id));
  const tables = view === "focus" ? allTables.filter((t) => near.has(t.key)) : allTables.filter((t) => sourcesShown.has(t.source.meta.id));
  const keep = new Set(tables.map((t) => t.key));
  const drawable = allDrawable.filter((r) => keep.has(tableKey(r.from.sourceId, r.from.table)) && keep.has(tableKey(r.to.sourceId, r.to.table)));
  const linkedNames = new Set(
    drawable.flatMap((r) => [`${tableKey(r.from.sourceId, r.from.table)}|${r.from.column}`, `${tableKey(r.to.sourceId, r.to.table)}|${r.to.column}`]),
  );
  const initial = layeredLayout(
    tables.map((t) => t.key),
    drawable,
    Object.fromEntries(tables.map((t) => [t.key, columns?.get(t.key)?.length ?? 0])),
  );

  const nodes: TableNodeType[] = columns && saved
    ? tables.map(({ source, table, key }) => {
        const all = (columns.get(key) ?? []).map((c) => ({ ...c, linked: linkedNames.has(`${key}|${c.name}`) }));
        const visible = showAll ? all : all.filter((c) => c.linked);
        const o = overrides[key];
        return {
          id: key,
          type: "table",
          position: o?.position ?? saved[key] ?? initial[key],
          measured: o?.measured,
          selected: o?.selected,
          dragging: o?.dragging,
          data: {
            label: sourceTableLabel(source, table),
            href: `/sources/${source.meta.id}/tables/${encodeURIComponent(table)}`,
            rowCount: counts[key] ?? null,
            columns: visible,
            hiddenCount: all.length - visible.length,
          },
        };
      })
    : [];

  const edges: Edge[] = drawable.map((r) => ({
    id: r.id,
    source: tableKey(r.from.sourceId, r.from.table),
    sourceHandle: `s:${r.from.column}`,
    target: tableKey(r.to.sourceId, r.to.table),
    targetHandle: `t:${r.to.column}`,
    markerEnd: { type: MarkerType.ArrowClosed },
  }));

  function onNodesChange(changes: NodeChange<TableNodeType>[]) {
    const next = applyNodeChanges(changes, nodes);
    setOverrides(
      Object.fromEntries(
        next.map((n) => [n.id, { position: n.position, measured: n.measured, selected: n.selected, dragging: n.dragging }]),
      ),
    );
  }

  // 끌어 놓은 노드는 React Flow가 넘겨주는 최종 위치를 쓰고, 나머지는 지금 보이는 위치를 그대로 저장한다.
  function savePositions(_: unknown, __: unknown, dragged: TableNodeType[]) {
    const layout: DiagramLayout = { ...saved };
    for (const n of nodes) layout[n.id] = n.position;
    for (const n of dragged) layout[n.id] = n.position;
    setSaved(layout);
    void writeDiagramLayout(layout);
  }

  function onConnect(conn: Connection) {
    const from = toColumnRef(conn.source, conn.sourceHandle);
    const to = toColumnRef(conn.target, conn.targetHandle);
    if (!from || !to) return;
    if (from.sourceId === to.sourceId && from.table === to.table && from.column === to.column) return;
    setPending({ from, to });
  }

  function resetLayout() {
    setOverrides({});
    setSaved({});
    void writeDiagramLayout({});
  }

  if (loading || !columns || !saved) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <p className="inline-flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          불러오는 중...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Header />
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="inline-flex overflow-hidden rounded border border-zinc-300 text-xs dark:border-zinc-700" role="group" aria-label="보기">
          {(
            [
              ["focus", "초점 보기"],
              ["all", "전체 보기"],
            ] as const
          ).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setMode(v)} className={`px-2 py-1 ${view === v ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
              {label}
            </button>
          ))}
        </span>
        {view === "focus" && (
          <>
            <select value={center ?? ""} onChange={(e) => setFocusKey(e.target.value)} aria-label="가운데 테이블" className="rounded border border-zinc-300 bg-white px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950">
              {[...allTables].sort((a, b) => a.table.localeCompare(b.table)).map((t) => (
                <option key={t.key} value={t.key}>
                  {sourceTableLabel(t.source, t.table)}
                  {degree.get(t.key) ? ` (${degree.get(t.key)})` : ""}
                </option>
              ))}
            </select>
            <span className="inline-flex overflow-hidden rounded border border-zinc-300 text-xs dark:border-zinc-700" role="group" aria-label="단계">
              {([1, 2] as const).map((d) => (
                <button key={d} type="button" aria-pressed={depth === d} onClick={() => setDepth(d)} className={`px-2 py-1 ${depth === d ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
                  {d}단계
                </button>
              ))}
            </span>
          </>
        )}
        <span className="text-xs text-zinc-500">
          시트 {allTables.length.toLocaleString()}개 중 {tables.length.toLocaleString()}개를 그립니다
        </span>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          모든 컬럼 보기
        </label>
        <button
          type="button"
          onClick={resetLayout}
          className="rounded-md px-2 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          자동 배치로 되돌리기
        </button>
        <p className="text-xs text-zinc-500">
          새로 이으려면 모든 컬럼 보기를 켜고, ID를 참조하는 컬럼의 오른쪽 점에서 그 ID가 있는 컬럼의 왼쪽 점으로 끌어다 놓습니다.
        </p>
      </div>

      {view === "all" && many && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="그릴 파일">
          <span className="text-zinc-500">시트가 {MANY_TABLES}개보다 많아 파일별로 접어 두었습니다. 그릴 파일:</span>
          {ready.map((s) => {
            const on = sourcesShown.has(s.meta.id);
            return (
              <button
                key={s.meta.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = new Set(sourcesShown);
                  if (on) next.delete(s.meta.id);
                  else next.add(s.meta.id);
                  setShownSources(next);
                }}
                className={`rounded border px-1.5 py-0.5 ${on ? "border-blue-500 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200" : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"}`}
              >
                {s.meta.name} {s.tables.length}
              </button>
            );
          })}
        </div>
      )}

      {pending && <PendingRelation pending={pending} onCancel={() => setPending(null)} onSave={async () => {
        await addRelations([{ id: newRelationId(), ...pending }]);
        setPending(null);
      }} />}

      {allTables.length === 0 ? (
        <p className="text-sm text-zinc-500">먼저 상단의 파일 불러오기로 파일을 열어 주세요.</p>
      ) : tables.length === 0 ? (
        <p className="text-sm text-zinc-500">{view === "all" ? "위에서 그릴 파일을 골라 주세요." : "확인한 참조 관계가 있는 테이블이 없습니다."}</p>
      ) : (
        <div className="h-[72vh] rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={savePositions}
            onConnect={onConnect}
            deleteKeyCode={null}
            colorMode={theme}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold">참조 관계 목록</h1>
      <RelationsTabs active="diagram" />
    </div>
  );
}

// 노드 id는 tableKey(소스 id/테이블), 연결점 id는 s:열 또는 t:열이다.
function toColumnRef(nodeId: string | null, handleId: string | null | undefined): ColumnRef | null {
  if (!nodeId || !handleId) return null;
  const slash = nodeId.indexOf("/");
  return {
    sourceId: nodeId.slice(0, slash),
    table: nodeId.slice(slash + 1),
    column: handleId.slice(2),
  };
}

interface PendingProps {
  pending: { from: ColumnRef; to: ColumnRef };
  onCancel: () => void;
  onSave: () => Promise<void>;
}

// 끌어 이은 관계를 바로 저장하지 않고 일치율을 보여준 뒤 확인받는다.
function PendingRelation({ pending, onCancel, onSave }: PendingProps) {
  const { sources, relations } = useWorkspace();
  const key = JSON.stringify(pending);
  const [result, setResult] = useState<{ key: string; value: RelationStats | "error" } | null>(null);
  const stats = result?.key === key ? result.value : null;
  const duplicate = relations.some((r) => sameEndpoints(r, pending));

  useEffect(() => {
    let active = true;
    relationStats(pending.from, pending.to)
      .then((value) => active && setResult({ key, value }))
      .catch(() => active && setResult({ key, value: "error" }));
    return () => {
      active = false;
    };
    // pending은 key에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm dark:border-blue-900 dark:bg-blue-950/40">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <ColumnLabel refValue={pending.from} sources={sources} />
          <ArrowRight className="size-4 shrink-0 text-zinc-400" aria-hidden />
          <ColumnLabel refValue={pending.to} sources={sources} />
        </div>
        {duplicate ? (
          <p className="text-xs text-zinc-500">이미 있는 참조 관계입니다.</p>
        ) : stats === "error" ? (
          <p className="text-xs text-red-600">값이 얼마나 맞는지 세지 못했습니다.</p>
        ) : stats ? (
          <StatsText stats={stats} />
        ) : (
          <p className="inline-flex items-center gap-1 text-xs text-zinc-500">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            값이 얼마나 맞는지 세는 중
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md px-3 py-1.5 hover:bg-white/60 dark:hover:bg-zinc-800"
      >
        취소
      </button>
      <button
        type="button"
        disabled={duplicate || !stats}
        onClick={() => void onSave()}
        className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        <Plus className="size-4" aria-hidden />
        참조 관계 저장
      </button>
    </div>
  );
}
