// 게임 기획 테이블을 흉내 낸 테스트 데이터를 만든다.
// 네 가지 참조 방식(단일 ID, 번호 붙은 여러 열, 한 칸 여러 ID, 타입+ID)과
// 일부러 넣은 문제(깨진 참조, 중복 키), 갱신본 비교용 이전 버전, MySQL 시드 SQL을 같이 만든다.
//
// 사용: node scripts/generate-game-fixtures.mjs
// 결과: fixtures/game/*.xlsx, fixtures/game/String.csv, fixtures/game-prev/*.xlsx, fixtures/mysql/seed.sql
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "fixtures");

// 실행할 때마다 같은 데이터가 나오도록 시드를 고정한 난수
let seed = 20261104;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const range = (start, count) => Array.from({ length: count }, (_, i) => start + i);
const pickMany = (arr, min, max) => {
  const n = int(min, max);
  const set = new Set();
  while (set.size < Math.min(n, arr.length)) set.add(pick(arr));
  return [...set];
};

// 약 0.8% 확률로 없는 ID를 섞는다. 참조 무결성 검사에서 찾아야 할 깨진 참조.
const BROKEN_RATE = 0.008;
function ref(ids) {
  return chance(BROKEN_RATE) ? 9_000_000 + int(1, 99_999) : pick(ids);
}

const T = {};
const strings = [];
function name(prefix, id, ko, en) {
  const key = `${prefix}_${id}`;
  strings.push({ key, ko, en });
  return key;
}

