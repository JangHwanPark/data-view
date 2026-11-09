"use client";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { useWorkspace } from "@/core/ui/workspace-provider";
import { buildExport, parseExport, remapRelations, type RelationsExport } from "@/core/relations";

const buttonClass =
  "inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

// 관계 설정을 JSON 파일로 내보내고 가져온다. 동료와 나누거나 다른 브라우저로 옮길 때 쓴다.
export function RelationTransfer() {
  const { sources, relations, addRelations } = useWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);
  const [incoming, setIncoming] = useState<RelationsExport | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  function exportFile() {
    const data = buildExport(
      relations,
      sources.map((s) => ({ id: s.meta.id, name: s.meta.name })),
    );
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "data-view-relations.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function readImport(file: File | undefined) {
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    setMessage(null);
    try {
      const data = parseExport(await file.text());
      // 이름이 하나만 맞는 소스는 자동으로 연결한다.
      const auto: Record<string, string> = {};
      for (const s of data.sources) {
        const matches = sources.filter((cur) => cur.meta.name === s.name);
        if (matches.length === 1) auto[s.id] = matches[0].meta.id;
      }
      if (data.sources.every((s) => auto[s.id])) {
        await apply(data, auto);
      } else {
        setIncoming(data);
        setMapping(auto);
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "파일을 읽지 못했습니다.", error: true });
    }
  }

  async function apply(data: RelationsExport, map: Record<string, string>) {
    const { added, skipped } = remapRelations(data, map, relations);
    await addRelations(added);
    setIncoming(null);
    setMessage({
      text: `참조 관계 ${added.length}개를 가져왔습니다.${skipped ? ` ${skipped}개는 이미 있거나 연결할 파일이 없어 건너뛰었습니다.` : ""}`,
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button type="button" className={buttonClass} disabled={relations.length === 0} onClick={exportFile}>
          <Download className="size-4" aria-hidden />
          내보내기
        </button>
        <button type="button" className={buttonClass} onClick={() => inputRef.current?.click()}>
          <Upload className="size-4" aria-hidden />
          가져오기
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => void readImport(e.target.files?.[0])}
        />
      </div>
      {message && <p className={`text-sm ${message.error ? "text-red-600" : "text-zinc-600 dark:text-zinc-400"}`}>{message.text}</p>}

      {incoming && (
        <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-3">이름이 같은 파일을 찾지 못했습니다. 어느 파일에 연결할지 골라 주세요.</p>
          <div className="flex flex-col gap-2">
            {incoming.sources.map((s) => (
              <label key={s.id} className="flex flex-col gap-1">
                <span className="text-zinc-500">{s.name}</span>
                <select
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                  value={mapping[s.id] ?? ""}
                  onChange={(e) => setMapping((prev) => ({ ...prev, [s.id]: e.target.value }))}
                >
                  <option value="">연결하지 않음</option>
                  {sources.map((cur) => (
                    <option key={cur.meta.id} value={cur.meta.id}>
                      {cur.meta.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className={buttonClass} onClick={() => setIncoming(null)}>
              취소
            </button>
            <button
              type="button"
              className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
              onClick={() => void apply(incoming, mapping)}
            >
              가져오기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
