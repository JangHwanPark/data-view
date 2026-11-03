// 게임 테스트 데이터와 일부러 어긋난 "옛 기획서"를 만든다. generate-game-fixtures.mjs를 먼저 돌려야 한다.
// 실제 기획서처럼 최신화가 안 된 상태를 흉내 낸다.
// - 실제로는 없는 테이블 이름(QuestReward, ItemTable, ShopProductTable, GachaPoolTable)
// - 데이터와 다른 수치(보상 그룹, 판매가, 상품 가격, 소환 비용)
// - 데이터에서 삭제된 ID, 아직 만들지 않은 테이블(QuestRepeatReward)
//
// 결과: fixtures/docs/퀘스트_보상_기획서.docx, 아이템_기획서.pptx, 상점_기획서.xlsx, 가챠_기획서.pdf
//       fixtures/docs/expected.json (의도한 어긋남 목록. 검출 결과를 맞춰 볼 때 쓴다)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, WidthType } from "docx";
import PptxGenJS from "pptxgenjs";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gameDir = join(root, "fixtures", "game");
const outDir = join(root, "fixtures", "docs");
if (!existsSync(join(gameDir, "Item.xlsx"))) {
  console.error("fixtures/game이 없습니다. 먼저 node scripts/generate-game-fixtures.mjs를 실행하세요.");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const sheet = (file, name) => XLSX.utils.sheet_to_json(XLSX.readFile(join(gameDir, file)).Sheets[name]);
const quests = sheet("Quest.xlsx", "Quest");
const items = sheet("Item.xlsx", "Item");
const products = sheet("Shop.xlsx", "ShopProduct");
const gachas = sheet("Gacha.xlsx", "Gacha");
const expected = [];

// 1. 퀘스트 보상 기획서 (워드)
{
  const rows = quests.filter((q) => q.quest_type === "MAIN").slice(0, 8).map((q) => ({ ...q }));
  rows[2].reward_group_id += 7; // 데이터와 다른 보상 그룹
  rows[5].reward_group_id += 3;
  expected.push(
    { doc: "퀘스트_보상_기획서.docx", kind: "value", table: "Quest", key: rows[2].quest_id, column: "reward_group_id", docValue: rows[2].reward_group_id },
    { doc: "퀘스트_보상_기획서.docx", kind: "value", table: "Quest", key: rows[5].quest_id, column: "reward_group_id", docValue: rows[5].reward_group_id },
  );
  rows.push({ quest_id: 79999, quest_type: "MAIN", reward_group_id: 50001 }); // 데이터에 없는 퀘스트
  expected.push({ doc: "퀘스트_보상_기획서.docx", kind: "missing-row", table: "Quest", key: 79999 });
  expected.push({ doc: "퀘스트_보상_기획서.docx", kind: "unknown-name", name: "QuestReward", hint: "RewardGroup 또는 Reward" });
  expected.push({ doc: "퀘스트_보상_기획서.docx", kind: "unknown-name", name: "QuestRepeatReward", hint: "아직 없는 테이블" });

  const cell = (text) => new TableCell({ children: [new Paragraph(String(text))] });
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "퀘스트 보상 기획서 (v1.3)", heading: HeadingLevel.TITLE }),
          new Paragraph({ text: "1. 개요", heading: HeadingLevel.HEADING_1 }),
          new Paragraph("퀘스트 정의는 QuestTable(퀘스트 테이블)에 있고, 완료 보상은 QuestReward 테이블의 보상 그룹으로 지급한다."),
          new Paragraph("퀘스트 완료 조건은 condition_id로 QuestCondition을 참조한다."),
          new Paragraph({ text: "2. 보상 규칙", heading: HeadingLevel.HEADING_1 }),
          new Paragraph("reward_group_id로 보상 그룹을 찾고, 보상 종류는 reward_type(ITEM, CURRENCY, CHARACTER)으로 구분한다."),
          new Paragraph(`보상 아이템은 「아이템 ${items[40].item_id}」처럼 아이템 이름으로 표기한다.`),
          new Paragraph({ text: "3. 메인 퀘스트 보상표", heading: HeadingLevel.HEADING_1 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: ["quest_id", "quest_type", "reward_group_id"].map(cell) }),
              ...rows.map((r) => new TableRow({ children: [r.quest_id, r.quest_type, r.reward_group_id].map(cell) })),
            ],
          }),
          new Paragraph({ text: "4. 반복 보상", heading: HeadingLevel.HEADING_1 }),
          new Paragraph("반복 퀘스트 보상은 QuestRepeatReward 테이블에 따로 정의한다. (2차 업데이트 예정)"),
        ],
      },
    ],
  });
  writeFileSync(join(outDir, "퀘스트_보상_기획서.docx"), await Packer.toBuffer(doc));
}

