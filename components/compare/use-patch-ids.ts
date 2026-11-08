"use client";

import { useEffect, useState } from "react";
import { sourceVersion, type WorkspaceSource } from "@/components/workspace-provider";
import { compareOne, patchIds, type PatchIds, type TableSummary } from "@/lib/client/compare";

// 바뀐 Id 목록을 다른 화면에서 쓰기(37단계). 테이블 하나의 전후 비교 요약과 새로 생긴/값이 바뀐 Id를 돌려준다.
// 이전 버전이 없으면 null, 읽는 중이면 "loading".
export interface PatchInfo {
  summary: TableSummary;
  ids: PatchIds | null; // ID 열이 없거나 바뀐 것이 없으면 null
}

const cache = new Map<string, Promise<PatchInfo | null>>();

export function usePatchIds(source: WorkspaceSource | undefined, table: string): PatchInfo | null | "loading" {
  const ready = source?.status === "ready" && source.tables.includes(table) && !!source.meta.previous;
  const key = ready && source ? `${sourceVersion(source)}|${source.meta.previous!.savedAt}|${table}` : null;
  const [state, setState] = useState<{ key: string; value: PatchInfo | null } | null>(null);
  useEffect(() => {
    if (!key || !source) return;
    let active = true;
    if (!cache.has(key)) {
      const promise = compareOne(source.meta, table, source.tables).then(async (summary) =>
        summary ? { summary, ids: await patchIds(source.meta, summary) } : null,
      );
      promise.catch(() => cache.delete(key));
      cache.set(key, promise);
    }
    cache
      .get(key)!
      .then((value) => active && setState({ key, value }))
      .catch(() => active && setState({ key, value: null }));
    return () => {
      active = false;
    };
    // source와 table은 key에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!key) return null;
  return state?.key === key ? state.value : "loading";
}

export type PatchFilter = "all" | "added" | "changed";

export function parsePatchFilter(value: string | null): PatchFilter | null {
  return value === "all" || value === "added" || value === "changed" ? value : null;
}

export function patchFilterIds(ids: PatchIds, filter: PatchFilter) {
  return filter === "added" ? ids.added : filter === "changed" ? ids.changed : [...ids.added, ...ids.changed];
}
