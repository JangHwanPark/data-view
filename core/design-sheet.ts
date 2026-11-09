// #Design, #Definition 시트 읽기(PLAN.md 24단계). 회사 시트는 데이터 시트 옆에 컬럼 설명 시트를 둔다.
// - #Design: 1행 머리말(테이블 한글 이름, 예: 「과일」), 2행 「컬럼 | 설명」, 그 아래 컬럼마다 설명.
//   설명 안의 <테이블>과 [컬럼]은 그 컬럼이 가리키는 곳이다(「<Color> 테이블의 [Id] 참조」).
// - #Definition: 「컬럼 | 정의」 표. #Design에 없는 컬럼(값의 뜻만 적은 것)이 여기에 있다.
// 이 파일은 브라우저 없이도 돌 수 있게 순수 함수만 둔다.

export type DescKind = "design" | "definition";

export interface DesignRef {
  table: string; // <테이블>
  column: string | null; // [컬럼]. 없으면 그 테이블의 ID 열
}

export interface ColumnDesc {
  column: string; // 설명 시트에 적힌 이름(Level#처럼 번호를 뗀 것일 수 있다)
  columns: string[]; // 데이터 표에서 맞는 컬럼(Level# → Level#1, Level#2, Level#3)
  text: string;
  from: DescKind;
  refs: DesignRef[];
}

export interface DescSheet {
  kind: DescKind;
  title: string | null; // 머리말
  rows: { column: string; text: string }[];
}

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
const HEADER_WORDS = /^(컬럼|컬럼명|열|필드|column|columns|field|name)$/i;

// 시트 이름으로 설명 시트인지와 종류를 본다. #Design, #Definition, #Design_Fruit 꼴.
export function descSheetKind(sheetName: string): { kind: DescKind; target: string | null } | null {
  const m = sheetName.trim().match(/^#\s*(design|definition|def)(?:[_\-(:\s]+([^)]*?))?\)?\s*$/i);
  if (!m) return null;
  return { kind: /^design$/i.test(m[1]) ? "design" : "definition", target: m[2]?.trim() || null };
}

export function parseDescSheet(aoa: unknown[][], kind: DescKind): DescSheet {
  // 「컬럼」이라고 적힌 칸으로 시작하는 줄이 표의 머리글이다. 없으면 첫 줄부터 표로 본다.
  let header = aoa.findIndex((row) => !blank(row[0]) && HEADER_WORDS.test(String(row[0]).trim()));
  const titleRows = header >= 0 ? aoa.slice(0, header) : [];
  const title = titleRows.map((r) => r.filter((v) => !blank(v))).find((cells) => cells.length >= 1)?.[0];
  if (header < 0) header = -1;
  const rows: DescSheet["rows"] = [];
  for (const row of aoa.slice(header + 1)) {
    if (blank(row[0])) continue;
    const text = row
      .slice(1)
      .filter((v) => !blank(v))
      .map((v) => String(v).trim())
      .join(" ");
    rows.push({ column: String(row[0]).trim(), text });
  }
  return { kind, title: title === undefined ? null : String(title).trim(), rows };
}

// 설명 문구 안의 <테이블>[컬럼]. [컬럼]은 <테이블> 바로 뒤 20글자 안에 있을 때만 그 테이블의 컬럼으로 본다.
export function parseRefs(text: string): DesignRef[] {
  const refs: DesignRef[] = [];
  const re = /<\s*([A-Za-z_][\w]*)\s*>([^<]{0,20}?\[\s*([^\]\s]+)\s*\])?/g;
  for (const m of text.matchAll(re)) {
    if (!refs.some((r) => r.table === m[1] && r.column === (m[3] ?? null))) refs.push({ table: m[1], column: m[3] ?? null });
  }
  return refs;
}

// 설명 시트의 컬럼 이름을 데이터 표의 컬럼과 맞춘다. 대소문자는 가리지 않고, Level#처럼 끝이 #이면 Level#1~n 모두.
export function matchColumns(name: string, dataColumns: string[]): string[] {
  const lower = name.toLowerCase();
  const exact = dataColumns.filter((c) => c.toLowerCase() === lower);
  if (exact.length) return exact;
  if (lower.endsWith("#")) return dataColumns.filter((c) => c.toLowerCase().startsWith(lower) && /^\d+$/.test(c.slice(name.length)));
  return [];
}

// 설명 시트들을 한 테이블의 컬럼 설명으로 합친다. 같은 컬럼이 두 시트에 있으면 #Design을 쓴다.
export function columnDescriptions(sheets: DescSheet[], dataColumns: string[]): { title: string | null; descriptions: ColumnDesc[] } {
  const ordered = [...sheets.filter((s) => s.kind === "design"), ...sheets.filter((s) => s.kind === "definition")];
  const descriptions: ColumnDesc[] = [];
  for (const sheet of ordered) {
    for (const row of sheet.rows) {
      if (!row.text) continue;
      if (descriptions.some((d) => d.column.toLowerCase() === row.column.toLowerCase())) continue;
      descriptions.push({ column: row.column, columns: matchColumns(row.column, dataColumns), text: row.text, from: sheet.kind, refs: parseRefs(row.text) });
    }
  }
  const title = sheets.find((s) => s.kind === "design" && s.title)?.title ?? null;
  return { title, descriptions };
}
