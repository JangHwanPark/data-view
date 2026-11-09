// 테이블 한글 이름(PLAN.md 25단계, 3-5 3-6). QA는 영어 테이블 이름(RewardDaily)보다 한글 이름(일일 보상)으로 찾는다.
// 1. 엑셀 #Design 머리말이 있으면 그것을 쓴다(기획자가 적은 이름이라 확실하다).
// 2. 없으면 단어 사전(영어,한글 csv)으로 테이블 이름의 단어를 옮겨 짓고 「추론」 표시를 붙인다.
//    - 단어 나누기: RewardDaily → Reward, Daily / reward_group_id → reward, group, id
//    - A By B → B별 A(ItemByType → 종류별 아이템), A Per B → B당 A(GoldPerLevel → 레벨당 골드)
//    - 끝에 붙은 꾸밈말(Daily, Weekly, Event …)은 앞으로 옮긴다(RewardDaily → 일일 보상, 38단계).
//    - 사전에 없는 단어는 영어 그대로 덧붙인다(FruitPrise → 과일 Prise). 아는 단어가 하나도 없으면 한글 이름이 없다.
// 3. 한글 이름이 같은 테이블이 여럿이면 서로 다른 단어를 괄호에 붙인다(보상(일일), 보상(주간)).
// 이 파일은 브라우저 없이도 돌 수 있게 순수 함수만 둔다.

export interface KoreanName {
  text: string; // 화면에 쓰는 이름(같은 이름 구분 괄호 포함)
  base: string; // 괄호 전 이름
  inferred: boolean; // 사전으로 지은 이름이면 true, #Design 머리말이면 false
  unknown: string[]; // 사전에 없어 영어로 남긴 단어
}

// 회사 게임 데이터에 자주 나오는 단어. 사용자가 단어 사전 csv로 더하거나 바꾼다(사용자 사전이 이긴다).
export const DEFAULT_WORDS_CSV = `english,korean
Achievement,업적
Asset,재화
Attendance,출석
Battle,전투
Buff,버프
Chapter,챕터
Character,캐릭터
Class,직업
Color,색
Condition,조건
Cost,비용
Costume,코스튬
Count,개수
Coupon,쿠폰
Currency,재화
Daily,일일
Day,날짜
Days,날짜
Dialog,대화
Drop,드랍
Dungeon,던전
Effect,효과
Equip,장비
Equipment,장비
Event,이벤트
Exp,경험치
Fruit,과일
Gacha,뽑기
Gold,골드
Grade,등급
Group,그룹
Growth,성장
Guild,길드
Info,정보
Item,아이템
Key,키
Level,레벨
Limited,한정
List,목록
Mail,우편
Map,지도
Material,재료
Mission,미션
Monster,몬스터
Monthly,월간
Name,이름
Npc,NPC
Package,패키지
Pass,패스
Period,기간
Pet,펫
Pool,풀
Portal,포털
Price,가격
Product,상품
Pvp,PvP
Quest,퀘스트
Rank,순위
Rate,확률
Recipe,제작법
Repeat,반복
Reward,보상
Schedule,일정
Season,계절
Set,세트
Shop,상점
Skill,스킬
Special,특별
Stage,스테이지
Stat,능력치
String,문자열
Template,틀
Text,글
Title,칭호
Tutorial,튜토리얼
Type,종류
Weekly,주간
World,월드`;

// 단어 사전 csv: 한 줄에 「영어,한글」. 첫 줄이 english,korean이면 머리글로 보고 건너뛴다. # 줄은 주석.
// 영어는 대소문자를 가리지 않고, 여러 단어(RewardGroup, reward group)는 붙여서 찾는다.
export function parseWordCsv(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [en, ko] = trimmed.split(/[,\t]/).map((s) => s?.trim().replace(/^"|"$/g, ""));
    if (!en || !ko || (/^english$/i.test(en) && /^korean$/i.test(ko))) continue;
    map.set(wordKey(en), ko);
  }
  return map;
}

const wordKey = (s: string) => s.toLowerCase().replace(/[\s_\-]/g, "");

// 기본 사전 + 기획서 이름 짝(아이템=Item) + 사용자 사전 순으로 합친다. 뒤에 온 것이 이긴다.
export function buildDictionary(userCsv: string, glossary: Map<string, string>): Map<string, string> {
  const dict = parseWordCsv(DEFAULT_WORDS_CSV);
  for (const [ko, en] of glossary) if (!dict.has(wordKey(en))) dict.set(wordKey(en), ko);
  for (const [en, ko] of parseWordCsv(userCsv)) dict.set(en, ko);
  return dict;
}

