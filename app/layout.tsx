import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { ExplainLayer } from "@/components/explain/value-explain";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { THEME_INIT_SCRIPT } from "@/lib/client/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "data-view",
  description: "데이터베이스와 엑셀 파일을 시각화하는 로컬 도구",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* 테마 클래스를 HTML이 그려지기 전에 붙인다. 위 suppressHydrationWarning은 이 스크립트가 바꾼 class를 React가 덮지 않게 한다. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full bg-zinc-50 text-[13px] text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <WorkspaceProvider>
          <div className="flex min-h-screen">
            {/* 사이드바는 현재 경로를 읽으므로 경로가 정해지기 전에는 빈 자리만 그린다. */}
            <Suspense fallback={<div className="w-64 shrink-0 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" />}>
              <Sidebar />
            </Suspense>
            <div className="flex min-w-0 flex-1 flex-col">
              <Suspense fallback={<div className="h-10 shrink-0 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" />}>
                <TopBar />
              </Suspense>
              <main className="flex min-w-0 flex-1 flex-col px-5 py-4">{children}</main>
            </div>
          </div>
          {/* 표의 값에 마우스를 올렸을 때 그 값이 어떤 데이터인지 보여주는 말풍선. 화면에 하나만 둔다. */}
          <ExplainLayer />
        </WorkspaceProvider>
      </body>
    </html>
  );
}
