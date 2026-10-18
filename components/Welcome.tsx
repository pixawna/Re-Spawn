"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import GraveyardScene from "./GraveyardScene";
import Pixel from "./Pixel";
import { reaper, tombstoneCracked, crt } from "@/lib/sprites";
import { api, type Project } from "@/lib/api";

const STEPS = [
  {
    sprite: tombstoneCracked,
    title: "Pick a dead project",
    text: "An old app that no longer builds on today's tools. We include three real ones.",
  },
  {
    sprite: reaper("thinking"),
    title: "Mori asks the graph",
    text: "The agent reproduces the failure, then FalkorDB finds the smallest safe set of upgrades.",
  },
  {
    sprite: crt,
    title: "It comes back to life",
    text: "Each fix is tried in a sandbox, built and tested. You get a report of every decision.",
  },
];

export default function Welcome() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    api<Project[]>("/api/projects")
      .then(setProjects)
      .catch(() => {});
  }, []);

  return (
    <div className="welcome">
      <div className="welcome-scene" aria-hidden>
        <GraveyardScene
          projects={projects}
          selected={null}
          runningId={null}
          mood="neutral"
          onPick={(id) => router.push(`/resurrect?p=${encodeURIComponent(id)}`)}
        />
      </div>
      <main className="welcome-panel">
        <h1 className="wordmark" aria-label="re:spawn">
          re
          <span className="colon" aria-hidden>
            <i />
            <i />
          </span>
          spawn
        </h1>
        <p className="welcome-lede">
          Old software dies when the world around it moves on. Re:Spawn is an AI agent that
          uses a knowledge graph to work out how to bring it back, then proves it works.
        </p>
        <ol className="welcome-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="step-art">
                <Pixel sprite={s.sprite} scale={i === 2 ? 2 : 2} />
              </span>
              <span className="step-num">{i + 1}</span>
              <div>
                <h2>{s.title}</h2>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="welcome-cta">
          <Link className="btn-life btn-big" href="/projects">
            Start a resurrection
          </Link>
          <span className="welcome-note">Takes about a minute. Nothing on your machine is changed.</span>
        </div>
      </main>
    </div>
  );
}
