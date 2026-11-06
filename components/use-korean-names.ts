"use client";

import { useMemo, useSyncExternalStore } from "react";
import { sourceVersion, useWorkspace } from "@/components/workspace-provider";
import { parseGlossary } from "@/lib/client/doc-infer";
import { tableRules } from "@/lib/client/file-import";
import { buildDictionary, koreanNames, type KoreanName, type NameMode } from "@/lib/client/korean-name";
import { readWordsFile, writeWordsFile } from "@/lib/client/opfs";

// 테이블 한글 이름(25단계)을 여러 화면이 같이 쓴다. 사용자 단어 사전은 OPFS에, 이름 표시 방식은 브라우저에 둔다.

let words: string | null = null;
const wordListeners = new Set<() => void>();
function loadWords() {
  if (words !== null) return;
  words = "";
  readWordsFile()
    .then((value) => {
      words = value;
      wordListeners.forEach((l) => l());
    })
    .catch(() => {});
}

export async function setWordCsv(text: string) {
  words = text;
  wordListeners.forEach((l) => l());
  await writeWordsFile(text);
}

export function useWordCsv() {
  return useSyncExternalStore(
    (l) => {
      loadWords();
      wordListeners.add(l);
      return () => wordListeners.delete(l);
    },
    () => words ?? "",
    () => "",
  );
}

const MODE_KEY = "data-view:name-mode";
const modeListeners = new Set<() => void>();
function readMode(): NameMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "en" || v === "ko" || v === "both" ? v : "both";
  } catch {
    return "both";
  }
}
export function setNameMode(mode: NameMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // 저장이 막힌 브라우저에서는 이번 화면에서만 바뀐다.
  }
  modeListeners.forEach((l) => l());
}
export function useNameMode(): NameMode {
  return useSyncExternalStore(
    (l) => {
      modeListeners.add(l);
      return () => modeListeners.delete(l);
    },
    readMode,
    () => "both" as NameMode,
  );
}

// 테이블 키(소스id/테이블) → 한글 이름. 다 읽은 소스의 테이블만 짓는다.
export function useKoreanNames(): Map<string, KoreanName> {
  const { sources, glossary } = useWorkspace();
  const csv = useWordCsv();
  const ready = sources.filter((s) => s.status === "ready");
  // 파일을 바꾸면 #Design 머리말도 바뀔 수 있어 소스 버전을 같이 본다.
  const signature = JSON.stringify(ready.map((s) => [s.meta.id, s.meta.name, s.tables, sourceVersion(s)]));
  return useMemo(() => {
    const dict = buildDictionary(csv, parseGlossary(glossary));
    const inputs = (JSON.parse(signature) as [string, string, string[], string][]).flatMap(([id, name, tables]) =>
      tables.map((table) => ({ key: `${id}/${table}`, table, title: tableRules(id, table)?.title ?? null, sourceName: name })),
    );
    return koreanNames(inputs, dict);
  }, [signature, csv, glossary]);
}