// 2. 아이템 기획서 (파워포인트)
{
  const rows = items.filter((i) => i.item_type === "EQUIP").slice(0, 8).map((i) => ({ ...i }));
  for (const idx of [1, 4, 6]) {
    rows[idx].sell_price += 500;
    expected.push({ doc: "아이템_기획서.pptx", kind: "value", table: "Item", key: rows[idx].item_id, column: "sell_price", docValue: rows[idx].sell_price });
  }
  // 현재 데이터에서 빠진 아이템 ID (연번 사이의 빈 번호)
  const ids = new Set(items.map((i) => i.item_id));
  let removed = 100001;
  while (ids.has(removed)) removed++;
  rows.push({ item_id: removed, name_key: `ITEM_${removed}`, grade_id: 3, sell_price: 1200 });
  expected.push({ doc: "아이템_기획서.pptx", kind: "missing-row", table: "Item", key: removed });
  expected.push({ doc: "아이템_기획서.pptx", kind: "unknown-name", name: "ItemTable", hint: "Item" });
  expected.push({ doc: "아이템_기획서.pptx", kind: "unknown-name", name: "ItemGrade", hint: "Grade" });

  const pptx = new PptxGenJS();
  const font = { fontFace: "Malgun Gothic" };
  let slide = pptx.addSlide();
  slide.addText("아이템 시스템 기획", { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 28, bold: true, ...font });
  slide.addText("아이템 정의는 ItemTable 기준이며, 등급은 ItemGrade 테이블을 참조한다.\n장비 아이템은 Equipment에서 slot과 set_id를 가진다.", { x: 0.5, y: 1.5, w: 9, h: 1.5, fontSize: 16, ...font });

  slide = pptx.addSlide();
  slide.addText("장비 판매가", { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 22, bold: true, ...font });
  slide.addText("sell_price는 등급(grade_id)에 따라 다르다. 아래는 1차 장비 목록이다.", { x: 0.5, y: 0.9, w: 9, h: 0.5, fontSize: 14, ...font });
  slide.addTable(
    [["item_id", "이름", "grade_id", "sell_price"], ...rows.map((r) => [String(r.item_id), `아이템 ${r.item_id}`, String(r.grade_id), String(r.sell_price)])].map((r) => r.map((text) => ({ text, options: font }))),
    { x: 0.5, y: 1.5, w: 9, fontSize: 11 },
  );

  slide = pptx.addSlide();
  slide.addText("소모품 효과", { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 22, bold: true, ...font });
  slide.addText("소모품은 effect_ids에 ItemEffect의 effect_id를 | 로 나열한다. 예: 8001|8023", { x: 0.5, y: 1.0, w: 9, h: 0.8, fontSize: 14, ...font });
  await pptx.writeFile({ fileName: join(outDir, "아이템_기획서.pptx") });
}

// 3. 상점 기획서 (엑셀)
{
  const rows = products.slice(0, 10).map((p) => ({ product_id: p.product_id, item_id: p.item_id, price: p.price }));
  for (const idx of [3, 8]) {
    rows[idx].price = Math.round(rows[idx].price * 1.5);
    expected.push({ doc: "상점_기획서.xlsx", kind: "value", table: "ShopProduct", key: rows[idx].product_id, column: "price", docValue: rows[idx].price });
  }
  expected.push({ doc: "상점_기획서.xlsx", kind: "unknown-name", name: "ShopProductTable", hint: "ShopProduct" });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ["상점 기획서"],
      ["상점 상품은 ShopProductTable에 정의한다."],
      ["가격 재화: price_currency_id → Currency"],
      ["보너스 아이템은 bonus_item_id_1 ~ bonus_item_id_3 에 최대 3개까지 넣는다."],
    ]),
    "개요",
  );
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "상품 목록");
  XLSX.writeFile(book, join(outDir, "상점_기획서.xlsx"));
}

// 4. 가챠 기획서 (PDF)
{
  const target = gachas[2];
  const docCost = target.cost * 10;
  expected.push({ doc: "가챠_기획서.pdf", kind: "value", table: "Gacha", key: target.gacha_id, column: "cost", docValue: docCost });
  expected.push({ doc: "가챠_기획서.pdf", kind: "unknown-name", name: "GachaPoolTable", hint: "GachaPool" });
  const fontPath = "C:/Windows/Fonts/malgun.ttf";
  if (!existsSync(fontPath)) {
    console.warn("맑은 고딕 글꼴이 없어 PDF 기획서는 건너뜁니다.");
  } else {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(readFileSync(fontPath), { subset: true });
    const pages = [
      [
        "가챠 기획서",
        "",
        "소환은 Gacha 테이블과 GachaPoolTable을 사용한다.",
        "Gacha.pool_ids 에는 풀 ID를 ; 로 구분해 넣는다.",
        "풀의 캐릭터 목록은 char_ids 에 | 로 구분해 넣는다.",
      ],
      [
        "소환별 비용",
        "",
        `소환 ${target.gacha_id} 비용: ${docCost}`,
        `소환 ${target.gacha_id} 비용 재화: cost_currency_id ${target.cost_currency_id}`,
        `대상 풀: ${String(target.pool_ids).split(";")[0]}`,
      ],
    ];
    for (const lines of pages) {
      const page = pdf.addPage([595, 842]);
      lines.forEach((line, i) => page.drawText(line, { x: 50, y: 780 - i * 24, size: i === 0 ? 20 : 12, font }));
    }
    writeFileSync(join(outDir, "가챠_기획서.pdf"), await pdf.save());
  }
}

writeFileSync(join(outDir, "expected.json"), JSON.stringify(expected, null, 2));
console.log(`docs 4, expected ${expected.length}`);
