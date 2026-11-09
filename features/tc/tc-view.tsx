"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ClipboardList, Loader2, Trash2, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { useKoreanNames } from "@/core/ui/use-korean-names";
import { sourceVersion, useWorkspace } from "@/core/ui/workspace-provider";
import { tableHref } from "@/core/doc-links";
import { runQuery } from "@/core/duckdb";
import { findHeaderRow, inactiveIds, qualifiedTable, twinInactive } from "@/core/file-import";
import { fetchLocalFile, listLocalFiles } from "@/core/local-files";
import { readTcFiles, writeTcFiles, type TcFile, type TcSheet } from "@/core/opfs";
import { loadColumns } from "@/core/schema";
import { findRefs, splitByRefs, type TcRef } from "./tc-links";
import { quoteIdent, quoteString } from "@/shared/lib/query-result";

// TC 시트(PLAN.md 30단계, 5-8). QA가 쓰는 확인 항목 엑셀을 불러와 참조 칸(Fruit 1001, 과일 가격(FruitPrice) 9002 …)을
// 그 테이블을 그 ID로 거른 화면 링크로 바꾼다. 데이터에 없는 ID와 비활성 행은 따로 표시한다.
// 불러온 TC는 읽은 표만 브라우저 저장소(OPFS)에 둔다.

function parseTc(buffer: ArrayBuffer): TcSheet[] {
  const book = XLSX.read(buffer, { dense: true });
  return book.SheetNames.flatMap((name) => {
    const aoa = XLSX.utils
      // 빈 줄도 읽어야 머리글 줄 번호가 엑셀과 같다.
      .sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: false, defval: "", blankrows: true })
      .map((row) => row.map((v) => String(v ?? "").trim()));
    if (!aoa.some((r) => r.some(Boolean))) return [];
    const h = findHeaderRow(aoa);
    const width = Math.max(...aoa.map((r) => r.length));
    const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? "");
    return [{ name, headerRow: h + 1, header: pad(aoa[h]), rows: aoa.slice(h + 1).filter((r) => r.some(Boolean)).map(pad) }];
  });
}

type RefState = "ok" | "missing" | "inactive";

