const STEPS = ["Choose a project", "Watch it resurrect", "Read the report"];

export default function Stepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="stepper" aria-label="Progress">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "now" : "next";
        return (
          <li key={label} className={`st-${state}`} aria-current={state === "now" ? "step" : undefined}>
            <span className="st-dot">{state === "done" ? "✓" : n}</span>
            <span className="st-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
