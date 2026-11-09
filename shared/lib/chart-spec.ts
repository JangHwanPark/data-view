// 차트와 실시간 조회의 질의 모양(PLAN 32단계). 브라우저(DuckDB)와 서버(MySQL)가 같은 모양을 받아 같은 결과를 만든다.
// SQL 문자열은 사용자 입력을 받지 않는다. 컬럼 이름은 목록에 있는 것만 쓰고(quoteIdent), 값은 lit()으로 넘긴다.
// lit()은 DuckDB에서는 따옴표로 감싼 글자, MySQL에서는 자리표시자(?)와 매개변수가 된다.

export type ChartKind = "bar" | "line" | "histogram";
export type Measure = "count" | "sum" | "avg" | "min" | "max";
export type FilterOp = "eq" | "ne" | "gt" | "ge" | "lt" | "le" | "contains" | "empty" | "notEmpty";

export interface SpecFilter {
  column: string;
  op: FilterOp;
  value: string;
}

export interface ChartSpec {
  kind: ChartKind;
  x: string; // 묶을 컬럼(막대), 가로축 컬럼(선), 나눌 숫자 컬럼(분포)
  measure: Measure; // 분포는 늘 count
  y?: string; // 합계, 평균 등을 낼 숫자 컬럼
  filters: SpecFilter[];
  limit: number; // 막대 수(가장 큰 것부터). 나머지는 「그 밖」으로 합친다
}

export interface ChartPoint {
  label: string;
  value: number;
  from?: number; // 분포 칸의 범위
  to?: number;
}

export interface ChartResult {
  points: ChartPoint[];
  other?: { count: number; value: number }; // 막대에서 잘라 낸 나머지
  rows: number; // 거른 뒤 행 수
}

export const MEASURE_LABEL: Record<Measure, string> = { count: "행 수", sum: "합계", avg: "평균", min: "최솟값", max: "최댓값" };
export const KIND_LABEL: Record<ChartKind, string> = { bar: "가로 막대(많은 순)", line: "선(가로축 순서대로)", histogram: "분포(숫자 구간별 행 수)" };
export const FILTER_OPS: FilterOp[] = ["eq", "ne", "gt", "ge", "lt", "le", "contains", "empty", "notEmpty"];
export const MAX_LIMIT = 50;
export const HIST_BINS = 20;
const LINE_LIMIT = 500;

export interface Dialect {
  name: "duckdb" | "mysql";
  ident: (name: string) => string;
  text: (expr: string) => string; // 글자로 바꾸기
  number: (expr: string) => string; // 숫자로 바꾸기(안 되면 NULL)
}

export const DUCKDB: Dialect = {
  name: "duckdb",
  ident: (n) => `"${n.replace(/"/g, '""')}"`,
  text: (e) => `CAST(${e} AS VARCHAR)`,
  number: (e) => `TRY_CAST(${e} AS DOUBLE)`,
};

export const MYSQL: Dialect = {
  name: "mysql",
  ident: (n) => `\`${n.replace(/`/g, "``")}\``,
  text: (e) => `CAST(${e} AS CHAR)`,
  // MySQL은 숫자가 아닌 글자를 0으로 바꾸므로 숫자 모양일 때만 바꾼다.
  number: (e) => `(CASE WHEN CAST(${e} AS CHAR) REGEXP '^-?[0-9]+(\\\\.[0-9]+)?$' THEN CAST(${e} AS DECIMAL(30,6)) END)`,
};

const isNumber = (v: string) => /^-?\d+(\.\d+)?$/.test(v.trim().replace(/,/g, ""));