// 공통
T.Grade = ["일반", "고급", "희귀", "영웅", "전설", "신화"].map((ko, i) => ({
  grade_id: i + 1,
  name_key: name("GRADE", i + 1, ko, ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"][i]),
  color: ["#9e9e9e", "#4caf50", "#2196f3", "#9c27b0", "#ff9800", "#f44336"][i],
}));
const gradeIds = T.Grade.map((r) => r.grade_id);

const CURRENCY = ["GOLD", "GEM", "STAMINA", "ARENA_COIN", "GUILD_COIN", "EVENT_TOKEN", "FRIEND_POINT", "SKILL_BOOK", "AWAKEN_STONE", "MILEAGE", "RAID_TICKET", "PASS_POINT"];
T.Currency = CURRENCY.map((code, i) => ({
  currency_id: i + 1,
  code,
  name_key: name("CURRENCY", i + 1, `재화 ${code}`, code),
  max_amount: pick([999999999, 99999, 9999, 999]),
}));
const currencyIds = T.Currency.map((r) => r.currency_id);

T.Stat = range(1, 20).map((id) => ({
  stat_id: id,
  code: ["HP", "ATK", "DEF", "SPD", "CRIT", "CRIT_DMG", "ACC", "EVA", "HP_REGEN", "MP"][(id - 1) % 10] + (id > 10 ? "_PCT" : ""),
  is_percent: id > 10 ? 1 : 0,
}));
const statIds = T.Stat.map((r) => r.stat_id);

// 번호 붙은 여러 열: stat_id_1~4
T.StatGroup = range(5001, 400).map((id) => {
  const row = { stat_group_id: id };
  const n = int(1, 4);
  for (let i = 1; i <= 4; i++) {
    row[`stat_id_${i}`] = i <= n ? ref(statIds) : null;
    row[`value_${i}`] = i <= n ? int(10, 5000) : null;
  }
  return row;
});
const statGroupIds = T.StatGroup.map((r) => r.stat_group_id);

T.Buff = range(7001, 300).map((id) => ({
  buff_id: id,
  name_key: name("BUFF", id, `버프 ${id}`, `Buff ${id}`),
  stat_id: ref(statIds),
  value: int(1, 300),
  duration_sec: pick([5, 10, 15, 30, 60, 0]),
}));
const buffIds = T.Buff.map((r) => r.buff_id);

// 아이템
T.ItemEffect = range(8001, 600).map((id) => ({
  effect_id: id,
  effect_type: pick(["HEAL", "BUFF", "EXP", "UNLOCK", "SUMMON"]),
  value: int(1, 10000),
  buff_id: chance(0.4) ? ref(buffIds) : null,
}));
const itemEffectIds = T.ItemEffect.map((r) => r.effect_id);

const ITEM_TYPES = ["EQUIP", "CONSUME", "MATERIAL", "COSTUME", "PET_FOOD", "TICKET"];
// 3,040개를 만들고 25개는 현재 버전에서 삭제, 마지막 40개는 현재 버전에서 새로 추가된 것으로 쓴다.
const allItems = range(100001, 3040).map((id) => {
  const type = pick(ITEM_TYPES);
  return {
    item_id: id,
    name_key: name("ITEM", id, `아이템 ${id}`, `Item ${id}`),
    item_type: type,
    grade_id: ref(gradeIds),
    max_stack: type === "EQUIP" || type === "COSTUME" ? 1 : pick([99, 999, 9999]),
    sell_currency_id: ref(currencyIds),
    sell_price: int(1, 50000),
    // 한 칸 여러 ID: 소모품만 효과 목록을 가진다
    effect_ids: type === "CONSUME" ? pickMany(itemEffectIds, 1, 3).join("|") : null,
  };
});
const newItemIds = new Set(allItems.slice(-40).map((r) => r.item_id));
const deletedItemIds = new Set(pickMany(allItems.slice(0, -40).map((r) => r.item_id), 25, 25));
const itemsCurrent = allItems.filter((r) => !deletedItemIds.has(r.item_id));
// 중복 키 3건
itemsCurrent.push({ ...itemsCurrent[10] }, { ...itemsCurrent[500] }, { ...itemsCurrent[1500], sell_price: 1 });
T.Item = itemsCurrent;
// 다른 테이블은 삭제 전 목록에서 고른다. 삭제된 아이템을 가리키는 행이 자연스럽게 깨진 참조가 된다.
const itemIds = allItems.filter((r) => !newItemIds.has(r.item_id)).map((r) => r.item_id);
const itemIdsByType = (type) => allItems.filter((r) => r.item_type === type && !newItemIds.has(r.item_id)).map((r) => r.item_id);

T.EquipSet = range(9001, 80).map((id) => ({
  set_id: id,
  name_key: name("EQUIPSET", id, `세트 ${id}`, `Set ${id}`),
  set_buff_id: ref(buffIds),
}));
const equipSetIds = T.EquipSet.map((r) => r.set_id);

T.Equipment = itemIdsByType("EQUIP").map((id) => ({
  item_id: id,
  slot: pick(["WEAPON", "HELMET", "ARMOR", "GLOVES", "BOOTS", "RING", "NECKLACE"]),
  base_stat_group_id: ref(statGroupIds),
  set_id: chance(0.3) ? ref(equipSetIds) : null,
  enhance_max: pick([10, 15, 20, 25]),
}));

// 번호 붙은 여러 열: material_id_1~5
T.Recipe = range(10001, 700).map((id) => {
  const row = { recipe_id: id, result_item_id: ref(itemIds) };
  const n = int(2, 5);
  for (let i = 1; i <= 5; i++) {
    row[`material_id_${i}`] = i <= n ? ref(itemIdsByType("MATERIAL")) : null;
    row[`material_count_${i}`] = i <= n ? int(1, 50) : null;
  }
  row.gold_cost = int(100, 100000);
  return row;
});

// 스킬
T.SkillEffect = range(31001, 1500).map((id) => ({
  effect_id: id,
  effect_type: pick(["DAMAGE", "HEAL", "BUFF", "DEBUFF", "SHIELD", "STUN"]),
  value: int(10, 3000),
  buff_id: chance(0.5) ? ref(buffIds) : null,
}));
const skillEffectIds = T.SkillEffect.map((r) => r.effect_id);

// 번호 붙은 여러 열: effect_id_1~3
T.Skill = range(30001, 900).map((id) => {
  const row = {
    skill_id: id,
    name_key: name("SKILL", id, `스킬 ${id}`, `Skill ${id}`),
    skill_type: pick(["ACTIVE", "PASSIVE", "ULTIMATE"]),
    cooldown_sec: pick([0, 5, 8, 12, 20, 30]),
  };
  const n = int(1, 3);
  for (let i = 1; i <= 3; i++) row[`effect_id_${i}`] = i <= n ? ref(skillEffectIds) : null;
  return row;
});
const skillIds = T.Skill.map((r) => r.skill_id);

// 캐릭터
T.Class = ["전사", "궁수", "마법사", "사제", "도적", "기사", "소환사", "격투가"].map((ko, i) => ({
  class_id: i + 1,
  name_key: name("CLASS", i + 1, ko, `Class ${i + 1}`),
}));
const classIds = T.Class.map((r) => r.class_id);

// 한 칸 여러 ID: skill_ids
T.Character = range(20001, 120).map((id) => ({
  char_id: id,
  name_key: name("CHAR", id, `캐릭터 ${id}`, `Hero ${id}`),
  class_id: ref(classIds),
  grade_id: ref(gradeIds),
  base_stat_group_id: ref(statGroupIds),
  skill_ids: pickMany(skillIds, 3, 5).map((s) => (chance(BROKEN_RATE) ? 9_999_999 : s)).join("|"),
}));
const charIds = T.Character.map((r) => r.char_id);

T.CharacterLevel = charIds.flatMap((charId) =>
  range(1, 60).map((level) => ({
    char_id: charId,
    level,
    need_exp: level * level * 37,
    stat_group_id: ref(statGroupIds),
  })),
);

T.Costume = range(21001, 400).map((id) => ({
  costume_id: id,
  char_id: ref(charIds),
  item_id: ref(itemIdsByType("COSTUME")),
}));
const costumeIds = T.Costume.map((r) => r.costume_id);

// 몬스터, 드랍
T.DropGroup = range(41001, 500).map((id) => ({ drop_group_id: id, memo: `드랍 그룹 ${id}` }));
const dropGroupIds = T.DropGroup.map((r) => r.drop_group_id);

// 타입+ID: reward_type이 ITEM이면 Item, CURRENCY면 Currency
T.DropItem = dropGroupIds.flatMap((groupId) =>
  range(1, int(3, 12)).map(() => {
    const type = chance(0.75) ? "ITEM" : "CURRENCY";
    return {
      drop_group_id: groupId,
      reward_type: type,
      reward_id: type === "ITEM" ? ref(itemIds) : ref(currencyIds),
      count: int(1, 100),
      rate: Math.round(rand() * 10000) / 100,
    };
  }),
);

T.Monster = range(40001, 800).map((id) => ({
  monster_id: id,
  name_key: name("MONSTER", id, `몬스터 ${id}`, `Monster ${id}`),
  level: int(1, 100),
  is_boss: chance(0.1) ? 1 : 0,
  skill_ids: pickMany(skillIds, 1, 4).join("|"),
  drop_group_id: ref(dropGroupIds),
}));
const monsterIds = T.Monster.map((r) => r.monster_id);

// 보상
T.RewardGroup = range(50001, 2500).map((id) => ({ reward_group_id: id, memo: `보상 그룹 ${id}` }));
const rewardGroupIds = T.RewardGroup.map((r) => r.reward_group_id);
// 일부 보상 그룹은 아무도 쓰지 않게 남겨 둔다(쓰이지 않는 데이터).
const usedRewardGroupIds = rewardGroupIds.slice(0, 2300);

// 타입+ID: ITEM, CURRENCY, CHARACTER, COSTUME
T.Reward = rewardGroupIds.flatMap((groupId) =>
  range(1, int(1, 5)).map(() => {
    const type = pick(["ITEM", "ITEM", "ITEM", "CURRENCY", "CURRENCY", "CHARACTER", "COSTUME"]);
    const target = { ITEM: itemIds, CURRENCY: currencyIds, CHARACTER: charIds, COSTUME: costumeIds }[type];
    return { reward_group_id: groupId, reward_type: type, reward_id: ref(target), count: type === "CURRENCY" ? int(10, 100000) : int(1, 10) };
  }),
);

T.MailTemplate = range(52001, 300).map((id) => ({
  mail_id: id,
  title_key: name("MAIL", id, `우편 ${id}`, `Mail ${id}`),
  reward_group_id: ref(usedRewardGroupIds),
  expire_days: pick([7, 14, 30]),
}));

T.Coupon = range(1, 100).map((i) => ({
  coupon_code: `DV${String(i).padStart(4, "0")}${pick(["A", "B", "C"])}`,
  reward_group_id: ref(usedRewardGroupIds),
  max_use: pick([1, 1000, 100000]),
}));

// 월드
T.Map = range(61001, 60).map((id) => ({ map_id: id, name_key: name("MAP", id, `지역 ${id}`, `Map ${id}`) }));
const mapIds = T.Map.map((r) => r.map_id);
T.Portal = range(62001, 200).map((id) => ({ portal_id: id, from_map_id: ref(mapIds), to_map_id: ref(mapIds) }));

T.Chapter = range(1, 30).map((id) => ({ chapter_id: id, name_key: name("CHAPTER", id, `챕터 ${id}`, `Chapter ${id}`) }));
const chapterIds = T.Chapter.map((r) => r.chapter_id);

T.Stage = range(60001, 900).map((id, i) => ({
  stage_id: id,
  chapter_id: chapterIds[Math.floor(i / 30)],
  map_id: ref(mapIds),
  monster_ids: pickMany(monsterIds, 2, 6).join("|"),
  first_reward_group_id: ref(usedRewardGroupIds),
  repeat_reward_group_id: ref(usedRewardGroupIds),
  // 자기 참조: 앞 스테이지를 깨야 열린다
  unlock_stage_id: i === 0 ? null : id - 1,
  stamina_cost: pick([5, 6, 8, 10]),
}));
const stageIds = T.Stage.map((r) => r.stage_id);

T.Dungeon = range(63001, 40).map((id) => ({
  dungeon_id: id,
  name_key: name("DUNGEON", id, `던전 ${id}`, `Dungeon ${id}`),
  stage_ids: pickMany(stageIds, 3, 8).join("|"),
  entry_currency_id: ref(currencyIds),
}));
const dungeonIds = T.Dungeon.map((r) => r.dungeon_id);
T.DungeonSchedule = dungeonIds.flatMap((dungeonId) =>
  pickMany([1, 2, 3, 4, 5, 6, 7], 2, 5).map((weekday) => ({ dungeon_id: dungeonId, weekday, open_hour: pick([0, 12, 18]) })),
);

// NPC, 대화
T.Npc = range(64001, 300).map((id) => ({ npc_id: id, name_key: name("NPC", id, `NPC ${id}`, `NPC ${id}`), map_id: ref(mapIds) }));
const npcIds = T.Npc.map((r) => r.npc_id);
T.Dialog = range(65001, 2000).map((id, i) => ({
  dialog_id: id,
  npc_id: ref(npcIds),
  text_key: name("DIALOG", id, `대사 ${id}`, `Line ${id}`),
  // 자기 참조: 다음 대사
  next_dialog_id: chance(0.7) && i < 1999 ? id + 1 : null,
}));

// 퀘스트
// 타입+ID: KILL은 Monster, CLEAR는 Stage, COLLECT는 Item, LEVEL은 참조 없음
T.QuestCondition = range(70001, 3000).map((id) => {
  const type = pick(["KILL", "KILL", "CLEAR", "COLLECT", "LEVEL"]);
  const target = { KILL: monsterIds, CLEAR: stageIds, COLLECT: itemIds }[type];
  return {
    condition_id: id,
    cond_type: type,
    target_id: target ? ref(target) : null,
    count: type === "LEVEL" ? int(5, 80) : int(1, 50),
  };
});
const conditionIds = T.QuestCondition.map((r) => r.condition_id);

T.Title = range(73001, 150).map((id) => ({ title_id: id, name_key: name("TITLE", id, `칭호 ${id}`, `Title ${id}`), buff_id: chance(0.5) ? ref(buffIds) : null }));
const titleIds = T.Title.map((r) => r.title_id);

const questsAll = range(71001, 1500).map((id, i) => ({
  quest_id: id,
  quest_type: pick(["MAIN", "SUB", "DAILY", "WEEKLY", "REPEAT"]),
  name_key: name("QUEST", id, `퀘스트 ${id}`, `Quest ${id}`),
  prev_quest_id: i > 0 && chance(0.6) ? id - 1 : null,
  npc_id: ref(npcIds),
  condition_id: ref(conditionIds),
  reward_group_id: ref(usedRewardGroupIds),
}));
T.Quest = questsAll;

T.Achievement = range(72001, 600).map((id) => ({
  achievement_id: id,
  condition_id: ref(conditionIds),
  reward_group_id: ref(usedRewardGroupIds),
  title_id: chance(0.25) ? ref(titleIds) : null,
}));

T.Tutorial = range(1, 60).map((step) => ({ step_id: step, target_stage_id: ref(stageIds.slice(0, 60)), reward_group_id: ref(usedRewardGroupIds) }));

// 상점
T.Shop = range(1, 20).map((id) => ({ shop_id: id, name_key: name("SHOP", id, `상점 ${id}`, `Shop ${id}`), reset_type: pick(["NONE", "DAILY", "WEEKLY", "MONTHLY"]) }));
const shopIds = T.Shop.map((r) => r.shop_id);

// 번호 붙은 여러 열: bonus_item_id_1~3
T.ShopProduct = range(80001, 1200).map((id) => {
  const row = {
    product_id: id,
    shop_id: ref(shopIds),
    item_id: ref(itemIds),
    item_count: int(1, 100),
    price_currency_id: ref(currencyIds),
    price: int(10, 100000),
  };
  const n = int(0, 3);
  for (let i = 1; i <= 3; i++) row[`bonus_item_id_${i}`] = i <= n ? ref(itemIds) : null;
  return row;
});

// 번호 붙은 여러 열: item_id_1~5
T.Package = range(81001, 300).map((id) => {
  const row = { package_id: id, name_key: name("PACKAGE", id, `패키지 ${id}`, `Package ${id}`), price_currency_id: ref(currencyIds), price: int(1000, 99000) };
  const n = int(2, 5);
  for (let i = 1; i <= 5; i++) {
    row[`item_id_${i}`] = i <= n ? ref(itemIds) : null;
    row[`item_count_${i}`] = i <= n ? int(1, 999) : null;
  }
  return row;
});

// 가챠
T.GachaPool = range(91001, 200).map((id) => ({ pool_id: id, char_ids: pickMany(charIds, 3, 12).join("|"), rate: Math.round(rand() * 10000) / 100 }));
const poolIds = T.GachaPool.map((r) => r.pool_id);
T.Gacha = range(90001, 40).map((id) => ({
  gacha_id: id,
  name_key: name("GACHA", id, `소환 ${id}`, `Summon ${id}`),
  cost_currency_id: ref(currencyIds),
  cost: pick([100, 300, 1000, 3000]),
  pool_ids: pickMany(poolIds, 2, 6).join(";"),
}));

// 펫
T.Pet = range(95001, 150).map((id) => ({ pet_id: id, item_id: ref(itemIdsByType("PET_FOOD")), skill_id: ref(skillIds), grade_id: ref(gradeIds) }));
T.PetLevel = T.Pet.flatMap((p) => range(1, 30).map((level) => ({ pet_id: p.pet_id, level, food_item_id: ref(itemIdsByType("PET_FOOD")), food_count: level * 2 })));

// 이벤트
T.Event = range(96001, 30).map((id) => ({
  event_id: id,
  name_key: name("EVENT", id, `이벤트 ${id}`, `Event ${id}`),
  token_currency_id: 6,
  start_at: new Date(Date.UTC(2026, int(0, 11), int(1, 28))),
}));
const eventIds = T.Event.map((r) => r.event_id);
T.EventMission = range(97001, 900).map((id) => ({ mission_id: id, event_id: ref(eventIds), condition_id: ref(conditionIds), reward_group_id: ref(usedRewardGroupIds) }));
T.EventShop = range(98001, 600).map((id) => ({ event_shop_id: id, event_id: ref(eventIds), item_id: ref(itemIds), cost_currency_id: 6, cost: int(10, 5000) }));
T.BattlePass = range(1, 5).flatMap((season) =>
  range(1, 50).map((level) => ({ season_id: season, level, free_reward_group_id: ref(usedRewardGroupIds), paid_reward_group_id: ref(usedRewardGroupIds) })),
);
T.Attendance = range(1, 12).flatMap((month) => range(1, 28).map((day) => ({ attendance_id: month * 100 + day, month, day, reward_group_id: ref(usedRewardGroupIds) })));

// 길드, PvP
T.GuildLevel = range(1, 30).map((level) => ({ guild_level: level, need_exp: level * 10000, buff_id: ref(buffIds) }));
T.PvpRank = range(1, 20).map((id) => ({ rank_id: id, min_point: (id - 1) * 100, season_reward_group_id: ref(usedRewardGroupIds) }));

// 다국어 문자열. name_key 등이 이 key를 가리킨다.
T.String = strings;

// 파일 구성. 시트 순서대로 엑셀에 넣는다.
const FILES = {
  "Common.xlsx": ["Grade", "Currency", "Stat", "StatGroup", "Buff"],
  "Item.xlsx": ["Item", "ItemEffect", "Equipment", "EquipSet", "Recipe"],
  "Character.xlsx": ["Class", "Character", "CharacterLevel", "Costume"],
  "Skill.xlsx": ["Skill", "SkillEffect"],
  "Monster.xlsx": ["Monster", "DropGroup", "DropItem"],
  "Reward.xlsx": ["RewardGroup", "Reward", "MailTemplate", "Coupon"],
  "World.xlsx": ["Chapter", "Stage", "Map", "Portal", "Dungeon", "DungeonSchedule"],
  "Npc.xlsx": ["Npc", "Dialog"],
  "Quest.xlsx": ["QuestCondition", "Quest", "Achievement", "Title", "Tutorial"],
  "Shop.xlsx": ["Shop", "ShopProduct", "Package"],
  "Gacha.xlsx": ["Gacha", "GachaPool"],
  "Pet.xlsx": ["Pet", "PetLevel"],
  "Event.xlsx": ["Event", "EventMission", "EventShop", "BattlePass", "Attendance"],
  "Guild.xlsx": ["GuildLevel", "PvpRank"],
};

function writeBook(dir, file, sheets, tables) {
  const book = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(tables[sheet]), sheet);
  }
  XLSX.writeFile(book, join(dir, file), { compression: true });
}

