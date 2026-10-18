"use client";
import { useSearchParams } from "next/navigation";
import ReSpawn from "./ReSpawn";

export default function ResurrectRoute() {
  const params = useSearchParams();
  const project = params.get("p") ?? undefined;
  return <ReSpawn key={project} initialProject={project} />;
}
