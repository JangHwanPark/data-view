// 다국어 글(문자열) 테이블 알아보기. 값 설명, 행 트리, 기획서 추론이 같은 기준을 쓴다.
const TEXT_COLUMNS = ["ko", "kr", "kor", "korean", "text", "en", "eng", "english", "name"];
const KEY_COLUMNS = ["key", "strkey", "str_key", "stringkey", "string_key"];

// 다국어 글 테이블의 키 열. 대소문자는 가리지 않는다(회사 시트는 Key, Korean, English).
export function stringKeyColumn(columns: string[]) {
  return columns.find((c) => KEY_COLUMNS.includes(c.toLowerCase())) ?? null;
}

// 다국어 글 테이블의 언어 열(30단계, 5-7). 키 열을 뺀 나머지 글 열이다(Korean, English …).
export function languageColumns(columns: string[]) {
  const key = stringKeyColumn(columns);
  return key ? columns.filter((c) => c !== key && !c.startsWith("#")) : [];
}

// key 열과 ko/en 같은 글 열이 있으면 다국어 글 테이블로 본다(기획서 추론과 같은 기준).
export function textColumn(columns: string[]) {
  if (!stringKeyColumn(columns)) return null;
  for (const t of TEXT_COLUMNS) {
    const hit = columns.find((x) => x.toLowerCase() === t);
    if (hit) return hit;
  }
  return null;
}
