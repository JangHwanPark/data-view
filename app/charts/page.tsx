import { ChartBuilder } from "@/components/charts/chart-builder";

export default function ChartsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">차트</h1>
        <p className="text-zinc-500">테이블 하나를 골라 묶을 컬럼과 값을 정하면 바로 그립니다. 예: 등급별 아이템 수, 레벨별 경험치 평균, 판매가 분포. 개발 DB에서 불러온 테이블은 「개발 DB에서 바로」로 지금 DB 값을 그릴 수 있습니다.</p>
      </div>
      <ChartBuilder />
    </div>
  );
}
