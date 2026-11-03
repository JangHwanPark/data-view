"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { applyTheme, readPreference, setPreference, subscribeTheme, type ThemePreference } from "@/lib/client/theme";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "시스템 설정 따르기", icon: Monitor },
  { value: "light", label: "밝게", icon: Sun },
  { value: "dark", label: "어둡게", icon: Moon },
];

export function ThemeToggle() {
  const pref = useSyncExternalStore(subscribeTheme, readPreference, () => "system" as const);

  // 개발 모드에서 React가 <html>을 다시 그리며 클래스를 지우는 경우를 위해 한 번 더 적용한다. 운영 빌드에서는 바뀌는 게 없다.
  useLayoutEffect(() => {
    applyTheme();
  }, []);

  return (
    <div role="radiogroup" aria-label="화면 테마" className="flex shrink-0 rounded border border-zinc-300 p-0.5 dark:border-zinc-700">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          aria-label={label}
          title={label}
          onClick={() => setPreference(value)}
          className={`rounded-sm p-1 ${
            pref === value
              ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
              : "text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          }`}
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}

// React Flow처럼 직접 테마를 받는 컴포넌트에 넘길 값
export function useResolvedTheme(): "light" | "dark" {
  const pref = useSyncExternalStore(subscribeTheme, readPreference, () => "system" as const);
  const systemDark = useSyncExternalStore(
    subscribeTheme,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
  return pref === "dark" || (pref === "system" && systemDark) ? "dark" : "light";
}
