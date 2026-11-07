// TC 시트와 테이블 잇기(PLAN.md 30단계, 5-8). QA가 쓰는 확인 항목(TC) 엑셀의 칸에서 테이블과 ID를 찾아 링크로 바꾼다.
// 알아보는 꼴:
//   Fruit 1001 / Fruit#1001 / Fruit:1001      테이블 이름 + ID(테이블의 첫 컬럼)
//   Fruit.Id=1003 / Fruit.NameKey=Str_Fruit_1  테이블.컬럼=값
//   과일 가격(FruitPrice) 9002 / 과일 1001       한글 이름(괄호 안 영어 이름이 있으면 그쪽) + ID
// 테이블 이름은 대소문자를 가리지 않고, 불러온 테이블에 있는 이름만 링크로 만든다. 브라우저 없이 돌 수 있게 순수 함수만 둔다.

export interface TcRef {
  start: number;
  end: number;
  table: string; // 불러온 테이블의 실제 이름
  column: string | null; // 적었으면 그 컬럼, 아니면 첫 컬럼
  value: string;
}

export interface TableName {
  table: string;
  korean?: string | null; // 한글 이름(괄호 전)
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function findRefs(text: string, tables: TableName[]): TcRef[] {
  const refs: TcRef[] = [];
  const byLower = new Map(tables.map((t) => [t.table.toLowerCase(), t.table]));
  const taken = (s: number, e: number) => refs.some((r) => s < r.end && e > r.start);

  // 1. 한글 이름(영어 이름) ID. 영어 이름이 있으면 그것으로 테이블을 고른다.
  for (const t of tables) {
    if (!t.korean || t.korean.length < 2) continue;
    const re = new RegExp(`${escape(t.korean)}\\s*(?:\\(\\s*([A-Za-z_]\\w*)\\s*\\))?\\s*[#:]?\\s*(\\d{2,})(?![\\d.])`, "g");
    for (const m of text.matchAll(re)) {
      const table = m[1] ? byLower.get(m[1].toLowerCase()) : t.table;
      if (!table || taken(m.index!, m.index! + m[0].length)) continue;
      refs.push({ start: m.index!, end: m.index! + m[0].length, table, column: null, value: m[2] });
    }
  }
  // 2. 테이블.컬럼=값, 테이블 ID
  const re = /(?<![A-Za-z0-9_])([A-Za-z_]\w*)(?:\.([A-Za-z_#][\w#]*)\s*=\s*([^\s,;)]+)|\s*[#:]?\s*(\d{2,})(?![\d.]))/g;
  for (const m of text.matchAll(re)) {
    const table = byLower.get(m[1].toLowerCase());
    if (!table || taken(m.index!, m.index! + m[0].length)) continue;
    refs.push({ start: m.index!, end: m.index! + m[0].length, table, column: m[2] ?? null, value: m[3] ?? m[4] });
  }
  return refs.sort((a, b) => a.start - b.start);
}

// 칸 글을 링크 조각과 보통 글로 나눈다.
export function splitByRefs(text: string, refs: TcRef[]) {
  const parts: ({ text: string } | { text: string; ref: TcRef })[] = [];
  let at = 0;
  for (const r of refs) {
    if (r.start > at) parts.push({ text: text.slice(at, r.start) });
    parts.push({ text: text.slice(r.start, r.end), ref: r });
    at = r.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}
