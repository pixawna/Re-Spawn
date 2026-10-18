"use client";
import { useEffect, useRef, useState } from "react";
import Pixel from "./Pixel";
import Heartbeat from "./Heartbeat";
import { crt, heart, reaper, skull, tombstoneCracked } from "@/lib/sprites";
import { assetUrl, replay, type Certificate } from "@/lib/api";

function certificateSvg(c: Certificate) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  const rows = Object.keys({ ...c.before, ...c.after })
    .map((k, i) => `<text x="40" y="${318 + i * 22}" class="m">${esc(k)}</text><text x="210" y="${318 + i * 22}" class="m dim">${esc(c.before[k] || "—")}</text><text x="300" y="${318 + i * 22}" class="m g">${esc(c.after[k] || "removed")}</text>`)
    .join("");
  const steps = c.steps.map((s, i) => `<text x="40" y="${448 + i * 22}" class="b">${i + 1}. ${esc(s)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="620" viewBox="0 0 420 620">
<style>text{font-family:'Pixelify Sans',monospace;fill:#ece4ff}.h{font-size:28px}.b{font-size:15px}.m{font-family:monospace;font-size:13px}.dim{fill:#8d86a8}.g{fill:#7dff8a}.s{font-size:12px;fill:#b9b2d1}</style>
<defs><linearGradient id="foil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7dff8a"/><stop offset=".35" stop-color="#a898e0"/><stop offset=".7" stop-color="#ffb648"/><stop offset="1" stop-color="#7dff8a"/></linearGradient></defs>
<rect width="420" height="620" fill="url(#foil)"/><rect x="10" y="10" width="400" height="600" fill="#1b1433"/>
<text x="40" y="58" class="s">Resurrection certificate · ${esc(c.run)}</text>
<text x="40" y="96" class="h">${esc(c.project)}</text>
<text x="40" y="120" class="s">${esc(c.owner)} · issued ${esc(c.issued)}</text>
<rect x="40" y="140" width="340" height="120" fill="#120c22"/><text x="60" y="190" class="b g">Alive on ${esc(c.node)}</text>
<text x="60" y="216" class="b">${c.tests.passed} tests passing · HTTP smoke ${c.smoke.every((s) => s.status === 200) ? "200 OK" : "failed"}</text>
<text x="60" y="240" class="s">${c.attempts.length} route${c.attempts.length === 1 ? "" : "s"} tried · ${c.duration}s · ${esc(c.graph)}</text>
<text x="40" y="292" class="s">Dependency</text><text x="210" y="292" class="s">Before</text><text x="300" y="292" class="s">After</text>${rows}
<text x="40" y="424" class="s">Recovery path</text>${steps}
<text x="40" y="588" class="s">Verified by Re:Spawn. The patch is in the run's evidence.</text></svg>`;
}

export default function Resurrection({ cert, onClose }: { cert: Certificate; onClose: () => void }) {
  const hosted = replay();
  const [showPatch, setShowPatch] = useState(false);
  const [stage, setStage] = useState<"crack" | "rise" | "on">(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "on" : "crack",
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
  const changed = Object.keys({ ...cert.before, ...cert.after }).filter((k) => cert.before[k] !== cert.after[k]);

  return (
    <div className="rez" role="dialog" aria-modal="true" aria-labelledby="rez-title">
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
            <i key={i} style={{ ["--d" as string]: `${(i * 37) % 100}`, ["--r" as string]: `${(i * 53) % 360}deg` }} />
          ))}
        </div>
        <div className="rez-crt">
          <Pixel sprite={crt} scale={22} />
          <div className="rez-screen">
            {stage === "on" && preview ? (
              hosted && cert.preview ? (
                <iframe srcDoc={hosted.text(cert.preview)} title={`${cert.project}, running again`} />
              ) : (
                <iframe src={preview} title={`${cert.project}, running again`} />
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
          <h2 id="rez-title">{cert.project} is alive.</h2>
          <Heartbeat pulse="alive" height={36} />
          <dl className="card-stats">
            <div>
              <dt>Tests</dt>
              <dd>
                {cert.tests.passed} passing{cert.tests.failed ? `, ${cert.tests.failed} failing` : ""}
              </dd>
            </div>
            <div>
              <dt>Smoke check</dt>
              <dd>{cert.smoke.map((s) => s.status).join(" · ") || "—"}</dd>
            </div>
            <div>
              <dt>Routes tried</dt>
              <dd>{cert.attempts.length}</dd>
            </div>
            <div>
              <dt>Runtime</dt>
              <dd>Node {cert.node.replace("v", "")}</dd>
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
                <Pixel sprite={a.outcome === "success" ? heart : skull} scale={2} />
                <span>
                  {a.titles.join(" + ")}
                  <small>{a.outcome === "success" ? "verified" : a.error}</small>
                </span>
              </li>
            ))}
          </ol>
          <div className="card-actions">
            {hosted ? (
              <button className="btn-ghost" onClick={() => setShowPatch((v) => !v)} aria-expanded={showPatch}>
                {showPatch ? "Hide patch" : "View patch"}
              </button>
            ) : (
              <>
                <button className="btn-life" onClick={download}>
                  Download certificate
                </button>
                <a className="btn-ghost" href={assetUrl(`/api/runs/${cert.run}/patch`)} target="_blank" rel="noreferrer">
                  View patch
                </a>
                {preview && (
                  <a className="btn-ghost" href={preview} target="_blank" rel="noreferrer">
                    Open the app
                  </a>
                )}
              </>
            )}
          </div>
          {hosted && showPatch && <pre className="card-patch">{hosted.text(`/api/runs/${cert.run}/patch`)}</pre>}
        </div>
      </aside>
      <button ref={closeRef} className="rez-close" onClick={onClose} aria-label="Back to the resurrection map">
        Back to the map
      </button>
    </div>
  );
}
