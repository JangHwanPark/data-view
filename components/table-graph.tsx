"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Background, MarkerType, Position, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { sourceTableLabel } from "@/components/relations/relation-parts";
import { useResolvedTheme } from "@/components/theme-toggle";
import { roleColor } from "@/components/map/map-parts";
import { useLinkedRelations } from "@/components/use-auto-links";
import { useDomainModel } from "@/components/use-domain-model";
import { ROLE_LABEL } from "@/lib/client/domain-model";
import { useWorkspace } from "@/components/workspace-provider";
import { isAutoRelation, isDesignRelation } from "@/lib/client/auto-links";
import { fromLabel, isExtended, type Relation } from "@/lib/client/relations";

// 가운데와 양옆 사이를 넓게 둬서 연결선 이름표가 상자에 가리지 않게 한다.
const COLUMN_GAP = 440;
const ROW_GAP = 84;

type Side = -1 | 0 | 1; // -1: 이 테이블을 가리키는 쪽(왼쪽), 1: 이 테이블이 가리키는 쪽(오른쪽)

interface Placed {
  key: string;
  sourceId: string;
  table: string;
  level: number; // 가운데에서 몇 단계 떨어졌는지. 왼쪽은 음수
}

// 지금 테이블을 가운데에 두고, 가리키는 테이블은 오른쪽, 가리켜지는 테이블은 왼쪽에 단계별로 놓는다.
function collect(start: { sourceId: string; table: string }, relations: Relation[], depth: number) {
  const key = (sourceId: string, table: string) => `${sourceId}/${table}`;
  const placed = new Map<string, Placed>([[key(start.sourceId, start.table), { key: key(start.sourceId, start.table), ...start, level: 0 }]]);
  const edges = new Map<string, Relation>();

  for (const side of [1, -1] as Side[]) {
    let frontier = [start];
    for (let level = 1; level <= depth; level++) {
      const next: { sourceId: string; table: string }[] = [];
      for (const t of frontier) {
        for (const r of relations) {
          const [here, there] = side === 1 ? [r.from, r.to] : [r.to, r.from];
          if (here.sourceId !== t.sourceId || here.table !== t.table) continue;
          edges.set(r.id, r);
          const k = key(there.sourceId, there.table);
          // 이미 놓인 테이블(가운데 포함)은 다시 놓지 않는다. 순환 참조에서 끝없이 펼쳐지지 않게 하려는 목적.
          if (placed.has(k)) continue;
          placed.set(k, { key: k, sourceId: there.sourceId, table: there.table, level: side * level });
          next.push(there);
        }
      }
      frontier = next;
    }
  }
  return { placed: [...placed.values()], edges: [...edges.values()].filter((r) => placed.has(key(r.from.sourceId, r.from.table)) && placed.has(key(r.to.sourceId, r.to.table))) };
}

