"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import RunReport from "./RunReport";
import Stepper from "./Stepper";

export default function ReportRoute() {
  const params = useSearchParams();
  const router = useRouter();
  const run = params.get("run");
  const project = params.get("p");
  const back = project ? `/resurrect?p=${encodeURIComponent(project)}` : "/projects";
  return (
    <div className="page">
      <header className="page-top">
        <Link href="/" className="mini-mark" aria-label="Re:Spawn home">
          re<span>:</span>spawn
        </Link>
        <Stepper current={3} />
      </header>
      <main className="page-body">
        <div className="report-nav">
          <Link className="btn-ghost" href={back}>
            ← Back to the resurrection
          </Link>
          <Link className="btn-ghost" href="/projects">
            Try another project
          </Link>
        </div>
        {run ? (
          <RunReport key={run} runId={run} inline onClose={() => router.push(back)} />
        ) : (
          <p className="callout">No run selected. Open a project and press Resurrect first.</p>
        )}
      </main>
    </div>
  );
}
