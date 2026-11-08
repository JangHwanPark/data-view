import type { DocCheckIssue } from "@/lib/client/doc-check";
import type { DomainModel } from "@/lib/client/domain-model";
import { loadRow, usesGroups, type RowNode } from "@/lib/client/row-tree";

// 기획서 기준 테스트 항목(설계 4.11). 기획서 절 하나에 나온 ID마다 그 행이 쓰는 것을 행 트리로 펼쳐 확인 내용을 만든다.
// 예: 퀘스트 71005 → 보상 그룹 50012 → 세부 보상(ITEM 101699 9개) → 아이템 101699
// 기획서와 다른 값, 데이터에 없는 ID, 없는 ID를 쓰는 행이 걸린 항목은 위로 올린다.

export const MAX_DEPTH = 3; // 트리를 펼치는 깊이
const MAX_LINES = 24; // 항목 하나에 적는 줄 수

export interface CheckLine {
  depth: number;
  text: string;
  missing: boolean; // 데이터에 없는 ID를 쓰는 줄
}

export interface CheckItem {
  key: string; // 진행 상태를 저장하는 키. 테이블 키|ID
  sourceId: string;
  table: string;
  keyColumn: string;
  id: string;
  title: string | null;
  lines: CheckLine[];
  flags: string[]; // 위로 올리는 이유
  notes?: string[]; // 알아 둘 점. 위로 올리지는 않는다(예: 이번 패치에서 바뀐 값)
  found: boolean; // 데이터에 이 ID의 행이 있는지
}

// 절에서 찾은 ID 하나. 기획서 화면에서 "맞음"으로 표시했거나 확실한 추정(85% 이상)인 것만 쓴다.
export interface SectionId {
  sourceId: string;
  table: string;
  column: string;
  value: string;
}

const lineText = (n: RowNode, kind: string) => {
  if (!n.values) return `${n.table} ${n.idValue} · 데이터에 없는 ID`;
  if (!n.unique) return `${kind === "detail" ? "세부 " : ""}${n.table}: ${n.summary}`;
  return `${n.table} ${n.idValue}${n.title ? ` ${n.title}` : ""}`;
};

async function treeLines(model: DomainModel, root: RowNode) {
  const lines: CheckLine[] = [];
  const seen = new Set<string>([`${root.key}|${root.idValue}`]);
  async function walk(node: RowNode, depth: number) {
    for (const g of await usesGroups(model, node)) {
      for (const n of g.nodes) {
        if (lines.length >= MAX_LINES) return;
        lines.push({ depth, text: `${g.kind === "detail" ? "" : `${g.label.split(" → ")[0]} → `}${lineText(n, g.kind)}`, missing: !n.values });
        const id = `${n.key}|${n.idValue}|${n.summary}`;
        if (depth < MAX_DEPTH && n.values && !seen.has(id)) {
          seen.add(id);
          await walk(n, depth + 1);
        }
      }
      if (g.total > g.nodes.length && lines.length < MAX_LINES) lines.push({ depth, text: `… 외 ${g.total - g.nodes.length}개`, missing: false });
    }
  }
  await walk(root, 1);
  return lines;
}

export async function buildItems(model: DomainModel, ids: SectionId[], issues: DocCheckIssue[]): Promise<CheckItem[]> {
  const items: CheckItem[] = [];
  const done = new Set<string>();
  // 기획서 표의 ID가 데이터에 없으면(데이터에 없는 ID) 행 트리를 만들 수 없으므로 문제 항목으로만 넣는다.
  const all = [
    ...ids,
    ...issues.filter((i) => i.kind === "missing-row").map((i) => ({ sourceId: i.sourceId, table: i.table, column: i.keyColumn, value: i.key })),
  ];
  for (const t of all) {
    const tableKey = `${t.sourceId}/${t.table}`;
    const key = `${tableKey}|${t.value}`;
    if (done.has(key)) continue;
    done.add(key);
    const root = await loadRow(model, tableKey, t.column, t.value);
    const flags: string[] = [];
    for (const i of issues.filter((x) => x.table === t.table && x.key === t.value)) {
      flags.push(i.kind === "value" ? `기획서와 다름: ${i.column} 기획서 ${i.docValue}, 데이터 ${i.dataValue ?? "(비어 있음)"}` : "기획서에는 있지만 데이터에 없는 ID");
    }
    if (!root.values) {
      if (!flags.length) flags.push("데이터에 없는 ID");
      items.push({ key, sourceId: t.sourceId, table: t.table, keyColumn: t.column, id: t.value, title: null, lines: [], flags, found: false });
      continue;
    }
    const lines = await treeLines(model, root);
    const broken = lines.filter((l) => l.missing).length;
    if (broken) flags.push(`없는 ID를 참조하는 곳 ${broken}개`);
    items.push({ key, sourceId: t.sourceId, table: t.table, keyColumn: t.column, id: t.value, title: root.title, lines, flags, found: true });
  }
  // 문제가 걸린 항목을 위로. 그 안에서는 기획서에 나온 순서를 지킨다.
  return items.map((item, i) => ({ item, i })).sort((a, b) => Number(!a.item.flags.length) - Number(!b.item.flags.length) || a.i - b.i).map((x) => x.item);
}
