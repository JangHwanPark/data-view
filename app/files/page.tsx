import { SourceList } from "@/features/sources";
import { WordDictionary } from "@/features/sources";
import { TeamSettings } from "@/features/sources";

export default function FilesPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">불러온 파일</h1>
      <SourceList />
      <WordDictionary />
      <TeamSettings />
    </div>
  );
}
