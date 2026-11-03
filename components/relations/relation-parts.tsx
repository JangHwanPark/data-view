import type { WorkspaceSource } from "@/components/workspace-provider";
import { coverage, type ColumnRef, type RelationStats } from "@/lib/client/relations";
import { tableKey } from "@/lib/client/schema";
import type { QueryColumn } from "@/lib/query-result";

export function endpointExists(ref: ColumnRef, columns: Map<string, QueryColumn[]>) {
  return columns.get(tableKey(ref.sourceId, ref.table))?.some((c) => c.name === ref.column) ?? false;
}

export function ColumnLabel({ refValue, sources }: { refValue: ColumnRef; sources: WorkspaceSource[] }) {
  const source = sources.find((s) => s.meta.id === refValue.sourceId);
  return (
    <span className="min-w-0 break-all">
      <span className="text-zinc-500">{source?.meta.name ?? "삭제된 파일"} / </span>
      <span>{refValue.table}</span>
      <span className="text-zinc-500">.</span>
      <span className="font-medium">{refValue.column}</span>
    </span>
  );
}

// 일치율이 낮거나 대상 값이 중복이면 키를 잘못 골랐을 가능성이 크다.
export function StatsText({ stats }: { stats: RelationStats }) {
  const ratio = coverage(stats);
  const percent = Math.round(ratio * 1000) / 10;
  const low = ratio < 0.5;
  return (
    <p className="text-xs text-zinc-500">
      <span className={low ? "font-medium text-red-600" : ""}>
        값 {stats.fromDistinct.toLocaleString()}개 중 {stats.matched.toLocaleString()}개({percent}%)가 대상에 있습니다.
      </span>{" "}
      {stats.toUnique ? (
        "대상 값은 모두 유일합니다."
      ) : (
        <span className="text-amber-700 dark:text-amber-400">
          대상 열에 중복 값이 있어 한 값이 여러 행으로 이어집니다.
        </span>
      )}
      {low && " 키 열을 다시 확인해 주세요."}
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
