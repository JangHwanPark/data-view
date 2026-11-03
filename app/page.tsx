import { SourceList } from "@/components/source-list";

export default function Home() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">데이터 소스</h1>
      <SourceList />
    </div>
  );
}
