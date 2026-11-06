"use client";

import { useKoreanNames, useNameMode } from "@/components/use-korean-names";
import { displayName, type KoreanName, type NameMode } from "@/lib/client/korean-name";

// 테이블 이름 표시(25단계). 이름 표시 방식(영어, 한글, 한글 영어)을 따르고, 사전으로 지은 한글 이름에는 「추론」을 붙인다.
export function InferredMark({ name }: { name: KoreanName }) {
  if (!name.inferred) return null;
  const tip = `단어 사전으로 지은 이름입니다.${name.unknown.length ? ` 사전에 없는 단어: ${name.unknown.join(", ")}` : ""} 불러온 파일 화면의 단어 사전에서 고칠 수 있습니다.`;
  return (
    <span className="ml-1 shrink-0 rounded bg-zinc-100 px-1 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" title={tip}>
      추론
    </span>
  );
}

export function TableName({ sourceId, table, mode, className }: { sourceId: string; table: string; mode?: NameMode; className?: string }) {
  const names = useKoreanNames();
  const chosen = useNameMode();
  const name = names.get(`${sourceId}/${table}`);
  const m = mode ?? chosen;
  return (
    <span className={className} title={name ? `${name.text} · ${table}` : table}>
      {displayName(table, name, m)}
      {name && m !== "en" && <InferredMark name={name} />}
    </span>
  );
}
