"use client";

import { useEffect, useState } from "react";
import { sourceVersion, useWorkspace, type WorkspaceDoc } from "@/core/ui/workspace-provider";
import { checkDoc, type DocCheckResult } from "./doc-check";
import { loadCatalog } from "@/core/doc-infer";

// 기획서 하나를 데이터와 맞춰 본 결과. 데이터나 기획서가 바뀌기 전까지는 다시 계산하지 않는다.
const cache = new Map<string, Promise<DocCheckResult>>();

export function useDocCheck(doc: WorkspaceDoc | undefined) {
  const { sources, initialized } = useWorkspace();
  const loading = !initialized || sources.some((s) => s.status === "loading");
  const ready = sources.filter((s) => s.status === "ready");
  const key =
    doc?.parsed && !loading ? JSON.stringify([doc.meta.id, doc.meta.replacedAt ?? doc.meta.createdAt, ready.map(sourceVersion)]) : null;
  const [loaded, setLoaded] = useState<{ key: string; value: DocCheckResult | "error" } | null>(null);

  useEffect(() => {
    if (!key || !doc?.parsed) return;
    let active = true;
    if (!cache.has(key)) {
      const tables = ready.flatMap((s) => s.tables.map((table) => ({ sourceId: s.meta.id, table })));
      cache.set(key, loadCatalog(tables).then((catalog) => checkDoc(doc.parsed!, catalog)));
    }
    cache
      .get(key)!
      .then((value) => active && setLoaded({ key, value }))
      .catch(() => {
        cache.delete(key);
        if (active) setLoaded({ key, value: "error" });
      });
    return () => {
      active = false;
    };
    // doc, ready는 key에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return loaded && loaded.key === key ? loaded.value : null;
}
