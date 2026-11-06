// 회사 테이블과 같은 "모양"을 가진 가짜 테스트 데이터(docs/PLAN.md 22단계, 집 작업 목록 2절).
// 게임 테스트 데이터(generate-game-fixtures.mjs)와 따로, 지어낸 과일 농장 데이터로 만든다. 회사 테이블 이름이나 값은 쓰지 않는다.
//
// 만드는 모양(2절 번호):
//  2-1 파일마다 #Design 시트: 1행 머리말(한글 이름), 2행 「컬럼 | 설명」, 설명 안에 <테이블>[컬럼] 문구
//  2-2 #Definition 시트: #Design에 없는 컬럼 설명(Fruit.Season, Fruit.Period)
//  2-3 데이터 시트의 머리글 줄 위치가 파일마다 다름(Fruit 3행, Asset 4행, 나머지 1행)
//  2-4 Id가 ;로 시작하는 비활성 행(;1003, ;1017, ;5004)
//  2-5 두 줄 머리글: 한 칸에 "Reward_" 줄바꿈 "Asset#1"
//  2-6 번호 붙은 열: Level#1~Level#3
//  2-7 #로 시작하는 메모 열에 한글 이름(#이름)
//  2-8 문자열 테이블 StringFruit(Key, Korean, English)와 Str_Fruit_n 키. 영어 일부를 일부러 비움
//  2-9 서식 있는 기획서 docx: 제목 1~3, 번호 목록, 글머리표, 가로로 합친 칸, 굵게, 목차 줄, 글상자, 필드, 지운 글자
//  2-10 이름이 한 글자 다른 테이블: FruitPrice, FruitPrise
//  2-11 #Design 머리말이 같은 테이블: RewardDaily, RewardWeekly, RewardEvent(모두 「보상」)
//
// 결과: fixtures/shape(엑셀), fixtures/shape-docs(기획서), fixtures/shape/expected.json(만든 모양과 일부러 넣은 문제 목록)
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AlignmentType,
  DeletedTextRun,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  Textbox,
  TextRun,
  WidthType,
} from "docx";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "fixtures", "shape");
const docDir = join(root, "fixtures", "shape-docs");
mkdirSync(outDir, { recursive: true });
mkdirSync(docDir, { recursive: true });

// 같은 결과가 나오도록 고정한 난수
let seed = 20261106;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[int(0, arr.length - 1)];

const expected = { headerRows: {}, inactive: {}, designRefs: [], definitionOnly: [], twoLineHeaders: {}, numbered: {}, brokenRefs: [], duplicateIds: [], inactiveRefs: [], sameKoreanName: [], typoPair: [], stringKeys: {}, missingTranslations: [] };

// 데이터 시트 하나와 #Design, #Definition 시트를 가진 파일을 쓴다.
// topLines: 머리글 위에 둘 설명 줄(2-3). header: 머리글 칸(두 줄 머리글은 "윗줄\n아랫줄").
function writeBook(table, { korean, topLines = [], header, rows, design, definition }) {
  const book = XLSX.utils.book_new();
  const aoa = [...topLines.map((l) => [l]), header, ...rows];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(aoa), table);
  // 2-1: 1행 머리말, 2행 머리글, 그 아래 컬럼마다 설명
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[korean], ["컬럼", "설명"], ...design]), "#Design");
  if (definition) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["컬럼", "정의"], ...definition]), "#Definition");
  XLSX.writeFile(book, join(outDir, `${table}.xlsx`));
  expected.headerRows[table] = topLines.length + 1;
}

// ---- 색, 성장 단계, 문자열 ----
const colors = [
  [1, "빨강", "Red", "#e53935"],
  [2, "노랑", "Yellow", "#fdd835"],
  [3, "초록", "Green", "#43a047"],
  [4, "보라", "Purple", "#8e24aa"],
  [5, "주황", "Orange", "#fb8c00"],
  [6, "분홍", "Pink", "#ec407a"],
];
writeBook("Color", {
  korean: "색",
  header: ["Id", "#이름", "Name", "Hex"],
  rows: colors,
  design: [
    ["Id", "색 번호"],
    ["Name", "색 영어 이름. 화면에는 쓰지 않는다"],
    ["Hex", "표시 색 코드"],
  ],
});

