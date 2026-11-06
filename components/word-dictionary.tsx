"use client";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { InferredMark } from "@/components/table-name";
import { setWordCsv, useKoreanNames, useWordCsv } from "@/components/use-korean-names";
import { useWorkspace } from "@/components/workspace-provider";
import { DEFAULT_WORDS_CSV, parseWordCsv } from "@/lib/client/korean-name";

// 단어 사전(25단계, 3-5). 테이블 이름의 영어 단어를 한글로 옮기는 사전이다. 한 줄에 「영어,한글」.
// 기본 사전에 더하거나 바꾼다. 사전에 없는 단어를 모아 보여주어 채워 넣기 쉽게 한다.
export function WordDictionary() {
  const saved = useWordCsv();
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const names = useKoreanNames();
  const { sources } = useWorkspace();
  const value = draft ?? saved;

  const tables = sources.filter((s) => s.status === "ready").flatMap((s) => s.tables.map((t) => ({ key: `${s.meta.id}/${t}`, table: t })));
  const inferred = tables.filter((t) => names.get(t.key)?.inferred);
  const designed = tables.filter((t) => names.get(t.key) && !names.get(t.key)!.inferred).length;
  const missing = tables.filter((t) => !names.get(t.key));
  const unknown = [...new Set(inferred.flatMap((t) => names.get(t.key)!.unknown))].sort();

  function download() {
    // 기본 사전과 사용자 사전을 합쳐 내려받는다. 회사에서 고쳐 다시 불러올 수 있다.
    const merged = new Map([...parseWordCsv(DEFAULT_WORDS_CSV), ...parseWordCsv(saved)]);
    const text = ["english,korean", ...[...merged].map(([en, ko]) => `${en},${ko}`)].join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "word-dictionary.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function upload(file: File) {
    const text = (await file.text()).replace(/^﻿/, "");
    const count = parseWordCsv(text).size;
    await setWordCsv(text);
    setDraft(null);
    setNote(`${file.name}에서 단어 ${count}개를 불러왔습니다.`);
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">단어 사전(테이블 한글 이름)</h2>
      <p className="text-sm text-zinc-500">
        엑셀 #Design 시트의 머리말이 있으면 그 이름을 쓰고, 없으면 이 사전으로 테이블 이름의 영어 단어를 옮겨 한글 이름을 짓습니다(「추론」 표시). 한 줄에 「영어,한글」로 적습니다.
        기본 사전에 있는 단어도 여기 적으면 이 뜻으로 바뀝니다. ItemByType은 「종류별 아이템」, GoldPerLevel은 「레벨당 골드」처럼 짓습니다.
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        테이블 {tables.length}개 중 머리말 이름 {designed}개, 사전으로 지은 이름 {inferred.length}개, 이름 없음 {missing.length}개
      </p>
      {unknown.length > 0 && (
        <div className="text-sm">
          <span className="text-zinc-500">사전에 없는 단어(누르면 아래에 줄을 더합니다): </span>
          {unknown.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDraft(`${value.replace(/\s*$/, "")}${value.trim() ? "\n" : ""}${w},`)}
              className="mr-1 mb-1 rounded border border-zinc-300 px-1.5 py-px font-mono text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {w}
            </button>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <p className="text-xs text-zinc-500">
          이름 없음: {missing.slice(0, 20).map((t) => t.table).join(", ")}
          {missing.length > 20 ? ` 외 ${missing.length - 20}개` : ""}
        </p>
      )}
      <textarea
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        rows={6}
        placeholder={"Prise,옛 가격\nDaily,일일"}
        aria-label="단어 사전"
        className="w-full max-w-xl rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          disabled={draft === null || draft === saved}
          onClick={() => void setWordCsv(draft ?? saved).then(() => setDraft(null))}
          className="rounded bg-zinc-900 px-3 py-1 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          저장
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          <Upload className="size-3.5" aria-hidden />
          csv 불러오기
        </button>
        <button type="button" onClick={download} className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          <Download className="size-3.5" aria-hidden />
          전체 사전 csv로 내려받기
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
        {note && <span className="text-xs text-zinc-500">{note}</span>}
      </div>
      {inferred.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-500">사전으로 지은 이름 {inferred.length}개 보기</summary>
          <ul className="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
            {inferred.map((t) => (
              <li key={t.key} className="flex items-center gap-1">
                <span className="font-mono text-xs text-zinc-500">{t.table}</span>→<span>{names.get(t.key)!.text}</span>
                <InferredMark name={names.get(t.key)!} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
