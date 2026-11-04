import type { WorkspaceSource } from "@/components/workspace-provider";
import { coverage, rowCoverage, type ColumnRef, type RelationStats, fromLabel, isExtended, type FromSide } from "@/lib/client/relations";
import { tableKey } from "@/lib/client/schema";
import type { QueryColumn } from "@/lib/query-result";

export function endpointExists(ref: ColumnRef, columns: Map<string, QueryColumn[]>) {
  return columns.get(tableKey(ref.sourceId, ref.table))?.some((c) => c.name === ref.column) ?? false;
}

// 쓰는 쪽이면 참조 방식(번호 붙은 열, 구분자, 종류 조건)까지 적는다.
export function ColumnLabel({ refValue, sources }: { refValue: ColumnRef | FromSide; sources: WorkspaceSource[] }) {
  const source = sources.find((s) => s.meta.id === refValue.sourceId);
  return (
    <span className="min-w-0 break-all">
      <span className="text-zinc-500">{source?.meta.name ?? "삭제된 파일"} / </span>
      <span>{refValue.table}</span>
      <span className="text-zinc-500">.</span>
      <span className="font-medium">{isExtended(refValue) ? fromLabel(refValue) : refValue.column}</span>
    </span>
  );
}

// 일치율이 낮거나 대상 값이 중복이면 키를 잘못 골랐을 가능성이 크다.
// 비율 대신 개수로 보여준다(설계 1.1). 행 기준 개수를 쓰고, 맞지 않는 개수를 따로 적는다.
export function StatsText({ stats }: { stats: RelationStats }) {
  const ratio = Math.max(coverage(stats), rowCoverage(stats));
  const low = ratio < 0.5;
  const total = stats.fromRows || stats.fromDistinct;
  const matched = stats.fromRows ? stats.matchedRows : stats.matched;
  const missing = total - matched;
  return (
    <p className="text-xs text-zinc-500">
      <span className={low ? "font-medium text-red-600" : ""}>
        {total.toLocaleString()}개 중 {matched.toLocaleString()}개 맞음
        {missing > 0 ? `, ${missing.toLocaleString()}개는 상대 테이블에 없는 ID` : ""}.
      </span>{" "}
      {stats.toUnique ? (
        "상대 테이블의 ID는 겹치지 않습니다."
      ) : (
        <span className="text-amber-700 dark:text-amber-400">상대 테이블에 같은 ID가 여러 줄 있어, 한 값이 여러 행으로 이어집니다.</span>
      )}
      {low && " 맞는 값이 적습니다. ID 열을 잘못 고르지 않았는지 확인해 주세요."}
    </p>
  );
}

export interface TableOption {
  key: string;
  sourceId: string;
  table: string;
  label: string;
}

export function tableOptions(sources: WorkspaceSource[]): TableOption[] {
  return sources.flatMap((s) =>
    s.tables.map((table) => ({
      key: tableKey(s.meta.id, table),
      sourceId: s.meta.id,
      table,
      label: sourceTableLabel(s, table),
    })),
  );
}

// CSV는 파일 이름만, 엑셀과 DB는 "소스 / 시트(테이블)"로 보여준다.
export function sourceTableLabel(source: WorkspaceSource | undefined, table: string) {
  if (!source) return table;
  return source.meta.kind === "csv" ? source.meta.name : `${source.meta.name} / ${table}`;
}