// 테이블 이름을 단어로 나눈다. 밑줄, 공백, 대소문자 경계, 숫자 경계로 자른다(HTTPRequest → HTTP, Request).
export function splitWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .split(/[\s_\-.#]+/)
    .filter(Boolean);
}

// 단어 목록을 옮긴다. 붙여서 사전에 있는 가장 긴 묶음부터 쓴다(Reward Group이 사전에 있으면 「보상 그룹」 하나로).
function translateWords(words: string[], dict: Map<string, string>) {
  const out: string[] = [];
  const unknown: string[] = [];
  let known = 0;
  for (let i = 0; i < words.length; ) {
    let hit = 0;
    for (let j = words.length; j > i; j--) {
      if (dict.has(wordKey(words.slice(i, j).join("")))) {
        hit = j;
        break;
      }
    }
    if (hit) {
      out.push(dict.get(wordKey(words.slice(i, hit).join("")))!);
      known += hit - i;
      i = hit;
    } else {
      // 숫자만인 단어(Asset 2)는 그대로 둔다. 모르는 단어로 세지 않는다.
      out.push(words[i]);
      if (!/^\d+$/.test(words[i])) unknown.push(words[i]);
      i++;
    }
  }
  return { text: out.join(" "), unknown, known };
}

// 사전으로 한글 이름을 짓는다. 아는 단어가 하나도 없으면 null.
export function inferKorean(table: string, dict: Map<string, string>): { text: string; unknown: string[] } | null {
  const words = splitWords(table);
  if (!words.length) return null;
  // A By B, A Per B: 기준(B)을 앞에 둔다.
  const joiner = words.findIndex((w, i) => i > 0 && i < words.length - 1 && /^(by|per)$/i.test(w));
  if (joiner > 0) {
    const a = translateWords(words.slice(0, joiner), dict);
    const b = translateWords(words.slice(joiner + 1), dict);
    if (a.known + b.known === 0) return null;
    const suffix = /^by$/i.test(words[joiner]) ? "별" : "당";
    return { text: `${b.text}${suffix} ${a.text}`, unknown: [...b.unknown, ...a.unknown] };
  }
  // 영어 테이블 이름은 꾸밈말을 뒤에 붙이곤 한다(RewardDaily, QuestRepeat). 한글은 꾸밈말이 앞이라 순서를 바꾼다.
  // 끝에서부터 이어진 꾸밈말을 떼어, 사전에 있어 옮겨지는 것만 앞으로 보낸다. 앞에 남는 단어가 있어야 한다.
  let cut = words.length;
  while (cut > 1 && TRAILING_MODIFIERS.has(words[cut - 1].toLowerCase()) && dict.has(wordKey(words[cut - 1]))) cut--;
  if (cut < words.length) {
    const head = translateWords(words.slice(0, cut), dict);
    const mods = translateWords(words.slice(cut), dict);
    if (head.known + mods.known === 0) return null;
    return { text: `${mods.text} ${head.text}`, unknown: [...mods.unknown, ...head.unknown] };
  }
  const t = translateWords(words, dict);
  return t.known ? { text: t.text, unknown: t.unknown } : null;
}

// 테이블 이름 끝에 와도 꾸미는 말로 보는 단어. 사용자 사전에 없는 단어는 옮기지 않으므로 순서도 그대로다.
// 명사로도 쓰이는 말(Event, Season)은 끝에 올 때만 꾸밈말로 본다(EventShop은 그대로 「이벤트 상점」).
const TRAILING_MODIFIERS = new Set(["daily", "weekly", "monthly", "event", "repeat", "limited", "special", "season"]);

export interface NameInput {
  key: string; // 테이블 키(소스id/테이블)
  table: string;
  title: string | null; // #Design 머리말
  sourceName?: string; // 같은 이름 구분이 단어로 안 될 때 쓴다(같은 테이블을 파일과 DB로 연 경우)
}

// 모든 테이블의 한글 이름. 같은 이름이 여럿이면 괄호로 구분한다(3-6).
export function koreanNames(inputs: NameInput[], dict: Map<string, string>): Map<string, KoreanName> {
  const result = new Map<string, KoreanName>();
  for (const t of inputs) {
    if (t.title) {
      result.set(t.key, { text: t.title, base: t.title, inferred: false, unknown: [] });
      continue;
    }
    const inferred = inferKorean(t.table, dict);
    if (inferred) result.set(t.key, { text: inferred.text, base: inferred.text, inferred: true, unknown: inferred.unknown });
  }

  // 같은 이름끼리 묶어, 모두에게 있는 단어를 빼고 남은 단어를 괄호에 붙인다.
  const byName = new Map<string, NameInput[]>();
  for (const t of inputs) {
    const name = result.get(t.key);
    if (name) byName.set(name.base, [...(byName.get(name.base) ?? []), t]);
  }
  for (const [, group] of byName) {
    if (group.length < 2) continue;
    const wordsOf = group.map((t) => splitWords(t.table).map((w) => w.toLowerCase()));
    const common = wordsOf[0].filter((w) => wordsOf.every((ws) => ws.includes(w)));
    const labels = group.map((t) => {
      const rest = splitWords(t.table).filter((w) => !common.includes(w.toLowerCase()));
      if (!rest.length) return null;
      return translateWords(rest, dict).text;
    });
    // 옮긴 괄호가 서로 겹치면(같은 뜻의 두 단어) 영어 단어를 그대로 쓴다.
    const clash = new Set(labels.filter((l, i) => l && labels.indexOf(l) !== i));
    group.forEach((t, i) => {
      const name = result.get(t.key)!;
      let label = labels[i];
      // 괄호가 이름과 겹쳐도(과일 가격(가격)) 구분이 안 되므로 영어 단어를 쓴다.
      if (!label || clash.has(label) || name.base.includes(label)) {
        const rest = splitWords(t.table).filter((w) => !common.includes(w.toLowerCase()));
        label = rest.length ? rest.join(" ") : (t.sourceName ?? t.table);
      }
      result.set(t.key, { ...name, text: `${name.base}(${label})` });
    });
  }
  return result;
}

// 화면 이름 표시 방식(3-12). 영어, 한글, 한글 영어.
export type NameMode = "en" | "ko" | "both";

export function displayName(table: string, name: KoreanName | undefined, mode: NameMode) {
  if (mode === "en" || !name) return table;
  return mode === "ko" ? name.text : `${name.text} ${table}`;
}

// 사이드바를 영어 이름 첫 단어로 묶을 때 쓰는 묶음 이름(RewardDaily → Reward).
export function firstWord(table: string) {
  return splitWords(table)[0] ?? table;
}
