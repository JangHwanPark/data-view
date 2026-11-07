"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, Download, Loader2, TriangleAlert } from "lucide-react";
import { ScanProgress } from "@/components/map/map-parts";
import { useCandidates } from "@/components/docs/use-candidates";
import { useDocCheck } from "@/components/docs/use-doc-check";
import { useDomainModel } from "@/components/use-domain-model";
import { useWorkspace } from "@/components/workspace-provider";
import { buildItems, type CheckItem, type SectionId } from "@/lib/client/checklist";
import { STRONG_SCORE } from "@/lib/client/doc-analysis";
import type { Candidate, DocMapping } from "@/lib/client/doc-infer";
import { extractTerms, type DocTerm } from "@/lib/client/doc-terms";
import { downloadXlsx } from "@/lib/client/export-xlsx";
import { readChecklists, writeChecklists, type ChecklistState, type CheckStatus } from "@/lib/client/opfs";

// 기획서 기준 테스트 항목(설계 4.11). 절 하나를 고르면 그 절에 나온 ID마다 확인 항목을 만든다.
const STATUS: { key: CheckStatus; label: string; tone: string }[] = [
  { key: "ok", label: "확인", tone: "bg-emerald-600 text-white" },
  { key: "problem", label: "문제", tone: "bg-red-600 text-white" },
  { key: "hold", label: "보류", tone: "bg-amber-500 text-white" },
];

// 절에 나온 ID 가운데 어느 테이블의 ID인지 아는 것. "맞음"으로 표시했거나 확실한 추정(85% 이상)만 쓴다.
function sectionIds(terms: DocTerm[], sectionId: string, candidates: Map<string, Candidate[]>, mappings: DocMapping[]): SectionId[] {
  const out: SectionId[] = [];
  for (const t of terms) {
    if (t.kind !== "id" || !t.sections.includes(sectionId)) continue;
    const mapping = mappings.find((m) => m.key === t.key);
    if (mapping && !mapping.target) continue; // 무시한 말
    const target = mapping?.target ?? candidates.get(t.key)?.find((c) => c.score >= STRONG_SCORE)?.target;
    if (target?.column) out.push({ sourceId: target.sourceId, table: target.table, column: target.column, value: t.text });
  }
  return out;
}

const cache = new Map<string, Promise<CheckItem[]>>();

