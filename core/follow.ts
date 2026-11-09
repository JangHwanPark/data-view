import { runQuery } from "@/core/duckdb";
import { qualifiedTable } from "@/core/file-import";
import { fromColumns, fromMatchWhere, isExtended, type ColumnRef, type FromSide, type Relation } from "@/core/relations";
import { quoteIdent, quoteString, type QueryResult } from "@/shared/lib/query-result";

// 따라가기 경로의 한 단계. 어느 테이블의 어느 열 값을 눌렀는지 기록한다.
export interface TrailStep extends KeyValue {
  sourceId: string;
  table: string;
  column: string;
}

export interface KeyValue {
  value: string;
  numeric?: boolean; // 누른 값이 숫자였는지
}

// out: 이 열이 다른 테이블을 가리킨다 (주문.고객ID -> 고객.ID)
// in: 다른 테이블이 이 열을 가리킨다 (고객.ID <- 주문.고객ID)
export interface Link {
  relation: Relation;
  direction: "out" | "in";
  target: ColumnRef | FromSide; // in이면 쓰는 쪽 전체(번호 붙은 열, 구분자, 타입 조건 포함)
}

export function linksFor(sourceId: string, table: string, column: string, relations: Relation[]): Link[] {
  const links: Link[] = [];
  for (const relation of relations) {
    const { from, to } = relation;
    if (from.sourceId === sourceId && from.table === table && fromColumns(from).includes(column)) {
      links.push({ relation, direction: "out", target: to });
    }
    if (to.sourceId === sourceId && to.table === table && to.column === column) {
      links.push({ relation, direction: "in", target: from });
    }
  }
  return links;
}

// 관계가 걸린 열 이름 목록. 표에서 값을 링크처럼 보여줄 때 쓴다.
export function linkedColumns(sourceId: string, table: string, relations: Relation[]) {
  const set = new Set<string>();
  for (const { from, to } of relations) {
    if (from.sourceId === sourceId && from.table === table) fromColumns(from).forEach((c) => set.add(c));
    if (to.sourceId === sourceId && to.table === table) set.add(to.column);
  }
  return set;
}

export const LINKED_ROW_LIMIT = 200;

// 숫자 1과 문자 "1"을 같은 값으로 보도록 문자열로 맞춰 비교한다. 관계 일치율 계산과 같은 기준.
// 숫자는 DOUBLE 열에서 800이 '800.0'으로 바뀌므로 숫자로도 한 번 더 비교한다.
export function fetchLinkedRows(target: ColumnRef | FromSide, key: KeyValue): Promise<QueryResult> {
  // 이 값을 쓰는 쪽이 번호 붙은 열이나 한 칸 여러 ID, 타입+ID면 펼친 값 가운데 하나라도 맞는 행을 찾는다.
  if (isExtended(target as FromSide)) {
    return runQuery(`SELECT * FROM ${qualifiedTable(target.sourceId, target.table)} WHERE ${fromMatchWhere(target as FromSide, key.value)}`, LINKED_ROW_LIMIT);
  }
  const col = quoteIdent(target.column);
  const numeric = key.numeric && Number.isFinite(Number(key.value)) ? ` OR TRY_CAST(${col} AS DOUBLE) = ${Number(key.value)}` : "";
  return runQuery(
    `SELECT * FROM ${qualifiedTable(target.sourceId, target.table)}
     WHERE CAST(${col} AS VARCHAR) = ${quoteString(key.value)}${numeric}`,
    LINKED_ROW_LIMIT,
  );
}

// 표에 보이는 값을 비교용 값으로 바꾼다. null은 따라갈 수 없다.
export function toKeyValue(value: unknown): KeyValue | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? { value: String(value), numeric: true } : { value: String(value) };
}

export function parseTrail(raw: string | null): TrailStep[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (s): s is TrailStep =>
        typeof s?.sourceId === "string" &&
        typeof s?.table === "string" &&
        typeof s?.column === "string" &&
        typeof s?.value === "string" &&
        (s.numeric === undefined || typeof s.numeric === "boolean"),
    );
  } catch {
    return [];
  }
}

export function serializeTrail(trail: TrailStep[]) {
  return JSON.stringify(trail);
}

// 한 칸에 여러 ID를 넣는 열과 구분자. 표에서 ID마다 따로 링크를 건다.
export function columnSeparators(sourceId: string, table: string, relations: Relation[]) {
  const map = new Map<string, string>();
  for (const { from } of relations) {
    if (from.sourceId === sourceId && from.table === table && from.separator) fromColumns(from).forEach((c) => map.set(c, from.separator!));
  }
  return map;
}
