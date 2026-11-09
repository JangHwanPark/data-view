// 화면 테마. 설정값(system, light, dark)은 브라우저에 기억하고, 실제 적용은 <html class="dark">로 한다.
export type ThemePreference = "system" | "light" | "dark";

export const THEME_KEY = "data-view:theme";

// HTML이 그려지기 전에 실행하는 스크립트. 첫 화면이 밝게 떴다가 어두워지는 깜빡임을 막는다.
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}");var d=p==="dark"||(p!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

const listeners = new Set<() => void>();

export function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function systemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolvedTheme(): "light" | "dark" {
  const pref = readPreference();
  return pref === "dark" || (pref === "system" && systemDark()) ? "dark" : "light";
}

export function applyTheme() {
  document.documentElement.classList.toggle("dark", resolvedTheme() === "dark");
}

export function setPreference(pref: ThemePreference) {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // 저장이 막힌 브라우저에서는 이번 화면에만 적용된다.
  }
  applyTheme();
  listeners.forEach((l) => l());
}

// useSyncExternalStore용 구독. 시스템 테마가 바뀌어도 알린다.
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    applyTheme();
    listener();
  };
  media.addEventListener("change", onChange);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onChange);
  };
}
