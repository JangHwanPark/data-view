import { runQuery } from "@/lib/client/duckdb";
import { qualifiedTable } from "@/lib/client/file-import";
import { tableKey } from "@/lib/client/schema";
import { quoteIdent, quoteString, type QueryColumn } from "@/lib/query-result";

export interface TableRef {
  sourceId: string;
  table: string;
}

export interface ColumnRef extends TableRef {
  column: string;
}

// 쓰는 쪽(설계 4.8). column은 대표 열(첫 열)이라 예전 관계와 그대로 맞는다. 게임 테이블의 네 가지 참조 방식을 다룬다.
// - 단일 열: { column: "item_id" }
// - 번호 붙은 여러 열: { column: "material_id_1", columns: ["material_id_1", ..., "material_id_5"] }
// - 한 칸에 여러 ID: { column: "skill_ids", separator: "|" }
// - 타입+ID: { column: "reward_id", when: { column: "reward_type", value: "ITEM" } }
export interface FromSide extends ColumnRef {
  columns?: string[];
  separator?: string;
  when?: { column: string; value: string };
}

// from이 to를 가리킨다. 예: 주문.고객ID -> 고객.ID
export interface Relation {
  id: string;
  from: FromSide;
  to: ColumnRef;
}

export function fromColumns(from: FromSide) {
  return from.columns?.length ? from.columns : [from.column];
}

// 단일 열이 아닌 참조 방식인지. 붙여 보기처럼 아직 단일 열만 다루는 화면이 거른다.
export function isExtended(from: FromSide) {
  return fromColumns(from).length > 1 || !!from.separator || !!from.when;
}

// 화면에 쓰는 쓰는 쪽 이름. "material_id_1~5", "skill_ids(|로 나눔)", "reward_id(reward_type이 ITEM일 때)"
export function fromLabel(from: FromSide) {
  const cols = fromColumns(from);
  let label = cols.length > 1 ? `${cols[0]} 외 ${cols.length - 1}개 열` : cols[0];
  if (from.separator) label += `(${from.separator}로 나눔)`;
  if (from.when) label += `(${from.when.column}이 ${from.when.value}일 때)`;
  return label;
}

// 값 비교 기준. 글자로 바꾸고 앞뒤 공백과 엑셀이 붙이는 .0을 뗀다(800.0 → 800).
export const normSql = (expr: string) => `regexp_replace(trim(CAST(${expr} AS VARCHAR)), '\\.0+$', '')`;

// 쓰는 쪽 한 행이 쓰는 값들의 목록 식. 번호 붙은 열은 모아서, 구분자가 있으면 나눠서 하나의 목록으로 만든다.
function fromListSql(from: FromSide) {
  const parts = fromColumns(from).map((c) => {
    const col = quoteIdent(c);
    return from.separator ? `string_split(CAST(${col} AS VARCHAR), ${quoteString(from.separator)})` : `[CAST(${col} AS VARCHAR)]`;
  });
  return parts.length === 1 ? parts[0] : `flatten([${parts.join(", ")}])`;
}

function whenSql(from: FromSide) {
  return from.when ? `CAST(${quoteIdent(from.when.column)} AS VARCHAR) = ${quoteString(from.when.value)}` : "true";
}

// 쓰는 쪽이 쓰는 값을 한 줄에 하나씩 펼친 표(열 이름 v). 빈 값은 버린다. 일치 확인, 없는 ID 찾기가 이 표로 센다.
export function fromValuesSql(from: FromSide) {
  return `SELECT v FROM (
    SELECT ${normSql("x")} AS v FROM (SELECT UNNEST(${fromListSql(from)}) AS x FROM ${qualifiedTable(from.sourceId, from.table)} WHERE ${whenSql(from)})
  ) WHERE v IS NOT NULL AND v <> ''`;
}

// 쓰는 쪽 테이블에서 이 값을 쓰는 행만 고르는 조건. 따라가기의 "이 값을 쓰는 행"과 값 설명의 "쓰이는 곳"이 쓴다.
export function fromMatchWhere(from: FromSide, value: string) {
  const v = value.trim().replace(/\.0+$/, "");
  return `(${whenSql(from)} AND list_contains(list_transform(${fromListSql(from)}, x -> ${normSql("x")}), ${quoteString(v)}))`;
}

export interface RelationStats {
  fromDistinct: number; // from 컬럼의 고유값 수 (null 제외)
  matched: number; // 그중 to 컬럼에 있는 값 수
  toUnique: boolean; // to 컬럼 값이 유일한지
  fromRows: number; // from 컬럼의 값이 있는 행 수
  matchedRows: number; // 그중 to 컬럼에 값이 있는 행 수
}

export function newRelationId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

