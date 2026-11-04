import { runQuery } from "@/lib/client/duckdb";
import { qualifiedTable } from "@/lib/client/file-import";
import type { ColumnRef } from "@/lib/client/relations";
import { quoteIdent } from "@/lib/query-result";

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
export async function findMissing(from: ColumnRef, to: ColumnRef): Promise<MissingResult> {
  const fc = quoteIdent(from.column);
  const tc = quoteIdent(to.column);
  const result = await runQuery(
    `WITH t AS (
       SELECT DISTINCT CAST(${tc} AS VARCHAR) AS v FROM ${qualifiedTable(to.sourceId, to.table)} WHERE ${tc} IS NOT NULL
     ), tn AS (
       SELECT DISTINCT TRY_CAST(${tc} AS DOUBLE) AS d FROM ${qualifiedTable(to.sourceId, to.table)} WHERE TRY_CAST(${tc} AS DOUBLE) IS NOT NULL
     ), f AS (
       SELECT CAST(${fc} AS VARCHAR) AS v, TRY_CAST(${fc} AS DOUBLE) AS d, count(*) AS n
       FROM ${qualifiedTable(from.sourceId, from.table)}
       WHERE ${fc} IS NOT NULL AND trim(CAST(${fc} AS VARCHAR)) <> ''
       GROUP BY 1, 2
     ), m AS (
       SELECT v, n FROM f
       WHERE v NOT IN (SELECT v FROM t) AND (d IS NULL OR d NOT IN (SELECT d FROM tn))
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
