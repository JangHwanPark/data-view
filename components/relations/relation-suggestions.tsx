"use client";

import { useState } from "react";
import { ArrowRight, Loader2, Plus, Sparkles } from "lucide-react";
import { useWorkspace, type WorkspaceSource } from "@/components/workspace-provider";
import { ColumnLabel, StatsText } from "@/components/relations/relation-parts";
import { newRelationId, sameEndpoints, suggestRelations, type Suggestion } from "@/lib/client/relations";
import type { QueryColumn } from "@/lib/query-result";

interface Props {
  sources: WorkspaceSource[];
  columns: Map<string, QueryColumn[]>;
}

export function RelationSuggestions({ sources, columns }: Props) {
  const { relations, addRelations } = useWorkspace();
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 이미 저장된 관계는 목록에서 뺀다.
  const pending = (suggestions ?? []).filter((s) => !relations.some((r) => sameEndpoints(r, s)));
  const strong = pending.filter((s) => !s.weak);
  const weak = pending.filter((s) => s.weak);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const tables = sources.flatMap((s) => s.tables.map((table) => ({ sourceId: s.meta.id, table })));
      setSuggestions(await suggestRelations(tables, columns, relations));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  function add(list: Suggestion[]) {
    return addRelations(list.map((s) => ({ id: newRelationId(), from: s.from, to: s.to })));
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">관계 추천</h2>
      <p className="text-sm text-zinc-500">
        값이 유일한 열을 키로 보고, 다른 시트의 열 중 값의 90% 이상이 그 키에 있는 것을 찾습니다. 열 이름이 달라도 찾을 수 있습니다.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={running || sources.length === 0}
          onClick={() => void run()}
          className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
          {running ? "찾는 중" : "추천 찾기"}
        </button>
        {strong.length > 1 && (
          <button
            type="button"
            onClick={() => void add(strong)}
            className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <Plus className="size-4" aria-hidden />
            모두 추가
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">추천을 찾지 못했습니다. ({error})</p>}
      {suggestions && pending.length === 0 && !running && (
        <p className="text-sm text-zinc-500">새로 추천할 관계가 없습니다.</p>
      )}

      {strong.length > 0 && <SuggestionList items={strong} sources={sources} onAdd={add} />}

      {weak.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-500">가능성 낮은 추천 {weak.length}개</summary>
          <p className="my-2 text-xs text-zinc-500">
            1부터 매긴 번호 열에 수량처럼 작은 숫자 열이 우연히 겹친 경우일 수 있습니다. 실제 관계인지 확인하고 추가해 주세요.
          </p>
          <SuggestionList items={weak} sources={sources} onAdd={add} />
        </details>
      )}
    </section>
  );
}

interface ListProps {
  items: Suggestion[];
  sources: WorkspaceSource[];
  onAdd: (list: Suggestion[]) => Promise<void>;
}

function SuggestionList({ items, sources, onAdd }: ListProps) {
  return (
    <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {items.map((s) => (
        <li
          key={`${s.from.sourceId}/${s.from.table}/${s.from.column}>${s.to.sourceId}/${s.to.table}/${s.to.column}`}
          className="flex items-start gap-3 px-4 py-3"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <ColumnLabel refValue={s.from} sources={sources} />
              <ArrowRight className="size-4 shrink-0 text-zinc-400" aria-hidden />
              <ColumnLabel refValue={s.to} sources={sources} />
              {s.nameMatch && (
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  이름 일치
                </span>
              )}
            </div>
            <StatsText stats={s.stats} />
          </div>
          <button
            type="button"
            onClick={() => void onAdd([s])}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <Plus className="size-3.5" aria-hidden />
            추가
          </button>
        </li>
      ))}
    </ul>
  );
}