const growth = [
  [101, "씨앗", 0],
  [102, "싹", 2],
  [103, "잎", 4],
  [104, "꽃", 7],
  [105, "열매", 10],
  [106, "수확", 12],
];
writeBook("Growth", {
  korean: "성장 단계",
  header: ["Id", "#이름", "Days"],
  rows: growth,
  design: [
    ["Id", "성장 단계 번호"],
    ["Days", "이 단계까지 걸리는 날 수"],
  ],
});

const fruitNames = ["사과", "배", "포도", "복숭아", "자두", "체리", "감", "귤", "딸기", "수박", "참외", "멜론", "망고", "키위", "레몬", "라임", "무화과", "석류", "블루베리", "앵두", "살구", "모과", "유자", "대추"];
const englishNames = ["Apple", "Pear", "Grape", "Peach", "Plum", "Cherry", "Persimmon", "Tangerine", "Strawberry", "Watermelon", "Korean melon", "Melon", "Mango", "Kiwi", "Lemon", "Lime", "Fig", "Pomegranate", "Blueberry", "Cherry plum", "Apricot", "Quince", "Yuzu", "Jujube"];
const strings = fruitNames.map((ko, i) => {
  // 2-8: 일부 영어를 일부러 비워 빈 번역을 찾는 기능(5-7)의 시험 재료로 쓴다.
  const missing = i % 7 === 5;
  if (missing) expected.missingTranslations.push(`Str_Fruit_${i + 1}`);
  return [`Str_Fruit_${i + 1}`, ko, missing ? "" : englishNames[i]];
});
writeBook("StringFruit", {
  korean: "과일 문자열",
  header: ["Key", "Korean", "English"],
  rows: strings,
  design: [
    ["Key", "문자열 키. 다른 테이블은 이 값을 적는다"],
    ["Korean", "한국어 문구"],
    ["English", "영어 문구"],
  ],
});
expected.stringKeys = { table: "StringFruit", key: "Key", languages: ["Korean", "English"], example: "Str_Fruit_1" };

// ---- 과일(머리글 3행, 비활성 행, 번호 붙은 열, #Definition에만 있는 컬럼) ----
const fruits = fruitNames.map((ko, i) => {
  const id = 1001 + i;
  const stages = [101, 102, 103, 104, 105, 106];
  return [id, ko, `Str_Fruit_${i + 1}`, colors[i % colors.length][0], stages[int(0, 1)], stages[int(2, 3)], stages[int(4, 5)], int(1, 4), pick([0, 0, 7, 14, 30]), rand() > 0.3 ? "TRUE" : "FALSE"];
});
// 2-4: 비활성 행은 Id 앞에 ;
for (const id of [1003, 1017]) {
  const row = fruits.find((r) => r[0] === id);
  row[0] = `;${id}`;
}
expected.inactive.Fruit = [";1003", ";1017"];
// 깨진 참조와 중복 Id(무결성 검사 시험)
fruits[9][3] = 99;
expected.brokenRefs.push({ table: "Fruit", column: "ColorId", value: 99, target: "Color" });
fruits.push([1012, "참외(중복)", "Str_Fruit_11", 2, 101, 103, 105, 2, 0, "TRUE"]);
expected.duplicateIds.push({ table: "Fruit", column: "Id", value: 1012 });
writeBook("Fruit", {
  korean: "과일",
  topLines: ["과일 정의 시트", "수정할 때는 기획팀에 먼저 알린다"],
  header: ["Id", "#이름", "NameKey", "ColorId", "Level#1", "Level#2", "Level#3", "Season", "Period", "IsTradable"],
  rows: fruits,
  design: [
    ["Id", "과일 번호. 4자리"],
    ["NameKey", "과일 이름. <StringFruit> 테이블의 [Key] 참조"],
    ["ColorId", "과일 색. <Color> 테이블의 [Id] 참조"],
    ["Level#", "단계별 성장. <Growth> 테이블 참조"],
    ["IsTradable", "거래 가능 여부"],
  ],
  definition: [
    ["Season", "수확 계절. 1 봄, 2 여름, 3 가을, 4 겨울"],
    ["Period", "판매 기간(일). 0이면 늘 판다"],
  ],
});
expected.designRefs.push(
  { table: "Fruit", column: "NameKey", target: "StringFruit", targetColumn: "Key" },
  { table: "Fruit", column: "ColorId", target: "Color", targetColumn: "Id" },
  { table: "Fruit", column: "Level#", target: "Growth", targetColumn: null },
);
expected.definitionOnly.push({ table: "Fruit", columns: ["Season", "Period"] });
expected.numbered.Fruit = { prefix: "Level#", columns: ["Level#1", "Level#2", "Level#3"], target: "Growth" };

