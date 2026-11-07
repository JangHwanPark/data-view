"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { TableDiff } from "@/components/compare/table-diff";
import { sourceVersion, useWorkspace, type WorkspaceSource } from "@/components/workspace-provider";
import { compareSource, type TableSummary } from "@/lib/client/compare";
import { isFileSource, type FileSourceMeta } from "@/lib/client/opfs";

const STATUS_LABEL: Record<TableSummary["status"], string> = {
  changed: "바뀜",
  added: "새 시트",
  removed: "사라진 시트",
  same: "같음",
};

// 패치 전후 비교 화면(설계 4.9). 교체할 때 남겨 둔 이전 파일과 지금 파일을 시트별로 비교한다.
export function CompareView() {
  const { sources, initialized } = useWorkspace();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const withPrevious = sources.filter((s): s is WorkspaceSource & { meta: FileSourceMeta } => isFileSource(s.meta) && !!s.meta.previous);
  const chosen = withPrevious.find((s) => s.meta.id === searchParams.get("source")) ?? withPrevious[0] ?? null;

  function choose(id: string) {
    window.history.pushState(null, "", `${pathname}?source=${encodeURIComponent(id)}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">패치 전후 비교</h1>
        <p className="text-zinc-500">
          파일을 새 패치로 바꾸면 바로 전 파일을 한 벌 남겨 두고 비교합니다. 시트마다 새로 생긴 행, 사라진 행, 값이 바뀐 행을 세고, 사라진 ID를 다른 테이블이 아직 쓰고 있으면 따로 알려 줍니다.
        </p>
      </div>

      {!initialized ? (
        <p className="text-zinc-500">불러오는 중...</p>
      ) : withPrevious.length === 0 ? (
        <div className="flex flex-col gap-1 rounded-md border border-dashed border-zinc-300 p-4 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">아직 비교할 이전 파일이 없습니다.</p>
          <p>
            <Link href="/files" className="text-blue-700 hover:underline dark:text-blue-400">
              불러온 파일
            </Link>
            에서 파일을 열고 &lsquo;새 패치 파일로 교체&rsquo;를 누르거나, 같은 자리에 새 파일을 덮어쓴 뒤 &lsquo;원본 경로에서 다시 읽기&rsquo;를 누르면 그 전 파일이 남아 여기서 비교할 수 있습니다.
          </p>
          <p className="text-xs text-zinc-500">개발 DB에서 불러온 테이블은 아직 비교하지 않습니다.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {withPrevious.map((s) => (
              <button
                key={s.meta.id}
                type="button"
                onClick={() => choose(s.meta.id)}
                aria-pressed={s === chosen}
                className={`rounded border px-2 py-1 text-xs ${s === chosen ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"}`}
              >
                {s.meta.name}
              </button>
            ))}
          </div>
          {chosen && <SourceCompare key={chosen.meta.id} source={chosen} />}
        </>
      )}
    </div>
  );
}