export function DocChecklist({ id }: { id: string }) {
  const { docs, mappings, initialized } = useWorkspace();
  const doc = docs.find((d) => d.meta.id === id);
  const terms = doc?.parsed ? extractTerms(doc.parsed) : null;
  const candidates = useCandidates(terms);
  const check = useDocCheck(doc);
  const { model, progress } = useDomainModel();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [state, setState] = useState<ChecklistState | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; items: CheckItem[] | "error" } | null>(null);

  useEffect(() => {
    readChecklists()
      .then(setState)
      .catch(() => setState({}));
  }, []);

  const ready = doc?.parsed && terms && candidates && candidates !== "error" && check && check !== "error";
  const sections = doc?.parsed?.sections ?? [];
  const perSection = ready
    ? sections.map((s) => ({
        section: s,
        ids: sectionIds(terms, s.id, candidates, mappings),
        issues: check.issues.filter((i) => i.sectionId === s.id),
      }))
    : [];
  const usable = perSection.filter((p) => p.ids.length || p.issues.length);
  const selectedId = searchParams.get("section") ?? usable[0]?.section.id ?? null;
  const selected = perSection.find((p) => p.section.id === selectedId) ?? null;
  const buildKey = selected && model ? JSON.stringify([id, selected.section.id, selected.ids, selected.issues.map((i) => [i.key, i.column, i.dataValue])]) : null;

  useEffect(() => {
    if (!buildKey || !selected || !model) return;
    let active = true;
    if (!cache.has(buildKey)) cache.set(buildKey, buildItems(model, selected.ids, selected.issues));
    cache
      .get(buildKey)!
      .then((items) => active && setLoaded({ key: buildKey, items }))
      .catch(() => {
        cache.delete(buildKey);
        if (active) setLoaded({ key: buildKey, items: "error" });
      });
    return () => {
      active = false;
    };
    // selected와 model은 buildKey가 바뀔 때만 다시 쓴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildKey]);

  const items = loaded?.key === buildKey ? loaded.items : null;
  const docState = state?.[id] ?? {};

  function update(itemKey: string, patch: Partial<{ status: CheckStatus; memo: string }>) {
    setState((prev) => {
      const base = prev ?? {};
      const cur = base[id]?.[itemKey] ?? { status: "todo" as CheckStatus, memo: "", updatedAt: "" };
      const next: ChecklistState = { ...base, [id]: { ...base[id], [itemKey]: { ...cur, ...patch, updatedAt: new Date().toISOString() } } };
      void writeChecklists(next);
      return next;
    });
  }

  function exportXlsx() {
    if (!items || items === "error" || !selected) return;
    const label: Record<CheckStatus, string> = { todo: "", ok: "확인", problem: "문제", hold: "보류" };
    downloadXlsx(
      {
        columns: ["절", "테이블", "ID", "이름", "확인 내용", "먼저 볼 점", "상태", "메모"].map((name) => ({ name, type: "string" as const })),
        rows: items.map((it) => [
          selected.section.title,
          it.table,
          it.id,
          it.title ?? "",
          it.lines.map((l) => `${"  ".repeat(l.depth - 1)}${l.text}`).join("\n"),
          it.flags.join("\n"),
          label[docState[it.key]?.status ?? "todo"],
          docState[it.key]?.memo ?? "",
        ]),
        rowCount: items.length,
        truncated: false,
        elapsedMs: 0,
      },
      `테스트항목_${doc?.meta.name.replace(/\.[^.]+$/, "")}_${selected.section.title}.xlsx`.replace(/[\\/:*?"<>|]/g, "_"),
      "테스트 항목",
    );
  }

  if (!initialized) return <p className="text-zinc-500">불러오는 중...</p>;
  if (!doc) return <p className="text-zinc-500">이 기획서를 찾을 수 없습니다.</p>;

  const counts = { all: 0, problem: 0, ok: 0, hold: 0, flagged: 0 };
  if (items && items !== "error") {
    counts.all = items.length;
    counts.flagged = items.filter((i) => i.flags.length).length;
    for (const it of items) {
      const st = docState[it.key]?.status;
      if (st === "problem") counts.problem++;
      if (st === "ok") counts.ok++;
      if (st === "hold") counts.hold++;
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Link href={`/docs/${id}`} className="inline-flex w-fit items-center gap-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ChevronLeft className="size-4" aria-hidden />
        {doc.meta.name}
      </Link>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold">테스트 항목</h1>
        <p className="text-zinc-500">
          절 하나를 고르면 그 절에 나온 ID마다 그 행의 참조 대상(보상, 아이템, 조건 …)을 펼쳐 확인할 항목으로 만듭니다. 기획서와 다른 값이나 없는 ID가 걸린 항목이 위에 옵니다.
        </p>
      </div>

      {!ready || !model ? (
        <p className="inline-flex items-center gap-2 text-zinc-500">
          {progress ? <ScanProgress progress={progress} /> : (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              기획서와 데이터를 맞춰 보는 중입니다.
            </>
          )}
        </p>
      ) : usable.length === 0 ? (
        <p className="text-zinc-500">이 기획서에는 데이터에서 찾은 ID가 없습니다. 기획서 화면에서 ID를 &lsquo;맞음&rsquo;으로 표시하면 여기서 쓸 수 있습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <nav aria-label="절" className="flex flex-col gap-0.5 text-xs">
            {usable.map((p) => (
              <button
                key={p.section.id}
                type="button"
                onClick={() => window.history.replaceState(null, "", `${pathname}?section=${p.section.id}`)}
                aria-current={p.section.id === selectedId ? "true" : undefined}
                className={`flex items-baseline gap-1.5 rounded px-2 py-1 text-left ${p.section.id === selectedId ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
              >
                <span className="min-w-0 flex-1 truncate">{p.section.title}</span>
                <span className="shrink-0 tabular-nums opacity-70">ID {new Set([...p.ids.map((x) => x.value), ...p.issues.filter((i) => i.kind === "missing-row").map((i) => i.key)]).size}</span>
                {p.issues.length > 0 && <TriangleAlert className="size-3 shrink-0 text-red-500" aria-label="기획서와 다른 곳 있음" />}
              </button>
            ))}
          </nav>

          <section className="flex min-w-0 flex-col gap-2">
            {selected && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="font-semibold">{selected.section.title}</h2>
                {items && items !== "error" && (
                  <span className="text-xs text-zinc-500">
                    항목 {counts.all}개 · 먼저 볼 항목 {counts.flagged}개 · 확인 {counts.ok} · 문제 {counts.problem} · 보류 {counts.hold}
                  </span>
                )}
                <Link href={`/docs/${id}#${selected.section.id}`} className="text-xs text-blue-700 hover:underline dark:text-blue-400">
                  기획서에서 이 절 보기
                </Link>
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
                항목을 만드는 중입니다. ID마다 이어진 행을 펼치므로 조금 걸립니다.
              </p>
            ) : items === "error" ? (
              <p className="text-red-600">항목을 만들지 못했습니다.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((it) => (
                  <ItemCard key={it.key} item={it} state={docState[it.key]} onChange={(patch) => update(it.key, patch)} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

interface CardProps {
  item: CheckItem;
  state?: { status: CheckStatus; memo: string };
  onChange: (patch: Partial<{ status: CheckStatus; memo: string }>) => void;
}

function ItemCard({ item, state, onChange }: CardProps) {
  const [memo, setMemo] = useState<string | null>(null);
  const status = state?.status ?? "todo";
  const treeHref = `/sources/${item.sourceId}/tables/${encodeURIComponent(item.table)}?view=data&tree=${encodeURIComponent(JSON.stringify({ column: item.keyColumn, value: item.id }))}`;
  return (
    <li
      className={`flex flex-col gap-1.5 rounded-md border bg-white px-3 py-2 text-xs dark:bg-zinc-900 ${item.flags.length ? "border-red-200 dark:border-red-900" : "border-zinc-200 dark:border-zinc-800"}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-zinc-500">{item.table}</span>
        <span className="font-semibold tabular-nums">{item.id}</span>
        {item.title && <span className="text-sm">{item.title}</span>}
        {item.found && (
          <Link href={treeHref} className="text-blue-700 hover:underline dark:text-blue-400">
            데이터에서 보기
          </Link>
        )}
        <div className="ml-auto flex gap-1">
          {STATUS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onChange({ status: status === s.key ? "todo" : s.key })}
              aria-pressed={status === s.key}
              className={`rounded px-2 py-0.5 ${status === s.key ? s.tone : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {item.flags.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {item.flags.map((f) => (
            <li key={f} className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
              <TriangleAlert className="size-3 shrink-0" aria-hidden />
              {f}
            </li>
          ))}
        </ul>
      )}
      {item.lines.length > 0 && (
        <ul className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
          {item.lines.map((l, i) => (
            <li key={i} className={`truncate ${l.missing ? "text-red-600 dark:text-red-400" : ""}`} style={{ paddingLeft: (l.depth - 1) * 16 }} title={l.text}>
              {l.text}
            </li>
          ))}
        </ul>
      )}
      <textarea
        aria-label={`${item.table} ${item.id} 메모`}
        rows={1}
        value={memo ?? state?.memo ?? ""}
        onChange={(e) => setMemo(e.target.value)}
        onBlur={() => {
          if (memo !== null && memo !== (state?.memo ?? "")) onChange({ memo });
          setMemo(null);
        }}
        placeholder="메모 (예: 보상 개수 기획서와 다름, 담당자 확인 중)"
        className="w-full resize-y rounded border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
      />
    </li>
  );
}
