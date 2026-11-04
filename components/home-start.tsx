"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { BookOpen, FolderInput, GitCompareArrows, Network, Search, SearchX } from "lucide-react";
import { useWorkspace } from "@/components/workspace-provider";

// 첫 화면(설계 1.1). 기능 이름이 아니라 QA가 실제로 하는 질문으로 시작한다.
// 파일을 하나도 안 불러왔으면 불러오는 방법부터 보여준다.
export function HomeStart() {
  const { sources, docs, initialized } = useWorkspace();
  if (!initialized) return <p className="text-zinc-500">불러오는 중...</p>;
  if (sources.length === 0 && docs.length === 0) return <Welcome />;
  const tables = sources.reduce((n, s) => n + s.tables.length, 0);

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold">무엇을 확인할까요?</h1>
        <Link href="/files" className="text-zinc-500 hover:underline">
          불러온 파일 {sources.length}개, 테이블 {tables}개, 기획서 {docs.length}개
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <IdSearchCard />
        <Card
          href="/docs"
          icon={<BookOpen className="size-5" aria-hidden />}
          title="기획서와 맞춰 보기"
          text="기획서 표의 ID와 값(보상 그룹, 판매가, 가격)이 실제 데이터와 같은지 비교하고, 다른 값과 데이터에 없는 ID를 모아 보여줍니다. 기획서에만 있는 옛 이름도 찾아 줍니다."
          note="문장 속에 쓴 수치(예: 보상 골드: 500)는 아직 비교하지 않습니다."
        />
        <Card
          href="/map"
          icon={<Network className="size-5" aria-hidden />}
          title="시스템 지도"
          text="테이블이 퀘스트, 아이템, 보상 같은 시스템으로 어떻게 묶이고 서로 어떻게 이어지는지 한눈에 봅니다. 처음 보는 데이터라면 여기서 시작하세요."
        />
        <Card
          icon={<SearchX className="size-5" aria-hidden />}
          title="없는 ID 찾기"
          text="다른 테이블에 없는 ID를 쓰는 곳(예: 지워진 아이템을 주는 보상)을 모아 보여줍니다."
          note="준비 중입니다. 지금은 테이블의 연결 그림에서 선을 누르면 맞지 않는 ID 개수를 볼 수 있습니다."
        />
        <Card
          icon={<GitCompareArrows className="size-5" aria-hidden />}
          title="패치 전후 비교"
          text="새로 받은 테이블 파일과 이전 파일을 비교해 바뀐 행과 값을 보여줍니다."
          note="준비 중입니다. 지금은 파일 화면의 '원본 경로에서 다시 읽기'로 새 파일로 바꿀 수 있습니다."
        />
      </div>

      <p className="text-xs text-zinc-500">
        왼쪽 목록에서 테이블을 누르면 그 테이블이 쓰는 테이블과 그 테이블을 쓰는 테이블을 그림으로 볼 수 있습니다. 값을 보려면 그림 위의 &lsquo;데이터&rsquo;를 누르세요.
      </p>
    </div>
  );
}

function IdSearchCard() {
  const router = useRouter();
  const [value, setValue] = useState("");
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="flex items-center gap-2 font-semibold">
        <Search className="size-5" aria-hidden />
        ID로 찾기
      </h2>
      <p className="text-zinc-600 dark:text-zinc-400">아이템 ID, 퀘스트 ID 같은 값을 넣으면 어느 테이블의 무엇이고 어디에 쓰이는지 보여줍니다.</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) router.push(`/search?q=${encodeURIComponent(value.trim())}`);
        }}
      >
        <input
          id="home-id-search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="예: 100041, 71003"
          aria-label="찾을 ID나 값"
          className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-950"
        />
        <button type="submit" className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
          찾기
        </button>
      </form>
    </section>
  );
}

function Card({ href, icon, title, text, note }: { href?: string; icon: ReactNode; title: string; text: string; note?: string }) {
  const body = (
    <>
      <h2 className="flex items-center gap-2 font-semibold">
        {icon}
        {title}
        {!href && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-normal text-zinc-500 dark:bg-zinc-800">준비 중</span>}
      </h2>
      <p className="text-zinc-600 dark:text-zinc-400">{text}</p>
      {note && <p className="text-xs text-zinc-500">{note}</p>}
    </>
  );
  const cls = "flex flex-col gap-2 rounded-lg border p-4";
  return href ? (
    <Link href={href} className={`${cls} border-zinc-300 bg-white hover:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-500`}>
      {body}
    </Link>
  ) : (
    <section className={`${cls} border-dashed border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/50`}>{body}</section>
  );
}

// 아무것도 안 불러왔을 때. 위치를 적어 폴더째 불러오는 쪽을 먼저 권한다.
function Welcome() {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">게임 데이터와 기획서를 불러와 주세요</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        테이블 엑셀과 기획서를 불러오면, 테이블끼리 어떻게 이어지는지 앱이 찾아서 그림으로 보여주고, 기획서에 적힌 이름과 ID가 데이터의 어디인지 이어 줍니다. 파일은 이 PC 밖으로 나가지 않습니다.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card
          href="/sources/new/path?kind=data"
          icon={<FolderInput className="size-5" aria-hidden />}
          title="테이블 폴더 불러오기"
          text="테이블 엑셀이 들어 있는 폴더 위치를 적으면 한꺼번에 불러옵니다."
        />
        <Card
          href="/sources/new/path?kind=doc"
          icon={<BookOpen className="size-5" aria-hidden />}
          title="기획서 폴더 불러오기"
          text="워드, PPT, PDF, 엑셀 기획서가 들어 있는 폴더 위치를 적으면 한꺼번에 불러옵니다."
        />
      </div>
      <p className="text-xs text-zinc-500">파일을 하나씩 고르려면 오른쪽 위의 &lsquo;파일 불러오기&rsquo;를 누르세요.</p>
    </div>
  );
}
