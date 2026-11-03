import Link from "next/link";

const TABS = [
  { key: "list", href: "/relations", label: "목록" },
  { key: "diagram", href: "/relations/diagram", label: "다이어그램" },
] as const;

export function RelationsTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav className="flex gap-1 border-b border-zinc-200 text-sm dark:border-zinc-800">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`-mb-px border-b-2 px-3 py-1.5 ${
            tab.key === active
              ? "border-zinc-900 font-medium dark:border-zinc-100"
              : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
