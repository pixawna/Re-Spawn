"use client";
import type { Project } from "@/lib/demo";
export default function Graveyard({
  projects,
  onSelect,
}: {
  projects: Project[];
  onSelect: (project: Project) => void;
}) {
  return (
    <div className="graveyard-scene">
      <svg
        className="landscape"
        viewBox="0 0 1000 360"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="sky" x2="0" y2="1">
            <stop stopColor="#201d39" />
            <stop offset="1" stopColor="#403452" />
          </linearGradient>
          <radialGradient id="moon">
            <stop stopColor="#e4ddff" stopOpacity=".17" />
            <stop offset="1" stopColor="#e4ddff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path fill="url(#sky)" d="M0 0H1000V360H0Z" />
        <circle cx="790" cy="75" r="90" fill="url(#moon)" />
        <circle cx="790" cy="75" r="27" fill="#cfc2ed" />
        <circle cx="801" cy="64" r="25" fill="#2c2542" />
        {[
          [80, 51],
          [172, 108],
          [260, 42],
          [397, 69],
          [536, 30],
          [655, 83],
          [905, 60],
          [941, 123],
          [493, 110],
          [350, 20],
          [710, 25],
        ].map(([x, y]) => (
          <path
            key={x}
            d={`M${x - 3} ${y}h6M${x} ${y - 3}v6`}
            stroke="#b7a7d5"
            opacity=".6"
          />
        ))}
        <path
          d="M0 198Q165 141 300 203T590 195T1000 191V360H0"
          fill="#29243d"
        />
        <path
          d="M0 252Q160 203 330 248T660 233T1000 231V360H0"
          fill="#242033"
        />
        <path d="M0 306Q240 255 477 291T1000 281V360H0" fill="#1c1b2b" />
        <path
          d="M447 360L521 245L549 245L550 360"
          fill="#4d4056"
          opacity=".55"
        />
        <g stroke="#53435e" strokeWidth="7" fill="none">
          <path d="M83 264L75 108M78 172L42 141L38 114M78 199L112 163L125 163M916 265L922 133M920 194L947 164L950 136M922 169L898 149" />
        </g>
        <g fill="#71617d" opacity=".45">
          {[40, 140, 280, 390, 620, 755, 875, 970].map((x) => (
            <path key={x} d={`M${x} 320l-5 -13l9 6l4 -18l3 22l8 -7l-4 10Z`} />
          ))}
        </g>
        <g stroke="#746184" opacity=".45">
          <path d="M0 258H160M0 279H160M14 246V293M45 246V293M77 246V293M110 246V293M144 246V293M848 250H1000M848 272H1000M864 238V287M896 238V287M927 238V287M959 238V287M990 238V287" />
        </g>
        <g fill="#bafa9e">
          <circle cx="157" cy="237" r="2" />
          <circle cx="562" cy="202" r="2" />
          <circle cx="865" cy="298" r="2" />
          <circle cx="355" cy="275" r="2" />
        </g>
      </svg>
      <div className="scene-label">
        <span className="live-dot" /> THE QUIET CORNER <span>·</span> 00:42 AM
      </div>
      <div className="graves">
        {projects.slice(0, 4).map((p, i) => (
          <button
            key={p.id}
            className={`grave grave-${i} ${p.status === "Verified working" ? "alive" : ""}`}
            onClick={() => onSelect(p)}
            aria-label={`Inspect ${p.name}`}
          >
            <div className="grave-art">
              <span className="grave-cross">
                {p.status === "Verified working" ? "⌘" : "+"}
              </span>
              <span className="grave-rip">
                {p.status === "Verified working" ? "I LIVE!" : "R.I.P."}
              </span>
              <span className="grave-lines">
                ━━
                <br />
                ━━━━
              </span>
            </div>
            <span className="grave-name">{p.name}</span>
            <span className="grave-status">
              {p.status === "Verified working"
                ? "✦ Resurrected"
                : p.status === "Unverified"
                  ? "○ Unverified"
                  : "✧ Waiting for a second chance"}
            </span>
          </button>
        ))}
      </div>
      <div className="scene-caption">
        <span>✦</span> A little forgotten. Never beyond saving.
      </div>
    </div>
  );
}
