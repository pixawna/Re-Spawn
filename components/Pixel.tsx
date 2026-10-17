import type { SpriteDef } from "@/lib/sprites";

// Renders a pixel map as crisp SVG rects, merging horizontal runs.
export default function Pixel({
  sprite,
  scale = 4,
  className,
  title,
}: {
  sprite: SpriteDef;
  scale?: number;
  className?: string;
  title?: string;
}) {
  const w = sprite.rows[0].length;
  const h = sprite.rows.length;
  const rects: React.ReactElement[] = [];
  sprite.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === "." || !sprite.palette[ch]) {
        x++;
        continue;
      }
      let run = 1;
      while (row[x + run] === ch) run++;
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={run} height={1} fill={sprite.palette[ch]} />);
      x += run;
    }
  });
  return (
    <svg
      className={className}
      width={w * scale}
      height={h * scale}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {rects}
    </svg>
  );
}
