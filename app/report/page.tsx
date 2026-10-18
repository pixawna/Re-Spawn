import { Suspense } from "react";
import ReportRoute from "@/components/ReportRoute";

export default function ReportPage() {
  return (
    <Suspense fallback={null}>
      <ReportRoute />
    </Suspense>
  );
}
