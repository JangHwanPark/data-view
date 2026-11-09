import { MYSQL, runChart, validSpec, whereSql, type SpecFilter } from "@/shared/lib/chart-spec";
import { errorResponse, rejectCrossOrigin } from "@/server/http";
import { errorCode, listTables, withConnection } from "@/server/mysql";
import { resolveConnection } from "@/server/resolve-connection";

// DB 실시간 조회(32단계). 스냅샷이 아니라 개발 DB에 지금 바로 묻는다.
// SQL은 받지 않는다. 테이블과 컬럼은 DB 목록에 있는 것만, 값은 매개변수(?)로만 넣는다. 세션은 읽기 전용이고 30초를 넘으면 끊는다(withConnection).
//   { table, chart: ChartSpec }        차트 값
//   { table, rows: { filters, limit } } 지금 행(최대 500행)

const ROW_LIMIT = 500;

export async function POST(request: Request, ctx: RouteContext<"/api/connections/[id]/query">) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { table?: unknown; chart?: unknown; rows?: { filters?: unknown; limit?: unknown } } | null;
  if (!body || typeof body.table !== "string") return errorResponse(400, "BAD_REQUEST", "테이블을 정해 주세요.");
  const input = await resolveConnection(id);
  if (!input) return errorResponse(404, "NOT_FOUND", "저장된 DB 접속 정보를 찾을 수 없습니다. 다시 연결해 주세요.");
  try {
    const started = Date.now();
    const result = await withConnection(input, async (conn) => {
      const target = (await listTables(conn, input.database)).find((t) => t.name === body.table);
      if (!target) return { error: "NOT_FOUND" as const };
      const columns = target.columns.map((c) => c.name);
      const from = conn.escapeId(target.name);
      const run = async (sql: string, params: unknown[]) => {
        const [rows] = await conn.query({ sql, values: params, rowsAsArray: true });
        return rows as unknown[][];
      };
      if (body.chart !== undefined) {
        const spec = validSpec(body.chart, columns);
        if (!spec) return { error: "BAD_SPEC" as const };
        // lit()마다 매개변수 목록을 새로 만들어 질의 하나에 묶는다.
        const lists = new Map<(v: string) => string, unknown[]>();
        const lit = () => {
          const params: unknown[] = [];
          const fn = (v: string) => (params.push(v), "?");
          lists.set(fn, params);
          return fn;
        };
        return { chart: await runChart(MYSQL, from, spec, lit, (sql, l) => run(sql, lists.get(l) ?? [])) };
      }
      const raw = body.rows ?? {};
      const filters = (Array.isArray(raw.filters) ? raw.filters : []) as SpecFilter[];
      const fake = validSpec({ kind: "bar", x: columns[0], measure: "count", filters, limit: 1 }, columns);
      if (!fake) return { error: "BAD_SPEC" as const };
      const limit = Math.max(1, Math.min(ROW_LIMIT, Number(raw.limit) || 200));
      const params: unknown[] = [];
      const where = whereSql(MYSQL, fake.filters, (v) => (params.push(v), "?"));
      const rows = await run(`SELECT * FROM ${from} ${where} LIMIT ${limit + 1}`, params);
      return { columns: target.columns, rows: rows.slice(0, limit), truncated: rows.length > limit };
    });
    if ("error" in result) {
      return result.error === "NOT_FOUND" ? errorResponse(404, "NOT_FOUND", "테이블을 찾을 수 없습니다.") : errorResponse(400, "BAD_SPEC", "컬럼이나 조건이 이 테이블에 맞지 않습니다.");
    }
    return Response.json({ ...result, queriedAt: new Date().toISOString(), ms: Date.now() - started });
  } catch (e) {
    return errorResponse(502, errorCode(e), e instanceof Error ? e.message : String(e));
  }
}
