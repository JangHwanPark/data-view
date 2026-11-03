import type { Relation } from "@/lib/client/relations";
import { tableKey } from "@/lib/client/schema";

const COLUMN_GAP = 340;
const ROW_GAP = 40;
const HEADER_HEIGHT = 48;
const COLUMN_ROW_HEIGHT = 26;

// 저장된 위치가 없는 테이블을 관계 방향에 따라 왼쪽에서 오른쪽으로 층을 나눠 놓는다.
// 가리키는 쪽(주문)이 왼쪽, 가리켜지는 쪽(고객)이 오른쪽에 온다.
// columnCounts는 테이블마다 전체 열 수다. 모든 열을 펼쳐도 아래 노드와 겹치지 않도록 이 높이로 간격을 잡는다.
export function layeredLayout(keys: string[], relations: Relation[], columnCounts: Record<string, number>) {
  const outgoing = new Map<string, Set<string>>();
  for (const { from, to } of relations) {
    const a = tableKey(from.sourceId, from.table);
    const b = tableKey(to.sourceId, to.table);
    if (a === b || !keys.includes(a) || !keys.includes(b)) continue;
    if (!outgoing.has(a)) outgoing.set(a, new Set());
    outgoing.get(a)!.add(b);
  }

  // 가리켜지는 테이블은 가리키는 테이블보다 한 층 오른쪽에 둔다. 순환이 있으면 테이블 수만큼만 돌고 멈춘다.
  const level = new Map(keys.map((k) => [k, 0]));
  for (let i = 0; i < keys.length; i++) {
    let changed = false;
    for (const [a, targets] of outgoing) {
      for (const b of targets) {
        if (level.get(b)! < level.get(a)! + 1) {
          level.set(b, level.get(a)! + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // 층마다 다음 노드를 놓을 y 위치
  const nextY = new Map<number, number>();
  const positions: Record<string, { x: number; y: number }> = {};
  for (const key of keys) {
    const l = level.get(key)!;
    const y = nextY.get(l) ?? 0;
    positions[key] = { x: l * COLUMN_GAP, y };
    nextY.set(l, y + HEADER_HEIGHT + (columnCounts[key] ?? 0) * COLUMN_ROW_HEIGHT + ROW_GAP);
  }
  return positions;
}
