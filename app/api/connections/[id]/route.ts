import { deleteConnection, getConnection } from "@/server/connections";
import { errorResponse, rejectCrossOrigin } from "@/server/http";

export async function DELETE(request: Request, ctx: RouteContext<"/api/connections/[id]">) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const { id } = await ctx.params;
  if (!getConnection(id)) return errorResponse(404, "NOT_FOUND", "저장된 DB 접속 정보를 찾을 수 없습니다. 다시 연결해 주세요.");
  deleteConnection(id);
  return new Response(null, { status: 204 });
}
