"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Gamepad2, Loader2 } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";
import { fetchLocalFile, listLocalFiles } from "@/lib/client/local-files";

const DOC_EXT = /\.(docx|pptx|pdf|xlsx)$/i;

// "테스트용 게임 데이터로 시작하기". 테스트 데이터가 없으면 서버가 만들고, 게임 테이블 15개와 기획서를 한 번에 불러온다.
// 불러온 파일은 경로를 기억하므로 다른 파일처럼 "원본 경로에서 다시 읽기"가 된다.
// kind가 shape이면 회사 시트와 같은 모양(머리글 위 설명 줄, 두 줄 머리글, ; 비활성 행, # 메모 열, Level#1~3)의
// 과일 농장 테이블 10개와 기획서를 불러온다(22, 23단계).
interface Props {
  kind?: "game" | "shape";
  compact?: boolean;
  onBusy?: (busy: boolean) => void;
  onNote?: (message: string) => void; // 일부 파일을 못 불러왔을 때. 화면이 바뀌어도 안내가 남도록 부모가 보여준다
}

export function SampleLoader({ kind = "game", compact = false, onBusy, onNote }: Props) {
  const { sources, docs, addFile, addDocument } = useWorkspace();
  const router = useRouter();
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    onBusy?.(true);
    try {
      setProgress("테스트 데이터를 준비하는 중입니다. 처음에는 30초쯤 걸립니다.");
      const res = await fetch("/api/sample", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = (await res.json()) as { game?: string; docs?: string; shape?: string; shapeDocs?: string; error?: { message: string } };
      const tableDir = kind === "shape" ? body.shape : body.game;
      const docDir = kind === "shape" ? body.shapeDocs : body.docs;
      if (!res.ok || !tableDir || !docDir) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      // 이미 연 파일은 다시 열지 않는다.
      const opened = new Set([
        ...sources.flatMap((s) => ("originPath" in s.meta && s.meta.originPath ? [s.meta.originPath] : [])),
        ...docs.flatMap((d) => (d.meta.originPath ? [d.meta.originPath] : [])),
      ]);
      const tables = (await listLocalFiles(tableDir)).filter((f) => !opened.has(f.path) && !f.name.endsWith(".json"));
      const docFiles = (await listLocalFiles(docDir)).filter((f) => DOC_EXT.test(f.name) && !opened.has(f.path));
      const all = [...tables.map((f) => ({ f, doc: false })), ...docFiles.map((f) => ({ f, doc: true }))];
      // 파일 하나가 실패해도 나머지는 불러오고, 끝에 실패한 파일을 알려 준다.
      const failed: string[] = [];
      for (const [i, { f, doc }] of all.entries()) {
        setProgress(`${i + 1}/${all.length} ${f.name} 불러오는 중`);
        try {
          const file = await fetchLocalFile(f.path);
          if (doc) await addDocument(file, f.path);
          else await addFile(file, f.path);
        } catch {
          failed.push(f.name);
        }
      }
      setProgress(null);
      onBusy?.(false);
      if (failed.length) {
        const message = `테스트 데이터 ${all.length - failed.length}개를 불러왔고, ${failed.length}개는 불러오지 못했습니다: ${failed.join(", ")}`;
        setError(message);
        onNote?.(message);
      } else router.push("/");
    } catch (e) {
      setProgress(null);
      onBusy?.(false);
      setError(`테스트 데이터를 불러오지 못했습니다. ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => void load()}
        disabled={progress !== null}
        className={`inline-flex w-fit items-center gap-2 rounded-md border border-zinc-300 bg-white font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800 ${compact ? "px-2.5 py-1 text-xs" : "px-3 py-2"}`}
      >
        {progress ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Gamepad2 className="size-4" aria-hidden />}
        {kind === "shape" ? "회사 시트 모양 테스트 데이터(과일 농장)" : "테스트용 게임 데이터로 시작하기"}
      </button>
      {progress && <p className="text-xs text-zinc-500">{progress}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!compact && !progress && !error && kind === "shape" && (
        <p className="text-xs text-zinc-500">머리글 위 설명 줄, 두 줄 머리글, ;로 막은 행, # 메모 열, Level#1~3 번호 열처럼 회사 시트와 같은 모양으로 만든 가짜 데이터입니다.</p>
      )}
      {!compact && !progress && !error && kind === "game" && (
        <p className="text-xs text-zinc-500">퀘스트, 아이템, 보상 같은 게임 테이블 15개와 일부러 데이터와 어긋나게 쓴 기획서를 불러옵니다. 사내 데이터 없이 기능을 둘러볼 때 씁니다.</p>
      )}
    </div>
  );
}