export function filterSql(d: Dialect, f: SpecFilter, lit: (v: string) => string) {
  const col = d.ident(f.column);
  const text = d.text(col);
  const v = f.value.trim();
  const n = v.replace(/,/g, "");
  switch (f.op) {
    case "empty":
      return `(${col} IS NULL OR TRIM(${text}) = '')`;
    case "notEmpty":
      return `(${col} IS NOT NULL AND TRIM(${text}) <> '')`;
    case "contains":
      // MySQL은 \가 기본 이스케이프 글자이고, DuckDB는 ESCAPE로 정해야 한다.
      return `LOWER(${text}) LIKE ${lit(`%${v.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`)}${d.name === "duckdb" ? " ESCAPE '\\'" : ""}`;
    case "eq":
    case "ne": {
      const same = isNumber(v) ? `(${text} = ${lit(v)} OR ${d.number(col)} = ${Number(n)})` : `(${text} = ${lit(v)})`;
      return f.op === "eq" ? same : `(${col} IS NULL OR NOT ${same})`;
    }
    default: {
      const op = { gt: ">", ge: ">=", lt: "<", le: "<=" }[f.op];
      return isNumber(v) ? `${d.number(col)} ${op} ${Number(n)}` : `${text} ${op} ${lit(v)}`;
    }
  }
}

export function whereSql(d: Dialect, filters: SpecFilter[], lit: (v: string) => string) {
  const parts = filters.filter((f) => FILTER_OPS.includes(f.op) && (f.op === "empty" || f.op === "notEmpty" || f.value.trim() !== "")).map((f) => filterSql(d, f, lit));
  return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
}

function measureSql(d: Dialect, spec: ChartSpec) {
  if (spec.measure === "count" || !spec.y) return "COUNT(*)";
  const fn = { sum: "SUM", avg: "AVG", min: "MIN", max: "MAX" }[spec.measure];
  return `${fn}(${d.number(d.ident(spec.y))})`;
}

// 차트 하나를 그리는 데 필요한 질의들. run은 (sql) → 행 배열. 테이블 이름은 호출하는 쪽이 이미 확인해 넘긴다.
export async function runChart(d: Dialect, from: string, spec: ChartSpec, lit: () => (v: string) => string, run: (sql: string, lit: (v: string) => string) => Promise<unknown[][]>): Promise<ChartResult> {
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(spec.limit) || 20));
  const total = async () => {
    const l = lit();
    const r = await run(`SELECT COUNT(*) FROM ${from} ${whereSql(d, spec.filters, l)}`, l);
    return Number(r[0]?.[0] ?? 0);
  };
  const x = d.ident(spec.x);
  if (spec.kind === "histogram") {
    const l1 = lit();
    const where1 = whereSql(d, spec.filters, l1);
    const range = await run(`SELECT MIN(${d.number(x)}), MAX(${d.number(x)}), COUNT(*) FROM ${from} ${where1}`, l1);
    const [min, max, rows] = (range[0] ?? []).map((v) => (v === null || v === undefined ? null : Number(v)));
    if (min === null || max === null) return { points: [], rows: rows ?? 0 };
    const width = max === min ? 1 : (max - min) / HIST_BINS;
    const l2 = lit();
    const where2 = whereSql(d, spec.filters, l2);
    const bucket = `LEAST(${HIST_BINS - 1}, FLOOR((${d.number(x)} - ${min}) / ${width}))`;
    const r = await run(`SELECT ${bucket} AS b, COUNT(*) FROM ${from} ${where2 ? `${where2} AND` : "WHERE"} ${d.number(x)} IS NOT NULL GROUP BY b ORDER BY b`, l2);
    const counts = new Map(r.map((row) => [Number(row[0]), Number(row[1])]));
    const bins = max === min ? 1 : HIST_BINS;
    const points = Array.from({ length: bins }, (_, i) => {
      const a = min + i * width;
      const b = i === bins - 1 ? max : min + (i + 1) * width;
      return { label: `${fmt(a)}~${fmt(b)}`, value: counts.get(i) ?? 0, from: a, to: b };
    });
    return { points, rows: rows ?? 0 };
  }
  const l = lit();
  const where = whereSql(d, spec.filters, l);
  const value = measureSql(d, spec);
  if (spec.kind === "line") {
    // 가로축은 숫자면 숫자 순서, 아니면 글자 순서로 놓는다.
    const r = await run(`SELECT ${d.text(x)} AS label, ${value} AS v, MIN(${d.number(x)}) AS n FROM ${from} ${where} GROUP BY ${d.text(x)} ORDER BY n, label LIMIT ${LINE_LIMIT}`, l);
    return { points: r.map((row) => ({ label: clean(row[0]), value: Number(row[1] ?? 0) })), rows: await total() };
  }
  const r = await run(`SELECT ${d.text(x)} AS label, ${value} AS v FROM ${from} ${where} GROUP BY ${d.text(x)} ORDER BY v DESC, label LIMIT ${limit + 1}`, l);
  const points = r.slice(0, limit).map((row) => ({ label: clean(row[0]), value: Number(row[1] ?? 0) }));
  let other: ChartResult["other"];
  if (r.length > limit) {
    // 잘라 낸 묶음 수와 그 값의 합(행 수, 합계일 때만 더할 수 있다)
    const lo = lit();
    const rest = await run(`SELECT COUNT(*), ${spec.measure === "count" || spec.measure === "sum" ? "SUM(v)" : "NULL"} FROM (SELECT ${d.text(x)} AS label, ${value} AS v FROM ${from} ${whereSql(d, spec.filters, lo)} GROUP BY ${d.text(x)} ORDER BY v DESC, label LIMIT 1000000 OFFSET ${limit}) t`, lo);
    other = { count: Number(rest[0]?.[0] ?? 0), value: Number(rest[0]?.[1] ?? NaN) };
  }
  return { points, other, rows: await total() };
}

const fmt = (n: number) => (Math.abs(n) >= 100 || Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(2));
const clean = (v: unknown) => (v === null || v === undefined ? "(비어 있음)" : String(v).replace(/^(-?\d+)\.0+$/, "$1"));

export function validSpec(spec: unknown, columns: string[]): ChartSpec | null {
  const s = spec as Partial<ChartSpec>;
  if (!s || !["bar", "line", "histogram"].includes(s.kind as string)) return null;
  if (typeof s.x !== "string" || !columns.includes(s.x)) return null;
  if (!["count", "sum", "avg", "min", "max"].includes(s.measure as string)) return null;
  if (s.measure !== "count" && (typeof s.y !== "string" || !columns.includes(s.y))) return null;
  const filters = Array.isArray(s.filters) ? s.filters : [];
  if (!filters.every((f) => f && typeof f.column === "string" && columns.includes(f.column) && FILTER_OPS.includes(f.op) && typeof f.value === "string" && f.value.length <= 200)) return null;
  return { kind: s.kind!, x: s.x, measure: s.measure!, y: s.measure === "count" ? undefined : s.y, filters, limit: Number(s.limit) || 20 };
}
