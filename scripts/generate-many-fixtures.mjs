// 시트가 많을 때(31단계, 설계 4.10)를 재려고 시트 300개짜리 가짜 데이터를 만든다. 회사 데이터와 상관없는 지어낸 이름이다.
//   node scripts/generate-many-fixtures.mjs        → fixtures/many/Part01.xlsx ~ Part20.xlsx(파일마다 시트 15개)
// 시트마다 첫 열이 Id(유일)이고, 같은 파일의 앞 시트나 다른 파일의 시트 Id를 가리키는 <시트>Id 열을 1~2개 둔다.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "fixtures", "many");
mkdirSync(outDir, { recursive: true });

let seed = 20261107;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));

const FILES = 20;
const SHEETS = 15;
const ROWS = 150;
const WORDS = ["Apple", "Berry", "Cloud", "Delta", "Ember", "Frost", "Grove", "Harbor", "Iris", "Jade", "Koala", "Lotus", "Maple", "Nova", "Orbit"];
const sheets = [];
for (let f = 1; f <= FILES; f++) {
  for (let s = 0; s < SHEETS; s++) sheets.push({ file: f, name: `P${String(f).padStart(2, "0")}${WORDS[s]}`, base: f * 100000 + s * 1000 });
}

let total = 0;
for (let f = 1; f <= FILES; f++) {
  const book = XLSX.utils.book_new();
  for (const sheet of sheets.filter((x) => x.file === f)) {
    const i = sheets.indexOf(sheet);
    // 가리킬 시트: 같은 파일의 바로 앞 시트, 그리고 가끔 다른 파일의 시트
    const targets = [];
    if (i % SHEETS > 0) targets.push(sheets[i - 1]);
    if (i % 3 === 0 && i > SHEETS) targets.push(sheets[int(0, i - SHEETS)]);
    const header = ["Id", "Name", ...targets.map((t) => `${t.name}Id`), "Value", "Rate"];
    const rows = [header];
    for (let r = 1; r <= ROWS; r++) {
      rows.push([sheet.base + r, `${sheet.name}_${r}`, ...targets.map((t) => t.base + int(1, ROWS)), int(0, 1000), int(0, 100) / 100]);
    }
    total += ROWS;
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheet.name);
  }
  XLSX.writeFile(book, join(outDir, `Part${String(f).padStart(2, "0")}.xlsx`));
}
console.log(`many fixtures: files ${FILES}, sheets ${sheets.length}, rows ${total}`);
