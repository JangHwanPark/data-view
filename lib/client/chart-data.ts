import { DUCKDB, runChart, type ChartResult, type ChartSpec } from "@/lib/chart-spec";
import { runQuery } from "@/lib/client/duckdb";
import { qualifiedTable } from "@/lib/client/file-import";
import { requestJson } from "@/lib/client/db-import";
import { quoteString } from "@/lib/query-result";

// 차트 값 구하기(32단계). 불러온 데이터(DuckDB 스냅샷)나 개발 DB(실시간)에 같은 모양으로 묻는다.

export interface ChartData extends ChartResult {
  live: boolean;
  queriedAt: string;
  ms: number;
}

// liveConnection이 있으면 개발 DB에 바로 묻는다(DB 소스의 연결 id).
export async function loadChart(sourceId: string, table: string, spec: ChartSpec, liveConnection: string | null): Promise<ChartData> {
  const started = performance.now();
  if (liveConnection) {
    const r = await requestJson<{ chart: ChartResult; queriedAt: string; ms: number }>(`/api/connections/${liveConnection}/query`, {
      method: "POST",
      body: JSON.stringify({ table, chart: spec }),
    });
    return { ...r.chart, live: true, queriedAt: r.queriedAt, ms: r.ms };
  }
  const result = await runChart(DUCKDB, qualifiedTable(sourceId, table), spec, () => quoteString, async (sql) => (await runQuery(sql, 100_000)).rows);
  return { ...result, live: false, queriedAt: new Date().toISOString(), ms: Math.round(performance.now() - started) };
}

// 개발 DB에서 지금 행을 읽는다(데이터 보기의 「DB에서 지금 값 보기」).
export function loadLiveRows(connectionId: string, table: string, filters: ChartSpec["filters"], limit = 200) {
  return requestJson<{ columns: { name: string; dataType: string }[]; rows: unknown[][]; truncated: boolean; queriedAt: string; ms: number }>(`/api/connections/${connectionId}/query`, {
    method: "POST",
    body: JSON.stringify({ table, rows: { filters, limit } }),
  });
}
