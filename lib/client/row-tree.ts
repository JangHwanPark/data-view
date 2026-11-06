import { focusWhere } from "@/lib/client/doc-links";
import type { DomainModel, LinkEnd } from "@/lib/client/domain-model";
import { runQuery } from "@/lib/client/duckdb";
import { qualifiedTable } from "@/lib/client/file-import";
import { fromMatchWhere } from "@/lib/client/relations";
import { columnsOf, textColumn, titleOf } from "@/lib/client/value-explain";

// 행 참조 트리와 사용처 추적(설계 4.9). 행 하나에서 출발해 연결을 따라 한 단계씩 펼친다.
// - 이 행이 쓰는 것: 퀘스트 → 보상 그룹 → (세부) 보상 3개 → 아이템, 재화 → 등급
// - 이 행을 쓰는 곳: 아이템 → 그 아이템을 주는 보상의 보상 그룹 → 그 보상 그룹을 쓰는 퀘스트, 메일
// 화면이 노드를 펼칠 때마다 다음 단계만 구한다. 한 갈래에 보여주는 행은 MAX_ROWS개까지다.

export const MAX_ROWS = 20;
const SUMMARY_FIELDS = 4;

export interface RowNode {
  key: string; // 테이블 키
  table: string;
  idColumn: string; // 이 행을 찾은 열(보통 첫 열)
  idValue: string;
  unique: boolean; // ID 열 값이 유일한 행인지. 세부 테이블(보상)의 행은 아니다
  title: string | null;
  summary: string; // 주요 값 몇 개
  values: Record<string, unknown> | null; // null이면 데이터에 없는 ID
  via?: string; // 사용처에서 세부 행을 거쳐 위 행으로 올라왔을 때의 설명
}

export interface RowGroup {
  kind: "uses" | "detail" | "usedBy";
  label: string; // "reward_group_id → RewardGroup"
  key: string; // 상대 테이블 키
  total: number; // 전체 행 수(보여주는 것은 MAX_ROWS까지)
  nodes: RowNode[];
  note?: string; // 세부 행을 위 행으로 올렸을 때의 설명. 이때는 "외 n개"를 쓰지 않는다
}

// 번호 붙은 열 묶음 이름. Level#1, Level#2, Level#3 → Level#1~3
export const groupLabel = (cols: string[]) => `${cols[0]}~${cols[cols.length - 1].match(/\d+$/)?.[0] ?? ""}`;
const split = (key: string) => ({ sourceId: key.slice(0, key.indexOf("/")), table: key.slice(key.indexOf("/") + 1) });
const clean = (v: unknown) => String(v).replace(/^(-?\d+)\.0+$/, "$1");

async function isTextTable(model: DomainModel, key: string) {
  return textColumn(await columnsOf(model, key)) !== null;
}

// 행 값으로 노드를 만든다. 이름은 이 행의 ID로 구하고(세부 테이블 행은 이름 대신 주요 값으로 알아본다).
async function toNode(model: DomainModel, key: string, values: Record<string, unknown>, unique: boolean, skip: string[] = []): Promise<RowNode> {
  const columns = await columnsOf(model, key);
  const idColumn = columns[0];
  const idValue = clean(values[idColumn]);
  const info = model.tables.get(key);
  const title = unique ? await titleOf(model, { key, column: idColumn }, idValue) : null;
  // 이름을 가져온 열(name_key)과 ID 열은 주요 값에서 뺀다.
  const nameColumns = new Set((info?.out ?? []).filter((l) => /_key$/i.test(l.column)).map((l) => l.column));
  const summary = columns
    .filter((c) => (unique ? c !== idColumn : true) && !nameColumns.has(c) && !skip.includes(c) && values[c] !== null && values[c] !== undefined && values[c] !== "")
    .slice(0, SUMMARY_FIELDS)
    .map((c) => `${c} ${clean(values[c])}`)
    .join(", ");
  return { key, table: split(key).table, idColumn, idValue, unique, title, summary, values };
}

async function fetchRows(key: string, where: string, limit: number) {
  const { sourceId, table } = split(key);
  const from = qualifiedTable(sourceId, table);
  // 같은 연결로 한 번에 하나씩 묻는다.
  const rows = await runQuery(`SELECT * FROM ${from} WHERE ${where} LIMIT ${limit}`, limit);
  const count = await runQuery(`SELECT CAST(count(*) AS BIGINT) FROM ${from} WHERE ${where}`, 1);
  const records = rows.rows.map((r) => Object.fromEntries(rows.columns.map((c, i) => [c.name, r[i]])));
  return { records, total: Number(count.rows[0]?.[0] ?? 0) };
}

// 출발 행. 테이블의 열 하나와 값으로 찾는다(데이터 표에서 고른 행의 첫 열).
export async function loadRow(model: DomainModel, key: string, column: string, value: string): Promise<RowNode> {
  const { records } = await fetchRows(key, focusWhere({ column, value }), 1);
  const columns = await columnsOf(model, key);
  const unique = column === columns[0] && (await fetchRows(key, focusWhere({ column, value }), 2)).total <= 1;
  if (!records[0]) return { key, table: split(key).table, idColumn: column, idValue: value, unique, title: null, summary: "", values: null };
  return toNode(model, key, records[0], unique);
}

