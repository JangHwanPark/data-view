"use client";

import { useRef } from "react";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatValue, LinkValue, SplitValues } from "@/components/cell-value";
import { ExplainCell, rowRecord, useExplainable } from "@/components/explain/value-explain";
import type { QueryColumn } from "@/lib/query-result";

type Row = unknown[];

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, Row>();

const ROW_HEIGHT = 28;
const COLUMN_WIDTH = 180;
const TYPE_LABEL: Record<QueryColumn["type"], string> = {
  string: "글자",
  number: "숫자",
  boolean: "참/거짓",
  date: "날짜",
  unknown: "기타",
};

// 렌더마다 새 배열을 만들지 않도록 결과가 바뀔 때 한 번만 호출한다.
export function buildColumns(columns: QueryColumn[]) {
  return helper.columns(
    columns.map((col, i) =>
      helper.accessor((row) => row[i], {
        id: String(i),
        header: col.name,
        cell: (info) => formatValue(info.getValue(), col.type),
      }),
    ),
  );
}

interface DataTableProps {
  columns: QueryColumn[];
  tableColumns: ReturnType<typeof buildColumns>;
  rows: Row[];
  linked?: Set<string>; // 관계가 걸린 열. 값을 눌러 따라갈 수 있다.
  onLinkClick?: (column: string, value: unknown) => void;
  sourceKey?: string; // 이 표의 테이블 키. 주면 값에 마우스를 올렸을 때 어떤 데이터인지 보여준다
  separators?: Map<string, string>; // 한 칸에 여러 ID를 넣는 열과 구분자. ID마다 따로 링크와 설명을 단다
}

export function DataTable({ columns, tableColumns, rows, linked, onLinkClick, sourceKey, separators }: DataTableProps) {
  const firstColumn = columns[0]?.name ?? null;
  const explainable = useExplainable(sourceKey, firstColumn);
  const table = useTable({ features, columns: tableColumns, data: rows });
  const scrollRef = useRef<HTMLDivElement>(null);
  const modelRows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: modelRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // 열이 적으면 남는 너비를 열끼리 나눠 본문을 채우고, 많으면 열마다 최소 너비를 지키며 가로로 스크롤한다.
  const gridTemplateColumns = `56px repeat(${columns.length}, minmax(${COLUMN_WIDTH}px, 1fr))`;

  return (
    <div
      ref={scrollRef}
      className="h-[calc(100vh-15rem)] min-h-80 overflow-auto rounded-md border border-zinc-200 bg-white text-[13px] dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div role="table" style={{ minWidth: 56 + columns.length * COLUMN_WIDTH }}>
        <div role="rowgroup" className="sticky top-0 z-10 bg-zinc-100 dark:bg-zinc-800">
          {table.getHeaderGroups().map((group) => (
            <div key={group.id} role="row" className="grid" style={{ gridTemplateColumns }}>
              <div role="columnheader" className="px-2 py-1 text-right text-xs text-zinc-400">
                #
              </div>
              {group.headers.map((header, i) => (
                <div
                  key={header.id}
                  role="columnheader"
                  className="border-l border-zinc-200 px-2 py-1 dark:border-zinc-700"
                >
                  <div className="truncate font-medium" title={columns[i]?.name}>
                    <table.FlexRender header={header} />
                  </div>
                  <div className="text-xs font-normal text-zinc-500">
                    {TYPE_LABEL[columns[i]?.type ?? "unknown"]}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = modelRows[item.index];
            return (
              <div
                key={row.id}
                role="row"
                className="absolute left-0 grid w-full border-t border-zinc-100 dark:border-zinc-800"
                style={{ gridTemplateColumns, height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
              >
                <div role="cell" className="px-2 py-1 text-right text-xs text-zinc-400">
                  {item.index + 1}
                </div>
                {row.getAllCells().map((cell) => {
                  const value = cell.getValue();
                  const column = columns[Number(cell.column.id)];
                  const isLink = column && linked?.has(column.name) && value !== null && onLinkClick;
                  const explain = sourceKey && column && explainable(column.name, () => rowRecord(columns, row.original));
                  const record = () => rowRecord(columns, row.original);
                  const separator = column && value !== null ? separators?.get(column.name) : undefined;
                  // 한 칸 여러 ID: ID마다 링크(누르면 그 ID로 따라가기)와 설명을 따로 단다.
                  const one = (part: string, partValue: unknown) => {
                    const inner = isLink ? <LinkValue text={part} onClick={() => onLinkClick(column.name, partValue)} /> : part;
                    return explain ? (
                      <ExplainCell here={sourceKey} column={column.name} firstColumn={firstColumn} value={partValue} row={record}>
                        {inner}
                      </ExplainCell>
                    ) : (
                      inner
                    );
                  };
                  const content = separator ? (
                    <SplitValues text={String(value)} separator={separator} render={(part) => one(part, part)} />
                  ) : isLink ? (
                    <LinkValue text={formatValue(value, column.type)} onClick={() => onLinkClick(column.name, value)} />
                  ) : (
                    <table.FlexRender cell={cell} />
                  );
                  return (
                    <div
                      key={cell.id}
                      role="cell"
                      title={value === null || explain ? undefined : String(value)}
                      className={`truncate border-l border-zinc-100 px-2 py-1 dark:border-zinc-800 ${
                        typeof value === "number" ? "text-right tabular-nums" : ""
                      } ${value === null ? "text-zinc-400" : ""}`}
                    >
                      {explain && !separator ? (
                        <ExplainCell here={sourceKey} column={column.name} firstColumn={firstColumn} value={value} row={record}>
                          {content}
                        </ExplainCell>
                      ) : (
                        content
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
