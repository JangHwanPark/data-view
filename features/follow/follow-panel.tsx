"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, X } from "lucide-react";
import { RecordTable } from "@/core/ui/record-table";
import { sourceTableLabel } from "@/features/relations";
import { useLinkedRelations } from "@/core/ui/use-auto-links";
import { useWorkspace } from "@/core/ui/workspace-provider";
import {
  columnSeparators,
  fetchLinkedRows,
  LINKED_ROW_LIMIT,
  linkedColumns,
  linksFor,
  toKeyValue,
  type Link,
  type TrailStep,
} from "@/core/follow";
import type { QueryResult } from "@/shared/lib/query-result";

interface Section {
  link: Link;
  result: QueryResult | null;
  error?: string;
}

interface Props {
  step: TrailStep;
  onFollow: (next: TrailStep) => void;
  onClose: () => void;
}

// 경로의 한 단계를 보여준다. 누른 값과 이어진 테이블마다 해당 행을 섹션으로 나눠 보여준다.
export function FollowPanel({ step, onFollow, onClose }: Props) {
  const { sources } = useWorkspace();
  // 저장한 관계에 자동으로 찾은 연결을 더해서 따라간다. 패널 안 표의 링크도 대상 테이블의 자동 연결까지 본다.
  const base = useLinkedRelations([{ sourceId: step.sourceId, table: step.table }]);
  const links = linksFor(step.sourceId, step.table, step.column, base.relations);
  const targetLinks = useLinkedRelations(links.map((l) => ({ sourceId: l.target.sourceId, table: l.target.table })));
  // 대상 파일이 아직 읽히는 중이면 조회하지 않는다.
  const readyIds = sources.filter((s) => s.status === "ready").map((s) => s.meta.id);
  const allReady = links.every((l) => readyIds.includes(l.target.sourceId));

  // 결과를 요청 키와 같이 저장하고, 키가 지금과 다르면 불러오는 중으로 본다.
  const requestKey = JSON.stringify([step, links.map((l) => `${l.relation.id}:${l.direction}`), allReady]);
  const [loaded, setLoaded] = useState<{ key: string; sections: Section[] } | null>(null);
  const sections = loaded?.key === requestKey ? loaded.sections : null;

  useEffect(() => {
    if (!allReady) return;
    let active = true;
    (async () => {
      const next: Section[] = [];
      for (const link of links) {
        try {
          next.push({ link, result: await fetchLinkedRows(link.target, step) });
        } catch (e) {
          next.push({ link, result: null, error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (active) setLoaded({ key: requestKey, sections: next });
    })();
    return () => {
      active = false;
    };
    // links와 step은 requestKey에 모두 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const origin = sources.find((s) => s.meta.id === step.sourceId);

  return (
    <div className="flex w-[420px] shrink-0 flex-col rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-zinc-500">{sourceTableLabel(origin, step.table)}</p>
          <p className="truncate text-sm">
            <span className="text-zinc-500">{step.column} = </span>
            <span className="font-medium">{step.value}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label="이 단계부터 닫기"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="flex flex-col gap-4 p-3">
        {links.length === 0 && (
          <p className="text-sm text-zinc-500">이 컬럼은 다른 테이블과 이어져 있지 않습니다. 확인한 참조 관계를 지웠을 수 있습니다.</p>
        )}
        {links.length > 0 && !sections && (
          <p className="inline-flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            불러오는 중...
          </p>
        )}
        {sections?.map(({ link, result, error }) => {
          const target = sources.find((s) => s.meta.id === link.target.sourceId);
          const Icon = link.direction === "out" ? ArrowRight : ArrowLeft;
          const linked = linkedColumns(link.target.sourceId, link.target.table, targetLinks.relations);
          return (
            <section key={`${link.relation.id}:${link.direction}`} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-sm">
                <Icon className="size-4 shrink-0 text-zinc-400" aria-hidden />
                <span className="min-w-0 truncate font-medium">{sourceTableLabel(target, link.target.table)}</span>
                <span className="shrink-0 text-xs text-zinc-500">
                  {link.direction === "out" ? "이 값이 가리키는 행" : "이 값을 참조하는 행"}
                  {result && `, ${result.rowCount}${result.truncated ? "+" : ""}행`}
                </span>
              </div>
              {error && <p className="text-xs text-red-600">행을 읽지 못했습니다.</p>}
              {/* 가리키는 대상이 없으면 깨진 참조라 경고하고, 이 값을 가리키는 행이 없는 것은 흔한 일이라 그냥 알린다. */}
              {result && result.rowCount === 0 &&
                (link.direction === "out" ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {link.target.column}에 이 ID가 없습니다. 없는 ID를 쓰고 있거나 데이터가 빠졌을 수 있습니다.
                  </p>
                ) : (
                  <p className="text-xs text-zinc-500">이 값을 참조하는 행이 없습니다.</p>
                ))}
              {result && result.rowCount > 0 && (
                <div className="rounded border border-zinc-200 dark:border-zinc-800">
                  <RecordTable
                    result={result}
                    sourceKey={`${link.target.sourceId}/${link.target.table}`}
                    separators={columnSeparators(link.target.sourceId, link.target.table, targetLinks.relations)}
                    linked={linked}
                    highlighted={(column) => column === link.target.column}
                    onLinkClick={(column, value) => {
                      const key = toKeyValue(value);
                      if (key) onFollow({ sourceId: link.target.sourceId, table: link.target.table, column, ...key });
                    }}
                  />
                </div>
              )}
              {result?.truncated && (
                <p className="text-xs text-zinc-500">앞의 {LINKED_ROW_LIMIT}행만 보여줍니다.</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
