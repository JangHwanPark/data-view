"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, Download, Loader2 } from "lucide-react";
import { ChecklistCard } from "@/features/checklist";
import { ScanProgress } from "@/core/ui/map-parts";
import { useDomainModel } from "@/core/ui/use-domain-model";
import { sourceVersion, useWorkspace, type WorkspaceSource } from "@/core/ui/workspace-provider";
import { buildItems, type CheckItem } from "@/features/checklist";
import { compareSource, compareTable, patchIds, previousLabel, type TableSummary } from "./compare";
import { downloadXlsx } from "@/shared/lib/export-xlsx";
import { readChecklists, writeChecklists, type ChecklistState, type CheckStatus } from "@/core/opfs";

// 패치 테스트 항목(37단계). 전후 비교에서 새로 생기거나 값이 바뀐 Id마다 그 행이 쓰는 것을 행 트리로 펼쳐 확인 항목을 만든다.
// 기획서 기준 테스트 항목과 같은 카드와 같은 저장 파일(checklists.json)을 쓰고, 키만 patch:<소스 id>:<이전 버전 시각>으로 나눈다.

export const MAX_ITEMS = 100; // 테이블 하나에서 만드는 항목 수. 행 트리를 펼치므로 많으면 느리다.

const summaryCache = new Map<string, Promise<TableSummary[]>>();
const itemCache = new Map<string, Promise<CheckItem[]>>();

async function buildPatchItems(source: WorkspaceSource, summary: TableSummary, model: NonNullable<ReturnType<typeof useDomainModel>["model"]>) {
  const meta = source.meta;
  const ids = await patchIds(meta, summary);
  if (!ids) return [];
  const detail = await compareTable(meta, summary);
  const changes = new Map(detail.changed.map((r) => [r.id, r.cells]));
  const picked = [...ids.added.map((v) => ({ v, added: true })), ...ids.changed.map((v) => ({ v, added: false }))].slice(0, MAX_ITEMS);
  const items = await buildItems(
    model,
    picked.map((p) => ({ sourceId: meta.id, table: summary.table, column: ids.key, value: p.v })),
    [],
  );
  const added = new Set(ids.added);
  return items.map((it) => {
    const cells = changes.get(it.id);
    const notes = added.has(it.id)
      ? ["이번 패치에서 새로 생긴 행"]
      : cells
        ? cells.map((c) => `값 바뀜: ${c.column} ${c.before ?? "(비어 있음)"} → ${c.after ?? "(비어 있음)"}`)
        : ["이번 패치에서 값이 바뀐 행"];
    return { ...it, notes };
  });
}

