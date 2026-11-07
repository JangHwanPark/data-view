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
import { runQuery } from "@/lib/client/duckdb";
import { qualifiedTable } from "@/lib/client/file-import";
import { readDiagramLayout, writeDiagramLayout, type DiagramLayout } from "@/lib/client/opfs";
import {
  newRelationId,
  relationStats,
  sameEndpoints,
  type ColumnRef,
  type RelationStats,
} from "@/lib/client/relations";
import { loadColumns, tableKey } from "@/lib/client/schema";
import type { QueryColumn } from "@/lib/query-result";

const nodeTypes = { table: TableNodeView };

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
      const nextCounts: Record<string, number> = {};
      for (const s of ready) {
        for (const table of s.tables) {
          const r = await runQuery(`SELECT count(*) FROM ${qualifiedTable(s.meta.id, table)}`, 1);
          nextCounts[tableKey(s.meta.id, table)] = Number(r.rows[0]?.[0] ?? 0);
        }
      }
      if (!active) return;
      setColumns(map);
      setCounts(nextCounts);
    })().catch(() => {
      if (active) setColumns(new Map());
    });
    return () => {
      active = false;
    };
    // ready는 schemaVersion에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, schemaVersion]);

  const tables = ready.flatMap((s) => s.tables.map((table) => ({ source: s, table, key: tableKey(s.meta.id, table) })));
  // 끊긴 관계(파일 교체로 열이 없어진 것)는 그리지 않는다.
  const drawable = columns
    ? relations.filter((r) => endpointExists(r.from, columns) && endpointExists(r.to, columns))
    : [];
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

      {pending && <PendingRelation pending={pending} onCancel={() => setPending(null)} onSave={async () => {
        await addRelations([{ id: newRelationId(), ...pending }]);
        setPending(null);
      }} />}

      {tables.length === 0 ? (
        <p className="text-sm text-zinc-500">먼저 상단의 파일 불러오기로 파일을 열어 주세요.</p>
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
