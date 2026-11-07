"use client";

import Link from "next/link";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Link2 } from "lucide-react";
import type { QueryColumn } from "@/lib/query-result";

export interface TableNodeColumn extends QueryColumn {
  linked: boolean;
}

export type TableNodeData = {
  label: string;
  href: string;
  rowCount: number | null;
  columns: TableNodeColumn[];
  hiddenCount: number; // 접어 둔 열 수
};

export type TableNodeType = Node<TableNodeData, "table">;

// 열마다 왼쪽(가리켜지는 쪽)과 오른쪽(가리키는 쪽)에 연결점을 둔다.
// 오른쪽 점에서 다른 테이블의 왼쪽 점으로 끌면 관계가 만들어진다.
export function TableNodeView({ data }: NodeProps<TableNodeType>) {
  return (
    <div className="w-64 rounded-lg border border-zinc-300 bg-white text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-baseline gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
        <Link href={data.href} className="nodrag min-w-0 flex-1 truncate text-sm font-medium hover:underline" title={data.label}>
          {data.label}
        </Link>
        {data.rowCount !== null && (
          <span className="shrink-0 text-zinc-500">{data.rowCount.toLocaleString()}행</span>
        )}
      </div>
      <ul className="py-1">
        {data.columns.map((c) => (
          <li key={c.name} className="relative flex items-center gap-1.5 px-3 py-1">
            <Handle
              type="target"
              id={`t:${c.name}`}
              position={Position.Left}
              className="!size-2 !border-zinc-400 !bg-white dark:!bg-zinc-900"
            />
            {c.linked ? (
              <Link2 className="size-3 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden />
            ) : (
              <span className="size-3 shrink-0" />
            )}
            <span className={`min-w-0 flex-1 truncate ${c.linked ? "font-medium" : "text-zinc-600 dark:text-zinc-400"}`}>
              {c.name}
            </span>
            <Handle
              type="source"
              id={`s:${c.name}`}
              position={Position.Right}
              className="!size-2 !border-zinc-400 !bg-white dark:!bg-zinc-900"
            />
          </li>
        ))}
        {data.hiddenCount > 0 && (
          <li className="px-3 py-1 text-zinc-400">참조 관계 없는 컬럼 {data.hiddenCount}개</li>
        )}
      </ul>
    </div>
  );
}
