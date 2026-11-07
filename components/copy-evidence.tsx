"use client";

import { useState } from "react";
import { Check, ClipboardCopy } from "lucide-react";
import { copyText } from "@/lib/client/evidence";

// 근거 복사 단추(29단계). 누르면 정해 둔 꼴의 글을 클립보드에 넣고 잠깐 「복사함」을 보여준다.
// text는 누를 때 만든다(값을 읽는 데 시간이 드는 근거도 있어서).
export function CopyEvidence({ text, label = "근거 복사", compact = false }: { text: () => string | Promise<string>; label?: string; compact?: boolean }) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyText(await text());
    setState(ok ? "done" : "fail");
    setTimeout(() => setState("idle"), 1500);
  }
  return (
    <button
      type="button"
      onClick={(e) => void copy(e)}
      title={`${label}: 버그 보고에 붙여 넣을 글을 복사합니다`}
      aria-label={label}
      className={`inline-flex shrink-0 items-center gap-1 rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 ${compact ? "p-0.5" : "px-1.5 py-0.5 text-[11px]"}`}
    >
      {state === "done" ? <Check className="size-3 text-emerald-600" aria-hidden /> : <ClipboardCopy className="size-3" aria-hidden />}
      {!compact && (state === "done" ? "복사함" : state === "fail" ? "복사 못 함" : label)}
    </button>
  );
}
