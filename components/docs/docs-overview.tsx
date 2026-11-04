"use client";

import Link from "next/link";
import { FileText, FolderInput, Loader2, Trash2 } from "lucide-react";
import { useCandidates } from "@/components/docs/use-candidates";
import { sourceTableLabel } from "@/components/relations/relation-parts";
import { useWorkspace } from "@/components/workspace-provider";
import { mentionedTables, mergeTerms, STRONG_SCORE, viewTerms } from "@/lib/client/doc-analysis";

// 기획서 목록과, 기획서가 최신이 아니라는 신호 두 가지를 모아 보여준다.
// 기획서에만 있음: 어느 테이블에도 맞지 않는 이름. 옛 이름이거나 아직 없는 테이블.
// 기획서에 없음: 어느 기획서에서도 확정되지 않았고 확실한 후보도 없는 테이블.
export function DocsOverview() {
  const { docs, sources, mappings, initialized, removeDocument } = useWorkspace();
  const parsed = docs.filter((d) => d.parsed).map((d) => ({ id: d.meta.id, parsed: d.parsed! }));
  const terms = parsed.length ? mergeTerms(parsed) : null;
  const candidates = useCandidates(terms);

  if (!initialized) return <p className="text-zinc-500">불러오는 중...</p>;

  const views = terms && candidates && candidates !== "error" ? viewTerms(terms, candidates, mappings) : null;
  // 확정도 무시도 안 했고, 같은 이름의 테이블이나 열도 없고, 확실한 후보(85% 이상)도 없는 이름.
  // QuestReward처럼 비슷한 테이블은 있어도 같은 테이블은 없는 경우다.
  const docOnly =
    views?.filter(
      (v) =>
        v.term.kind === "name" &&
        (v.state === "unmatched" ||
          (v.state === "candidate" && !v.candidates.some((c) => c.exact) && (v.candidates[0]?.score ?? 0) < STRONG_SCORE)),
    ) ?? [];
  const mentioned = views ? mentionedTables(views) : null;
  const ready = sources.filter((s) => s.status === "ready");
  const notInDocs = mentioned
    ? ready.flatMap((s) => s.tables.filter((t) => !mentioned.has(`${s.meta.id}/${t}`)).map((table) => ({ source: s, table })))
    : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-lg font-semibold">기획서</h1>
        <p className="text-zinc-500">상단의 소스 추가에서 워드, PPT, PDF, 엑셀 기획서를 파일로 고르거나 경로를 지정해 열 수 있습니다.</p>
        <Link
          href="/sources/new/path?kind=doc"
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          <FolderInput className="size-3.5" aria-hidden />
          기획서 경로 지정
        </Link>
      </div>

      {docs.length === 0 ? (
        <p className="text-zinc-500">열어 둔 기획서가 없습니다.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-zinc-200 bg-zinc-200 md:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-800">
          {docs.map((d) => (
            <li key={d.meta.id} className="flex items-center gap-2 bg-white px-3 py-2 dark:bg-zinc-900">
              <FileText className="size-4 shrink-0 text-zinc-400" aria-hidden />
              <Link href={`/docs/${d.meta.id}`} className="min-w-0 flex-1 truncate hover:underline">
                {d.meta.name}
              </Link>
              <span className="text-xs text-zinc-500">
                {d.status === "ready" ? `절 ${d.parsed?.sections.length ?? 0}개` : d.status === "loading" ? "읽는 중" : "읽기 실패"}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`${d.meta.name}을(를) 목록에서 지울까요? 확정한 용어 매칭은 남습니다.`)) void removeDocument(d.meta.id);
                }}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                aria-label={`${d.meta.name} 삭제`}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {terms && !views && (
        <p className="inline-flex items-center gap-2 text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          기획서와 데이터를 맞춰 보는 중
        </p>
      )}

      {views && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <section className="flex flex-col gap-2">
            <h2 className="font-medium">
              기획서에만 있음 <span className="text-zinc-500">{docOnly.length}</span>
            </h2>
            <p className="text-xs text-zinc-500">기획서에 나오지만 같은 이름의 테이블이나 열이 없는 이름입니다(확실한 후보 85% 미만). 옛 이름이거나 아직 만들지 않은 테이블일 수 있습니다.</p>
            <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {docOnly.length === 0 && <li className="px-3 py-2 text-zinc-500">없습니다.</li>}
              {docOnly.map((v) => (
                <li key={v.term.key} className="flex flex-wrap items-center gap-x-2 px-3 py-1.5">
                  <span className="font-medium text-red-600 dark:text-red-400">{v.term.text}</span>
                  {v.candidates[0] && (
                    <span className="text-xs text-zinc-500">
                      가장 가까운 후보 {v.candidates[0].target.table} {Math.round(v.candidates[0].score * 100)}%
                    </span>
                  )}
                  <span className="ml-auto text-xs text-zinc-500">
                    {[...new Set(v.term.sections.map((s) => s.split("/")[0]))]
                      .map((docId) => docs.find((d) => d.meta.id === docId)?.meta.name)
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="font-medium">
              기획서에 없음 <span className="text-zinc-500">{notInDocs.length}</span>
            </h2>
            <p className="text-xs text-zinc-500">어느 기획서에서도 확정되지 않았고 확실한 후보(85% 이상)도 아닌 테이블입니다. 기획서가 빠뜨렸거나 다른 이름으로 적었을 수 있습니다.</p>
            <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-zinc-200 bg-zinc-200 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-800">
              {notInDocs.map(({ source, table }) => (
                <li key={`${source.meta.id}/${table}`} className="bg-white px-3 py-1.5 dark:bg-zinc-900">
                  <Link href={`/sources/${source.meta.id}/tables/${encodeURIComponent(table)}`} className="hover:underline">
                    {sourceTableLabel(source, table)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
