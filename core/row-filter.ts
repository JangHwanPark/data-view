import { quoteIdent, quoteString } from "@/shared/lib/query-result";

// 여러 조건으로 행 거르기(PLAN.md 30단계, 5-6). QA가 경계값(0, 최댓값)이나 「등급 3 이상이면서 판매 가능」 같은 행을 찾을 때 쓴다.
// 조건은 모두 맞아야(그리고) 한다. 주소의 f 쿼리에 JSON으로 두어 새로고침, 주소 나누기, 뒤로 가기가 된다.

export type FilterOp = "eq" | "ne" | "gt" | "ge" | "lt" | "le" | "contains" | "empty" | "notEmpty";

export interface RowFilter {
  column: string;
  op: FilterOp;
  value: string;
}

export const OP_LABEL: Record<FilterOp, string> = {
  eq: "같음 (=)",
  ne: "다름 (≠)",
  gt: "보다 큼 (>)",
  ge: "이상 (≥)",
  lt: "보다 작음 (<)",
  le: "이하 (≤)",
  contains: "들어 있음",
  empty: "비어 있음",
  notEmpty: "비어 있지 않음",
};

export const NO_VALUE: FilterOp[] = ["empty", "notEmpty"];
const COMPARE: Partial<Record<FilterOp, string>> = { gt: ">", ge: ">=", lt: "<", le: "<=" };

const isNumber = (v: string) => /^-?\d+(\.\d+)?$/.test(v.trim().replace(/,/g, ""));

export function filterSql(f: RowFilter) {
  const col = quoteIdent(f.column);
  const text = `CAST(${col} AS VARCHAR)`;
  const v = f.value.trim();
  const n = v.replace(/,/g, "");
  switch (f.op) {
    case "empty":
      return `(${col} IS NULL OR trim(${text}) = '')`;
    case "notEmpty":
      return `(${col} IS NOT NULL AND trim(${text}) <> '')`;
    case "contains":
      return `${text} ILIKE ${quoteString(`%${v.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)} ESCAPE '\\'`;
    case "eq":
    case "ne": {
      // 숫자는 800과 800.0을 같게 본다.
      const same = isNumber(v) ? `(${text} = ${quoteString(v)} OR TRY_CAST(${col} AS DOUBLE) = ${Number(n)})` : `(${text} = ${quoteString(v)})`;
      return f.op === "eq" ? same : `(${col} IS NULL OR NOT ${same})`;
    }
    default: {
      const op = COMPARE[f.op]!;
      // 숫자면 숫자로, 아니면 글자 순서로 비교한다(날짜 2026-01-01 같은 글자도 순서가 맞는다).
      return isNumber(v) ? `TRY_CAST(${col} AS DOUBLE) ${op} ${Number(n)}` : `${text} ${op} ${quoteString(v)}`;
    }
  }
}

export function filtersWhere(filters: RowFilter[], columns: string[]) {
  return filters.filter((f) => columns.includes(f.column) && (NO_VALUE.includes(f.op) || f.value.trim() !== "")).map(filterSql);
}

export function parseFilters(raw: string | null): RowFilter[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (f): f is RowFilter => typeof f?.column === "string" && typeof f?.value === "string" && typeof f?.op === "string" && f.op in OP_LABEL,
    );
  } catch {
    return [];
  }
}

export function describeFilter(f: RowFilter) {
  return NO_VALUE.includes(f.op) ? `${f.column} ${OP_LABEL[f.op]}` : `${f.column} ${OP_LABEL[f.op].replace(/ \(.*\)$/, "")} ${f.value}`;
}
