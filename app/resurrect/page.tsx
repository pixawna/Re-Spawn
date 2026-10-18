import { Suspense } from "react";
import ResurrectRoute from "@/components/ResurrectRoute";

export default function ResurrectPage() {
  return (
    <Suspense fallback={null}>
      <ResurrectRoute />
    </Suspense>
  );
}
