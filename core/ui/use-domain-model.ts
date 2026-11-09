"use client";

import { useEffect, useSyncExternalStore } from "react";
import { sourceVersion, useWorkspace } from "@/core/ui/workspace-provider";
import { findAutoLinks, type AutoLink } from "@/core/auto-links";
import { buildModel, type DomainModel } from "@/core/domain-model";
import { readDomainOverrides, writeDomainOverrides } from "@/core/opfs";
import { loadColumns, loadRowCounts } from "@/core/schema";

// 모든 테이블의 자동 연결(설계 4.12 D1). 화면을 옮겨 다녀도 다시 찾지 않도록 모듈에 결과를 둔다.
// 테이블 하나의 자동 연결은 findAutoLinks가 따로 캐시하므로, 테이블 화면에서 이미 찾은 테이블은 바로 끝난다.
interface Scan {
  key: string;
  done: number;
  total: number;
  result: { links: AutoLink[]; firstColumns: Map<string, string>; rowCounts: Map<string, number> } | null;
  error?: string;
}

let scan: Scan | null = null;
const scanListeners = new Set<() => void>();
function setScan(next: Scan) {
  scan = next;
  scanListeners.forEach((l) => l());
}

function startScan(
  key: string,
  version: string,
  tables: { sourceId: string; table: string }[],
  relations: Parameters<typeof findAutoLinks>[3],
  kinds: Map<string, string>,
) {
  if (scan?.key === key) return;
  setScan({ key, done: 0, total: tables.length, result: null });
  (async () => {
    const links: AutoLink[] = [];
    for (let i = 0; i < tables.length; i++) {
      links.push(...(await findAutoLinks(version, tables, tables[i], relations, kinds)));
      // 진행률은 몇 테이블마다 알린다. 매번 알리면 화면이 테이블 수만큼 다시 그려진다.
      if (scan?.key !== key) return;
      if (i % 4 === 3) setScan({ ...scan, done: i + 1 });
    }
    const columns = await loadColumns();
    const rowCounts = await loadRowCounts();
    const firstColumns = new Map([...columns].filter(([, cols]) => cols[0]).map(([k, cols]) => [k, cols[0].name]));
    // 두 테이블이 서로를 찾으면 같은 연결이 두 번 나오므로 id로 한 번만 남긴다.
    const unique = [...new Map(links.map((l) => [l.relation.id, l])).values()];
    if (scan?.key === key) setScan({ key, done: tables.length, total: tables.length, result: { links: unique, firstColumns, rowCounts } });
  })().catch((e) => {
    if (scan?.key === key) setScan({ key, done: 0, total: tables.length, result: null, error: e instanceof Error ? e.message : String(e) });
  });
}

// 사용자가 바꾼 도메인(D3). 여러 화면이 같이 보므로 모듈에 두고 OPFS에 저장한다.
let overrides: Record<string, string> | null = null;
const overrideListeners = new Set<() => void>();
function loadOverrides() {
  if (overrides !== null) return;
  overrides = {};
  readDomainOverrides()
    .then((value) => {
      overrides = value;
      overrideListeners.forEach((l) => l());
    })
    .catch(() => {});
}

export async function setDomainOverride(tableKey: string, domain: string | null) {
  const next = { ...(overrides ?? {}) };
  if (domain && domain.trim()) next[tableKey] = domain.trim();
  else delete next[tableKey];
  overrides = next;
  overrideListeners.forEach((l) => l());
  await writeDomainOverrides(next);
}

const EMPTY = {};
function useOverrides() {
  return useSyncExternalStore(
    (l) => {
      loadOverrides();
      overrideListeners.add(l);
      return () => overrideListeners.delete(l);
    },
    () => overrides ?? EMPTY,
    () => EMPTY,
  );
}

function useScan() {
  return useSyncExternalStore(
    (l) => {
      scanListeners.add(l);
      return () => scanListeners.delete(l);
    },
    () => scan,
    () => null,
  );
}

export interface DomainModelState {
  model: DomainModel | null;
  progress: { done: number; total: number } | null; // 찾는 중일 때만 있다
  reasons: Map<string, string>; // 자동 연결의 근거
  rowCounts: Map<string, number>;
  error?: string;
}

export function useDomainModel(): DomainModelState {
  const { sources, relations, initialized } = useWorkspace();
  const loading = !initialized || sources.some((s) => s.status === "loading");
  const ready = sources.filter((s) => s.status === "ready");
  const version = ready.map(sourceVersion).join("|");
  const scanKey = loading ? null : JSON.stringify([version, relations.map((r) => r.id)]);
  const current = useScan();
  const userDomains = useOverrides();

  useEffect(() => {
    if (!scanKey) return;
    const tables = ready.flatMap((s) => s.tables.map((table) => ({ sourceId: s.meta.id, table })));
    const kinds = new Map(ready.map((s) => [s.meta.id, s.meta.kind === "mysql" ? "db" : "file"]));
    startScan(scanKey, version, tables, relations, kinds);
    // ready, relations, version은 scanKey에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanKey]);

  const own = current && current.key === scanKey ? current : null;
  const result = own?.result ?? null;

  // 모델 계산은 테이블 수백 개에서도 가벼우므로 렌더 때마다 만든다. 무거운 부분(자동 연결)은 위에서 끝났다.
  const model = result
    ? buildModel({
        tables: ready.flatMap((s) =>
          s.tables.map((table) => ({
            sourceId: s.meta.id,
            table,
            sourceName: s.meta.name,
            sourceKind: s.meta.kind,
            firstColumn: result.firstColumns.get(`${s.meta.id}/${table}`) ?? null,
          })),
        ),
        relations: [...relations, ...result.links.map((l) => l.relation)],
        overrides: userDomains,
      })
    : null;

  return {
    model,
    // 데이터를 읽는 중이거나 아직 찾기 전이면 0/0으로 알려 화면이 비어 보이지 않게 한다.
    progress: own && !own.result && !own.error ? { done: own.done, total: own.total } : !own && (loading || scanKey) ? { done: 0, total: 0 } : null,
    reasons: new Map((result?.links ?? []).map((l) => [l.relation.id, l.reason])),
    rowCounts: result?.rowCounts ?? new Map(),
    error: own?.error,
  };
}
