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
  // 찾을 범위(31단계). 시트가 많으면 비교가 테이블 수의 제곱으로 늘어나므로 파일을 골라 좁힌다. 비어 있으면 모두.
  const [scope, setScope] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ phase: "read" | "compare"; done: number; total: number } | null>(null);
  const inScope = sources.filter((s) => !scope.size || scope.has(s.meta.id));
  const scopeTables = inScope.reduce((n, s) => n + s.tables.length, 0);

  // 이미 저장된 관계는 목록에서 뺀다.
  const pending = (suggestions ?? []).filter((s) => !relations.some((r) => sameEndpoints(r, s)));
  const strong = pending.filter((s) => !s.weak);
  const weak = pending.filter((s) => s.weak);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const tables = inScope.flatMap((s) => s.tables.map((table) => ({ sourceId: s.meta.id, table })));
      setSuggestions(await suggestRelations(tables, columns, relations, setProgress));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  function add(list: Suggestion[]) {
    return addRelations(list.map((s) => ({ id: newRelationId(), from: s.from, to: s.to })));
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">앱이 찾은 참조 관계</h2>
      <p className="text-sm text-zinc-500">
        값이 겹치지 않는 컬럼을 ID 컬럼으로 보고, 다른 시트의 컬럼 중 값의 90% 이상이 그 ID 컬럼에 있는 것을 찾습니다. 컬럼 이름이 달라도 찾을 수 있습니다. 맞는 것만 골라 추가하세요.
      </p>
      {sources.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="찾을 범위">
          <span className="text-zinc-500">찾을 범위</span>
          <button
            type="button"
            onClick={() => setScope(new Set())}
            aria-pressed={scope.size === 0}
            className={`rounded border px-1.5 py-0.5 ${scope.size === 0 ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 dark:border-zinc-700"}`}
          >
            모든 파일
          </button>
          {sources.map((s) => {
            const on = scope.has(s.meta.id);
            return (
              <button
                key={s.meta.id}
                type="button"
                onClick={() =>
                  setScope((prev) => {
                    const next = new Set(prev);
                    if (on) next.delete(s.meta.id);
                    else next.add(s.meta.id);
                    return next;
                  })
                }
                aria-pressed={on}
                className={`rounded border px-1.5 py-0.5 ${on ? "border-blue-500 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200" : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"}`}
              >
                {s.meta.name}
              </button>
            );
          })}
          <span className="text-zinc-500">
            · 시트 {scopeTables.toLocaleString()}개{scopeTables > 60 ? " (시트가 많아 오래 걸릴 수 있습니다. 파일을 골라 좁혀 보세요)" : ""}
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={running || sources.length === 0}
          onClick={() => void run()}
          className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
          {running ? "찾는 중" : "참조 관계 찾기"}
        </button>
        {progress && (
          <span className="text-xs tabular-nums text-zinc-500" aria-live="polite">
            {progress.phase === "read" ? "테이블 읽는 중" : "비교하는 중"} {progress.done.toLocaleString()}/{progress.total.toLocaleString()}
          </span>
        )}
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

      {error && <p className="text-sm text-red-600">참조 관계를 찾지 못했습니다. ({error})</p>}
      {suggestions && pending.length === 0 && !running && (
        <p className="text-sm text-zinc-500">새로 찾은 참조 관계가 없습니다.</p>
      )}

      {strong.length > 0 && <SuggestionList items={strong} sources={sources} onAdd={add} />}

      {weak.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-500">맞을 가능성이 낮은 참조 관계 {weak.length}개</summary>
          <p className="my-2 text-xs text-zinc-500">
            1, 2, 3처럼 번호를 매긴 ID 컬럼에 수량 같은 작은 숫자가 우연히 겹친 경우일 수 있습니다. 실제로 이어지는지 확인하고 추가해 주세요.
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
                  이름이 같음
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
