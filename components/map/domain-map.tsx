"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { BookOpen } from "lucide-react";
import { MapTabs, RoleBadge, roleColor, RoleLegend, ScanProgress, tablePath } from "@/components/map/map-parts";
import { TableCard } from "@/components/map/table-card";
import { useResolvedTheme } from "@/components/theme-toggle";
import { useDomainModel } from "@/components/use-domain-model";
import { useWorkspace, type WorkspaceDoc } from "@/components/workspace-provider";
import { nameRefersToTable, parseGlossary } from "@/lib/client/doc-infer";
import { extractTerms } from "@/lib/client/doc-terms";
import { ROLE_ORDER, type DomainInfo, type DomainModel, type TableRole } from "@/lib/client/domain-model";

const DOMAIN_WIDTH = 220;
const DOMAIN_COLUMN_GAP = 330;
const DOMAIN_ROW_GAP = 28;
const LIST_MAX = 7;
const listRows = (d: DomainInfo) => Math.min(d.tables.length, LIST_MAX) + (d.tables.length > LIST_MAX ? 1 : 0);
const domainHeight = (d: DomainInfo) => 40 + listRows(d) * 18 + 10;

type DomainNodeData = {
  domain: DomainInfo;
  tables: { key: string; table: string; role: TableRole }[];
  selected: boolean;
  faded: boolean;
};
type DomainNodeType = Node<DomainNodeData, "domain">;

