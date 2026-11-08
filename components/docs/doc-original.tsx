"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, FileText, Search } from "lucide-react";
import { useKoreanNames } from "@/components/use-korean-names";
import { useWorkspace, type WorkspaceDoc } from "@/components/workspace-provider";
import type { DocBlock, DocCell, DocRun, ParsedDoc } from "@/lib/client/doc-import";

// 기획서 원문 창(PLAN.md 26단계, 3-8). 워드의 서식(제목 수준, 번호, 글머리표, 굵게, 가로로 합친 칸, 목차, 글상자)을 살려 그린다.
// 찾기 칸에 말을 넣고 F3(다음), Shift+F3(이전)으로 옮겨 다닌다. 오른쪽에는 이 문서에 나오는 테이블이 나오는 다른 문서를 둔다.
// 주소의 #s3은 그 절로, ?q=Fruit는 그 말을 찾은 채로 연다.

export function DocOriginal({ doc, initialQuery }: { doc: WorkspaceDoc; initialQuery: string }) {
  const parsed = doc.parsed!;
  const blocks = useMemo(() => parsed.blocks ?? blocksFromSections(parsed), [parsed]);
  const [query, setQuery] = useState(initialQuery);
  const [current, setCurrent] = useState(0);
  const q = query.trim();

  // 찾은 곳을 그리는 차례대로 센다. 같은 차례로 다시 그리므로 번호가 맞는다.
  let hitCount = 0;
  const highlight = (text: string) => {
    if (!q) return text;
    const parts = splitMatches(text, q);
    return parts.map((part, i) => {
      if (!part.hit) return part.text;
      const n = hitCount++;
      return (
        <mark key={i} data-hit={n} className={`rounded-sm px-0.5 text-inherit ${n === current ? "bg-orange-300 dark:bg-orange-700" : "bg-yellow-200 dark:bg-yellow-800/60"}`}>
          {part.text}
        </mark>
      );
    });
  };
  const runs = (list: DocRun[]) =>
    list.map((r, i) =>
      r.bold ? (
        <strong key={i} className="font-semibold">
          {highlight(r.text)}
        </strong>
      ) : (
        <span key={i}>{highlight(r.text)}</span>
      ),
    );
  const firstOfSection = new Set<number>();
  const seen = new Set<string>();
  blocks.forEach((b, i) => {
    if (!seen.has(b.sectionId)) {
      seen.add(b.sectionId);
      firstOfSection.add(i);
    }
  });

  const body = blocks.map((b, i) => {
    const anchor = firstOfSection.has(i) ? b.sectionId : undefined;
    if (b.kind === "heading") {
      const size = b.level <= 1 ? "text-lg" : b.level === 2 ? "text-base" : "text-[15px]";
      return (
        <div key={i} id={anchor} className={`scroll-mt-20 pt-3 font-semibold ${size}`} title={`스타일: ${b.style}`}>
          {b.label && <span className="mr-1.5 text-zinc-500">{b.label}</span>}
          {runs(b.runs)}
        </div>
      );
    }
    if (b.kind === "table") {
      return (
        <div key={i} id={anchor} className="scroll-mt-20 overflow-x-auto">
          <table className="my-1 border-collapse text-[13px]">
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell: DocCell, c) =>
                    cell.merged ? null : (
                      <td
                        key={c}
                        colSpan={cell.span > 1 ? cell.span : undefined}
                        rowSpan={cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : undefined}
                        className={`border border-zinc-300 px-2 py-1 align-top dark:border-zinc-700 ${r === 0 ? "bg-zinc-50 dark:bg-zinc-800/60" : ""} ${cell.span > 1 ? "text-center" : ""}`}
                        title={cell.span > 1 ? `가로로 ${cell.span}칸 합친 칸` : cell.rowSpan && cell.rowSpan > 1 ? `세로로 ${cell.rowSpan}칸 합친 칸` : undefined}
                      >
                        {runs(cell.runs)}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    const cls = b.toc
      ? "text-zinc-400 dark:text-zinc-500"
      : b.textbox
        ? "rounded border border-zinc-300 bg-zinc-50 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800/50"
        : b.title
          ? "text-xl font-bold"
          : "";
    return (
      <div
        key={i}
        id={anchor}
        className={`scroll-mt-20 whitespace-pre-wrap ${cls}`}
        style={b.label ? { paddingLeft: `${(b.indent ?? 0) * 1.25 + 1.5}rem`, textIndent: "-1.25rem" } : b.toc ? { paddingLeft: "1rem" } : undefined}
        title={b.toc ? "목차 줄" : b.textbox ? "글상자" : undefined}
      >
        {b.textbox && <span className="mr-1 text-[11px] text-zinc-500">글상자</span>}
        {b.label && <span className="mr-1 inline-block min-w-4 text-zinc-500">{b.label}</span>}
        {runs(b.runs)}
      </div>
    );
  });
  const total = hitCount;

  // 지금 찾은 곳이 보이게 옮긴다.
  useEffect(() => {
    if (!q || !total) return;
    document.querySelector(`[data-hit="${current}"]`)?.scrollIntoView({ block: "center" });
  }, [q, current, total]);

  // 주소의 #절로 처음 한 번 옮긴다.
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash) document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, []);

  // F3, Shift+F3. 브라우저의 찾기 창 대신 이 문서 안에서 옮긴다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F3") return;
      e.preventDefault();
      if (!total) return;
      setCurrent((c) => (e.shiftKey ? (c - 1 + total) % total : (c + 1) % total));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  const shown = total ? Math.min(current, total - 1) : 0;
  const sections = parsed.sections;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_18rem]">
      <nav aria-label="제목 목록" className="hidden lg:block">
        <ul className="sticky top-14 flex max-h-[calc(100vh-8rem)] flex-col gap-0.5 overflow-y-auto text-xs">
          {sections.map((s) => (
            <li key={s.id} style={{ paddingLeft: `${Math.max(0, (s.level ?? 1) - 1) * 0.75}rem` }}>
              <a href={`#${s.id}`} className="block truncate rounded px-2 py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800" title={s.path?.join(" > ")}>
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="sticky top-12 z-10 flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-white/95 px-2 py-1.5 text-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
          <Search className="size-4 text-zinc-400" aria-hidden />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCurrent(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && total) {
                e.preventDefault();
                setCurrent((c) => (e.shiftKey ? (c - 1 + total) % total : (c + 1) % total));
              }
            }}
            placeholder="원문에서 찾기 (F3 다음, Shift+F3 이전)"
            aria-label="원문에서 찾기"
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
          {q && (
            <span className="text-xs tabular-nums text-zinc-500" aria-live="polite">
              {total ? `${shown + 1}/${total}` : "없음"}
            </span>
          )}
          <button type="button" disabled={!total} onClick={() => setCurrent((c) => (c - 1 + total) % total)} className="rounded p-0.5 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800" aria-label="이전 (Shift+F3)">
            <ChevronUp className="size-4" aria-hidden />
          </button>
          <button type="button" disabled={!total} onClick={() => setCurrent((c) => (c + 1) % total)} className="rounded p-0.5 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800" aria-label="다음 (F3)">
            <ChevronDown className="size-4" aria-hidden />
          </button>
        </div>
        <article className="flex flex-col gap-1.5 rounded-md border border-zinc-200 bg-white px-5 py-4 leading-relaxed dark:border-zinc-800 dark:bg-zinc-900">{body}</article>
      </div>
      <SharedTableDocs doc={doc} onPick={(word) => {
        setQuery(word);
        setCurrent(0);
      }} />
    </div>
  );
}

