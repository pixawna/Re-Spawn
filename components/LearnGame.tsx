"use client";
import { useEffect, useState, type KeyboardEvent } from "react";
import { api, type GraphMap, type Project } from "@/lib/api";
import FeatureDialog from "./FeatureDialog";
import Pixel from "./Pixel";
import { reaper, tombstoneCracked } from "@/lib/sprites";
import {
  buildLessons,
  moveExplorer,
  stationAt,
  WALLS,
  type Position,
} from "@/lib/learn-game";
export default function LearnGame({
  project,
  onClose,
  onExplore,
}: {
  project: Project;
  onClose: () => void;
  onExplore: () => void;
}) {
  const [graph, setGraph] = useState<GraphMap | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [position, setPosition] = useState<Position>([0, 6]);
  const [collected, setCollected] = useState<number[]>([]);
  const [feedback, setFeedback] = useState(
    "Find a glowing rune. The gravestones block your path.",
  );
  const [notes, setNotes] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api<GraphMap>(`/api/projects/${project.id}/map`)
      .then((g) => {
        if (!cancelled) {
          setGraph(g);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, retry]);
  const lessons = graph ? buildLessons(graph) : [];
  const station = stationAt(position);
  const lesson = station < 0 ? null : lessons[station];
  function move(dx: number, dy: number) {
    const next = moveExplorer(position, dx, dy);
    if (next === position) {
      setFeedback("That way is blocked. Try another path.");
      return;
    }
    setPosition(next);
    const target = stationAt(next);
    setFeedback(
      target >= 0
        ? collected.includes(target)
          ? "You already recovered this rune. Keep exploring."
          : "A memory stirs. Read the field note and answer to collect its rune."
        : "Follow the glowing runes through the graveyard.",
    );
  }
  function key(e: KeyboardEvent) {
    const directions: Record<string, Position> = {
      ArrowUp: [0, -1],
      w: [0, -1],
      ArrowDown: [0, 1],
      s: [0, 1],
      ArrowLeft: [-1, 0],
      a: [-1, 0],
      ArrowRight: [1, 0],
      d: [1, 0],
    };
    const delta = directions[e.key];
    if (delta) {
      e.preventDefault();
      move(...delta);
    }
  }
  function answer(index: number) {
    if (!lesson) return;
    if (index !== lesson.correct) {
      setFeedback(lesson.retry);
      return;
    }
    setCollected((previous) =>
      previous.includes(station) ? previous : [...previous, station],
    );
    setFeedback(
      "Rune recovered! +20 knowledge points. This score is training progress, not a recovery verification.",
    );
  }
  const complete = collected.length === 5;
  return (
    <FeatureDialog
      title="Mori’s field school"
      kicker="Learn mode"
      onClose={onClose}
      className="learn-dialog"
    >
      <div className="learn-intro">
        <p>
          Explore <strong>{project.name}</strong>. Recover five memory runes and
          learn how a resurrection works.
        </p>
        <span
          className="learn-score"
          aria-label={`${collected.length * 20} knowledge points`}
        >
          {collected.length * 20}
          <small> / 100 XP</small>
        </span>
      </div>
      <p className="feature-muted">
        Optional training, using a snapshot of this project’s graph. Moving or
        answering never changes the repository or graph. All evidence is
        available without earning points.
      </p>
      {error && (
        <p role="alert">
          Could not load graph facts: {error}{" "}
          <button className="btn-ghost" onClick={() => setRetry((x) => x + 1)}>
            Retry
          </button>
        </p>
      )}
      {!graph && !error && <p role="status">Lighting the graveyard…</p>}
      {graph && (
        <>
          <div className="learn-progress" aria-label="Recovered runes">
            {lessons.map((item, i) => (
              <span
                className={collected.includes(i) ? "recovered" : ""}
                key={item.title}
              >
                {collected.includes(i) ? "✦" : "◇"} {item.title}
              </span>
            ))}
          </div>
          <div className="learn-layout">
            <div>
              <div
                className="learn-board"
                tabIndex={0}
                role="group"
                aria-label="Graveyard game board. Use arrow keys or WASD to move Mori."
                onKeyDown={key}
              >
                {Array.from({ length: 49 }, (_, i) => {
                  const x = i % 7,
                    y = Math.floor(i / 7);
                  const wall = WALLS.has(`${x},${y}`);
                  const here = position[0] === x && position[1] === y;
                  const rune = stationAt([x, y]);
                  const adjacent =
                    Math.abs(position[0] - x) + Math.abs(position[1] - y) === 1;
                  return (
                    <button
                      key={i}
                      tabIndex={-1}
                      className={`learn-cell ${wall ? "stone" : ""} ${here ? "mori" : ""} ${rune >= 0 ? "rune" : ""} ${collected.includes(rune) ? "found" : ""}`}
                      aria-label={`${here ? "Mori is here" : wall ? "Gravestone" : rune >= 0 ? `${lessons[rune].title} rune${collected.includes(rune) ? ", recovered" : ""}` : "Path"} · column ${x + 1}, row ${y + 1}`}
                      onClick={() => {
                        if (adjacent) move(x - position[0], y - position[1]);
                        else
                          setFeedback(
                            "Move one tile at a time with the arrow controls or an adjacent tile.",
                          );
                      }}
                    >
                      {here ? (
                        <Pixel
                          sprite={reaper(complete ? "happy" : "neutral")}
                          scale={2}
                        />
                      ) : wall ? (
                        <Pixel sprite={tombstoneCracked} scale={1} />
                      ) : rune >= 0 ? (
                        <span>{collected.includes(rune) ? "✦" : "◇"}</span>
                      ) : (
                        <i />
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="learn-instructions">
                Arrow keys / WASD when the board is focused. Or tap the
                controls. Mori: column {position[0] + 1}, row {position[1] + 1}.
              </p>
              <div className="learn-controls" aria-label="Movement controls">
                <button
                  className="btn-ghost up"
                  aria-label="Move up"
                  onClick={() => move(0, -1)}
                >
                  ↑
                </button>
                <button
                  className="btn-ghost left"
                  aria-label="Move left"
                  onClick={() => move(-1, 0)}
                >
                  ←
                </button>
                <button
                  className="btn-ghost down"
                  aria-label="Move down"
                  onClick={() => move(0, 1)}
                >
                  ↓
                </button>
                <button
                  className="btn-ghost right"
                  aria-label="Move right"
                  onClick={() => move(1, 0)}
                >
                  →
                </button>
              </div>
            </div>
            <aside className="learn-quest">
              <p className="feature-kicker">
                {lesson ? `Memory ${station + 1} / 5` : "Your next quest"}
              </p>
              <h3>
                {complete
                  ? "Field training complete"
                  : (lesson?.title ?? "Follow the memories")}
              </h3>
              {lesson ? (
                <>
                  <p>{lesson.fact}</p>
                  <code>{lesson.source}</code>
                  {!collected.includes(station) && (
                    <>
                      <h4>{lesson.question}</h4>
                      <div className="learn-answers">
                        {lesson.options.map((option, i) => (
                          <button
                            className="btn-ghost"
                            key={option}
                            onClick={() => answer(i)}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {collected.includes(station) && (
                    <p className="learn-recovered">✦ Rune recovered</p>
                  )}
                </>
              ) : (
                <p>
                  Five runes are scattered among the graves. Find a rune, read
                  its real graph fact, and answer a short question. The stones
                  are obstacles; the paths connect every rune.
                </p>
              )}
              <p role="status" className="learn-feedback">
                {feedback}
              </p>
              {complete && (
                <p className="learn-recovered">
                  100 XP · You traced the cause, route, prerequisites, memory
                  and proof. This completes training; only a real verified run
                  can revive the project.
                </p>
              )}
              <button className="btn-life" onClick={onExplore}>
                Explore the real graph →
              </button>
            </aside>
          </div>
          <div className="learn-footer">
            <button
              className="btn-ghost"
              onClick={() => setNotes((v) => !v)}
              aria-expanded={notes}
            >
              {notes ? "Hide" : "Read all"} field notes · no points required
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                setPosition([0, 6]);
                setCollected([]);
                setFeedback("A fresh expedition. Find the five runes.");
              }}
            >
              Restart training
            </button>
          </div>
          {notes && (
            <div className="learn-notes">
              {lessons.map((item) => (
                <article key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.fact}</p>
                  <code>{item.source}</code>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </FeatureDialog>
  );
}
