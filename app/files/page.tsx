import { SourceList } from "@/components/source-list";

export default function FilesPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">불러온 파일</h1>
      <SourceList />
    </div>
  );
}