function SourceCompare({ source }: { source: WorkspaceSource & { meta: FileSourceMeta } }) {
  const { meta } = source;
  const ready = source.status === "ready";
  const requestKey = ready ? `${sourceVersion(source)}|${meta.previous?.savedAt}` : null;
  const [loaded, setLoaded] = useState<{ key: string; value: TableSummary[] | string } | null>(null);
  const result = loaded?.key === requestKey ? loaded.value : null;
  const [picked, setPicked] = useState<string | null>(null);
  const [showSame, setShowSame] = useState(false);

  useEffect(() => {
    if (!requestKey) return;
    let active = true;
    compareSource(meta, source.tables)
      .then((value) => active && setLoaded({ key: requestKey, value }))
      .catch((e) => active && setLoaded({ key: requestKey, value: e instanceof Error ? e.message : String(e) }));
    return () => {
      active = false;
    };
    // meta와 테이블 목록은 requestKey에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const head = (
    <p className="text-xs text-zinc-500">
      이전 파일 {meta.previous?.fileName} ({meta.previous && new Date(meta.previous.savedAt).toLocaleString()}에 교체) → 지금 파일 {meta.fileName}
    </p>
  );

  if (!ready || result === null) {
    return (
      <div className="flex flex-col gap-2">
        {head}
        <p className="inline-flex items-center gap-2 text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {ready ? "두 파일을 비교하는 중입니다." : "지금 파일을 읽는 중입니다."}
        </p>
      </div>
    );
  }
  if (typeof result === "string") {
    return (
      <div className="flex flex-col gap-2">
        {head}
        <p className="text-red-600">비교하지 못했습니다. 이전 파일이 지워졌을 수 있습니다. 파일을 다시 교체해 주세요.</p>
        <pre className="text-xs whitespace-pre-wrap text-zinc-500">{result}</pre>
      </div>
    );
  }

  const changes = (t: TableSummary) => t.added + t.removed + t.changed + t.addedColumns.length + t.removedColumns.length;
  const different = result.filter((t) => t.status !== "same").sort((a, b) => changes(b) - changes(a));
  const same = result.filter((t) => t.status === "same");
  const current = result.find((t) => t.table === picked) ?? different[0] ?? null;

  return (
    <div className="flex flex-col gap-3">
      {head}
      <p>
        시트 {result.length}개 중 <strong>{different.length}</strong>개가 바뀌었습니다.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse overflow-hidden rounded-md border border-zinc-200 bg-white text-xs dark:border-zinc-800 dark:bg-zinc-900">
          <thead className="bg-zinc-50 text-left dark:bg-zinc-800">
            <tr>
              <th className="px-3 py-1.5 font-medium">시트</th>
              <th className="px-2 py-1.5 font-medium">상태</th>
              <th className="px-2 py-1.5 text-right font-medium">새로 생긴 행</th>
              <th className="px-2 py-1.5 text-right font-medium">사라진 행</th>
              <th className="px-2 py-1.5 text-right font-medium">값이 바뀐 행</th>
              <th className="px-2 py-1.5 text-right font-medium">행 수 (전 → 후)</th>
              <th className="px-2 py-1.5 font-medium">컬럼 변화</th>
            </tr>
          </thead>
          <tbody>
            {[...different, ...(showSame ? same : [])].map((t) => (
              <tr
                key={t.table}
                onClick={() => setPicked(t.table)}
                className={`cursor-pointer border-t border-zinc-100 dark:border-zinc-800 ${t === current ? "bg-blue-50 dark:bg-blue-950/40" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}
              >
                <td className="px-3 py-1.5 font-medium">{t.table}</td>
                <td className={`px-2 py-1.5 ${t.status === "same" ? "text-zinc-400" : t.status === "changed" ? "" : "text-amber-700 dark:text-amber-400"}`}>{STATUS_LABEL[t.status]}</td>
                <Num value={t.added} />
                <Num value={t.removed} warn />
                <Num value={t.changed} />
                <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">
                  {t.oldRows.toLocaleString()} → {t.newRows.toLocaleString()}
                </td>
                <td className="px-2 py-1.5 text-zinc-500">
                  {[...t.addedColumns.map((c) => `+${c}`), ...t.removedColumns.map((c) => `-${c}`)].join(", ")}
                  {!t.key && t.status === "changed" && <span className="ml-1 text-zinc-400">(ID 컬럼이 없어 줄 단위로 비교)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {same.length > 0 && (
        <button type="button" onClick={() => setShowSame((v) => !v)} className="inline-flex w-fit items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          {showSame ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
          바뀌지 않은 시트 {same.length}개 {showSame ? "숨기기" : "보기"}
        </button>
      )}
      {different.length === 0 && <p className="text-zinc-500">두 파일의 내용이 같습니다.</p>}
      {current && current.status !== "same" && <TableDiff key={current.table} meta={meta} summary={current} />}
    </div>
  );
}

function Num({ value, warn }: { value: number; warn?: boolean }) {
  return (
    <td className={`px-2 py-1.5 text-right tabular-nums ${value === 0 ? "text-zinc-300 dark:text-zinc-600" : warn ? "font-medium text-amber-700 dark:text-amber-400" : "font-medium"}`}>
      {value.toLocaleString()}
    </td>
  );
}