// 이 행이 쓰는 것. 이 행의 ID 열 값들이 가리키는 행과, 이 테이블을 위 테이블로 두는 세부 테이블의 행이다.
export async function usesGroups(model: DomainModel, node: RowNode): Promise<RowGroup[]> {
  const info = model.tables.get(node.key);
  if (!info || !node.values) return [];
  const groups: RowGroup[] = [];
  const byColumn = new Map<string, LinkEnd[]>();
  for (const l of info.out) byColumn.set(l.column, [...(byColumn.get(l.column) ?? []), l]);

  for (const [column, links] of byColumn) {
    // 세부 행(보상)에서 위 행(보상 그룹)으로 가는 연결은 방금 내려온 길이라 다시 보여주지 않는다.
    if (!node.unique && info.parent && links.some((l) => l.key === info.parent)) continue;
    const raw = node.values[column];
    if (raw === null || raw === undefined || String(raw).trim() === "") continue;
    // 종류+ID 열은 이 행의 종류 값에 맞는 연결만 쓴다.
    const link = links.find((l) => l.when && String(node.values![l.when.column] ?? "") === l.when.value) ?? links.find((l) => !l.when);
    if (!link) continue;
    // 이름 글(name_key → String)은 노드 이름에 이미 들어 있어 따로 펼치지 않는다.
    if (await isTextTable(model, link.key)) continue;
    const ids = (link.separator ? String(raw).split(link.separator) : [String(raw)]).map((v) => clean(v.trim())).filter(Boolean);
    const nodes: RowNode[] = [];
    for (const id of ids.slice(0, MAX_ROWS)) {
      const { records } = await fetchRows(link.key, focusWhere({ column: link.otherColumn, value: id }), 1);
      nodes.push(
        records[0]
          ? await toNode(model, link.key, records[0], true)
          : { key: link.key, table: split(link.key).table, idColumn: link.otherColumn, idValue: id, unique: true, title: null, summary: "", values: null },
      );
    }
    groups.push({ kind: "uses", label: `${column} → ${split(link.key).table}`, key: link.key, total: ids.length, nodes });
  }

  // 세부 행: 보상 그룹 → 보상처럼 이 행의 ID를 첫 열로 쓰는 세부 테이블의 행.
  if (node.unique) {
    for (const t of model.tables.values()) {
      if (t.parent !== node.key) continue;
      const link = t.out.find((l) => l.key === node.key);
      if (!link) continue;
      const { records, total } = await fetchRows(t.key, focusWhere({ column: link.column, value: node.idValue }), MAX_ROWS);
      if (!total) continue;
      const nodes: RowNode[] = [];
      for (const r of records) nodes.push(await toNode(model, t.key, r, false, [link.column]));
      groups.push({ kind: "detail", label: `세부: ${t.table}`, key: t.key, total, nodes });
    }
  }
  return groups;
}

// 이 행을 쓰는 곳. 세부 테이블(보상)의 행이 쓰면 그 행의 위 행(보상 그룹)으로 올려서 보여준다.
// 그래야 다음 단계에서 그 보상 그룹을 쓰는 퀘스트, 메일까지 이어서 펼칠 수 있다.
export async function usedByGroups(model: DomainModel, node: RowNode): Promise<RowGroup[]> {
  const info = model.tables.get(node.key);
  if (!info || !node.values || !node.unique) return [];
  const groups: RowGroup[] = [];
  const seen = new Set<string>();
  for (const l of info.in.filter((x) => x.column === node.idColumn)) {
    const other = model.tables.get(l.key);
    if (!other) continue;
    // 번호 붙은 열 묶음(Level#1~3)은 열마다 연결 끝이 있지만 묶음 하나로 한 번만 찾는다.
    if (seen.has(l.relationId)) continue;
    seen.add(l.relationId);
    // 세부 테이블이 위 테이블을 가리키는 연결(보상 → 보상 그룹)은 "이 행이 쓰는 것"의 세부로 이미 보여준다.
    if (other.parent === node.key && other.out.some((o) => o.key === node.key && o.column === l.otherColumn)) continue;
    const { sourceId, table } = split(l.key);
    const where =
      l.separator || l.when || l.group
        ? fromMatchWhere({ sourceId, table, column: l.otherColumn, columns: l.group, separator: l.separator, when: l.when }, node.idValue)
        : focusWhere({ column: l.otherColumn, value: node.idValue });
    const { records, total } = await fetchRows(l.key, where, MAX_ROWS);
    if (!total) continue;
    const parentLink = other.parent ? other.out.find((o) => o.key === other.parent) : undefined;
    let nodes: RowNode[];
    let key = l.key;
    if (parentLink) {
      // 세부 행 → 위 행. 같은 위 행은 한 번만 보여준다.
      key = parentLink.key;
      const parentIds = [...new Set(records.map((r) => clean(r[parentLink.column])).filter((v) => v && v !== "null"))];
      nodes = [];
      for (const pid of parentIds) {
        const { records: pr } = await fetchRows(parentLink.key, focusWhere({ column: parentLink.otherColumn, value: pid }), 1);
        if (!pr[0]) continue;
        const n = await toNode(model, parentLink.key, pr[0], true);
        nodes.push({ ...n, via: `${table} 행에서` });
      }
    } else {
      nodes = [];
      for (const r of records) nodes.push(await toNode(model, l.key, r, other.parent === null || other.parent === undefined));
    }
    const how = l.separator ? `(${l.separator}로 나눈 값)` : l.when ? `(${l.when.column}이 ${l.when.value})` : "";
    groups.push({
      kind: "usedBy",
      label: `${table}.${l.group ? groupLabel(l.group) : l.otherColumn}${how}${parentLink ? ` → ${split(parentLink.key).table}` : ""}`,
      key,
      total,
      nodes,
      ...(parentLink
        ? { note: total > records.length ? `${table} ${total.toLocaleString()}행 중 ${records.length}행의 위 행만 보여줍니다` : `${table} ${total.toLocaleString()}행의 위 행` }
        : {}),
    });
  }
  return groups.sort((a, b) => b.total - a.total);
}
