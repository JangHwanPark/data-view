"use client";

import { useSearchParams } from "next/navigation";
import { parsePathKind, PathImport } from "./path-import";

// 주소의 kind(data, doc)로 무엇을 불러오러 왔는지 정한다. 종류를 바꾸면 목록과 고른 값을 새로 시작한다.
export function PathImportPage() {
  const kind = parsePathKind(useSearchParams().get("kind"));
  return <PathImport key={kind ?? "all"} kind={kind} />;
}
