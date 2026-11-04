"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2, Network, Save, Table2 } from "lucide-react";
import { RoleBadge, roleColor, ScanProgress } from "@/components/map/map-parts";
import { TableDomainLine } from "@/components/map/table-domain-line";
import { TableDocNotes } from "@/components/table-doc-notes";
import { useResolvedTheme } from "@/components/theme-toggle";
import { useLinkedRelations } from "@/components/use-auto-links";
import { useDomainModel } from "@/components/use-domain-model";
import { useWorkspace } from "@/components/workspace-provider";
import { buildModel, ROLE_LABEL, type DomainModel } from "@/lib/client/domain-model";
import { runQuery } from "@/lib/client/duckdb";
import { qualifiedTable } from "@/lib/client/file-import";
import { HEAD, relationLayout, ROW, type LayoutEdge, type LayoutNode } from "@/lib/client/relation-layout";
import { newRelationId } from "@/lib/client/relations";
import { dataHref, graphHref, MAX_VIA, parseDepth, parseVia } from "@/lib/client/table-view";

// 자동으로 찾은 연결은 id가 auto:로 시작한다(auto-links.ts).
const isAuto = (relationId: string) => relationId.startsWith("auto:");

type RelNodeData = {
  node: LayoutNode;
  model: DomainModel;
  centerDomain: string;
  partial: boolean; // 모든 연결을 찾기 전이라 역할을 믿을 수 없음
};
type RelNodeType = Node<RelNodeData, "rel">;

// 관계도의 상자. 열마다 왼쪽(들어오는 선)과 오른쪽(나가는 선)에 연결점을 둬서 선이 열에서 열로 이어진다(G3).
function RelNodeView({ data }: NodeProps<RelNodeType>) {
  const { node, model, centerDomain, partial } = data;
  const info = node.key ? model.tables.get(node.key) : null;
  const center = node.kind === "center";
  const border = center ? "var(--color-zinc-900)" : info && !partial ? roleColor(info.role) : "var(--color-zinc-300)";
  const header = (
    <>
      <Handle type="target" id="in" position={Position.Left} style={{ top: 20 }} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
      <Handle type="source" id="out" position={Position.Right} style={{ top: 20 }} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
    </>
  );

  if (node.kind === "group" && node.group) {
    const { domain, tables } = node.group;
    return (
      <div className="cursor-pointer rounded-md border border-dashed border-zinc-400 bg-zinc-50 text-xs dark:border-zinc-600 dark:bg-zinc-800/60" style={{ width: node.w, height: node.h }} title="누르면 펼칩니다">
        {header}
        <div className="flex flex-col justify-center px-2.5" style={{ height: HEAD }}>
          <span className="truncate text-[13px] font-semibold">
            {domain} 시스템 {tables.length}개
          </span>
          <span className="text-[11px] text-blue-700 dark:text-blue-400">눌러서 펼치기</span>
        </div>
        <ul className="px-2.5">
          {tables.slice(0, 4).map((k) => {
            const t = model.tables.get(k)!;
            return (
              <li key={k} className="flex items-center gap-1.5" style={{ height: ROW }}>
                <span className="size-2 shrink-0 rounded-sm" style={{ background: partial ? "var(--role-isolated)" : roleColor(t.role) }} aria-hidden />
                <span className="truncate">{t.table}</span>
              </li>
            );
          })}
          {tables.length > 4 && <li className="text-zinc-500" style={{ height: ROW }}>외 {tables.length - 4}개</li>}
        </ul>
      </div>
    );
  }

  return (
    <div
      className={`rounded-md bg-white text-xs dark:bg-zinc-900 ${center ? "" : "cursor-pointer hover:shadow-md"}`}
      style={{ width: node.w, height: node.h, border: `${center ? 2 : 1.5}px solid ${border}` }}
      title={center ? undefined : "누르면 이 테이블을 가운데로 옮깁니다"}
    >
      {header}
      <div className="flex items-start gap-1 border-b border-zinc-200 px-2.5 pt-1.5 dark:border-zinc-700" style={{ height: HEAD }}>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-semibold" title={info?.table}>
            {info?.table}
          </p>
          <p className="truncate text-[10px] text-zinc-500">
            {info && info.domain !== centerDomain ? `${info.domain} 시스템 · ` : center && info ? `${info.domain} 시스템 · ` : ""}
            {info && !partial ? ROLE_LABEL[info.role] : ""}
          </p>
        </div>
        {!center && node.key && (
          <Link
            href={dataHref(node.key)}
            onClick={(e) => e.stopPropagation()}
            className="nodrag shrink-0 rounded px-1 text-[10px] text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
            title="이 테이블의 데이터 보기"
          >
            데이터
          </Link>
        )}
      </div>
      <ul>
        {node.cols.map((c, i) => (
          <li key={c} className="relative flex items-center px-2.5 font-mono text-[11px]" style={{ height: ROW }}>
            <Handle type="target" id={`in:${c}`} position={Position.Left} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-zinc-400" />
            <span className={`truncate ${center && i === 0 ? "font-semibold text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"}`}>{c}</span>
            {center && i === 0 && <span className="ml-1 shrink-0 font-sans text-[10px] text-zinc-400">ID 열</span>}
            <Handle type="source" id={`out:${c}`} position={Position.Right} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-zinc-400" />
          </li>
        ))}
        {node.hidden > 0 && (
          <li className="flex items-center px-2.5 text-[11px] text-zinc-400" style={{ height: ROW }}>
            외 {node.hidden}개 열
          </li>
        )}
      </ul>
    </div>
  );
}