export function TableGraph({ sourceId, table }: { sourceId: string; table: string }) {
  const { sources } = useWorkspace();
  const router = useRouter();
  const theme = useResolvedTheme();
  const [depth, setDepth] = useState(1);

  // 1단계는 가운데 테이블의 연결만, 2단계는 이웃 테이블의 자동 연결까지 구해서 펼친다.
  const center = useLinkedRelations([{ sourceId, table }]);
  const neighbors = collect({ sourceId, table }, center.relations, 1).placed.filter((p) => p.level !== 0);
  const wide = useLinkedRelations(depth === 2 ? [{ sourceId, table }, ...neighbors] : [{ sourceId, table }]);
  const relations = depth === 2 ? wide.relations : center.relations;

  const { placed, edges } = collect({ sourceId, table }, relations, depth);
  const counts = new Map<number, number>();
  const byLevel = new Map<number, Placed[]>();
  for (const p of placed) byLevel.set(p.level, [...(byLevel.get(p.level) ?? []), p]);
  const maxRows = Math.max(...[...byLevel.values()].map((l) => l.length));

  // 도메인 지도를 다 계산했으면 상자에 도메인과 역할을 붙인다. 테두리 색이 역할이고, 글자로도 적는다.
  const { model } = useDomainModel();
  const nodes: Node[] = placed.map((p) => {
    const info = model?.tables.get(p.key);
    const here = model?.tables.get(`${sourceId}/${table}`);
    const row = counts.get(p.level) ?? 0;
    counts.set(p.level, row + 1);
    const inLevel = byLevel.get(p.level)!.length;
    const center = p.level === 0;
    return {
      id: p.key,
      position: { x: p.level * COLUMN_GAP, y: (row - (inLevel - 1) / 2) * ROW_GAP },
      data: {
        label: info ? (
          <div className="flex flex-col items-center leading-tight">
            <span>{p.table}</span>
            <span className="text-[10px] text-zinc-500">
              {info.domain !== here?.domain ? `${info.domain} 시스템 · ` : ""}
              {ROLE_LABEL[info.role]}
            </span>
          </div>
        ) : (
          sourceTableLabel(sources.find((s) => s.meta.id === p.sourceId), p.table)
        ),
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: false,
      connectable: false,
      className: center ? "!border-2 !border-zinc-900 !font-semibold dark:!border-zinc-100" : "cursor-pointer",
      style: { width: 240, fontSize: 13, padding: "6px 10px", ...(info && !center ? { borderColor: roleColor(info.role), borderWidth: 2 } : {}) },
    };
  });

  // 이름과 값으로 찾은 연결은 점선, 기획 설명(#Design)에 적힌 연결과 확인한 연결은 실선으로 그린다.
  const flowEdges: Edge[] = edges.map((r) => ({
    id: r.id,
    source: `${r.from.sourceId}/${r.from.table}`,
    target: `${r.to.sourceId}/${r.to.table}`,
    // 열 이름이 같으면 한 번만 적어 이름표를 짧게 한다.
    label: `${r.from.column === r.to.column && !isExtended(r.from) ? r.from.column : `${fromLabel(r.from)} → ${r.to.column}`}${isDesignRelation(r) ? " (기획 설명)" : isAutoRelation(r) ? " (앱이 찾음)" : ""}`,
    // 꺾인 선으로 그려 같은 상자에서 나가는 선들이 한 줄로 겹치지 않고 높이별로 갈라지게 한다.
    type: "smoothstep",
    labelStyle: { fontSize: 10 },
    labelBgPadding: [4, 2],
    markerEnd: { type: MarkerType.ArrowClosed },
    style: isAutoRelation(r) && !isDesignRelation(r) ? { strokeDasharray: "5 4" } : undefined,
  }));

  const height = Math.min(Math.max(maxRows * ROW_GAP + 90, 300), 640);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span>이어진 테이블</span>
        <span className="text-zinc-400">왼쪽은 이 테이블을 쓰는 테이블, 오른쪽은 이 테이블이 쓰는 테이블, 실선은 기획 설명에 적혀 있거나 확인한 연결, 점선은 앱이 이름과 값으로 찾은 연결</span>
        {depth === 2 && !wide.ready && <span className="text-zinc-400">이웃 테이블의 연결을 찾는 중</span>}
        <span className="ml-auto">보기 범위</span>
        {[1, 2].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDepth(d)}
            className={`rounded px-1.5 py-0.5 ${depth === d ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
          >
            {d === 1 ? "바로 이어진 것" : "한 단계 더"}
          </button>
        ))}
      </div>
      <div className="rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" style={{ height }}>
        <ReactFlow
          // 테이블이나 깊이가 바뀌면 화면 맞춤을 다시 하도록 새로 그린다.
          key={`${sourceId}/${table}/${depth}/${placed.length}`}
          nodes={nodes}
          edges={flowEdges}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          minZoom={0.4}
          colorMode={theme}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          panOnScroll
          onNodeClick={(_, node) => {
            if (node.id === `${sourceId}/${table}`) return;
            const slash = node.id.indexOf("/");
            router.push(`/sources/${node.id.slice(0, slash)}/tables/${encodeURIComponent(node.id.slice(slash + 1))}`);
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} />
        </ReactFlow>
      </div>
    </div>
  );
}
