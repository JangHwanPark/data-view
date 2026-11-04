import type { DocTarget } from "@/lib/client/doc-infer";
import type { DocTerm } from "@/lib/client/doc-terms";
import type { KeyValue } from "@/lib/client/follow";
import { quoteIdent, quoteString } from "@/lib/query-result";

// 기획서에서 연 행. 테이블 화면 주소의 row 쿼리에 넣어 새로고침이나 공유 후에도 같은 행을 연다.
export interface RowFocus {
  column: string;
  value: string;
}

export function parseRowFocus(raw: string | null): RowFocus | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as unknown;
    if (data && typeof data === "object" && "column" in data && "value" in data) {
      const { column, value } = data as Record<string, unknown>;
      if (typeof column === "string" && typeof value === "string" && column) return { column, value };
    }
  } catch {
    // 손으로 고친 주소는 무시하고 표 전체를 보여준다.
  }
  return null;
}

export function tableHref(sourceId: string, table: string, focus?: RowFocus | null) {
  const base = `/sources/${sourceId}/tables/${encodeURIComponent(table)}`;
  return focus ? `${base}?row=${encodeURIComponent(JSON.stringify(focus))}` : base;
}

// 용어가 가리키는 행의 키 값. ID는 그 숫자 자체, 따옴표 이름은 다국어 문자열 key다.
// 이름 용어(테이블, 열)는 행이 아니라 테이블을 가리키므로 null이다.
export function targetRowValue(term: DocTerm, target: DocTarget): string | null {
  if (!target.column) return null;
  if (term.kind === "id") return term.text;
  if (term.kind === "quoted") return target.value ?? null;
  return null;
}

// 용어를 눌렀을 때 갈 곳. 행을 가리키면 그 행을, 아니면 테이블을 연다.
export function termHref(term: DocTerm, target: DocTarget) {
  const value = targetRowValue(term, target);
  return tableHref(target.sourceId, target.table, value !== null && target.column ? { column: target.column, value } : null);
}

// 기획서의 값은 글자라서, 숫자처럼 생겼으면 숫자 열(800.0)과도 맞도록 숫자로도 비교한다.
export function focusKey(focus: RowFocus): KeyValue {
  return /^-?\d+(\.\d+)?$/.test(focus.value) ? { value: focus.value, numeric: true } : { value: focus.value };
}

// 따라가기 조회(fetchLinkedRows)와 같은 기준으로 행을 찾는 WHERE 절.
export function focusWhere(focus: RowFocus) {
  const col = quoteIdent(focus.column);
  const key = focusKey(focus);
  const numeric = key.numeric ? ` OR TRY_CAST(${col} AS DOUBLE) = ${Number(key.value)}` : "";
  return `(CAST(${col} AS VARCHAR) = ${quoteString(key.value)}${numeric})`;
}

// 문장 안에 이 값이 단어로 나오는지. 71005를 찾을 때 710050이나 1.71005는 세지 않는다.
export function valuePattern(value: string) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_.])${escaped}(?![A-Za-z0-9_]|\\.\\d)`);
}