export function PatchChecklist() {
  const { sources, initialized } = useWorkspace();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const source = sources.find((s) => s.meta.id === searchParams.get("source") && !!s.meta.previous) ?? null;
  const { model, progress } = useDomainModel();
  const [state, setState] = useState<ChecklistState | null>(null);
  const [summaries, setSummaries] = useState<{ key: string; list: TableSummary[] | "error" } | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; items: CheckItem[] | "error" } | null>(null);

  useEffect(() => {
    readChecklists()
      .then(setState)
      .catch(() => setState({}));
  }, []);

  const ready = source?.status === "ready";
  const summaryKey = ready && source ? `${sourceVersion(source)}|${source.meta.previous!.savedAt}` : null;
  useEffect(() => {
    if (!summaryKey || !source) return;
    let active = true;
    if (!summaryCache.has(summaryKey)) {
      const p = compareSource(source.meta, source.tables);
      p.catch(() => summaryCache.delete(summaryKey));
      summaryCache.set(summaryKey, p);
    }
    summaryCache
      .get(summaryKey)!
      .then((list) => active && setSummaries({ key: summaryKey, list }))
      .catch(() => active && setSummaries({ key: summaryKey, list: "error" }));
    return () => {
      active = false;
    };
    // source는 summaryKey에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryKey]);

  const list = summaries?.key === summaryKey ? summaries.list : null;
  const usable = Array.isArray(list) ? list.filter((t) => t.key && t.status === "changed" && t.added + t.changed > 0).sort((a, b) => b.added + b.changed - (a.added + a.changed)) : [];
  const selected = usable.find((t) => t.table === searchParams.get("table")) ?? usable[0] ?? null;
  const buildKey = selected && model && summaryKey ? `${summaryKey}|${selected.table}` : null;

  useEffect(() => {
    if (!buildKey || !selected || !model || !source) return;
    let active = true;
    if (!itemCache.has(buildKey)) {
      const p = buildPatchItems(source, selected, model);
      p.catch(() => itemCache.delete(buildKey));
      itemCache.set(buildKey, p);
    }
    itemCache
      .get(buildKey)!
      .then((items) => active && setLoaded({ key: buildKey, items }))
      .catch(() => active && setLoaded({ key: buildKey, items: "error" }));
    return () => {
      active = false;
    };
    // selected, model, source는 buildKey가 바뀔 때만 다시 쓴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildKey]);

  const items = loaded?.key === buildKey ? loaded.items : null;
  const stateKey = source ? `patch:${source.meta.id}:${source.meta.previous!.savedAt}` : "";
  const listState = state?.[stateKey] ?? {};

  function update(itemKey: string, patch: Partial<{ status: CheckStatus; memo: string }>) {
    setState((prev) => {
      const base = prev ?? {};
      const cur = base[stateKey]?.[itemKey] ?? { status: "todo" as CheckStatus, memo: "", updatedAt: "" };
      const next: ChecklistState = { ...base, [stateKey]: { ...base[stateKey], [itemKey]: { ...cur, ...patch, updatedAt: new Date().toISOString() } } };
      void writeChecklists(next);
      return next;
    });
  }

  function exportXlsx() {
    if (!items || items === "error" || !selected || !source) return;
    const label: Record<CheckStatus, string> = { todo: "", ok: "확인", problem: "문제", hold: "보류" };
    downloadXlsx(
      {
        columns: ["테이블", "ID", "이름", "이번 패치", "확인 내용", "먼저 볼 점", "상태", "메모"].map((name) => ({ name, type: "string" as const })),
        rows: items.map((it) => [
          it.table,
          it.id,
          it.title ?? "",
          (it.notes ?? []).join("\n"),
          it.lines.map((l) => `${"  ".repeat(l.depth - 1)}${l.text}`).join("\n"),
          it.flags.join("\n"),
          label[listState[it.key]?.status ?? "todo"],
          listState[it.key]?.memo ?? "",
        ]),
        rowCount: items.length,
        truncated: false,
        elapsedMs: 0,
      },
      `패치테스트항목_${source.meta.name.replace(/\.[^.]+$/, "")}_${selected.table}.xlsx`.replace(/[\\/:*?"<>|]/g, "_"),
      "테스트 항목",
    );
  }

  if (!initialized) return <p className="text-zinc-500">불러오는 중...</p>;
  if (!source) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-zinc-500">비교할 이전 버전이 있는 소스를 찾을 수 없습니다.</p>
        <Link href="/compare" className="text-blue-700 hover:underline dark:text-blue-400">
          패치 전후 비교로 가기
        </Link>
      </div>
    );
  }

  const counts = { all: 0, flagged: 0, ok: 0, problem: 0, hold: 0 };
  if (items && items !== "error") {
    counts.all = items.length;
    counts.flagged = items.filter((i) => i.flags.length).length;
    for (const it of items) {
      const st = listState[it.key]?.status;
      if (st === "ok") counts.ok++;
      if (st === "problem") counts.problem++;
      if (st === "hold") counts.hold++;
    }
  }
  const total = selected ? selected.added + selected.changed : 0;

  return (
    <div className="flex flex-col gap-3">
      <Link href={`/compare?source=${encodeURIComponent(source.meta.id)}`} className="inline-flex w-fit items-center gap-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ChevronLeft className="size-4" aria-hidden />
        패치 전후 비교
      </Link>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold">패치 테스트 항목</h1>
        <p className="text-zinc-500">
          {source.meta.name}: {previousLabel(source.meta)}과 지금을 비교해, 새로 생기거나 값이 바뀐 Id마다 그 행의 참조 대상(보상, 아이템, 조건 …)을 펼쳐 확인할 항목으로 만듭니다. 없는 ID를 참조하게 된 항목이 위에 옵니다.
        </p>
      </div>

      {!ready || list === null || !model ? (
        <p className="inline-flex items-center gap-2 text-zinc-500">
          {progress && !model ? (
            <ScanProgress progress={progress} />
          ) : (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              전후를 비교하는 중입니다.
            </>
          )}
        </p>
      ) : list === "error" ? (
        <p className="text-red-600">비교하지 못했습니다. 남겨 둔 이전 버전이 지워졌을 수 있습니다.</p>
      ) : usable.length === 0 ? (
        <p className="text-zinc-500">새로 생기거나 값이 바뀐 행이 있는 테이블이 없습니다. ID 컬럼이 없는 시트는 줄 단위로만 비교하므로 여기에 나오지 않습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <nav aria-label="테이블" className="flex flex-col gap-0.5 text-xs">
            {usable.map((t) => (
              <button
                key={t.table}
                type="button"
                onClick={() => window.history.replaceState(null, "", `${pathname}?source=${encodeURIComponent(source.meta.id)}&table=${encodeURIComponent(t.table)}`)}
                aria-current={t === selected ? "true" : undefined}
                className={`flex items-baseline gap-1.5 rounded px-2 py-1 text-left ${t === selected ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
              >
                <span className="min-w-0 flex-1 truncate">{t.table}</span>
                <span className="shrink-0 tabular-nums opacity-70">
                  새 {t.added} · 바뀜 {t.changed}
                </span>
              </button>
            ))}
          </nav>

          <section className="flex min-w-0 flex-col gap-2">
            {selected && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="font-semibold">{selected.table}</h2>
                {items && items !== "error" && (
                  <span className="text-xs text-zinc-500">
                    항목 {counts.all}개{total > counts.all ? ` (바뀐 행 ${total.toLocaleString()}개 중 앞의 ${counts.all}개)` : ""} · 먼저 볼 항목 {counts.flagged}개 · 확인 {counts.ok} · 문제 {counts.problem} · 보류 {counts.hold}
                  </span>
                )}
                <button
                  type="button"
                  onClick={exportXlsx}
                  disabled={!items || items === "error"}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  <Download className="size-3.5" aria-hidden />
                  엑셀로 내보내기
                </button>
              </div>
            )}
            {items === null ? (
              <p className="inline-flex items-center gap-2 text-zinc-500">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                항목을 만드는 중입니다. Id마다 이어진 행을 펼치므로 조금 걸립니다.
              </p>
            ) : items === "error" ? (
              <p className="text-red-600">항목을 만들지 못했습니다.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((it) => (
                  <ChecklistCard key={it.key} item={it} state={listState[it.key]} onChange={(patch) => update(it.key, patch)} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
