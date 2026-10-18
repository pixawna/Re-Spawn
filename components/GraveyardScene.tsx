"use client";
import { useMemo, useState } from "react";
import type { SpriteDef } from "@/lib/sprites";
import {
  crt,
  deadTree,
  lantern,
  mushroom,
  reaper,
  tombstone,
  tombstoneCracked,
  type Mood,
} from "@/lib/sprites";
import { environmentLabel, type Project } from "@/lib/api";

// The graveyard is drawn on a real 320x180 pixel grid and scaled up with crisp edges.
const W = 320;
const H = 180;
const GROUND = 128;

function Sprite({
  s,
  x,
  y,
  className,
}: {
  s: SpriteDef;
  x: number;
  y: number;
  className?: string;
}) {
  const rects: React.ReactElement[] = [];
  s.rows.forEach((row, ry) => {
    let rx = 0;
    while (rx < row.length) {
      const ch = row[rx];
      if (ch === "." || !s.palette[ch]) {
        rx++;
        continue;
      }
      let run = 1;
      while (row[rx + run] === ch) run++;
      rects.push(
        <rect
          key={`${rx}-${ry}`}
          x={rx}
          y={ry}
          width={run}
          height={1}
          fill={s.palette[ch]}
        />,
      );
      rx += run;
    }
  });
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={className}>{rects}</g>
    </g>
  );
}

// Deterministic stepped hills.
function hills(base: number, amp: number, seed: number, step = 4) {
  let d = `M0 ${H}`;
  for (let x = 0; x <= W; x += step) {
    const y = Math.round(
      base -
        amp *
          (0.55 * Math.sin((x + seed) / 37) +
            0.3 * Math.sin((x + seed * 3) / 13) +
            0.15 * Math.sin(x / 5.3)),
    );
    d += ` L${x} ${y} L${x + step} ${y}`;
  }
  return d + ` L${W} ${H} Z`;
}

const STARS = [
  [14, 12],
  [33, 30],
  [52, 9],
  [71, 40],
  [90, 18],
  [118, 7],
  [131, 33],
  [152, 15],
  [170, 44],
  [188, 10],
  [206, 28],
  [226, 6],
  [282, 14],
  [300, 36],
  [312, 8],
  [64, 58],
  [104, 52],
  [144, 62],
  [196, 56],
  [298, 60],
  [8, 48],
  [244, 52],
  [270, 64],
  [180, 26],
  [40, 70],
];

const DECOR = [
  { x: 20, label: "bower_components, 2013–2018" },
  { x: 48, label: "A Flash portfolio. It had a loading bar." },
  { x: 262, label: "gulpfile.js, retired by webpack" },
  { x: 292, label: "jQuery carousel plugin v0.3" },
];

function slots(n: number) {
  const gap = n > 5 ? 30 : 38;
  return Array.from({ length: n }, (_, i) =>
    Math.round(W / 2 + (i - (n - 1) / 2) * gap),
  );
}

