"use client";

import { formatValue, LinkValue, SplitValues } from "@/components/cell-value";
import { ExplainCell, rowRecord, useExplainable } from "@/components/explain/value-explain";
import type { QueryResult } from "@/lib/query-result";

interface Props {
  result: QueryResult;
  linked?: Set<string>;
  highlighted?: (column: string, rowIndex: number) => boolean;
  onLinkClick?: (column: string, value: unknown) => void;
  sourceKey?: string; // 이 표의 테이블 키. 주면 값에 마우스를 올렸을 때 어떤 데이터인지 보여준다
  separators?: Map<string, string>; // 한 칸에 여러 ID를 넣는 열과 구분자
}

// 패널과 검색 결과에 쓰는 작은 표. 행이 적어서 가상 스크롤 없이 그린다.
export function RecordTable({ result, linked, highlighted, onLinkClick, sourceKey, separators }: Props) {
  const firstColumn = result.columns[0]?.name ?? null;
  const explainable = useExplainable(sourceKey, firstColumn);
  return (
    <div className="max-h-[60vh] overflow-auto">
      <table className="w-max min-w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800">
          <tr>
            {result.columns.map((c) => (
              <th key={c.name} className="border-b border-zinc-200 px-2 py-1 text-left font-medium dark:border-zinc-700">
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, r) => (
            <tr key={r} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
              {result.columns.map((c, i) => {
                const value = row[i];
                const text = formatValue(value, c.type);
                const isLink = linked?.has(c.name) && value !== null && onLinkClick;
                const explain = sourceKey && explainable(c.name, () => rowRecord(result.columns, row));
                const record = () => rowRecord(result.columns, row);
                const separator = value !== null ? separators?.get(c.name) : undefined;
                const one = (part: string) => {
                  const inner = isLink ? <LinkValue text={part} onClick={() => onLinkClick(c.name, part)} /> : part;
                  return explain ? (
                    <ExplainCell here={sourceKey} column={c.name} firstColumn={firstColumn} value={part} row={record}>
                      {inner}
                    </ExplainCell>
                  ) : (
                    inner
                  );
                };
                const content = separator ? (
                  <SplitValues text={text} separator={separator} render={one} />
                ) : isLink ? (
                  <LinkValue text={text} onClick={() => onLinkClick(c.name, value)} />
                ) : (
                  text
                );
                return (
                  <td
                    key={c.name}
                    className={`max-w-56 truncate px-2 py-1 ${
                      highlighted?.(c.name, r) ? "bg-amber-100 dark:bg-amber-900/40" : ""
                    } ${typeof value === "number" ? "text-right tabular-nums" : ""} ${value === null ? "text-zinc-400" : ""}`}
                    title={value === null || explain ? undefined : text}
                  >
                    {explain && !separator ? (
                      <ExplainCell here={sourceKey} column={c.name} firstColumn={firstColumn} value={value} row={record}>
                        {content}
                      </ExplainCell>
                    ) : (
                      content
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
