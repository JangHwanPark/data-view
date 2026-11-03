import { qualifiedTable } from "@/lib/client/file-import";
import type { Relation, TableRef } from "@/lib/client/relations";
import { tableKey } from "@/lib/client/schema";
import { quoteIdent, quoteString, type QueryColumn } from "@/lib/query-result";

// 시작 테이블에 관계를 따라 테이블을 하나씩 붙인다.
// attachTo는 이미 붙은 테이블의 순번(0이 시작 테이블)이다.
export interface JoinStep {
  relationId: string;
  direction: "out" | "in";
  attachTo: number;
}

export interface JoinSpec {
  start: TableRef;
  steps: JoinStep[];
}

// out: 붙어 있는 테이블이 가리키는 쪽을 붙인다 (주문 -> 고객). 행 수가 늘지 않는다.
// in: 붙어 있는 테이블을 가리키는 쪽을 붙인다 (고객 <- 주문). 한 행이 여러 행으로 늘 수 있다.
export interface JoinCandidate extends JoinStep {
  relation: Relation;
  table: TableRef;
}

export function joinedTables(spec: JoinSpec, relations: Relation[]): TableRef[] | null {
  const tables: TableRef[] = [spec.start];
  for (const step of spec.steps) {
    const rel = relations.find((r) => r.id === step.relationId);
    if (!rel || step.attachTo >= tables.length) return null;
    const end = step.direction === "out" ? rel.to : rel.from;
    tables.push({ sourceId: end.sourceId, table: end.table });
  }
  return tables;
}

export function joinCandidates(spec: JoinSpec, relations: Relation[]): JoinCandidate[] {
  const tables = joinedTables(spec, relations) ?? [];
  const same = (a: TableRef, b: TableRef) => a.sourceId === b.sourceId && a.table === b.table;
  const candidates: JoinCandidate[] = [];
  tables.forEach((t, i) => {
    for (const relation of relations) {
      const used = (direction: "out" | "in") =>
        spec.steps.some((s) => s.relationId === relation.id && s.attachTo === i && s.direction === direction);
      if (same(relation.from, t) && !used("out")) {
        candidates.push({ relationId: relation.id, direction: "out", attachTo: i, relation, table: relation.to });
      }
      if (same(relation.to, t) && !used("in")) {
        candidates.push({ relationId: relation.id, direction: "in", attachTo: i, relation, table: relation.from });
      }
    }
  });
  return candidates;
}

export const MISSING = "__dv_missing";
const SEPARATOR = "\u001f";

export interface JoinQuery {
  sql: string; // 결과 열 + 붙인 시트가 있으면 맨 끝에 누락 표시 열
  countSql: string;
  missingSql: string; // 단계별 누락 행 수
  labels: string[]; // 테이블 순번별 표시 이름
}

// 컬럼 이름이 겹치면 "테이블.열"로 구분한다. 같은 테이블을 두 번 붙이면 테이블 이름 뒤에 번호를 붙인다.
export function buildJoinQuery(
  spec: JoinSpec,
  relations: Relation[],
  columns: Map<string, QueryColumn[]>,
  onlyMissing: boolean,
): JoinQuery | null {
  const tables = joinedTables(spec, relations);
  if (!tables) return null;

  const labels = tables.map((t, i) => {
    const before = tables.slice(0, i).filter((o) => o.table === t.table).length;
    return before ? `${t.table}${before + 1}` : t.table;
  });
  const cols = tables.map((t) => columns.get(tableKey(t.sourceId, t.table)) ?? []);
  if (cols.some((c) => c.length === 0)) return null;

  const counts = new Map<string, number>();
  cols.flat().forEach((c) => counts.set(c.name.toLowerCase(), (counts.get(c.name.toLowerCase()) ?? 0) + 1));
  const select = cols.flatMap((list, i) =>
    list.map((c) => {
      const name = counts.get(c.name.toLowerCase())! > 1 ? `${labels[i]}.${c.name}` : c.name;
      return `t${i}.${quoteIdent(c.name)} AS ${quoteIdent(name)}`;
    }),
  );

  // 숫자 1과 문자 "1"을 같은 값으로 보도록 관계 일치율 계산과 같이 문자열로 비교한다.
  const joins: string[] = [];
  const missing: string[] = [];
  spec.steps.forEach((step, k) => {
    const i = k + 1;
    const rel = relations.find((r) => r.id === step.relationId)!;
    const [here, there] = step.direction === "out" ? [rel.from.column, rel.to.column] : [rel.to.column, rel.from.column];
    const left = `t${step.attachTo}.${quoteIdent(here)}`;
    const right = `t${i}.${quoteIdent(there)}`;
    joins.push(
      `LEFT JOIN ${qualifiedTable(tables[i].sourceId, tables[i].table)} AS t${i} ON CAST(${left} AS VARCHAR) = CAST(${right} AS VARCHAR)`,
    );
    // 붙일 값은 있는데 상대 테이블에서 못 찾은 행
    missing.push(`${left} IS NOT NULL AND ${right} IS NULL`);
  });

  const from = `FROM ${qualifiedTable(spec.start.sourceId, spec.start.table)} AS t0 ${joins.join(" ")}`;
  // 붙인 시트가 없으면 누락 표시 열도 만들지 않는다.
  const missingSelect = missing.length
    ? `, concat_ws(${quoteString(SEPARATOR)}, ${missing.map((m, k) => `CASE WHEN ${m} THEN ${quoteString(labels[k + 1])} END`).join(", ")}) AS ${MISSING}`
    : "";
  const where = onlyMissing && missing.length ? `WHERE ${missing.map((m) => `(${m})`).join(" OR ")}` : "";

  return {
    sql: `SELECT ${select.join(", ")}${missingSelect} ${from} ${where}`,
    countSql: `SELECT count(*) ${from} ${where}`,
    missingSql: missing.length
      ? `SELECT ${missing.map((m) => `count(*) FILTER (WHERE ${m})`).join(", ")} ${from}`
      : "SELECT 0",
    labels,
  };
}

export function splitMissing(value: unknown) {
  return String(value ?? "").split(SEPARATOR).filter(Boolean);
}

export function parseSpec(raw: string | null): JoinSpec | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as JoinSpec;
    if (typeof data?.start?.sourceId !== "string" || typeof data.start.table !== "string" || !Array.isArray(data.steps)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}