const gameDir = join(OUT, "game");
const prevDir = join(OUT, "game-prev");
const mysqlDir = join(OUT, "mysql");
for (const d of [gameDir, prevDir, mysqlDir]) mkdirSync(d, { recursive: true });

for (const [file, sheets] of Object.entries(FILES)) writeBook(gameDir, file, sheets, T);
// CSV 경로도 쓰이도록 문자열 테이블은 CSV로 낸다.
writeFileSync(join(gameDir, "String.csv"), XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(T.String)));

// 이전 버전: 아이템은 삭제된 25개가 있고 새 40개가 없으며 60개는 값이 다르다. 퀘스트는 30개의 보상이 다르다.
const changedItemIds = new Set(pickMany(itemsCurrent.slice(0, 2900).map((r) => r.item_id), 60, 60));
const prevTables = {
  ...T,
  Item: allItems
    .filter((r) => !newItemIds.has(r.item_id))
    .map((r) => (changedItemIds.has(r.item_id) ? { ...r, sell_price: r.sell_price + int(1, 999), grade_id: pick(gradeIds) } : r)),
  Quest: questsAll.map((r, i) => (i % 50 === 7 ? { ...r, reward_group_id: pick(usedRewardGroupIds) } : r)),
};
writeBook(prevDir, "Item.xlsx", FILES["Item.xlsx"], prevTables);
writeBook(prevDir, "Quest.xlsx", FILES["Quest.xlsx"], prevTables);