// 찾는 말과 맞는 부분을 나눈다. 대소문자는 가리지 않는다.
export function splitMatches(text: string, query: string): { text: string; hit: boolean }[] {
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); needle && at >= 0; at = lower.indexOf(needle, at + needle.length)) {
    if (at > from) out.push({ text: text.slice(from, at), hit: false });
    out.push({ text: text.slice(at, at + needle.length), hit: true });
    from = at + needle.length;
  }
  if (from < text.length) out.push({ text: text.slice(from), hit: false });
  return out;
}

// 워드가 아닌 문서(PPT, PDF, 엑셀)는 절 제목, 줄, 표로 원문을 대신한다.
function blocksFromSections(parsed: ParsedDoc): DocBlock[] {
  return parsed.sections.flatMap((s) => [
    { kind: "heading" as const, sectionId: s.id, level: 1, runs: [{ text: s.title }], style: "절 제목" },
    ...s.lines.map((line) => ({ kind: "para" as const, sectionId: s.id, runs: [{ text: line }], style: "" })),
    ...s.tables.map((t) => ({ kind: "table" as const, sectionId: s.id, rows: [t.header, ...t.rows].map((row) => row.map((c) => ({ runs: [{ text: c }], span: 1 }))) })),
  ]);
}

// 문서 전체 글(절 제목, 줄, 표 칸).
export function docText(parsed: ParsedDoc) {
  return parsed.sections.flatMap((s) => [s.title, ...s.lines, ...s.tables.flatMap((t) => [...t.header, ...t.rows.flat()])]).join("\n");
}