export function sameEndpoints(a: Pick<Relation, "from" | "to">, b: Pick<Relation, "from" | "to">) {
  const eq = (x: ColumnRef, y: ColumnRef) =>
    x.sourceId === y.sourceId && x.table === y.table && x.column === y.column;
  // 같은 열이라도 타입 조건이나 묶은 열, 구분자가 다르면 다른 연결이다(reward_id → Item과 reward_id → Currency).
  const extra = (f: FromSide) => JSON.stringify([fromColumns(f), f.separator ?? "", f.when ?? null]);
  return eq(a.from, b.from) && eq(a.to, b.to) && extra(a.from) === extra(b.from);
}

// 숫자 1과 문자 "1"을 같은 값으로 보도록 문자열로 맞춰 비교한다.
// 번호 붙은 열, 한 칸 여러 ID, 타입+ID도 값을 펼쳐서 센다. 이때 "행"은 펼친 값 하나하나다.
export async function relationStats(from: FromSide, to: ColumnRef): Promise<RelationStats> {
  const t = quoteIdent(to.column);
  const result = await runQuery(
    `WITH f AS (
       SELECT v, count(*) AS n FROM (${fromValuesSql(from)}) GROUP BY 1
     ), t AS (
       SELECT ${normSql(t)} AS v FROM ${qualifiedTable(to.sourceId, to.table)} WHERE ${t} IS NOT NULL
     )
     SELECT
       (SELECT count(*) FROM f),
       (SELECT count(*) FROM f WHERE v IN (SELECT v FROM t)),
       (SELECT count(*) FROM t),
       (SELECT count(DISTINCT v) FROM t),
       (SELECT CAST(coalesce(sum(n), 0) AS BIGINT) FROM f),
       (SELECT CAST(coalesce(sum(n), 0) AS BIGINT) FROM f WHERE v IN (SELECT v FROM t))`,
    1,
  );
  const [fromDistinct, matched, toCount, toDistinct, fromRows, matchedRows] = (result.rows[0] ?? []).map(Number);
  return { fromDistinct, matched, toUnique: toCount === toDistinct, fromRows, matchedRows };
}

export function coverage(stats: RelationStats) {
  return stats.fromDistinct === 0 ? 0 : stats.matched / stats.fromDistinct;
}

// 행 기준 일치율. sum()은 128비트 정수라 그대로 읽으면 숫자로 바뀌지 않으므로 쿼리에서 BIGINT로 바꿔 읽는다. 등급처럼 값 종류가 적은 테이블을 가리킬 때는 깨진 ID 몇 개만 섞여도 고유값 기준 일치율이 크게 떨어진다.
// (등급 6개 + 깨진 ID 24개 → 고유값 기준 20%, 행 기준 99%)
export function rowCoverage(stats: RelationStats) {
  const ratio = stats.fromRows === 0 ? 0 : stats.matchedRows / stats.fromRows;
  // 값을 못 읽었으면 NaN이 되는데, NaN은 어떤 기준과 비교해도 걸러지지 않아 모든 후보가 통과한다. 0으로 본다.
  return Number.isFinite(ratio) ? ratio : 0;
}

export interface Suggestion {
  from: ColumnRef;
  to: ColumnRef;
  stats: RelationStats;
  nameMatch: boolean;
  weak: boolean;
}

interface ColumnProfile {
  ref: ColumnRef;
  rows: number;
  nonNull: number;
  distinct: number;
  sequence: boolean; // 1, 2, 3...처럼 빈틈없이 이어지는 정수인지
}

const KEYABLE = new Set<QueryColumn["type"]>(["string", "number"]);
const MIN_COVERAGE = 0.9;