// ---- 재화(머리글 4행, 비활성 행) ----
const activeFruitIds = fruits.map((r) => r[0]).filter((v) => typeof v === "number");
const assets = [
  [5001, "골드", "GOLD", ""],
  [5002, "씨앗 주머니", "SEED", ""],
  [5003, "사과 상자", "FRUIT", 1001],
  [5004, "옛 포도 상자", "FRUIT", 1003],
  [5005, "딸기 상자", "FRUIT", 1009],
  [5006, "망고 상자", "FRUIT", 1013],
  [5007, "보석", "GEM", ""],
];
assets[3][0] = ";5004";
expected.inactive.Asset = [";5004"];
writeBook("Asset", {
  korean: "재화",
  topLines: ["재화 시트", "Type이 FRUIT이면 FruitId를 채운다", "비활성 재화는 Id 앞에 ;를 붙인다"],
  header: ["Id", "#이름", "Type", "FruitId"],
  rows: assets,
  design: [
    ["Id", "재화 번호"],
    ["Type", "재화 종류. GOLD, SEED, FRUIT, GEM"],
    ["FruitId", "과일 상자일 때 담긴 과일. <Fruit> 테이블 참조"],
  ],
});
expected.designRefs.push({ table: "Asset", column: "FruitId", target: "Fruit", targetColumn: null });

// ---- 보상 세 가지(두 줄 머리글, 머리말이 모두 「보상」) ----
const assetIds = [5001, 5002, 5003, 5005, 5006, 5007];
function rewardRows(first, count, label) {
  return Array.from({ length: count }, (_, i) => [first + i, label(i), pick(assetIds), int(1, 50) * 10, pick(assetIds), int(1, 9)]);
}
const rewardHeader = (second) => ["Id", second, "Reward_\nAsset#1", "Reward_\nCount#1", "Reward_\nAsset#2", "Reward_\nCount#2"];
const rewardDesign = [
  ["Id", "보상 번호"],
  ["Asset#", "주는 재화. <Asset> 테이블의 [Id] 참조"],
  ["Count#", "주는 개수"],
];
writeBook("RewardDaily", { korean: "보상", header: rewardHeader("Day"), rows: rewardRows(7001, 28, (i) => i + 1), design: [...rewardDesign, ["Day", "출석 날짜(1~28)"]] });
writeBook("RewardWeekly", { korean: "보상", header: rewardHeader("Week"), rows: rewardRows(7101, 8, (i) => i + 1), design: [...rewardDesign, ["Week", "주차"]] });
const eventRows = rewardRows(7201, 10, (i) => `EVENT_${i + 1}`);
// 비활성 재화(;5004)를 가리키는 보상: 비활성 행 참조 검사(5-3)의 시험 재료
eventRows[3][2] = 5004;
expected.inactiveRefs.push({ table: "RewardEvent", column: "Asset#1", value: 5004, target: "Asset" });
writeBook("RewardEvent", { korean: "보상", header: rewardHeader("EventName"), rows: eventRows, design: [...rewardDesign, ["EventName", "이벤트 이름"]] });
for (const t of ["RewardDaily", "RewardWeekly", "RewardEvent"]) {
  expected.twoLineHeaders[t] = { "Reward_\nAsset#1": "Asset#1", "Reward_\nCount#1": "Count#1", "Reward_\nAsset#2": "Asset#2", "Reward_\nCount#2": "Count#2" };
  expected.numbered[t] = { prefix: "Asset#", columns: ["Asset#1", "Asset#2"], target: "Asset" };
  expected.designRefs.push({ table: t, column: "Asset#", target: "Asset", targetColumn: "Id" });
}
expected.sameKoreanName.push({ korean: "보상", tables: ["RewardDaily", "RewardWeekly", "RewardEvent"], remaining: ["Daily", "Weekly", "Event"], note: "모두에 있는 Reward를 빼고 남은 단어. 단어 사전에 풀이가 있으면 그 풀이(예: 일일, 주간, 이벤트)로 괄호를 붙인다" });

