"use client";

import { useRef, useState } from "react";
import { Download, Upload, Users } from "lucide-react";
import { setDomainOverride } from "@/components/use-domain-model";
import { setWordCsv, useKoreanNames, useWordCsv } from "@/components/use-korean-names";
import { useWorkspace } from "@/components/workspace-provider";
import { readDomainOverrides } from "@/lib/client/opfs";
import { buildTeamSettings, importDomains, importRelations, mergeGlossary, mergeWords, parseTeamSettings } from "@/lib/client/team-settings";

// 팀 공유 설정(30단계, 5-9). 참조 관계, 단어 사전, 용어집, 바꾼 시스템을 한 파일로 내보내고 가져온다.
export function TeamSettings() {
  const { sources, relations, addRelations, glossary, setGlossary } = useWorkspace();
  const words = useWordCsv();
  const names = useKoreanNames();
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const current = sources.map((s) => ({ id: s.meta.id, name: s.meta.name, tables: s.tables }));

  async function exportFile() {
    const data = buildTeamSettings({ relations, sources: current, words, glossary, domains: await readDomainOverrides(), names });
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "data-view-team-settings.json";
    a.click();
    URL.revokeObjectURL(url);
    setMessage({
      text: `참조 관계 ${data.relations.relations.length}개, 단어 ${words.trim() ? words.trim().split(/\n/).length : 0}줄, 바꾼 시스템 ${data.domains.length}개, 한글 이름 ${data.tableNames.length}개를 담았습니다.`,
    });
  }

  async function importFile(file: File | undefined) {
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    try {
      const data = parseTeamSettings(await file.text());
      const rel = importRelations(data, current, relations);
      await addRelations(rel.added);
      const w = mergeWords(words, data.words);
      await setWordCsv(w.text);
      const g = mergeGlossary(glossary, data.glossary);
      await setGlossary(g.text);
      const d = importDomains(data, current);
      for (const { key, domain } of d.out) await setDomainOverride(key, domain);
      const skipped = rel.skipped + d.skipped;
      setMessage({
        text: `가져옴: 참조 관계 ${rel.added.length}개, 단어 ${w.changed}개, 용어집 ${g.changed}개, 시스템 ${d.out.length}개.${skipped ? ` ${skipped}개는 이미 있거나 같은 이름의 파일이 없어 건너뛰었습니다.` : ""}`,
      });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "파일을 읽지 못했습니다.", error: true });
    }
  }

  const button = "inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
  return (
    <section className="flex flex-col gap-2">
      <h2 className="inline-flex items-center gap-1.5 font-medium">
        <Users className="size-4" aria-hidden />
        팀 공유 설정
      </h2>
      <p className="text-sm text-zinc-500">
        확인한 참조 관계, 단어 사전(테이블 한글 이름), 기획서 이름 짝(용어집), 바꾼 시스템을 한 파일로 내보내 QA실 동료와 같이 씁니다. 가져오면 지금 설정에 더하고, 같은 단어는 가져온 뜻으로 바꿉니다.
        파일은 이름으로 맞추므로 동료와 같은 이름의 파일을 불러와 두어야 합니다. 데이터 값, DB 접속 정보, 기획서 내용은 들어가지 않습니다.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void exportFile()} className={button}>
          <Download className="size-4" aria-hidden />
          설정 내보내기
        </button>
        <button type="button" onClick={() => inputRef.current?.click()} className={button}>
          <Upload className="size-4" aria-hidden />
          설정 가져오기
        </button>
        <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" aria-label="팀 공유 설정 파일" onChange={(e) => void importFile(e.target.files?.[0])} />
        {message && <span className={`text-xs ${message.error ? "text-red-600" : "text-zinc-600 dark:text-zinc-400"}`}>{message.text}</span>}
      </div>
    </section>
  );
}
