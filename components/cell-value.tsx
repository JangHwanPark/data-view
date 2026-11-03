import type { QueryColumn } from "@/lib/query-result";

export function formatValue(value: unknown, type: QueryColumn["type"]) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (type === "date" && typeof value === "string") {
    // 날짜 값은 시간대 없는 ISO 문자열이라 변환 없이 잘라서 보여준다. 자정이면 날짜만 쓴다.
    const [date, time = ""] = value.replace("Z", "").split("T");
    const hms = time.slice(0, 8);
    return !hms || hms === "00:00:00" ? date : `${date} ${hms}`;
  }
  return String(value);
}

// 관계가 걸린 값. 누르면 연결된 행으로 따라간다.
export function LinkValue({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="max-w-full truncate text-blue-700 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-700 dark:text-blue-400 dark:decoration-blue-700"
    >
      {text}
    </button>
  );
}