// ---- 이름이 한 글자 다른 두 테이블 ----
const priceRows = activeFruitIds.slice(0, 15).map((id, i) => [9001 + i, id, int(10, 500) * 10]);
// 비활성 과일(;1003)을 가리키는 가격
priceRows.push([9016, 1003, 1200]);
expected.inactiveRefs.push({ table: "FruitPrice", column: "FruitId", value: 1003, target: "Fruit" });
writeBook("FruitPrice", {
  korean: "과일 가격",
  header: ["Id", "FruitId", "Price"],
  rows: priceRows,
  design: [
    ["Id", "가격 번호"],
    ["FruitId", "<Fruit> 테이블의 [Id] 참조"],
    ["Price", "판매 가격(골드)"],
  ],
});
writeBook("FruitPrise", {
  korean: "과일 가격",
  header: ["Id", "FruitId", "Prise"],
  rows: priceRows.slice(0, 6).map(([id, f, p]) => [id, f, Math.round(p * 0.9)]),
  design: [
    ["Id", "가격 번호(옛 시트)"],
    ["FruitId", "<Fruit> 테이블 참조"],
    ["Prise", "옛 판매 가격. 오타 이름을 그대로 둔 시트"],
  ],
});
expected.typoPair.push({ tables: ["FruitPrice", "FruitPrise"], korean: "과일 가격", expected: ["과일 가격 (Price)", "과일 가격 (Prise)"] });
expected.designRefs.push({ table: "FruitPrice", column: "FruitId", target: "Fruit", targetColumn: "Id" }, { table: "FruitPrise", column: "FruitId", target: "Fruit", targetColumn: null });

writeFileSync(join(outDir, "expected.json"), JSON.stringify(expected, null, 2));

// ---- 서식 있는 기획서(2-9) ----
const body = (text) => new Paragraph({ children: [new TextRun(text)] });
const tocLine = (level, text, page) =>
  new Paragraph({ style: `TOC${level}`, children: [new TextRun(`${text}\t${page}`)] });
const cell = (text, opts = {}) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: opts.bold })] })], columnSpan: opts.span });

