"use client";

import { useRef, useState } from "react";
import { Check, Loader2, RefreshCw, Undo2, X } from "lucide-react";
import { Highlighted, KIND_LABEL, STATE_LABEL, TargetLabel } from "@/components/docs/doc-parts";
import { useCandidates } from "@/components/docs/use-candidates";
import { useWorkspace } from "@/components/workspace-provider";
import { isSelected, viewTerms, type TermState, type TermView } from "@/lib/client/doc-analysis";
import type { DocSection } from "@/lib/client/doc-import";
import { extractTerms } from "@/lib/client/doc-terms";

const KIND_NAME = { docx: "워드", pptx: "PPT", pdf: "PDF", xlsx: "엑셀" } as const;
const FILTERS: (TermState | "all")[] = ["candidate", "unmatched", "confirmed", "ignored", "all"];

// 절 목록, 본문, 용어 패널을 한 화면에 둔다. 본문에서 용어를 누르면 오른쪽에서 바로 후보를 확정한다.
export function DocView({ id }: { id: string }) {
  const { docs, mappings, initialized } = useWorkspace();
  const doc = docs.find((d) => d.meta.id === id);
  const [filter, setFilter] = useState<TermState | "all">("candidate");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // 한 문서의 용어는 렌더마다 다시 뽑아도 가볍다. 후보 계산은 키가 같으면 다시 하지 않는다.
  const terms = doc?.parsed ? extractTerms(doc.parsed) : null;
  const candidates = useCandidates(terms);

  if (!initialized) return <p className="text-zinc-500">불러오는 중...</p>;
  if (!doc) return <p className="text-zinc-500">이 기획서를 찾을 수 없습니다.</p>;
  if (doc.status === "loading") {
    return (
      <p className="inline-flex items-center gap-2 text-zinc-500">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        기획서를 읽는 중입니다.
      </p>
    );
  }
  if (doc.status === "error" || !doc.parsed || !terms) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        <p>기획서를 읽지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.</p>
        {doc.error && <pre className="mt-2 whitespace-pre-wrap text-xs">{doc.error}</pre>}
      </div>
    );
  }

  const views = viewTerms(terms, candidates && candidates !== "error" ? candidates : new Map(), mappings);
  const counts = Object.fromEntries(FILTERS.map((f) => [f, f === "all" ? views.length : views.filter((v) => v.state === f).length]));
  const sections = doc.parsed.sections;

  // 본문에서 용어를 누르면 그 용어가 보이도록 거르기를 풀고 선택한다.
  function select(key: string) {
    setSelectedKey(key);
    const v = views.find((x) => x.term.key === key);
    if (v && filter !== "all" && v.state !== filter) setFilter("all");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold break-all">{doc.meta.name}</h1>
        <p className="text-zinc-500">
          {KIND_NAME[doc.meta.kind]} 기획서, 절 {sections.length}개, 용어 {views.length}개 (확정 {counts.confirmed}, 확인 필요 {counts.candidate}, 매칭 안 됨 {counts.unmatched})
        </p>
        {!candidates && (
          <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            데이터와 맞춰 보는 중
          </span>
        )}
        {candidates === "error" && <span className="text-xs text-red-600">데이터와 맞춰 보지 못했습니다.</span>}
        <DocReplace id={doc.meta.id} originPath={doc.meta.originPath} />
        <p className="ml-auto text-xs text-zinc-500">
          <span className="text-blue-700 underline dark:text-blue-400">확정</span>{" "}
          <mark className="rounded-sm bg-amber-100 px-0.5 text-inherit dark:bg-amber-900/40">확인 필요</mark>{" "}
          <span className="text-red-600 underline decoration-wavy dark:text-red-400">매칭 안 됨</span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[11rem_minmax(0,1fr)_22rem]">
        <nav aria-label="절 목록" className="hidden lg:block">
          <ul className="sticky top-14 flex max-h-[calc(100vh-8rem)] flex-col gap-0.5 overflow-y-auto text-xs">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block truncate rounded px-2 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <DocBody sections={sections} views={views} selectedKey={selectedKey} onSelect={select} />
        <aside aria-label="용어 패널" className="lg:sticky lg:top-14 lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto">
          <div className="mb-2 flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded px-2 py-0.5 text-xs ${filter === f ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"}`}
              >
                {f === "all" ? "전체" : STATE_LABEL[f]} {counts[f]}
              </button>
            ))}
          </div>
          <TermList
            views={filter === "all" ? views : views.filter((v) => v.state === filter)}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
          />
          <GlossaryEditor />
        </aside>
      </div>
    </div>
  );
}

interface BodyProps {
  sections: DocSection[];
  views: TermView[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

function DocBody({ sections, views, selectedKey, onSelect }: BodyProps) {
  const hl = (text: string) => <Highlighted text={text} views={views} selectedKey={selectedKey} onSelect={onSelect} />;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {sections.map((s) => (
        <section key={s.id} id={s.id} className="scroll-mt-14 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 font-semibold">{hl(s.title)}</h2>
          {s.lines.map((line, i) => (
            <p key={i} className="leading-6">
              {hl(line)}
            </p>
          ))}
          {s.tables.map((table, ti) => (
            <div key={ti} className="mt-2 overflow-x-auto">
              <table className="border-collapse text-xs">
                <thead>
                  <tr>
                    {table.header.map((h, i) => (
                      <th key={i} className="border border-zinc-200 bg-zinc-50 px-2 py-1 text-left font-medium dark:border-zinc-700 dark:bg-zinc-800">
                        {hl(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="border border-zinc-200 px-2 py-1 dark:border-zinc-700">
                          {hl(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

interface ListProps {
  views: TermView[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

function TermList({ views, selectedKey, onSelect }: ListProps) {
  const { sources, setMapping, clearMapping } = useWorkspace();
  if (views.length === 0) return <p className="text-xs text-zinc-500">해당하는 용어가 없습니다.</p>;
  const sorted = [...views].sort((a, b) => (b.candidates[0]?.score ?? 0) - (a.candidates[0]?.score ?? 0) || a.term.text.localeCompare(b.term.text));
  return (
    <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 bg-white text-xs dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {sorted.map((v) => {
        const open = v.term.key === selectedKey;
        const top = v.candidates[0];
        return (
          <li key={v.term.key} className={open ? "bg-blue-50/60 dark:bg-blue-950/30" : ""}>
            <button type="button" onClick={() => onSelect(open ? null : v.term.key)} className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left">
              <span className="min-w-0 flex-1 truncate font-medium">{v.term.text}</span>
              <span className="shrink-0 text-zinc-400">{KIND_LABEL[v.term.kind]}</span>
              <span
                className={`shrink-0 ${v.state === "unmatched" ? "text-red-600" : v.state === "candidate" ? "text-amber-700 dark:text-amber-400" : v.state === "confirmed" ? "text-blue-700 dark:text-blue-400" : "text-zinc-500"}`}
              >
                {v.state === "candidate" && top ? `${Math.round(top.score * 100)}%` : STATE_LABEL[v.state]}
              </span>
            </button>
            {open && (
              <div className="flex flex-col gap-1.5 px-2.5 pb-2">
                {v.state === "confirmed" && v.target && (
                  <p className="text-zinc-600 dark:text-zinc-400">
                    확정: <TargetLabel target={v.target} sources={sources} />
                  </p>
                )}
                {v.candidates.length === 0 ? (
                  <p className="text-zinc-500">{v.term.kind === "id" ? "어느 테이블의 키에도 없는 값입니다. 데이터에서 빠졌거나 아직 없는 ID일 수 있습니다." : "맞는 테이블이나 열이 없습니다. 옛 이름이거나 아직 없는 테이블일 수 있습니다."}</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {v.candidates.map((c, i) => (
                      <li key={i} className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isSelected(v, c)}
                            onClick={() => void setMapping({ key: v.term.key, text: v.term.text, target: c.target })}
                            className="inline-flex min-w-0 items-center gap-0.5 rounded border border-zinc-300 px-1.5 py-0.5 hover:bg-zinc-100 disabled:border-blue-300 disabled:text-blue-700 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:disabled:text-blue-400"
                            title="이 대상으로 확정"
                          >
                            <Check className="size-3 shrink-0" aria-hidden />
                            <span className="truncate">
                              <TargetLabel target={c.target} sources={sources} />
                            </span>
                          </button>
                          <span className="tabular-nums text-zinc-500">{Math.round(c.score * 100)}%</span>
                        </div>
                        <span className="pl-1 text-zinc-400">{c.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div>
                  {v.state === "confirmed" || v.state === "ignored" ? (
                    <button type="button" onClick={() => void clearMapping(v.term.key)} className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      <Undo2 className="size-3" aria-hidden />
                      되돌리기
                    </button>
                  ) : (
                    <button type="button" onClick={() => void setMapping({ key: v.term.key, text: v.term.text, target: null })} className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="데이터와 상관없는 말로 표시">
                      <X className="size-3" aria-hidden />
                      무시
                    </button>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// 기획서 새 판으로 교체. 확정한 용어 매칭은 용어 키에 묶여 있어 그대로 이어진다.
function DocReplace({ id, originPath }: { id: string; originPath?: string }) {
  const { replaceDocument, reloadFromOrigin } = useWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (p: Promise<void>) => {
    setError(null);
    p.catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  const cls = "inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
  return (
    <span className="flex items-center gap-1.5">
      {originPath && (
        <button type="button" className={cls} title={originPath} onClick={() => run(reloadFromOrigin(id))}>
          <RefreshCw className="size-3" aria-hidden />
          원본 경로에서 다시 읽기
        </button>
      )}
      <button type="button" className={cls} onClick={() => inputRef.current?.click()}>
        <RefreshCw className="size-3" aria-hidden />
        새 판으로 교체
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".docx,.pptx,.pdf,.xlsx"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) run(replaceDocument(id, file));
          e.target.value = "";
        }}
      />
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

function GlossaryEditor() {
  const { glossary, setGlossary } = useWorkspace();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <details className="mt-3 rounded-md border border-zinc-200 bg-white p-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="cursor-pointer">용어집</summary>
      <p className="mt-1.5 text-zinc-500">한글 용어를 테이블 이름의 영어 단어로 바꿀 때 씁니다. 한 줄에 하나씩 &lsquo;한글=English&rsquo;로 적고, 저장하면 후보를 다시 계산합니다.</p>
      <textarea
        aria-label="용어집"
        value={draft ?? glossary}
        onChange={(e) => setDraft(e.target.value)}
        rows={8}
        className="mt-2 w-full rounded border border-zinc-300 bg-white p-2 font-mono dark:border-zinc-700 dark:bg-zinc-950"
      />
      <button
        type="button"
        disabled={draft === null || draft === glossary}
        onClick={() => void setGlossary(draft ?? glossary).then(() => setDraft(null))}
        className="mt-1 rounded-md bg-zinc-900 px-3 py-1 font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        저장
      </button>
    </details>
  );
}