export function TcView() {
  const { sources, initialized } = useWorkspace();
  const names = useKoreanNames();
  const [files, setFiles] = useState<TcFile[] | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    readTcFiles()
      .then(setFiles)
      .catch(() => setFiles([]));
  }, []);

  async function save(next: TcFile[]) {
    setFiles(next);
    await writeTcFiles(next);
  }

  async function add(file: File) {
    try {
      const sheets = parseTc(await file.arrayBuffer());
      const tc: TcFile = { id: crypto.randomUUID().slice(0, 12), name: file.name, addedAt: new Date().toISOString(), sheets };
      await save([...(files ?? []), tc]);
      setPickedId(tc.id);
      setSheetIndex(0);
      setNote(`${file.name}: 시트 ${sheets.length}개, 행 ${sheets.reduce((n, s) => n + s.rows.length, 0)}개를 불러왔습니다.`);
    } catch (e) {
      setNote(`${file.name}을(를) 읽지 못했습니다. ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function addSample() {
    setNote("테스트용 TC를 준비하는 중");
    try {
      const res = await fetch("/api/sample", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = (await res.json()) as { shapeTc?: string };
      if (!body.shapeTc) throw new Error("테스트 데이터 위치를 받지 못했습니다.");
      for (const f of (await listLocalFiles(body.shapeTc)).filter((x) => /\.xlsx$/i.test(x.name))) await add(await fetchLocalFile(f.path));
    } catch (e) {
      setNote(`테스트용 TC를 불러오지 못했습니다. ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 테이블 이름 → 소스. 같은 이름을 여러 소스로 열었으면 엑셀을 먼저 쓴다.
  const ready = sources.filter((s) => s.status === "ready");
  const tableSource = new Map<string, string>();
  for (const s of [...ready].sort((a, b) => (a.meta.kind === "excel" ? -1 : 0) - (b.meta.kind === "excel" ? -1 : 0))) {
    for (const t of s.tables) if (!tableSource.has(t)) tableSource.set(t, s.meta.id);
  }
  const tableNames = [...tableSource.entries()].map(([table, sourceId]) => ({ table, korean: names.get(`${sourceId}/${table}`)?.base ?? null }));

  const picked = files?.find((f) => f.id === pickedId) ?? files?.[0] ?? null;
  const sheet = picked?.sheets[Math.min(sheetIndex, (picked?.sheets.length ?? 1) - 1)] ?? null;
  const cellRefs = sheet ? sheet.rows.map((row) => row.map((cell) => findRefs(cell, tableNames))) : [];
  const allRefs = cellRefs.flat(2);
  const states = useRefStates(allRefs, tableSource, ready.map(sourceVersion).join("|"));
  const stateOf = (r: TcRef) => states?.get(refKey(r));
  const missing = allRefs.filter((r) => stateOf(r) === "missing").length;
  const inactive = allRefs.filter((r) => stateOf(r) === "inactive").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="inline-flex items-center gap-2 text-lg font-semibold">
          <ClipboardList className="size-5" aria-hidden />
          TC 시트
        </h1>
        <p className="text-zinc-500">
          확인 항목(TC) 엑셀을 불러오면 참조 칸의 「Fruit 1001」, 「Fruit.Id=1003」, 「과일 가격(FruitPrice) 9002」 같은 글을 그 테이블을 그 ID로 거른 화면 링크로 바꿉니다.
          데이터에 없는 ID는 빨간색, 엑셀에서 ;로 막아 둔 비활성 행은 노란색으로 표시합니다. 불러온 TC는 이 브라우저에만 저장됩니다.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
          <Upload className="size-4" aria-hidden />
          TC 엑셀 불러오기
        </button>
        <button type="button" onClick={() => void addSample()} className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          테스트용 TC(과일 농장)
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          aria-label="TC 엑셀 파일"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void add(f);
            e.target.value = "";
          }}
        />
        {note && <span className="text-xs text-zinc-500">{note}</span>}
      </div>

      {files === null || !initialized ? (
        <p className="inline-flex items-center gap-1 text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          불러오는 중
        </p>
      ) : files.length === 0 ? (
        <p className="text-zinc-500">불러온 TC가 없습니다.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            {files.map((f) => (
              <span key={f.id} className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 ${f.id === picked?.id ? "border-zinc-900 dark:border-zinc-100" : "border-zinc-300 dark:border-zinc-700"}`}>
                <button type="button" onClick={() => (setPickedId(f.id), setSheetIndex(0))} className="hover:underline">
                  {f.name}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`${f.name}을(를) 목록에서 지울까요?`)) void save(files.filter((x) => x.id !== f.id));
                  }}
                  aria-label={`${f.name} 지우기`}
                  className="text-zinc-400 hover:text-red-600"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </span>
            ))}
          </div>
          {picked && picked.sheets.length > 1 && (
            <div className="flex gap-1 text-xs" role="group" aria-label="시트">
              {picked.sheets.map((s, i) => (
                <button key={s.name} type="button" onClick={() => setSheetIndex(i)} aria-pressed={sheet === s} className={`rounded px-2 py-0.5 ${sheet === s ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 dark:bg-zinc-800"}`}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
          {sheet && (
            <>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {sheet.name}: {sheet.rows.length}행(머리글 {sheet.headerRow}행), 테이블 참조 {allRefs.length}개
                {states ? (
                  <>
                    {missing > 0 && <span className="text-red-700 dark:text-red-400"> · 데이터에 없는 ID {missing}개</span>}
                    {inactive > 0 && <span className="text-amber-700 dark:text-amber-400"> · 비활성 행 {inactive}개</span>}
                    {!missing && !inactive && allRefs.length > 0 && " · 모두 데이터에 있음"}
                  </>
                ) : (
                  allRefs.length > 0 && " · 데이터에 있는지 확인하는 중"
                )}
              </p>
              <div className="overflow-x-auto rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-zinc-100 text-xs text-zinc-500 dark:bg-zinc-800">
                    <tr>
                      {sheet.header.map((h, i) => (
                        <th key={i} className="px-2 py-1.5 font-medium whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.rows.map((row, r) => (
                      <tr key={r} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                        {row.map((cell, c) => (
                          <td key={c} className="px-2 py-1.5">
                            {splitByRefs(cell, cellRefs[r][c]).map((part, k) =>
                              "ref" in part ? (
                                <RefLink key={k} text={part.text} r={part.ref} sourceId={tableSource.get(part.ref.table)!} state={stateOf(part.ref)} />
                              ) : (
                                <span key={k}>{part.text}</span>
                              ),
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const refKey = (r: Pick<TcRef, "table" | "column" | "value">) => `${r.table}|${r.column ?? ""}|${r.value}`;

function RefLink({ text, r, sourceId, state }: { text: string; r: TcRef; sourceId: string; state?: RefState }) {
  const [column, setColumn] = useState<string | null>(r.column);
  // 컬럼을 적지 않았으면 그 테이블의 첫 컬럼(ID)을 쓴다. 링크를 그릴 때 한 번만 찾는다.
  useEffect(() => {
    if (r.column) return;
    let active = true;
    firstColumn(sourceId, r.table).then((c) => active && setColumn(c));
    return () => {
      active = false;
    };
  }, [sourceId, r.table, r.column]);
  const cls =
    state === "missing"
      ? "text-red-700 decoration-wavy dark:text-red-400"
      : state === "inactive"
        ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
        : "text-blue-700 dark:text-blue-400";
  const title = state === "missing" ? "데이터에 이 ID의 행이 없습니다" : state === "inactive" ? "엑셀에서 ;로 막아 둔 비활성 행입니다" : "누르면 이 테이블을 이 값으로 거른 화면을 엽니다";
  if (!column) return <span className={cls}>{text}</span>;
  return (
    <Link href={`${tableHref(sourceId, r.table, { column, value: r.value })}&view=data`} className={`rounded-sm underline ${cls}`} title={title}>
      {text}
      {state === "missing" && " (없음)"}
      {state === "inactive" && " (비활성)"}
    </Link>
  );
}

const firstCache = new Map<string, Promise<string | null>>();
function firstColumn(sourceId: string, table: string) {
  const key = `${sourceId}/${table}`;
  if (!firstCache.has(key)) firstCache.set(key, loadColumns().then((m) => m.get(key)?.[0]?.name ?? null));
  return firstCache.get(key)!;
}

// 참조한 ID가 데이터에 있는지, 비활성 행인지 테이블마다 한 번씩 묻는다.
function useRefStates(refs: TcRef[], tableSource: Map<string, string>, version: string) {
  const signature = JSON.stringify([version, [...new Set(refs.map(refKey))].sort()]);
  const [loaded, setLoaded] = useState<{ key: string; map: Map<string, RefState> } | null>(null);
  useEffect(() => {
    const list = (JSON.parse(signature) as [string, string[]])[1].map((k) => {
      const [table, column, value] = k.split("|");
      return { table, column: column || null, value };
    });
    if (!list.length) return;
    let active = true;
    (async () => {
      const map = new Map<string, RefState>();
      const groups = new Map<string, typeof list>();
      for (const r of list) groups.set(`${r.table}|${r.column ?? ""}`, [...(groups.get(`${r.table}|${r.column ?? ""}`) ?? []), r]);
      for (const [, group] of groups) {
        const { table } = group[0];
        const sourceId = tableSource.get(table);
        if (!sourceId) continue;
        const column = group[0].column ?? (await firstColumn(sourceId, table));
        if (!column) continue;
        const c = quoteIdent(column);
        const values = group.map((g) => g.value);
        const r = await runQuery(
          `SELECT DISTINCT regexp_replace(CAST(${c} AS VARCHAR), '\\.0+$', '') FROM ${qualifiedTable(sourceId, table)} WHERE regexp_replace(CAST(${c} AS VARCHAR), '\\.0+$', '') IN (${values.map(quoteString).join(", ")})`,
          values.length + 1,
        );
        const found = new Set(r.rows.map((row) => String(row[0])));
        const off = twinInactive(sourceId, table)?.ids ?? inactiveIds(sourceId, table);
        for (const g of group) map.set(refKey(g), !found.has(g.value) ? "missing" : off.has(g.value) ? "inactive" : "ok");
      }
      return map;
    })()
      .then((map) => active && setLoaded({ key: signature, map }))
      .catch(() => {});
    return () => {
      active = false;
    };
    // tableSource는 version에 따라 바뀐다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return loaded?.key === signature ? loaded.map : null;
}