const nodeTypes = { rel: RelNodeView };

// 테이블 관계도(설계 4.13). 사이드바에서 테이블을 누르면 기본으로 열리는 보기다.
export function TableRelationView({ id, table }: { id: string; table: string }) {
  const { sources, initialized } = useWorkspace();
  const source = sources.find((s) => s.meta.id === id);
  const ready = source?.status === "ready" && source.tables.includes(table);
  const center = `${id}/${table}`;
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const depth = parseDepth(searchParams.get("depth"));
  const via = parseVia(searchParams.get("via")).filter((k) => k !== center);
  const theme = useResolvedTheme();

  // 모든 연결로 만든 도메인 모델. 처음 계산하는 동안은 이 테이블만의 자동 연결로 1단계를 먼저 그린다.
  const domain = useDomainModel();
  const local = useLinkedRelations([{ sourceId: id, table }]);
  const partial = !domain.model;
  const model =
    domain.model ??
    (ready && local.ready
      ? buildModel({
          tables: sources
            .filter((s) => s.status === "ready")
            .flatMap((s) => s.tables.map((t) => ({ sourceId: s.meta.id, table: t, sourceName: s.meta.name, sourceKind: s.meta.kind, firstColumn: null }))),
          relations: local.relations,
          overrides: {},
        })
      : null);
  const reasons = domain.model ? domain.reasons : local.reasons;

  const columns = useColumns(id, table, ready);
  const [open, setOpen] = useState<{ key: string; ids: Set<string> }>({ key: center, ids: new Set() });
  const openIds = open.key === center ? open.ids : new Set<string>();
  const [hover, setHover] = useState<{ edge: LayoutEdge; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<{ key: string; edge: LayoutEdge } | null>(null);
  const picked = selected?.key === center ? selected.edge : null;

  if (!initialized || source?.status === "loading") return <Loading text="데이터를 읽는 중입니다." />;
  if (!ready) return <p className="text-zinc-500">이 테이블을 찾을 수 없습니다.</p>;

  const layout = model && columns ? relationLayout({ model, center, columns, depth: partial ? 1 : depth, open: openIds }) : null;

  function moveTo(key: string) {
    // 지나온 길에 이미 있는 테이블로 가면 그 뒤를 잘라 되돌아간 것으로 본다.
    const index = via.indexOf(key);
    const next = index >= 0 ? via.slice(0, index) : [...via, center].slice(-MAX_VIA);
    router.push(graphHref(key, { depth, via: next }));
  }

  function setDepth(d: 1 | 2) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "graph");
    if (d === 2) params.set("depth", "2");
    else params.delete("depth");
    window.history.replaceState(null, "", `${pathname}?${params}`);
  }

  const nodes: RelNodeType[] = (layout?.nodes ?? []).map((n) => ({
    id: n.id,
    type: "rel",
    position: { x: n.x, y: n.y },
    data: { node: n, model: model!, centerDomain: model!.tables.get(center)?.domain ?? "", partial },
    draggable: false,
    connectable: false,
  }));
  const edges: Edge[] = (layout?.edges ?? []).map((e) => {
    const auto = isAuto(e.relationId);
    const active = hover?.edge.id === e.id || picked?.id === e.id;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      style: { strokeDasharray: auto ? "5 4" : undefined, strokeWidth: active ? 2.5 : 1.4, stroke: active ? "var(--color-zinc-900)" : undefined },
      interactionWidth: 14,
      zIndex: active ? 10 : 0,
    };
  });
  const byId = new Map((layout?.edges ?? []).map((e) => [e.id, e]));
  const height = layout ? Math.min(Math.max(layout.height + 90, 320), 760) : 320;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold break-all">{table}</h1>
      </div>
      <TableDomainLine sourceId={id} table={table} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
        <nav aria-label="지나온 테이블" className="flex flex-wrap items-center gap-1">
          <span>지나온 길:</span>
          {via.map((k, i) => (
            <span key={`${k}-${i}`} className="inline-flex items-center gap-1">
              <Link href={graphHref(k, { depth, via: via.slice(0, i) })} className="text-blue-700 hover:underline dark:text-blue-400">
                {k.slice(k.indexOf("/") + 1)}
              </Link>
              <span aria-hidden>›</span>
            </span>
          ))}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{table}</span>
        </nav>
        {partial && (
          <span className="inline-flex items-center gap-1">
            {domain.progress ? <ScanProgressInline progress={domain.progress} /> : null}
          </span>
        )}
        <span className="ml-auto">보기 범위</span>
        <div className="flex gap-0.5">
          {([1, 2] as const).map((d) => (
            <button
              key={d}
              type="button"
              disabled={partial && d === 2}
              onClick={() => setDepth(d)}
              aria-pressed={depth === d}
              className={`rounded px-2 py-0.5 disabled:opacity-40 ${depth === d ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
              title={partial && d === 2 ? "모든 테이블의 연결을 찾은 뒤에 볼 수 있습니다" : undefined}
            >
              {d === 1 ? "바로 이어진 것" : "한 단계 더"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="relative rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" style={{ height }}>
            {!layout ? (
              <div className="p-4">{domain.progress ? <ScanProgress progress={domain.progress} /> : <Loading text="연결을 찾는 중입니다." />}</div>
            ) : (
              <>
                <ColumnHeads empty={layout.empty} />
                {depth === 2 && !partial && layout.far === 0 && (
                  <p className="pointer-events-none absolute inset-x-0 bottom-2 z-10 text-center text-[11px] text-zinc-500">한 단계 더 이어지는 테이블이 없습니다.</p>
                )}
                <ReactFlow
                  key={`${center}/${depth}/${layout.nodes.length}/${partial}`}
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  fitView
                  fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
                  minZoom={0.25}
                  colorMode={theme}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable={false}
                  zoomOnScroll={false}
                  panOnScroll
                  onNodeClick={(_, node) => {
                    const n = (node.data as RelNodeData).node;
                    if (n.kind === "group" && n.group) setOpen({ key: center, ids: new Set([...openIds, n.group.id]) });
                    else if (n.kind !== "center" && n.key) moveTo(n.key);
                  }}
                  onEdgeMouseMove={(ev, edge) => setHover({ edge: byId.get(edge.id)!, x: ev.clientX, y: ev.clientY })}
                  onEdgeMouseLeave={() => setHover(null)}
                  onEdgeClick={(_, edge) => setSelected({ key: center, edge: byId.get(edge.id)! })}
                  onPaneClick={() => setSelected(null)}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background gap={16} size={1} />
                  <Controls showInteractive={false} />
                </ReactFlow>
              </>
            )}
          </div>
          {picked ? (
            <EdgeDetail edge={picked} reason={reasons.get(picked.relationId)} onDone={() => setSelected(null)} />
          ) : (
            <p className="text-xs text-zinc-500">
              상자를 누르면 그 테이블이 가운데로 옵니다. 선에 마우스를 올리면 왜 이어졌다고 보는지 나오고, 선을 누르면 앱이 찾은 연결(점선)을 맞는 연결로 확인할 수 있습니다.
            </p>
          )}
        </div>
        <InfoPanel id={id} table={table} model={model} partial={partial} columns={columns ?? []} />
      </div>

      {hover && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 max-w-sm rounded bg-zinc-900 px-2 py-1.5 text-xs text-white shadow dark:bg-zinc-100 dark:text-zinc-900"
          style={{ left: Math.min(hover.x + 12, (typeof window !== "undefined" ? window.innerWidth : 1200) - 360), top: hover.y + 12 }}
        >
          <p className="font-medium">
            {hover.edge.from.table}.{hover.edge.from.column} → {hover.edge.to.table}.{hover.edge.to.column}
          </p>
          <p className="opacity-80">{isAuto(hover.edge.relationId) ? reasons.get(hover.edge.relationId) ?? "앱이 찾은 연결" : "확인한 연결"}</p>
        </div>
      )}
    </div>
  );
}

function ColumnHeads({ empty }: { empty: { left: boolean; right: boolean } }) {
  return (
    <div className="pointer-events-none absolute inset-x-3 top-2 z-10 flex justify-between text-[11px] text-zinc-400">
      <span>← 이 테이블을 쓰는 테이블{empty.left ? " (없음)" : ""}</span>
      <span>이 테이블이 쓰는 테이블{empty.right ? " (없음)" : ""} →</span>
    </div>
  );
}

function ScanProgressInline({ progress }: { progress: { done: number; total: number } }) {
  return (
    <>
      <Loader2 className="size-3 animate-spin" aria-hidden />
      모든 연결을 찾는 중{progress.total ? ` (${progress.done}/${progress.total})` : ""}. 다 찾으면 역할과 &lsquo;한 단계 더&rsquo;를 볼 수 있습니다.
    </>
  );
}

// 선을 눌렀을 때의 설명 줄(G8). 자동 연결이면 그 자리에서 관계로 저장한다.
function EdgeDetail({ edge, reason, onDone }: { edge: LayoutEdge; reason?: string; onDone: () => void }) {
  const { addRelations } = useWorkspace();
  const auto = isAuto(edge.relationId);
  const [saving, setSaving] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/50">
      <span className="font-mono">
        {edge.from.table}.{edge.from.column} → {edge.to.table}.{edge.to.column}
      </span>
      <span className="text-zinc-500">{auto ? reason ?? "앱이 찾은 연결" : "확인한 연결"}</span>
      {/* 근거에 "없는 ID"가 있으면 그 목록으로 바로 간다. 확인한 연결은 근거 글이 없으므로 늘 링크를 둔다. */}
      {(!auto || reason?.includes("없는 ID")) && (
        <Link href={`/check/missing?link=${encodeURIComponent(edge.relationId)}`} className="text-blue-700 hover:underline dark:text-blue-400">
          없는 ID 보기
        </Link>
      )}
      {auto && (
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void addRelations([{ id: newRelationId(), from: edge.from, to: edge.to }]).finally(onDone);
          }}
          className="ml-auto inline-flex items-center gap-1 rounded bg-zinc-900 px-2 py-0.5 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          <Save className="size-3" aria-hidden />
          맞는 연결로 확인
        </button>
      )}
    </div>
  );
}

// 오른쪽 정보 칸(G9).
function InfoPanel({ id, table, model, partial, columns }: { id: string; table: string; model: DomainModel | null; partial: boolean; columns: string[] }) {
  const info = model?.tables.get(`${id}/${table}`);
  const parent = info?.parent ? model?.tables.get(info.parent) : null;
  const count = (list: { key: string }[]) => new Set(list.map((l) => l.key)).size;
  const outside = (list: { key: string }[]) => new Set(list.map((l) => model!.tables.get(l.key)!.domain).filter((d) => d !== info?.domain)).size;
  return (
    <aside className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/50 xl:self-start">
      {info && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-zinc-500">시스템</dt>
          <dd>
            <Link href={`/map?domain=${encodeURIComponent(info.domain)}`} className="inline-flex items-center gap-1 text-blue-700 hover:underline dark:text-blue-400">
              <Network className="size-3" aria-hidden />
              {info.domain}
            </Link>
          </dd>
          <dt className="text-zinc-500">역할</dt>
          <dd>{partial ? <span className="text-zinc-400">찾는 중</span> : <RoleBadge role={info.role} />}</dd>
          {parent && (
            <>
              <dt className="text-zinc-500">위 테이블</dt>
              <dd>
                <Link href={graphHref(parent.key)} className="text-blue-700 hover:underline dark:text-blue-400">
                  {parent.table}
                </Link>
              </dd>
            </>
          )}
          <dt className="text-zinc-500">열</dt>
          <dd className="tabular-nums">{columns.length}개</dd>
          <dt className="text-zinc-500">쓰는 테이블</dt>
          <dd className="tabular-nums">
            테이블 {count(info.out)}개{outside(info.out) ? ` (다른 시스템 ${outside(info.out)})` : ""}
          </dd>
          <dt className="text-zinc-500">쓰이는 곳</dt>
          <dd className="tabular-nums">
            테이블 {count(info.in)}개{outside(info.in) ? ` (다른 시스템 ${outside(info.in)})` : ""}
          </dd>
        </dl>
      )}
      <Link href={dataHref(`${id}/${table}`)} className="inline-flex w-fit items-center gap-1 rounded border border-zinc-300 bg-white px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800">
        <Table2 className="size-3.5" aria-hidden />
        데이터 보기
      </Link>
      <TableDocNotes sourceId={id} table={table} columns={columns} focus={null} narrow />
    </aside>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <p className="inline-flex items-center gap-2 text-sm text-zinc-500">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {text}
    </p>
  );
}

// 가운데 테이블의 열 목록(순서대로). 열이 바뀌는 일은 파일을 교체할 때뿐이라 테이블마다 한 번 읽는다.
function useColumns(sourceId: string, table: string, ready: boolean) {
  const [loaded, setLoaded] = useState<{ key: string; names: string[] } | null>(null);
  const key = `${sourceId}/${table}`;
  useEffect(() => {
    if (!ready) return;
    let active = true;
    runQuery(`SELECT * FROM ${qualifiedTable(sourceId, table)} LIMIT 0`, 1)
      .then((r) => active && setLoaded({ key, names: r.columns.map((c) => c.name) }))
      .catch(() => active && setLoaded({ key, names: [] }));
    return () => {
      active = false;
    };
  }, [key, ready, sourceId, table]);
  return loaded?.key === key ? loaded.names : null;
}

