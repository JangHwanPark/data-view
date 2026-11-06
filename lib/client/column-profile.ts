import { runQuery } from "@/lib/client/duckdb";
import { isMemoColumn, qualifiedTable } from "@/lib/client/file-import";
import { mostlyUnique, quoteIdent } from "@/lib/query-result";

// 테이블 열 정보 줄(설계 6.2). 열마다 채워진 칸, 빈 칸 비율, 값 종류 수, ID 열인지를 센다.
// 테이블 하나에 쿼리 한 번으로 모든 열을 센다. 자주 나오는 값과 최솟값·최댓값은 머리글에 마우스를 올렸을 때만 구한다.

export interface ColumnProfile {
  column: string;
  rows: number; // 전체 행 수
  filled: number; // 값이 있는 칸 수(빈 글자 제외)
  distinct: number; // 값 종류 수
  isId: boolean; // 값이 모두 다르고 빈 칸이 없음(98% 기준). ID 열로 볼 수 있다
}

export interface ColumnDetail {
  top: { value: string; count: number }[]; // 자주 나오는 값
  min: string | null;
  max: string | null;
  numeric: boolean;
}

const cache = new Map<string, Promise<Map<string, ColumnProfile>>>();

// version이 바뀌면(파일 교체) 다시 센다.
export function profileColumns(sourceId: string, table: string, columns: string[], version: string) {
  const key = `${version}|${sourceId}/${table}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      (async () => {
        const from = qualifiedTable(sourceId, table);
        const parts = columns.flatMap((c) => {
          const q = quoteIdent(c);
          // 빈 글자("")도 빈 칸으로 센다. 엑셀에서 지운 칸이 빈 글자로 남는 일이 많다.
          return [
            `CAST(count(CASE WHEN ${q} IS NOT NULL AND trim(CAST(${q} AS VARCHAR)) <> '' THEN 1 END) AS BIGINT)`,
            `CAST(count(DISTINCT ${q}) AS BIGINT)`,
          ];
        });
        const r = await runQuery(`SELECT CAST(count(*) AS BIGINT), ${parts.join(", ")} FROM ${from}`, 1);
        const row = (r.rows[0] ?? []).map(Number);
        const rows = row[0] ?? 0;
        const map = new Map<string, ColumnProfile>();
        columns.forEach((c, i) => {
          const filled = row[1 + i * 2] ?? 0;
          const distinct = row[2 + i * 2] ?? 0;
          // # 메모 열(#이름)은 값이 모두 달라도 ID가 아니다.
          map.set(c, { column: c, rows, filled, distinct, isId: !isMemoColumn(sourceId, table, c) && mostlyUnique(rows, distinct, filled) });
        });
        return map;
      })(),
    );
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  return cache.get(key)!;
}

const detailCache = new Map<string, Promise<ColumnDetail>>();

export function columnDetail(sourceId: string, table: string, column: string, version: string) {
  const key = `${version}|${sourceId}/${table}|${column}`;
  if (!detailCache.has(key)) {
    detailCache.set(
      key,
      (async () => {
        const from = qualifiedTable(sourceId, table);
        const q = quoteIdent(column);
        const top = await runQuery(
          `SELECT CAST(${q} AS VARCHAR) AS v, CAST(count(*) AS BIGINT) AS n FROM ${from}
           WHERE ${q} IS NOT NULL AND trim(CAST(${q} AS VARCHAR)) <> '' GROUP BY 1 ORDER BY n DESC, v LIMIT 5`,
          5,
        );
        // 숫자로 읽히는 값이 대부분이면 숫자 기준으로 최솟값과 최댓값을 구한다.
        const range = await runQuery(
          `SELECT CAST(min(TRY_CAST(${q} AS DOUBLE)) AS VARCHAR), CAST(max(TRY_CAST(${q} AS DOUBLE)) AS VARCHAR),
                  CAST(count(TRY_CAST(${q} AS DOUBLE)) AS BIGINT), CAST(count(${q}) AS BIGINT),
                  min(CAST(${q} AS VARCHAR)), max(CAST(${q} AS VARCHAR))
           FROM ${from}`,
          1,
        );
        const [nmin, nmax, ncount, count, smin, smax] = range.rows[0] ?? [];
        const numeric = Number(ncount) > 0 && Number(ncount) >= Number(count) * 0.98;
        const clean = (v: unknown) => (v === null || v === undefined ? null : String(v).replace(/^(-?\d+)\.0+$/, "$1"));
        return {
          top: top.rows.map(([v, n]) => ({ value: clean(v) ?? "", count: Number(n) })),
          min: numeric ? clean(nmin) : clean(smin),
          max: numeric ? clean(nmax) : clean(smax),
          numeric,
        };
      })(),
    );
    if (detailCache.size > 500) detailCache.delete(detailCache.keys().next().value!);
  }
  return detailCache.get(key)!;
}

const exampleCache = new Map<string, Promise<Map<string, string[]>>>();

// 컬럼 표(24단계)의 값 예시. 열마다 서로 다른 값 3개를 한 번의 쿼리로 구한다.
export function columnExamples(sourceId: string, table: string, columns: string[], version: string) {
  const key = `${version}|${sourceId}/${table}`;
  if (!exampleCache.has(key)) {
    exampleCache.set(
      key,
      (async () => {
        const map = new Map<string, string[]>();
        if (!columns.length) return map;
        const parts = columns.map((c) => {
          const v = `CAST(${quoteIdent(c)} AS VARCHAR)`;
          // 값 사이 구분자는 값에 거의 나오지 않는 글자(0x1F)를 쓴다.
          return `array_to_string(list_slice(list(DISTINCT ${v}) FILTER (WHERE ${v} IS NOT NULL AND trim(${v}) <> ''), 1, 3), chr(31))`;
        });
        const r = await runQuery(`SELECT ${parts.join(", ")} FROM ${qualifiedTable(sourceId, table)}`, 1);
        const row = r.rows[0] ?? [];
        columns.forEach((c, i) => {
          const raw = row[i];
          map.set(c, raw === null || raw === undefined || raw === "" ? [] : String(raw).split("\u001f").map((x) => x.replace(/^(-?\d+)\.0+$/, "$1")));
        });
        return map;
      })(),
    );
    if (exampleCache.size > 200) exampleCache.delete(exampleCache.keys().next().value!);
  }
  return exampleCache.get(key)!;
}