export default function GraveyardScene({
  projects,
  selected,
  runningId,
  mood,
  onPick,
}: {
  projects: Project[];
  selected: string | null;
  runningId: string | null;
  mood: Mood;
  onPick: (id: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const xs = slots(Math.min(projects.length, 7));
  const far = useMemo(() => hills(90, 10, 40), []);
  const mid = useMemo(() => hills(110, 7, 190), []);
  const near = useMemo(() => hills(GROUND - 2, 2, 7, 2), []);
  const moriIndex = Math.max(
    0,
    projects.findIndex((p) => p.id === (runningId || selected)),
  );
  const moriX = projects.length ? xs[moriIndex] + 13 : W / 2 + 18;

  return (
    <svg
      className="world-svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMax slice"
      shapeRendering="crispEdges"
      role="group"
      aria-label="The graveyard"
    >
      <defs>
        <pattern id="dither" width="2" height="2" patternUnits="userSpaceOnUse">
          <rect width="1" height="1" fill="#241a45" />
          <rect x="1" y="1" width="1" height="1" fill="#241a45" />
        </pattern>
        <pattern
          id="dither3"
          width="2"
          height="2"
          patternUnits="userSpaceOnUse"
        >
          <rect width="2" height="2" fill="#1d1534" />
          <rect width="1" height="1" fill="#241a2b" />
          <rect x="1" y="1" width="1" height="1" fill="#241a2b" />
        </pattern>
        <pattern
          id="dither4"
          width="2"
          height="2"
          patternUnits="userSpaceOnUse"
        >
          <rect width="2" height="2" fill="#241a2b" />
          <rect width="1" height="1" fill="#2a1d17" />
          <rect x="1" y="1" width="1" height="1" fill="#2a1d17" />
        </pattern>
        <pattern
          id="dither2"
          width="2"
          height="2"
          patternUnits="userSpaceOnUse"
        >
          <rect width="1" height="1" fill="#2e2257" />
          <rect x="1" y="1" width="1" height="1" fill="#2e2257" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="#140f28" />
      <rect y="46" width={W} height="6" fill="url(#dither)" />
      <rect y="52" width={W} height="40" fill="#241a45" pointerEvents="none" />
      <rect y="86" width={W} height="6" fill="url(#dither2)" />
      <rect y="92" width={W} height="60" fill="#2e2257" />

      {STARS.map(([x, y], i) => (
        <rect
          key={i}
          x={x}
          y={y}
          width="1"
          height="1"
          fill="#ece4ff"
          className={
            i % 3 === 0 ? "twinkle" : i % 3 === 1 ? "twinkle slow" : ""
          }
        />
      ))}
      {/* moon: stepped disc with a bite */}
      <g transform="translate(218 16)">
        {[
          [8, 0, 12],
          [4, 1, 20],
          [2, 2, 24],
          [1, 4, 26],
          [0, 6, 28],
          [0, 10, 28],
          [0, 18, 28],
          [1, 22, 26],
          [2, 24, 24],
          [4, 26, 20],
          [8, 27, 12],
        ].map(([x, y, w], i, arr) => {
          const h = (arr[i + 1]?.[1] ?? 28) - y;
          return (
            <rect key={i} x={x} y={y} width={w} height={h} fill="#ece4ff" />
          );
        })}
        <rect x="6" y="9" width="3" height="3" fill="#cfc4ef" />
        <rect x="15" y="17" width="4" height="3" fill="#cfc4ef" />
        <rect x="11" y="5" width="2" height="2" fill="#cfc4ef" />
      </g>

      <path d={far} fill="#221a44" />
      {/* crypt on the far hill */}
      <g transform="translate(70 66)" fill="#191237">
        <rect x="0" y="10" width="26" height="18" />
        <rect x="3" y="6" width="20" height="4" />
        <rect x="8" y="2" width="10" height="4" />
        <rect x="12" y="-4" width="2" height="6" />
        <rect x="10" y="-2" width="6" height="2" />
        <rect
          x="10"
          y="16"
          width="6"
          height="12"
          fill="#ffb648"
          opacity=".7"
          className="flicker"
        />
      </g>
      <path d={mid} fill="#1b1438" />
      <Sprite s={deadTree} x={6} y={GROUND - 36} />
      <Sprite s={deadTree} x={286} y={GROUND - 30} />

      {/* fence */}
      <g fill="#120c26">
        <rect x="0" y={GROUND - 13} width={W} height="1" />
        <rect x="0" y={GROUND - 7} width={W} height="1" />
        {Array.from({ length: 54 }, (_, i) => (
          <g key={i}>
            <rect x={i * 6} y={GROUND - 16} width="1" height="16" />
            <rect x={i * 6 - 1} y={GROUND - 16} width="3" height="1" />
            <rect x={i * 6} y={GROUND - 17} width="1" height="1" />
          </g>
        ))}
      </g>

      <rect y={GROUND} width={W} height={H - GROUND} fill="#1d1534" />
      <path d={near} fill="#1d1534" />
      <rect y={GROUND} width={W} height="1" fill="#2f4a3f" />
      {Array.from({ length: 40 }, (_, i) => (
        <rect
          key={i}
          x={(i * 37) % W}
          y={GROUND - 1}
          width="1"
          height="2"
          fill="#3f6b4a"
        />
      ))}
      {/* the ground turns into soil as it goes down, so the camera can descend into it */}
      <rect y={GROUND + 18} width={W} height="2" fill="url(#dither3)" />
      <rect y={GROUND + 20} width={W} height="14" fill="#241a2b" />
      <rect y={GROUND + 32} width={W} height="2" fill="url(#dither4)" />
      <rect y={GROUND + 34} width={W} height={H} fill="#2a1d17" />
      {[
        [30, 152, 3, 2],
        [96, 160, 2, 2],
        [150, 170, 4, 2],
        [205, 156, 3, 2],
        [262, 166, 2, 2],
        [300, 150, 3, 2],
        [60, 172, 2, 1],
      ].map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill="#3a2a22" />
      ))}
      <path
        d="M118 128 v6 h-3 v5 h-4 v6 M200 128 v4 h4 v7 h3 v9"
        stroke="#140e24"
        strokeWidth="1"
        fill="none"
      />

      {/* scenery graves: decoration only */}
      {DECOR.map((d) => (
        <g
          key={d.x}
          className="decor-grave"
          transform={`translate(${d.x} ${GROUND - 13}) scale(.55)`}
          aria-hidden
        >
          <title>{d.label}</title>
          <Sprite s={tombstone} x={0} y={0} />
        </g>
      ))}
      <Sprite s={mushroom} x={88} y={GROUND - 4} className="glow-soft" />
      <Sprite s={mushroom} x={238} y={GROUND - 4} className="glow-soft" />

      {/* fog */}
      <g className="fog" opacity=".05" fill="#ece4ff" pointerEvents="none">
        <rect x="-40" y={GROUND - 10} width="120" height="4" />
        <rect x="120" y={GROUND - 6} width="160" height="3" />
        <rect x="300" y={GROUND - 9} width="90" height="4" />
      </g>

      {projects.slice(0, 7).map((p, i) => {
        const x = xs[i] - 10;
        const alive = p.status === "alive" || p.status === "build-passing";
        const running = runningId === p.id;
        const sprite = alive
          ? crt
          : p.status === "dead"
            ? tombstoneCracked
            : tombstone;
        const isSel = selected === p.id;
        const label = p.name.length > 16 ? p.name.slice(0, 15) + "…" : p.name;
        return (
          <g
            key={p.id}
            className={`grave ${running ? "is-running" : ""} ${isSel ? "is-selected" : ""} ${alive ? "is-alive" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={`${p.name}: ${alive ? "alive" : p.status === "dead" ? "build fails" : running ? "being revived" : "not checked yet"}. Open its resurrection map.`}
            onClick={() => onPick(p.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(p.id);
              }
            }}
            onMouseEnter={() => setHover(p.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(p.id)}
            onBlur={() => setHover(null)}
          >
            {(running || alive) && (
              <g
                className="pulse-glow"
                fill={running ? "#ffb648" : "#7dff8a"}
                opacity=".09"
                pointerEvents="none"
              >
                {/* stepped pixel halo */}
                <rect x={x + 4} y={GROUND - 30} width="12" height="2" />
                <rect x={x} y={GROUND - 28} width="20" height="3" />
                <rect x={x - 3} y={GROUND - 25} width="26" height="22" />
                <rect x={x} y={GROUND - 3} width="20" height="3" />
              </g>
            )}
            <rect
              x={x - 2}
              y={GROUND - 26}
              width={alive ? 28 : 24}
              height="34"
              fill="transparent"
            />
            <Sprite
              s={sprite}
              x={alive ? x - 2 : x}
              y={GROUND - (alive ? 21 : 22)}
              className="grave-sprite"
            />
            {alive && (
              <g
                transform={`translate(${x + 3} ${GROUND - 16})`}
                className="screen-glow"
              >
                <rect width="14" height="8" fill="#1d5a32" />
                <rect x="1" y="4" width="2" height="1" fill="#7dff8a" />
                <rect x="3" y="2" width="1" height="4" fill="#7dff8a" />
                <rect x="4" y="5" width="1" height="1" fill="#7dff8a" />
                <rect x="5" y="3" width="1" height="2" fill="#7dff8a" />
                <rect x="6" y="4" width="7" height="1" fill="#7dff8a" />
              </g>
            )}
            {p.status === "unverified" && !running && (
              <text
                x={x + 10}
                y={GROUND - 7}
                className="grave-glyph"
                textAnchor="middle"
              >
                ?
              </text>
            )}
            <text
              x={x + 10}
              y={GROUND + 8}
              textAnchor="middle"
              className="grave-name"
            >
              {label}
            </text>
            {/* tiny ECG under the name */}
            <g transform={`translate(${x} ${GROUND + 11})`}>
              {alive ? (
                <path
                  d="M0 2 H7 V0 H8 V4 H9 V1 H10 V2 H20"
                  stroke="#7dff8a"
                  fill="none"
                  strokeWidth=".7"
                  className="ecg-mini"
                />
              ) : (
                <rect
                  width="20"
                  height=".7"
                  y="2"
                  fill={running ? "#ffb648" : "#5b5478"}
                />
              )}
            </g>
            {hover === p.id && (
              <g
                className="epitaph"
                transform={`translate(${Math.min(Math.max(x - 30, 4), W - 84)} ${GROUND - 62})`}
              >
                <rect width="80" height="30" fill="#120c22" />
                <rect x="1" y="1" width="78" height="28" fill="#241a45" />
                <text x="5" y="10" className="epi-title">
                  {label}
                </text>
                <text x="5" y="18" className="epi-line">
                  {p.packages
                    .slice(0, 2)
                    .map((x) =>
                      x.id.replace(/^[^:]+:/, "").replace(/@([^@]*)$/, " $1"),
                    )
                    .join(", ") ||
                    `${p.ecosystem === "pypi" ? "Python" : "npm"} project`}
                </text>
                <text
                  x="5"
                  y="25"
                  className={`epi-line ${alive ? "ok" : p.status === "dead" ? "bad" : ""}`}
                >
                  {alive
                    ? "Alive again"
                    : p.status === "dead"
                      ? "Build fails on " + environmentLabel(p.runtime)
                      : "Click to check its pulse"}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* Mori stands beside the grave being worked on */}
      <g
        className="mori-walk"
        style={{ transform: `translate(${moriX}px, ${GROUND - 23}px)` }}
      >
        <Sprite s={reaper(mood)} x={0} y={0} className="mori-bob" />
        <Sprite s={lantern} x={14} y={10} className="lantern-swing" />
      </g>
      {[
        [40, 120],
        [130, 128],
        [210, 118],
        [276, 126],
        [168, 112],
      ].map(([x, y], i) => (
        <rect
          key={i}
          x={x}
          y={y}
          width="1"
          height="1"
          fill="#7dff8a"
          className={`firefly f${i}`}
        />
      ))}
    </svg>
  );
}