function DomainNodeView({ data }: NodeProps<DomainNodeType>) {
  const { domain, tables, selected, faded } = data;
  return (
    <div
      className={`cursor-pointer rounded-lg border bg-white text-xs shadow-sm transition-opacity dark:bg-zinc-900 ${selected ? "border-2 border-zinc-900 dark:border-zinc-100" : "border-zinc-300 dark:border-zinc-700"} ${faded ? "opacity-35" : ""}`}
      style={{ width: DOMAIN_WIDTH }}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="flex items-baseline gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{domain.name}</span>
        <span className="shrink-0 text-zinc-500">테이블 {domain.tables.length}</span>
      </div>
      <ul className="px-3 py-1">
        {tables.slice(0, LIST_MAX).map((t) => (
          <li key={t.key} className="flex h-[18px] items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-sm" style={{ background: roleColor(t.role) }} aria-hidden />
            <span className="truncate">{t.table}</span>
          </li>
        ))}
        {tables.length > LIST_MAX && <li className="flex h-[18px] items-center text-zinc-400">외 {tables.length - LIST_MAX}개</li>}
      </ul>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}

const nodeTypes = { domain: DomainNodeView };

// 도메인 지도(설계 4.12 D5, D6). 도메인을 상자로, 도메인 사이 연결을 선으로 그리고, 고른 도메인의 안쪽을 아래에 펼친다.
export function DomainMap() {
  const { sources, initialized } = useWorkspace();
  const { model, progress, rowCounts, error } = useDomainModel();
  const theme = useResolvedTheme();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const selectedName = searchParams.get("domain");

  // 도메인을 고를 때마다 서버에 요청하지 않도록 주소만 바꾼다. 뒤로 가기로 이전 도메인으로 돌아간다.
  function select(name: string | null) {
    window.history.pushState(null, "", name ? `${pathname}?domain=${encodeURIComponent(name)}` : pathname);
  }

  const intro = (
    <>
      <MapTabs active="domains" />
      <p className="text-zinc-500">
        테이블을 도메인(파일, 이름 접두어)으로 묶고 도메인 사이의 연결을 그립니다. 왼쪽은 콘텐츠가 시작되는 도메인, 오른쪽은 여러 곳에서 가져다 쓰는 공통 도메인입니다. 선의 숫자는 연결 수이고, 상자를 누르면 그 도메인 안을 아래에 펼칩니다.
      </p>
    </>
  );

  if (!initialized) return <div className="flex flex-col gap-3">{intro}</div>;
  if (!sources.length) {
    return (
      <div className="flex flex-col gap-3">
        {intro}
        <p className="text-zinc-500">열어 둔 데이터가 없습니다. 상단의 소스 추가에서 엑셀이나 데이터베이스를 열어 주세요.</p>
      </div>
    );
  }
  if (!model) {
    return (
      <div className="flex flex-col gap-3">
        {intro}
        {error ? <p className="text-red-600">연결을 찾지 못했습니다. {error}</p> : progress && <ScanProgress progress={progress} />}
      </div>
    );
  }

  const selected = model.domains.find((d) => d.name === selectedName) ?? null;
  const counts = new Map<TableRole, number>();
  for (const t of model.tables.values()) counts.set(t.role, (counts.get(t.role) ?? 0) + 1);
  const linkCount = [...model.tables.values()].reduce((n, t) => n + t.out.length, 0);
  const crossCount = model.domains.reduce((n, d) => n + [...d.out.values()].reduce((a, b) => a + b, 0), 0);

  const { nodes, edges, height } = domainGraph(model, selected);

  return (
    <div className="flex flex-col gap-3">
      {intro}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p>
          도메인 <strong>{model.domains.length}</strong>개, 테이블 <strong>{model.tables.size}</strong>개, 연결 <strong>{linkCount}</strong>개(도메인 사이 {crossCount}개)
        </p>
        <div className="ml-auto">
          <RoleLegend counts={counts} />
        </div>
      </div>
      <div className="rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" style={{ height }}>
        <ReactFlow
          key={`${model.domains.length}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.05 }}
          minZoom={0.2}
          colorMode={theme}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          panOnScroll
          onNodeClick={(_, node) => select(node.id === selected?.name ? null : node.id)}
          onPaneClick={() => select(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {selected ? (
        <DomainDetail key={selected.name} domain={selected} model={model} rowCounts={rowCounts} onSelect={select} />
      ) : (
        <p className="text-zinc-500">도메인 상자를 누르면 그 도메인의 테이블 연결과 바깥 도메인과의 연결을 볼 수 있습니다.</p>
      )}
    </div>
  );
}

function domainGraph(model: DomainModel, selected: DomainInfo | null) {
  const nextY = new Map<number, number>();
  const nodes: DomainNodeType[] = [];
  const neighbors = new Set(selected ? [selected.name, ...selected.in.keys(), ...selected.out.keys()] : []);
  for (const d of model.domains) {
    const y = nextY.get(d.level) ?? 0;
    nextY.set(d.level, y + domainHeight(d) + DOMAIN_ROW_GAP);
    nodes.push({
      id: d.name,
      type: "domain",
      position: { x: d.level * DOMAIN_COLUMN_GAP, y },
      data: {
        domain: d,
        tables: d.tables.map((k) => model.tables.get(k)!).map((t) => ({ key: t.key, table: t.table, role: t.role })),
        selected: d === selected,
        faded: selected !== null && !neighbors.has(d.name),
      },
    });
  }
  // 층마다 세로 길이가 달라서, 가운데를 맞춰 선이 덜 엉키게 한다.
  const tallest = Math.max(...nextY.values());
  for (const n of nodes) n.position.y += (tallest - nextY.get(n.data.domain.level)!) / 2;

  const max = Math.max(1, ...model.domains.flatMap((d) => [...d.out.values()]));
  const edges: Edge[] = model.domains.flatMap((d) =>
    [...d.out].map(([target, count]) => {
      const active = selected === null || d === selected || target === selected.name;
      return {
        id: `${d.name}>${target}`,
        source: d.name,
        target,
        label: String(count),
        labelStyle: { fontSize: 10 },
        labelBgPadding: [3, 1] as [number, number],
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: 1 + (3 * count) / max, opacity: active ? 0.9 : 0.08 },
        labelShowBg: active,
        ...(active ? {} : { label: undefined }),
      };
    }),
  );
  return { nodes, edges, height: Math.min(Math.max(tallest + 60, 360), 760) };
}

interface DetailProps {
  domain: DomainInfo;
  model: DomainModel;
  rowCounts: Map<string, number>;
  onSelect: (name: string) => void;
}

// 고른 도메인의 안쪽(D6). 가운데에 도메인 테이블, 왼쪽에 이 도메인을 가리키는 도메인, 오른쪽에 이 도메인이 가리키는 도메인을 둔다.
function DomainDetail({ domain, model, rowCounts, onSelect }: DetailProps) {
  const router = useRouter();
  const theme = useResolvedTheme();
  const { nodes, edges, height } = detailGraph(domain, model);
  const roles = ROLE_ORDER.filter((r) => domain.tables.some((k) => model.tables.get(k)!.role === r));
  return (
    <section className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold">{domain.name}</h2>
        <span className="text-xs text-zinc-500">
          테이블 {domain.tables.length}개, 가리키는 도메인 {domain.out.size}개, 가리켜지는 도메인 {domain.in.size}개
        </span>
        <span className="flex gap-2">
          {roles.map((r) => (
            <RoleBadge key={r} role={r} />
          ))}
        </span>
      </div>
      <DomainDocs name={domain.name} tables={domain.tables.map((k) => model.tables.get(k)!.table)} />
      <div className="rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" style={{ height }}>
        <ReactFlow
          key={domain.name}
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          minZoom={0.3}
          colorMode={theme}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          panOnScroll
          onNodeClick={(_, node) => {
            if (node.id.startsWith("domain:")) onSelect(node.id.slice(7));
            else router.push(tablePath(node.id));
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} />
        </ReactFlow>
      </div>
      <p className="text-xs text-zinc-500">가운데 테이블을 누르면 그 테이블을, 양쪽의 점선 상자를 누르면 그 도메인을 엽니다.</p>
      <div className="grid grid-cols-1 gap-2 2xl:grid-cols-2">
        {domain.tables.map((k) => (
          <TableCard key={k} info={model.tables.get(k)!} model={model} rows={rowCounts.get(k)} domains={model.domains.map((d) => d.name)} />
        ))}
      </div>
    </section>
  );
}

const DETAIL_GAP = 300;
const DETAIL_ROW = 64;

function detailGraph(domain: DomainInfo, model: DomainModel) {
  const inside = new Set(domain.tables);
  // 도메인 안의 층: 가리키는 테이블을 왼쪽, 가리켜지는 테이블을 오른쪽에 둔다. 순환은 테이블 수만큼만 돌고 멈춘다.
  const level = new Map(domain.tables.map((k) => [k, 0]));
  for (let i = 0; i < domain.tables.length; i++) {
    let changed = false;
    for (const k of domain.tables) {
      for (const l of model.tables.get(k)!.out) {
        if (!inside.has(l.key)) continue;
        if (level.get(l.key)! < level.get(k)! + 1 && level.get(k)! + 1 < domain.tables.length) {
          level.set(l.key, level.get(k)! + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  const maxLevel = Math.max(0, ...level.values());
  const columns = new Map<number, string[]>();
  for (const k of domain.tables) columns.set(level.get(k)! + 1, [...(columns.get(level.get(k)! + 1) ?? []), k]);
  columns.set(0, [...domain.in.keys()].map((d) => `domain:${d}`));
  columns.set(maxLevel + 2, [...domain.out.keys()].map((d) => `domain:${d}`));
  const tallest = Math.max(...[...columns.values()].map((c) => c.length));

  const nodes: Node[] = [];
  for (const [col, ids] of columns) {
    ids.forEach((id, row) => {
      const external = id.startsWith("domain:");
      const info = external ? null : model.tables.get(id)!;
      nodes.push({
        id,
        position: { x: col * DETAIL_GAP, y: (row - (ids.length - 1) / 2) * DETAIL_ROW },
        data: { label: external ? `${id.slice(7)} 도메인` : info!.table },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        className: "cursor-pointer",
        style: external
          ? { width: 200, fontSize: 12, padding: "6px 8px", borderStyle: "dashed", color: "var(--color-zinc-500)" }
          : { width: 200, fontSize: 13, padding: "8px 10px", borderWidth: 2, borderColor: roleColor(info!.role), fontWeight: 500 },
      });
    });
  }

  // 바깥 도메인으로 가는 선은 테이블과 도메인 쌍마다 하나로 모으고, 이름표에 열 이름을 적는다.
  const edges = new Map<string, { source: string; target: string; labels: Set<string> }>();
  const add = (source: string, target: string, label: string) => {
    const id = `${source}>${target}`;
    const e = edges.get(id) ?? { source, target, labels: new Set<string>() };
    e.labels.add(label);
    edges.set(id, e);
  };
  for (const k of domain.tables) {
    const info = model.tables.get(k)!;
    for (const l of info.out) {
      const other = model.tables.get(l.key)!;
      add(k, inside.has(l.key) ? l.key : `domain:${other.domain}`, inside.has(l.key) ? l.column : `${l.column} → ${other.table}`);
    }
    for (const l of info.in) {
      const other = model.tables.get(l.key)!;
      if (!inside.has(l.key)) add(`domain:${other.domain}`, k, `${other.table}.${l.otherColumn}`);
    }
  }
  const flowEdges: Edge[] = [...edges].map(([id, e]) => {
    const labels = [...e.labels];
    return {
      id,
      source: e.source,
      target: e.target,
      label: labels.length > 2 ? `${labels.slice(0, 2).join(", ")} 외 ${labels.length - 2}` : labels.join(", "),
      labelStyle: { fontSize: 10 },
      labelBgPadding: [3, 1] as [number, number],
      markerEnd: { type: MarkerType.ArrowClosed },
      style: e.source.startsWith("domain:") || e.target.startsWith("domain:") ? { strokeDasharray: "5 4" } : undefined,
    };
  });
  return { nodes, edges: flowEdges, height: Math.min(Math.max(tallest * DETAIL_ROW + 80, 260), 720) };
}

// 이 도메인을 설명하는 기획서 절. 도메인 이름이나 그 테이블 이름을 가리키는 말이 나오는 절이다.
function DomainDocs({ name, tables }: { name: string; tables: string[] }) {
  const { docs, glossary } = useWorkspace();
  const glossaryMap = parseGlossary(glossary);
  const found = findDomainSections(docs, [name, ...tables], glossaryMap);
  if (!docs.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 text-zinc-500">
        <BookOpen className="size-3.5" aria-hidden />
        기획서
      </span>
      {found.length === 0 && <span className="text-zinc-400">이 도메인을 다루는 절을 찾지 못했습니다.</span>}
      {found.map((f) => (
        <Link
          key={`${f.docId}/${f.sectionId}`}
          href={`/docs/${f.docId}#${f.sectionId}`}
          className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <span className="text-zinc-500">{f.docName}</span> {f.title}
        </Link>
      ))}
    </div>
  );
}

function findDomainSections(docs: WorkspaceDoc[], names: string[], glossary: Map<string, string>) {
  const out: { docId: string; docName: string; sectionId: string; title: string }[] = [];
  for (const doc of docs) {
    if (!doc.parsed) continue;
    const sections = new Set<string>();
    for (const t of extractTerms(doc.parsed)) {
      if (t.kind !== "name") continue;
      if (names.some((n) => nameRefersToTable(t.text, n, glossary))) t.sections.forEach((s) => sections.add(s));
    }
    for (const s of doc.parsed.sections) {
      if (sections.has(s.id)) out.push({ docId: doc.meta.id, docName: doc.meta.name, sectionId: s.id, title: s.title });
    }
  }
  return out.slice(0, 12);
}
