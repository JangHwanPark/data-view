import { deleteConnection, getConnection } from "@/lib/server/connections";
import { errorResponse, rejectCrossOrigin } from "@/lib/server/http";

export async function DELETE(request: Request, ctx: RouteContext<"/api/connections/[id]">) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  const { id } = await ctx.params;
  if (!getConnection(id)) return errorResponse(404, "NOT_FOUND", "연결을 찾을 수 없습니다.");
  deleteConnection(id);
  return new Response(null, { status: 204 });
}