// 영문 테이블 이름은 앞뒤가 영문, 숫자, _가 아닐 때만 그 이름으로 본다(QuestCondition 속 Quest는 세지 않는다).
export function mentions(text: string, table: string) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`).test(text);
}

// 같은 테이블이 나오는 다른 문서. 불러온 테이블 이름이 이 문서에 나오면, 그 이름이 나오는 다른 문서를 모은다.
function SharedTableDocs({ doc, onPick }: { doc: WorkspaceDoc; onPick: (word: string) => void }) {
  const { docs, sources } = useWorkspace();
  const names = useKoreanNames();
  const tables = [...new Set(sources.filter((s) => s.status === "ready").flatMap((s) => s.tables))];
  const texts = new Map(docs.filter((d) => d.parsed).map((d) => [d.meta.id, docText(d.parsed!)]));
  const mine = texts.get(doc.meta.id) ?? "";
  const found = tables.filter((t) => mentions(mine, t)).sort();
  const koreanOf = (table: string) => [...names.entries()].find(([k]) => k.endsWith(`/${table}`))?.[1]?.text;
  return (
    <aside aria-label="같은 테이블이 나오는 다른 문서" className="flex flex-col gap-2 text-xs lg:sticky lg:top-14 lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto">
      <p className="font-medium text-zinc-600 dark:text-zinc-300">이 문서에 나오는 테이블 {found.length}개</p>
      {found.length === 0 && <p className="text-zinc-400">불러온 테이블 이름이 이 문서에 나오지 않습니다.</p>}
      <ul className="flex flex-col gap-1.5">
        {found.map((t) => {
          const others = docs.filter((d) => d.meta.id !== doc.meta.id && mentions(texts.get(d.meta.id) ?? "", t));
          return (
            <li key={t} className="rounded border border-zinc-200 px-2 py-1 dark:border-zinc-800">
              <button type="button" onClick={() => onPick(t)} className="font-mono font-medium hover:underline" title="이 문서에서 찾기">
                {t}
              </button>
              {koreanOf(t) && <span className="ml-1 text-zinc-500">{koreanOf(t)}</span>}
              {others.length === 0 ? (
                <p className="text-zinc-400">다른 문서에는 나오지 않음</p>
              ) : (
                <ul>
                  {others.map((d) => (
                    <li key={d.meta.id}>
                      <Link href={`/docs/${d.meta.id}?view=original&q=${encodeURIComponent(t)}`} className="inline-flex items-center gap-1 text-blue-700 hover:underline dark:text-blue-400">
                        <FileText className="size-3" aria-hidden />
                        {d.meta.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
