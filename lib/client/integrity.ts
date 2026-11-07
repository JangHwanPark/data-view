import { runQuery } from "@/lib/client/duckdb";
import { inactiveIds, qualifiedTable, tableRules, twinInactive } from "@/lib/client/file-import";
import { fromValuesSql, normSql, type ColumnRef, type FromSide } from "@/lib/client/relations";
import { quoteIdent, quoteString } from "@/lib/query-result";

// 참조 무결성 검사(설계 4.9). QA 화면 이름은 "없는 ID 찾기"다.
// - 없는 ID: 쓰는 쪽 열의 값이 대상 테이블의 ID 열에 없는 행(예: 지워진 아이템을 주는 보상)
// - 중복 ID: 다른 테이블이 쓰는 ID 열에 같은 값이 두 번 이상 있는 경우

export const TOP_LIMIT = 100;

export interface MissingResult {
  rows: number; // 없는 ID를 쓰는 행 수
  ids: number; // 없는 ID 종류 수
  top: { value: string; rows: number }[]; // 행 수가 많은 순서로 최대 100개
}

export interface DuplicateResult {
  values: number; // 두 번 이상 나온 값의 종류 수
  top: { value: string; rows: number }[];
}

// 숫자 열은 엑셀에서 800이 800.0으로 읽히기도 하므로 화면과 링크에는 정수 모양으로 보여준다.
export function cleanValue(v: unknown) {
  const s = String(v);
  return /^-?\d+\.0+$/.test(s) ? s.replace(/\.0+$/, "") : s;
}

// 값 비교는 따라가기, 연결 확인과 같은 기준이다. 글자로 바꿔 비교하고, 숫자면 숫자로도 비교해 800과 800.0을 같게 본다.
// 개수는 BIGINT로 바꿔 읽는다. DuckDB의 sum()과 count() over()는 128비트 정수라 그대로 읽으면 숫자가 되지 않는다.
export async function findMissing(from: FromSide, to: ColumnRef): Promise<MissingResult> {
  // 쓰는 쪽 값은 펼쳐서 센다(번호 붙은 열, 한 칸 여러 ID, 타입+ID). 비교는 글자로 바꾸고 .0을 뗀 값으로 한다.
  const tc = quoteIdent(to.column);
  const result = await runQuery(
    `WITH t AS (
       SELECT DISTINCT ${normSql(tc)} AS v FROM ${qualifiedTable(to.sourceId, to.table)} WHERE ${tc} IS NOT NULL
     ), f AS (
       SELECT v, count(*) AS n FROM (${fromValuesSql(from)}) GROUP BY 1
     ), m AS (
       SELECT v, n FROM f WHERE v NOT IN (SELECT v FROM t)
     )
     SELECT v, CAST(n AS BIGINT), CAST(sum(n) OVER () AS BIGINT), CAST(count(*) OVER () AS BIGINT)
     FROM m ORDER BY n DESC, v LIMIT ${TOP_LIMIT}`,
    TOP_LIMIT,
  );
  const first = result.rows[0];
  return {
    rows: first ? Number(first[2]) : 0,
    ids: first ? Number(first[3]) : 0,
    top: result.rows.map((r) => ({ value: cleanValue(r[0]), rows: Number(r[1]) })),
  };
}

// 비활성 행 참조(PLAN.md 29단계, 5-3). 쓰는 쪽 값이 대상 테이블에서 ;로 막아 둔(비활성) 행의 Id인 곳.
// 게임에서 쓰지 않는 행을 다른 테이블이 아직 쓰고 있다는 뜻이라, 없는 ID처럼 버그가 나기 쉽다.
// 대상이 DB나 CSV면 같은 이름의 엑셀 테이블에서 막아 둔 Id를 쓴다. 쓰는 쪽 행이 비활성이면(막아 둔 행끼리) 세지 않는다.
export function targetInactive(to: ColumnRef): string[] {
  const own = tableRules(to.sourceId, to.table) ? [...inactiveIds(to.sourceId, to.table)] : [...(twinInactive(to.sourceId, to.table)?.ids ?? [])];
  return own;
}

export async function findInactiveRefs(from: FromSide, to: ColumnRef): Promise<MissingResult | null> {
  const ids = targetInactive(to);
  if (!ids.length) return null;
  // 대상 ID 컬럼이 첫 컬럼일 때만 본다. ;는 첫 컬럼(Id)에 붙기 때문이다.
  const head = await runQuery(`SELECT * FROM ${qualifiedTable(to.sourceId, to.table)} LIMIT 0`, 0);
  if (head.columns[0]?.name !== to.column) return null;
  const fromHead = await runQuery(`SELECT * FROM ${qualifiedTable(from.sourceId, from.table)} LIMIT 0`, 0);
  const fromFirst = fromHead.columns[0]?.name;
  const fromOff = [...inactiveIds(from.sourceId, from.table)];
  const skip = fromFirst && fromOff.length ? `${normSql(quoteIdent(fromFirst))} NOT IN (${fromOff.map(quoteString).join(", ")})` : undefined;
  const result = await runQuery(
    `WITH f AS (SELECT v, count(*) AS n FROM (${fromValuesSql(from, skip)}) GROUP BY 1),
     m AS (SELECT v, n FROM f WHERE v IN (${ids.map(quoteString).join(", ")}))
     SELECT v, CAST(n AS BIGINT), CAST(sum(n) OVER () AS BIGINT), CAST(count(*) OVER () AS BIGINT)
     FROM m ORDER BY n DESC, v LIMIT ${TOP_LIMIT}`,
    TOP_LIMIT,
  );
  const first = result.rows[0];
  return {
    rows: first ? Number(first[2]) : 0,
    ids: first ? Number(first[3]) : 0,
    top: result.rows.map((r) => ({ value: cleanValue(r[0]), rows: Number(r[1]) })),
  };
}

export async function findDuplicates(ref: ColumnRef): Promise<DuplicateResult> {
  const c = quoteIdent(ref.column);
  const result = await runQuery(
    `SELECT CAST(${c} AS VARCHAR) AS v, CAST(count(*) AS BIGINT) AS n, CAST(count(*) OVER () AS BIGINT)
     FROM ${qualifiedTable(ref.sourceId, ref.table)}
     WHERE ${c} IS NOT NULL
     GROUP BY 1 HAVING count(*) > 1
     ORDER BY n DESC, v LIMIT ${TOP_LIMIT}`,
    TOP_LIMIT,
  );
  const first = result.rows[0];
  return {
    values: first ? Number(first[2]) : 0,
    top: result.rows.map((r) => ({ value: cleanValue(r[0]), rows: Number(r[1]) })),
  };
}
