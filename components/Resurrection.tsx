"use client";
import { useEffect, useRef, useState } from "react";
import Pixel from "./Pixel";
import Heartbeat from "./Heartbeat";
import { crt, heart, reaper, skull, tombstoneCracked } from "@/lib/sprites";
import {
  api,
  assetUrl,
  replay,
  environmentLabel,
  type Certificate,
} from "@/lib/api";

function certificateSvg(c: Certificate) {
  const esc = (s: string) =>
    s.replace(
      /[&<>"]/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!,
    );
  const packages = Object.keys({ ...c.before, ...c.after });
  const pathY = 340 + packages.length * 22;
  const footerY = pathY + 70 + c.steps.length * 22;
  const height = Math.max(620, footerY + 32);
  const smokeOk =
    c.verification?.smoke ??
    (c.smoke.length > 0 && c.smoke.every((check) => check.status === 200));
  const rows = packages
    .map(
      (k, i) =>
        `<text x="40" y="${318 + i * 22}" class="m">${esc(k)}</text><text x="210" y="${318 + i * 22}" class="m dim">${esc(c.before[k] || "—")}</text><text x="300" y="${318 + i * 22}" class="m g">${esc(c.after[k] || "removed")}</text>`,
    )
    .join("");
  const steps = c.steps
    .map(
      (s, i) =>
        `<text x="40" y="${pathY + 24 + i * 22}" class="b">${i + 1}. ${esc(s)}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="${height}" viewBox="0 0 420 ${height}">
<style>text{font-family:'Pixelify Sans',monospace;fill:#ece4ff}.h{font-size:28px}.b{font-size:15px}.m{font-family:monospace;font-size:13px}.dim{fill:#8d86a8}.g{fill:#7dff8a}.s{font-size:12px;fill:#b9b2d1}</style>
<defs><linearGradient id="foil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7dff8a"/><stop offset=".35" stop-color="#a898e0"/><stop offset=".7" stop-color="#ffb648"/><stop offset="1" stop-color="#7dff8a"/></linearGradient></defs>
<rect width="420" height="${height}" fill="url(#foil)"/><rect x="10" y="10" width="400" height="${height - 20}" fill="#1b1433"/>
<text x="40" y="58" class="s">Resurrection certificate · ${esc(c.run)}</text>
<text x="40" y="96" class="h">${esc(c.project)}</text>
<text x="40" y="120" class="s">${esc(c.owner)} · issued ${esc(c.issued)}</text>
<rect x="40" y="140" width="340" height="120" fill="#120c22"/><text x="60" y="190" class="b g">${c.status === "alive" ? "Alive" : "Build passing"} on ${esc(environmentLabel(c.environment ?? { kind: "node", version: c.node.replace(/^v/, "") }))}</text>
<text x="60" y="216" class="b">${c.tests.passed} tests passing · HTTP smoke ${smokeOk ? "passed" : "incomplete / failed"}</text>
<text x="60" y="240" class="s">${c.attempts.length} route${c.attempts.length === 1 ? "" : "s"} tried · ${c.duration}s · ${esc(c.graph)}</text>
<text x="40" y="292" class="s">Dependency</text><text x="210" y="292" class="s">Before</text><text x="300" y="292" class="s">After</text>${rows}
<text x="40" y="${pathY}" class="s">Recovery path</text>${steps}
<text x="40" y="${height - 32}" class="s">${c.status === "alive" ? "Verified by Re:Spawn." : "Verification incomplete."} See full run evidence.</text></svg>`;
}

export default function Resurrection({
  cert,
  onClose,
}: {
  cert: Certificate;
  onClose: () => void;
}) {
  const hosted = replay();
  const [prState, setPrState] = useState("");
  const [prBusy, setPrBusy] = useState(false);
  const [prUrl, setPrUrl] = useState("");
  async function openPR() {
    setPrBusy(true);
    setPrState("");
    try {
      const result = await api<{ url: string }>(
        `/api/runs/${cert.run}/pull-request`,
        { method: "POST" },
      );
      setPrUrl(result.url);
    } catch (e) {
      setPrState((e as Error).message);
    } finally {
      setPrBusy(false);
    }
  }
  const [showPatch, setShowPatch] = useState(false);
  const [stage, setStage] = useState<"crack" | "rise" | "on">(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "on"
      : "crack",
  );
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const a = setTimeout(() => setStage("rise"), 1300);
    const b = setTimeout(() => setStage("on"), 2600);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const download = () => {
    const blob = new Blob([certificateSvg(cert)], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${cert.project}-resurrection.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const preview = cert.preview ? assetUrl(cert.preview) : null;
  const changed = Object.keys({ ...cert.before, ...cert.after }).filter(
    (k) => cert.before[k] !== cert.after[k],
  );

  return (
    <div
      className="rez"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rez-title"
    >
      <div className={`rez-stage stage-${stage}`}>
        <div className="rez-ground" />
        <div className="rez-stone left" aria-hidden>
          <Pixel sprite={tombstoneCracked} scale={10} />
        </div>
        <div className="rez-stone right" aria-hidden>
          <Pixel sprite={tombstoneCracked} scale={10} />
        </div>
        <div className="rez-debris" aria-hidden>
          {Array.from({ length: 14 }, (_, i) => (
            <i
              key={i}
              style={{
                ["--d" as string]: `${(i * 37) % 100}`,
                ["--r" as string]: `${(i * 53) % 360}deg`,
              }}
            />
          ))}
        </div>
        <div className="rez-crt">
          <Pixel sprite={crt} scale={22} />
          <div className="rez-screen">
            {stage === "on" && preview ? (
              hosted && cert.preview ? (
                <iframe
                  sandbox="allow-scripts allow-forms"
                  srcDoc={hosted.text(cert.preview)}
                  title={`${cert.project}, running again`}
                />
              ) : (
                <iframe
                  sandbox="allow-scripts allow-forms"
                  src={preview}
                  title={`${cert.project}, running again`}
                />
              )
            ) : (
              <span className="boot">booting…</span>
            )}
          </div>
        </div>
        <div className="rez-mori" aria-hidden>
          <Pixel sprite={reaper("happy")} scale={4} />
        </div>
      </div>

      <aside className="card">
        <div className="card-inner">
          <p className="card-kicker">Resurrection certificate</p>
          <h2 id="rez-title">
            {cert.project}{" "}
            {cert.status === "alive"
              ? "is alive."
              : "builds. Verification is incomplete."}
          </h2>
          <Heartbeat
            pulse={cert.status === "alive" ? "alive" : "weak"}
            height={36}
          />
          <dl className="card-stats">
            <div>
              <dt>Tests</dt>
              <dd>
                {cert.tests.passed} passing
                {cert.tests.failed ? `, ${cert.tests.failed} failing` : ""}
              </dd>
            </div>
            <div>
              <dt>Smoke check</dt>
              <dd>
                {cert.verification?.smoke === false
                  ? "Incomplete / failed"
                  : cert.smoke.map((s) => s.status).join(" · ") || "—"}
              </dd>
            </div>
            <div>
              <dt>Routes tried</dt>
              <dd>{cert.attempts.length}</dd>
            </div>
            <div>
              <dt>Runtime</dt>
              <dd>
                {environmentLabel(
                  cert.environment ?? {
                    kind: "node",
                    version: cert.node.replace(/^v/, ""),
                  },
                )}
              </dd>
            </div>
          </dl>
          <h3>What changed</h3>
          <ul className="card-diff">
            {changed.map((k) => (
              <li key={k}>
                <span>{k}</span>
                <s>{cert.before[k] || "—"}</s>
                <b>{cert.after[k] || "removed"}</b>
              </li>
            ))}
          </ul>
          <h3>How it got here</h3>
          <ol className="card-route">
            {cert.attempts.map((a) => (
              <li key={a.n} className={a.outcome === "success" ? "ok" : "bad"}>
                <Pixel
                  sprite={a.outcome === "success" ? heart : skull}
                  scale={2}
                />
                <span>
                  {a.titles.join(" + ")}
                  <small>
                    {a.outcome === "success"
                      ? "verified"
                      : a.outcome === "build-passing"
                        ? "Build passed; verification incomplete"
                        : a.error}
                  </small>
                </span>
              </li>
            ))}
          </ol>
          <div className="card-actions">
            {hosted ? (
              <button
                className="btn-ghost"
                onClick={() => setShowPatch((v) => !v)}
                aria-expanded={showPatch}
              >
                {showPatch ? "Hide patch" : "View patch"}
              </button>
            ) : (
              <>
                <button className="btn-life" onClick={download}>
                  Download certificate
                </button>
                <a
                  className="btn-ghost"
                  href={assetUrl(`/api/runs/${cert.run}/patch`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View patch
                </a>
                {preview && (
                  <a
                    className="btn-ghost"
                    href={preview}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open the app
                  </a>
                )}
              </>
            )}
          </div>
          {!hosted && (
            <div className="pr-actions">
              <a
                className="btn-ghost"
                href={assetUrl(`/api/runs/${cert.run}/certificate`)}
                target="_blank"
                rel="noreferrer"
              >
                Full certificate + decision trace
              </a>
              {cert.status === "alive" && cert.source.startsWith("git:") && (
                <>
                  <p>
                    Create a draft PR with the verified project changes and
                    decision trace in {cert.owner}/{cert.project}.
                  </p>
                  <button
                    className="btn-life"
                    onClick={openPR}
                    disabled={prBusy || !!prUrl}
                  >
                    {prBusy ? "Opening PR…" : "Open draft PR on GitHub"}
                  </button>
                  {prUrl && (
                    <a href={prUrl} target="_blank" rel="noreferrer">
                      View draft pull request ↗
                    </a>
                  )}
                  {prState && <p role="alert">{prState}</p>}
                </>
              )}
            </div>
          )}
          {hosted && showPatch && (
            <pre className="card-patch">
              {hosted.text(`/api/runs/${cert.run}/patch`)}
            </pre>
          )}
        </div>
      </aside>
      <button
        ref={closeRef}
        className="rez-close"
        onClick={onClose}
        aria-label="Back to the resurrection map"
      >
        Back to the map
      </button>
    </div>
  );
}
