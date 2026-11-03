"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Loader2, Trash2 } from "lucide-react";
import { sourceVersion, useWorkspace } from "@/components/workspace-provider";
import { ColumnLabel, endpointExists, StatsText } from "@/components/relations/relation-parts";
import { RelationForm } from "@/components/relations/relation-form";
import { RelationSuggestions } from "@/components/relations/relation-suggestions";
import { RelationTransfer } from "@/components/relations/relation-transfer";
import { RelationsTabs } from "@/components/relations/relations-tabs";
import { relationStats, type RelationStats } from "@/lib/client/relations";
import { loadColumns } from "@/lib/client/schema";
import type { QueryColumn } from "@/lib/query-result";

export function RelationsView() {
  const { sources, relations, initialized, removeRelation } = useWorkspace();
  const [columns, setColumns] = useState<Map<string, QueryColumn[]> | null>(null);
  const [stats, setStats] = useState<Record<string, RelationStats | "error">>({});

  const loading = !initialized || sources.some((s) => s.status === "loading");
  // 파일 교체나 헤더 변경으로 컬럼이 바뀌면 다시 읽도록 상태를 문자열로 묶는다.
  const schemaVersion = sources
    .map(sourceVersion)
    .join("|");

  useEffect(() => {
    if (loading) return;
    let active = true;
    loadColumns()
      .then((map) => {
        if (active) setColumns(map);
      })
      .catch(() => {
        if (active) setColumns(new Map());
      });
    return () => {
      active = false;
    };
  }, [loading, schemaVersion]);

  useEffect(() => {
    if (!columns) return;
    let active = true;
    (async () => {
      const next: Record<string, RelationStats | "error"> = {};
      for (const rel of relations) {
        if (!endpointExists(rel.from, columns) || !endpointExists(rel.to, columns)) continue;
        try {
          next[rel.id] = await relationStats(rel.from, rel.to);
        } catch {
          next[rel.id] = "error";
        }
      }
      if (active) setStats(next);
    })();
    return () => {
      active = false;
    };
  }, [columns, relations]);

  const ready = sources.filter((s) => s.status === "ready");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">관계</h1>
          <RelationTransfer />
        </div>
        <RelationsTabs active="list" />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">설정된 관계</h2>
        {!initialized ? (
          <p className="text-sm text-zinc-500">불러오는 중...</p>
        ) : relations.length === 0 ? (
          <p className="text-sm text-zinc-500">
            아직 관계가 없습니다. 아래에서 직접 추가하거나 추천을 받아 보세요.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {relations.map((rel) => {
              const missing =
                columns && !loading && (!endpointExists(rel.from, columns) || !endpointExists(rel.to, columns));
              const s = stats[rel.id];
              return (
                <li key={rel.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <ColumnLabel refValue={rel.from} sources={sources} />
                      <ArrowRight className="size-4 shrink-0 text-zinc-400" aria-hidden />
                      <ColumnLabel refValue={rel.to} sources={sources} />
                    </div>
                    {missing ? (
                      <p className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="size-3.5" aria-hidden />
                        파일에서 이 시트나 열을 찾을 수 없습니다. 교체한 파일의 구조가 바뀌었는지 확인해 주세요.
                      </p>
                    ) : s === "error" ? (
                      <p className="text-xs text-red-600">일치율을 계산하지 못했습니다.</p>
                    ) : s ? (
                      <StatsText stats={s} />
                    ) : (
                      <p className="inline-flex items-center gap-1 text-xs text-zinc-500">
                        <Loader2 className="size-3 animate-spin" aria-hidden />
                        확인 중
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeRelation(rel.id)}
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                    aria-label="관계 삭제"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {ready.length < 2 && initialized && !loading ? (
        <p className="text-sm text-zinc-500">
          관계를 만들려면 데이터 소스에서 파일을 두 개 이상 열어 주세요. 한 엑셀 파일 안의 시트끼리도 관계를 만들 수 있습니다.
        </p>
      ) : null}

      {columns && !loading && (
        <>
          <RelationForm sources={ready} columns={columns} />
          <RelationSuggestions sources={ready} columns={columns} />
        </>
      )}
    </div>
  );
}