// MySQL 시드. 같은 데이터를 game 데이터베이스에 넣고 읽기 전용 계정을 만든다.
function sqlType(values) {
  const present = values.filter((v) => v !== null && v !== undefined);
  if (present.length && present.every((v) => v instanceof Date)) return "DATETIME";
  if (present.length && present.every((v) => Number.isInteger(v))) return "BIGINT";
  if (present.length && present.every((v) => typeof v === "number")) return "DOUBLE";
  const max = Math.max(16, ...present.map((v) => String(v).length));
  return max > 500 ? "TEXT" : `VARCHAR(${Math.min(max * 2, 1000)})`;
}
function sqlValue(v) {
  if (v === null || v === undefined) return "NULL";
  if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace("T", " ")}'`;
  if (typeof v === "number") return String(v);
  return `'${String(v).replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}
const sql = [
  "CREATE DATABASE IF NOT EXISTS game CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;",
  "USE game;",
];
for (const [tableName, rows] of Object.entries(T)) {
  const columns = Object.keys(rows[0]);
  sql.push(`DROP TABLE IF EXISTS \`${tableName}\`;`);
  sql.push(`CREATE TABLE \`${tableName}\` (${columns.map((c) => `\`${c}\` ${sqlType(rows.map((r) => r[c]))} NULL`).join(", ")});`);
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r) => `(${columns.map((c) => sqlValue(r[c])).join(",")})`);
    sql.push(`INSERT INTO \`${tableName}\` (${columns.map((c) => `\`${c}\``).join(",")}) VALUES ${batch.join(",")};`);
  }
}
sql.push("CREATE USER IF NOT EXISTS 'viewer'@'%' IDENTIFIED BY 'viewer';");
sql.push("GRANT SELECT ON game.* TO 'viewer'@'%';");
writeFileSync(join(mysqlDir, "seed.sql"), sql.join("\n") + "\n");

// 환경변수에서 DB 접속 정보 읽기를 시험하는 .env. docker-compose.yml의 테스트 계정 값이다.
const envDir = join(OUT, "env");
mkdirSync(envDir, { recursive: true });
writeFileSync(
  join(envDir, "test.env"),
  [
    "# data-view 테스트용. docker compose up -d 로 띄운 MySQL",
    "GAME_DB_HOST=127.0.0.1",
    "GAME_DB_PORT=3307",
    "GAME_DB_USER=viewer",
    "GAME_DB_PASSWORD=viewer",
    "GAME_DB_NAME=game",
    'DATABASE_URL="mysql://viewer:viewer@127.0.0.1:3307/game"',
    "",
  ].join("\n"),
);

const total = Object.values(T).reduce((sum, rows) => sum + rows.length, 0);
console.log(`sheets ${Object.keys(T).length}, rows ${total}, files ${Object.keys(FILES).length + 1}`);