// 이름이 달라도 찾을 수 있도록 값으로 추천한다.
// 1) 값이 유일하고 null이 없는 컬럼을 키 후보로 잡는다.
// 2) 다른 테이블의 컬럼 중 고유값의 90% 이상이 키 후보에 있는 것을 고른다.
export async function suggestRelations(
  tables: TableRef[],
  columns: Map<string, QueryColumn[]>,
  existing: Relation[],
): Promise<Suggestion[]> {
  const profiles: ColumnProfile[] = [];
  for (const table of tables) {
    const cols = (columns.get(tableKey(table.sourceId, table.table)) ?? []).filter((c) => KEYABLE.has(c.type));
    if (cols.length === 0) continue;
    const select = cols
      .map((c) => {
        const q = quoteIdent(c.name);
        // 숫자 열은 정수 연번인지 보려고 최소, 최대, 소수 여부를 같이 구한다.
        const range =
          c.type === "number"
            ? `min(${q}), max(${q}), bool_and(${q} = floor(${q}))`
            : "NULL, NULL, NULL";
        return `count(${q}), count(DISTINCT ${q}), ${range}`;
      })
      .join(", ");
    const result = await runQuery(
      `SELECT count(*), ${select} FROM ${qualifiedTable(table.sourceId, table.table)}`,
      1,
    );
    const row = result.rows[0] ?? [];
    cols.forEach((c, i) => {
      const base = 1 + i * 5;
      const [nonNull, distinct, min, max, integral] = row.slice(base, base + 5);
      profiles.push({
        ref: { ...table, column: c.name },
        rows: Number(row[0]),
        nonNull: Number(nonNull),
        distinct: Number(distinct),
        sequence: integral === true && Number(max) - Number(min) + 1 === Number(distinct),
      });
    });
  }

  const keys = profiles.filter((p) => p.rows > 0 && p.nonNull === p.rows && p.distinct === p.rows);
  const suggestions: Suggestion[] = [];

  for (const key of keys) {
    for (const col of profiles) {
      if (col.ref.sourceId === key.ref.sourceId && col.ref.table === key.ref.table) continue;
      // 같은 데이터를 파일과 DB로 둘 다 열면 같은 이름의 테이블끼리 값이 100% 겹친다. 복사본끼리는 비교하지 않는다.
      if (col.ref.table === key.ref.table) continue;
      if (col.distinct === 0) continue;
      // 키 후보에 있는 값 수보다 고유값이 훨씬 많으면 90%를 넘을 수 없다.
      if (key.distinct < col.distinct * MIN_COVERAGE) continue;
      if (existing.some((r) => sameEndpoints(r, { from: col.ref, to: key.ref }))) continue;

      const nameMatch = namesMatch(col.ref, key.ref);
      // 양쪽 다 1부터 매긴 행 번호 같은 컬럼이면 우연히 겹친다.
      // from도 유일한 컬럼이면 이름이 맞을 때만 추천한다.
      const fromIsKey = col.nonNull === col.rows && col.distinct === col.rows;
      if (fromIsKey && !nameMatch) continue;

      const stats = await relationStats(col.ref, key.ref);
      if (coverage(stats) < MIN_COVERAGE) continue;
      // 키가 1부터 매긴 번호면 수량 같은 작은 정수 열도 우연히 다 들어간다.
      // 이름까지 맞지 않으면 버리지 않고 가능성 낮음으로 표시한다.
      const weak = key.sequence && !nameMatch;
      suggestions.push({ from: col.ref, to: key.ref, stats, nameMatch, weak });
    }
  }

  return suggestions.sort(
    (a, b) =>
      Number(a.weak) - Number(b.weak) ||
      Number(b.nameMatch) - Number(a.nameMatch) ||
      coverage(b.stats) - coverage(a.stats),
  );
}

// "고객ID", "customer_id" 같은 이름에서 키 접미사를 떼고 비교한다.
function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/(id|no|code|key|번호|코드|아이디)$/u, "");
}

function namesMatch(from: ColumnRef, to: ColumnRef) {
  const f = normalizeName(from.column);
  if (!f) return false;
  const t = normalizeName(to.column);
  return f === t || f === normalizeName(to.table);
}

// 내보내기 파일 형식. 소스는 이름으로 다시 맞춘다.
export interface RelationsExport {
  app: "data-view";
  version: 1;
  sources: { id: string; name: string }[];
  relations: Relation[];
}

export function buildExport(relations: Relation[], sources: { id: string; name: string }[]): RelationsExport {
  const used = new Set(relations.flatMap((r) => [r.from.sourceId, r.to.sourceId]));
  return {
    app: "data-view",
    version: 1,
    sources: sources.filter((s) => used.has(s.id)),
    relations,
  };
}

export function parseExport(text: string): RelationsExport {
  const data = JSON.parse(text) as Partial<RelationsExport>;
  if (data.app !== "data-view" || data.version !== 1 || !Array.isArray(data.relations) || !Array.isArray(data.sources)) {
    throw new Error("data-view에서 내보낸 연결 파일이 아닙니다.");
  }
  return data as RelationsExport;
}

// 가져온 관계의 소스 id를 지금 소스 id로 바꾼다. 매핑이 없는 소스를 쓰는 관계는 버린다.
export function remapRelations(data: RelationsExport, mapping: Record<string, string>, existing: Relation[]) {
  const added: Relation[] = [];
  let skipped = 0;
  for (const rel of data.relations) {
    const fromId = mapping[rel.from.sourceId];
    const toId = mapping[rel.to.sourceId];
    if (!fromId || !toId) {
      skipped++;
      continue;
    }
    const next: Relation = {
      id: newRelationId(),
      from: { ...rel.from, sourceId: fromId },
      to: { ...rel.to, sourceId: toId },
    };
    if ([...existing, ...added].some((r) => sameEndpoints(r, next))) {
      skipped++;
      continue;
    }
    added.push(next);
  }
  return { added, skipped };
}
