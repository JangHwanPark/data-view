import { ROLE_ORDER, type DomainModel, type LinkEnd } from "@/core/domain-model";
import type { ColumnRef } from "@/core/relations";

// 테이블 관계도(설계 4.13)의 배치. 가운데 테이블을 열 목록 상자로 두고,
// 왼쪽에 이 테이블을 가리키는 테이블, 오른쪽에 이 테이블이 가리키는 테이블을 놓는다.
// 화면과 상관없는 순수 함수라 같은 입력이면 같은 배치가 나온다.

export const HEAD = 40; // 상자 머리 높이
export const ROW = 18; // 열 한 줄 높이
export const NODE_W = 210;
export const CENTER_W = 240;
const GAP = 14;
const COL_GAP = 110;
export const MAX_SIDE = 12; // 한쪽 이웃이 이보다 많으면 도메인별로 접는다(G5)
const GROUP_LIST = 4;

export type NodeKind = "center" | "table" | "group" | "far";

export interface LayoutNode {
  id: string;
  kind: NodeKind;
  key: string | null; // 테이블 키. 묶음 상자는 null
  side: -2 | -1 | 0 | 1 | 2;
  cols: string[]; // 상자에 적는 열
  hidden: number; // 가운데 상자에서 접은 열 수
  group?: { id: string; domain: string; tables: string[] };
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  relationId: string;
  from: ColumnRef;
  to: ColumnRef;
}

export const boxHeight = (rows: number) => HEAD + rows * ROW + 8;
export const handleTop = (i: number) => HEAD + i * ROW + ROW / 2;

const ref = (key: string, column: string): ColumnRef => {
  const slash = key.indexOf("/");
  return { sourceId: key.slice(0, slash), table: key.slice(slash + 1), column };
};

interface Input {
  model: DomainModel;
  center: string;
  columns: string[]; // 가운데 테이블의 모든 열(순서대로)
  depth: 1 | 2;
  open: Set<string>; // 펼친 묶음 id
}

