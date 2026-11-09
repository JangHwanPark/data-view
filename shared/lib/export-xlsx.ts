import * as XLSX from "xlsx";
import type { QueryResult } from "@/shared/lib/query-result";

// 엑셀 한 시트의 최대 행 수(1,048,576)에서 머리글 한 줄을 뺀 값
export const XLSX_MAX_ROWS = 1_048_575;

// 결과를 엑셀 파일로 내려받는다. 날짜 열은 엑셀에서 날짜로 다룰 수 있도록 Date로 넣는다.
export function downloadXlsx(result: QueryResult, fileName: string, sheetName = "data") {
  const dateIndexes = result.columns.flatMap((c, i) => (c.type === "date" ? [i] : []));
  const rows = result.rows.map((row) =>
    row.map((value, i) => (dateIndexes.includes(i) && typeof value === "string" ? new Date(value) : value)),
  );
  // 결과의 날짜 문자열은 UTC 기준이라 UTC로 해석해야 날짜가 밀리지 않는다.
  const sheet = XLSX.utils.aoa_to_sheet([result.columns.map((c) => c.name), ...rows], { cellDates: true, UTC: true });

  // 시간이 전부 자정인 열은 날짜만, 아니면 시각까지 보여준다.
  for (const i of dateIndexes) {
    const dateOnly = rows.every((row) => !(row[i] instanceof Date) || (row[i] as Date).getTime() % 86_400_000 === 0);
    const format = dateOnly ? "yyyy-mm-dd" : "yyyy-mm-dd hh:mm:ss";
    for (let r = 1; r <= rows.length; r++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c: i })];
      if (cell?.t === "d" || cell?.t === "n") cell.z = format;
    }
  }

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName.slice(0, 31));
  // XLSX.writeFile은 브라우저에 따라 파일 이름을 잃고 "download"로 받아지므로, 파일을 직접 만들어 이름을 붙여 내려받는다.
  const bytes = XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