const doc = new Document({
  styles: {
    paragraphStyles: [
      { id: "TOC1", name: "toc 1", basedOn: "Normal", run: { color: "666666" } },
      { id: "TOC2", name: "toc 2", basedOn: "Normal", run: { color: "666666" }, paragraph: { indent: { left: 240 } } },
    ],
  },
  numbering: {
    config: [
      { reference: "rules", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START }] },
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.START }] },
    ],
  },
  sections: [
    {
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("과일 농장 기획서")] }),
        // Word 목차를 업데이트해 둔 상태처럼 목차 줄을 미리 넣는다(원문 창에서 흐리게 보여줄 줄).
        new Paragraph({ children: [new TextRun({ text: "목차", bold: true })] }),
        tocLine(1, "1. 개요", 1),
        tocLine(2, "1.1 과일 데이터 정의", 1),
        tocLine(1, "2. 보상", 2),
        tocLine(1, "3. 가격", 2),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("1. 개요")] }),
        new Paragraph({
          children: [
            new TextRun({ text: "과일(Fruit)", bold: true }),
            new TextRun(" 테이블은 농장에서 기르는 과일을 정의한다. 과일의 색은 <Color> 테이블을, 성장 단계는 Growth 테이블을 참조한다."),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun("과일 이름은 StringFruit 테이블의 문자열 키로 적는다."),
            new DeletedTextRun({ text: " 예전에는 이름을 바로 적었다.", id: 1, author: "기획", date: "2026-10-01T00:00:00Z" }),
            new TextRun(" 이 문서의 쪽: "),
            new TextRun({ children: [PageNumber.CURRENT] }),
          ],
        }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("1.1 과일 데이터 정의")] }),
        new Paragraph({ numbering: { reference: "rules", level: 0 }, children: [new TextRun("Id는 4자리 번호를 쓴다.")] }),
        new Paragraph({ numbering: { reference: "rules", level: 0 }, children: [new TextRun("쓰지 않는 과일은 Id 앞에 ;를 붙여 비활성으로 둔다.")] }),
        new Paragraph({ numbering: { reference: "rules", level: 0 }, children: [new TextRun("NameKey에는 StringFruit 테이블의 Key를 넣는다.")] }),
        new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("1.1.1 성장 단계")] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Level#1부터 Level#3까지 Growth 테이블의 Id를 넣는다.")] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("수확 계절(Season)은 1 봄부터 4 겨울까지다.")] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("2. 보상")] }),
        body("보상 데이터 테이블은 세 가지다. 매일 받는 보상은 RewardDaily 테이블, 주간 보상은 RewardWeekly 테이블, 이벤트 보상은 RewardEvent 테이블에 둔다. 보상으로 주는 재화는 Asset 테이블을 참조한다."),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: [cell("보상 종류", { bold: true }), cell("보상 내용", { bold: true, span: 2 })] }),
            new TableRow({ children: [cell(""), cell("Asset", { bold: true }), cell("Count", { bold: true })] }),
            new TableRow({ children: [cell("RewardDaily"), cell("5001"), cell("100")] }),
            new TableRow({ children: [cell("RewardWeekly"), cell("5007"), cell("3")] }),
          ],
        }),
        new Textbox({
          style: { width: "300pt", height: "60pt" },
          children: [body("참고: 이벤트 보상은 RewardEvent 테이블에서 관리하며, 이벤트가 끝나면 Id 앞에 ;를 붙여 비활성으로 둔다.")],
        }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("3. 가격")] }),
        body("과일 가격(FruitPrice) 테이블은 과일마다 판매 가격을 정한다. 예전에 쓰던 FruitPrise 테이블은 이름이 틀린 옛 시트라 더 이상 쓰지 않는다."),
        // 300자가 넘는 긴 문단(설명 문장 점수에서 -1)
        body(
          "가격 정책 메모: " +
            "과일 가격은 시즌과 이벤트에 따라 바뀔 수 있으며, 바뀐 가격은 FruitPrice 테이블에만 반영하고 FruitPrise 테이블에는 반영하지 않는다. ".repeat(3) +
            "가격을 바꿀 때는 보상으로 주는 과일 상자(Asset 테이블의 FRUIT 종류)의 가치도 함께 확인한다.",
        ),
      ],
    },
  ],
});
writeFileSync(join(docDir, "과일_농장_기획서.docx"), await Packer.toBuffer(doc));

const files = Object.keys(expected.headerRows).length;
console.log(`shape fixtures: tables ${files}, docs 1`);
