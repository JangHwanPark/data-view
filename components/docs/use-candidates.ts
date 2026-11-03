"use client";

import { useEffect, useState } from "react";
import { sourceVersion, useWorkspace } from "@/components/workspace-provider";
import { analyze } from "@/lib/client/doc-analysis";
import type { Candidate } from "@/lib/client/doc-infer";
import type { DocTerm } from "@/lib/client/doc-terms";

// 기획서 용어의 후보를 계산한다. 기획서 화면과 기획서 목록 화면이 같이 쓴다.
// 데이터 소스나 용어집이 바뀌면 다시 계산한다.
export function useCandidates(terms: DocTerm[] | null) {
  const { sources, glossary, initialized } = useWorkspace();
  const loading = !initialized || sources.some((s) => s.status === "loading");
  const ready = sources.filter((s) => s.status === "ready");
  const requestKey = terms && !loading ? JSON.stringify([terms.map((t) => t.key), ready.map(sourceVersion), glossary]) : null;
  const [loaded, setLoaded] = useState<{ key: string; value: Map<string, Candidate[]> | "error" } | null>(null);

  useEffect(() => {
    if (!requestKey || !terms) return;
    let active = true;
    const tables = ready.flatMap((s) => s.tables.map((table) => ({ sourceId: s.meta.id, table })));
    analyze(terms, tables, glossary)
      .then((value) => active && setLoaded({ key: requestKey, value }))
      .catch(() => active && setLoaded({ key: requestKey, value: "error" }));
    return () => {
      active = false;
    };
    // terms, ready, glossary는 requestKey에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  return loaded && loaded.key === requestKey ? loaded.value : null;
}