export function relationLayout({ model, center, columns, depth, open }: Input) {
  const me = model.tables.get(center);
  if (!me) return null;
  const home = me.domain;
  const info = (key: string) => model.tables.get(key)!;
  // 같은 도메인을 먼저, 그다음 도메인 이름, 역할, 테이블 이름 순서로 놓는다.
  const sortKey = (key: string) => [info(key).domain === home ? 0 : 1, info(key).domain, ROLE_ORDER.indexOf(info(key).role), info(key).table] as const;
  const byOrder = (a: string, b: string) => {
    const x = sortKey(a);
    const y = sortKey(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  };

  // 가운데 상자: 키 열(첫 열)을 맨 위에, 연결에 쓰인 열을 그 아래에, 나머지는 "외 n개"로 접는다.
  const used = new Set([...me.out.map((l) => l.column), ...me.in.map((l) => l.column)]);
  const key = columns[0];
  const centerCols = key ? [key, ...columns.filter((c) => c !== key && used.has(c))] : [...used];
  for (const c of used) if (!centerCols.includes(c)) centerCols.push(c);
  const hidden = Math.max(0, columns.length - centerCols.length);
  const centerNode: LayoutNode = {
    id: `c:${center}`,
    kind: "center",
    key: center,
    side: 0,
    cols: centerCols,
    hidden,
    x: 0,
    y: 0,
    w: CENTER_W,
    h: boxHeight(centerCols.length + (hidden ? 1 : 0)),
  };
  const placed = new Set([center]);

  // 한쪽 이웃. 테이블마다 상자 하나이고, 상자에는 연결에 쓰인 그 테이블 쪽 열을 적는다.
  function side(links: LinkEnd[], dir: -1 | 1) {
    const byTable = new Map<string, LinkEnd[]>();
    for (const l of links) if (l.key !== center) byTable.set(l.key, [...(byTable.get(l.key) ?? []), l]);
    const tables = [...byTable.keys()].sort(byOrder);
    const nodes: { node: LayoutNode; links: LinkEnd[] }[] = [];
    const tableNode = (k: string) => {
      const ls = byTable.get(k)!;
      const cols = [...new Set(ls.map((l) => l.otherColumn))];
      placed.add(k);
      return { node: { id: `t:${dir}:${k}`, kind: "table", key: k, side: dir, cols, hidden: 0, x: 0, y: 0, w: NODE_W, h: boxHeight(cols.length) } as LayoutNode, links: ls };
    };
    if (tables.length <= MAX_SIDE) return tables.map(tableNode);
    const byDomain = new Map<string, string[]>();
    for (const k of tables) byDomain.set(info(k).domain, [...(byDomain.get(info(k).domain) ?? []), k]);
    for (const [domain, list] of byDomain) {
      const id = `g:${dir}:${domain}`;
      if (list.length === 1 || open.has(id)) {
        nodes.push(...list.map(tableNode));
        continue;
      }
      list.forEach((k) => placed.add(k));
      const rows = Math.min(list.length, GROUP_LIST) + (list.length > GROUP_LIST ? 1 : 0);
      nodes.push({
        node: { id, kind: "group", key: null, side: dir, cols: [], hidden: 0, group: { id, domain, tables: list }, x: 0, y: 0, w: NODE_W, h: boxHeight(rows) },
        links: list.flatMap((k) => byTable.get(k)!),
      });
    }
    return nodes;
  }

  const left = side(me.in, -1);
  const right = side(me.out, 1);
  const columnsBySide = new Map<number, LayoutNode[]>([
    [-1, left.map((n) => n.node)],
    [0, [centerNode]],
    [1, right.map((n) => n.node)],
  ]);
  const edges: LayoutEdge[] = [];

  for (const { node, links } of left) {
    for (const l of links) {
      edges.push({
        id: `${node.id}|${l.relationId}|${l.column}|${l.otherColumn}`,
        source: node.id,
        target: centerNode.id,
        sourceHandle: node.kind === "table" ? `out:${l.otherColumn}` : "out",
        targetHandle: `in:${l.column}`,
        relationId: l.relationId,
        from: ref(l.key, l.otherColumn),
        to: ref(center, l.column),
      });
    }
  }
  for (const { node, links } of right) {
    for (const l of links) {
      edges.push({
        id: `${node.id}|${l.relationId}|${l.column}|${l.otherColumn}`,
        source: centerNode.id,
        target: node.id,
        sourceHandle: `out:${l.column}`,
        targetHandle: node.kind === "table" ? `in:${l.otherColumn}` : "in",
        relationId: l.relationId,
        from: ref(center, l.column),
        to: ref(l.key, l.otherColumn),
      });
    }
  }

  // 2단계(G6): 이웃의 이웃을 바깥 열에 둔다. 이미 나온 테이블은 다시 그리지 않는다.
  if (depth === 2) {
    for (const dir of [-1, 1] as const) {
      const near = (dir === -1 ? left : right).map((n) => n.node).filter((n) => n.kind === "table");
      const far = new Map<string, LayoutNode>();
      for (const n of near) {
        const t = info(n.key!);
        for (const l of dir === -1 ? t.in : t.out) {
          if (placed.has(l.key) && !far.has(l.key)) continue;
          if (!far.has(l.key)) {
            far.set(l.key, { id: `f:${dir}:${l.key}`, kind: "far", key: l.key, side: (dir * 2) as -2 | 2, cols: [], hidden: 0, x: 0, y: 0, w: NODE_W, h: boxHeight(0) });
          }
          const f = far.get(l.key)!;
          edges.push(
            dir === 1
              ? { id: `${n.id}>${f.id}|${l.relationId}`, source: n.id, target: f.id, sourceHandle: "out", targetHandle: "in", relationId: l.relationId, from: ref(n.key!, l.column), to: ref(l.key, l.otherColumn) }
              : { id: `${f.id}>${n.id}|${l.relationId}`, source: f.id, target: n.id, sourceHandle: "out", targetHandle: "in", relationId: l.relationId, from: ref(l.key, l.otherColumn), to: ref(n.key!, l.column) },
          );
        }
      }
      const list = [...far.values()].sort((a, b) => byOrder(a.key!, b.key!));
      list.forEach((n) => placed.add(n.key!));
      columnsBySide.set(dir * 2, list);
    }
  }

  // 열마다 세로로 쌓고, 가장 긴 열을 기준으로 가운데를 맞춘다.
  const sides = [...columnsBySide.keys()].sort((a, b) => a - b);
  const heightOf = (list: LayoutNode[]) => list.reduce((s, n) => s + n.h + GAP, -GAP);
  const tallest = Math.max(...sides.map((s) => heightOf(columnsBySide.get(s)!)));
  let x = 0;
  const nodes: LayoutNode[] = [];
  for (const s of sides) {
    const list = columnsBySide.get(s)!;
    let y = (tallest - heightOf(list)) / 2;
    for (const n of list) {
      n.x = x;
      n.y = y;
      y += n.h + GAP;
      nodes.push(n);
    }
    x += (s === 0 ? CENTER_W : NODE_W) + COL_GAP;
  }
  const far = nodes.filter((n) => n.kind === "far").length;
  return { nodes, edges, width: x - COL_GAP, height: tallest, far, empty: { left: left.length === 0, right: right.length === 0 } };
}
