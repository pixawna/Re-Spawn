// Hand-placed pixel art. Each sprite is rows of palette keys; "." is transparent.
export type { Mood };
export type SpriteDef = { rows: string[]; palette: Record<string, string> };

export const C = {
  night: "#1b1433",
  dusk: "#2e2257",
  plum: "#4b3a7d",
  lilac: "#7a68b3",
  moon: "#ece4ff",
  life: "#7dff8a",
  lifeDeep: "#2fae5a",
  coral: "#ff6b6b",
  amber: "#ffb648",
  stone: "#8d86a8",
  stoneLight: "#b9b2d1",
  stoneDark: "#5b5478",
  ink: "#120c22",
  soil: "#2a1d17",
  bone: "#e9dcc0",
};

const cloak = {
  k: "#120c22",
  c: "#33275a",
  h: "#4d3d84",
  f: "#07040f",
  e: C.life,
  w: "#d8c690",
  g: C.life,
  s: "#7a5a3c",
  l: "#b4ffbb",
};

// Mori, the tiny reaper who brings software back. 18x22.
const reaperBase = [
  "......kkkkkk......",
  "....kkcccccckk....",
  "...kcchhhhhhcck...",
  "..kcchhffffhhcck..",
  "..kchhffffffhhck..",
  ".kcchffffffffhcck.",
  ".kchfEEffffEEfhck.",
  ".kchfEEffffEEfhck.",
  ".kchffffffffffhck.",
  ".kcchffffffffhcck.",
  ".kccchffffffhccck.",
  "kcccchhhhhhhhcccck",
  "kcchcccccccccchcck",
  "kcchccccccccccchck",
  "kcchcccccccccccchk",
  ".kchccccccccccchk.",
  ".kchcccccccccccck.",
  ".kcchccccccccccck.",
  ".kccchcccccccccck.",
  "kcccccccccccccccck",
  ".kcckcckccckcckck.",
  "..kk.kk..kk..kk...",
];

type Mood = "neutral" | "happy" | "sad" | "thinking";

// Eyes live at rows 6-7, cols 5-6 and 11-12. Moods redraw just those pixels.
function eyes(rows: string[], mood: Mood) {
  const lit: Record<Mood, [number, number][]> = {
    neutral: [[6, 5], [6, 6], [7, 5], [7, 6], [6, 11], [6, 12], [7, 11], [7, 12]],
    thinking: [[7, 5], [7, 6], [7, 11], [7, 12]],
    happy: [[6, 5], [6, 6], [7, 4], [7, 7], [6, 11], [6, 12], [7, 10], [7, 13]],
    sad: [[6, 4], [6, 7], [7, 5], [7, 6], [6, 10], [6, 13], [7, 11], [7, 12]],
  };
  const out = rows.map((r) => r.replace(/E/g, "f").split(""));
  lit[mood].forEach(([y, x]) => (out[y][x] = "e"));
  return out.map((r) => r.join(""));
}

export function reaper(mood: Mood = "neutral"): SpriteDef {
  return { rows: eyes(reaperBase, mood), palette: cloak };
}

// Green-flame lantern Mori carries. 7x10.
export const lantern: SpriteDef = {
  rows: [
    "..sss..",
    ".s...s.",
    "wwwwwww",
    "w.lgl.w",
    "w.ggg.w",
    "w.ggg.w",
    "w..g..w",
    "wwwwwww",
    ".wwwww.",
    "..www..",
  ],
  palette: { s: "#7a5a3c", w: "#d8c690", g: C.life, l: "#d6ffd9" },
};

// Tombstone. 20x24. "d" = engraving.
const stoneRows = [
  "......oooooooo......",
  "....oollllllllo.....",
  "...ollllllllllloo...",
  "..ollllllssslllllo..",
  "..olllllssssssllllo.",
  ".ollllssssssssssslo.",
  ".olllsssssssssssslo.",
  ".ollsssddsssddssslo.",
  ".ollssdssssssssdsso.",
  ".olssdsssssssssdsso.",
  ".olssdsssssssssdsso.",
  ".olsssdssssssssdsso.",
  ".olsssddssssssddsso.",
  ".olsssssssssssssssmo",
  ".olssssddddddsssssmo",
  ".olsssssssssssssssmo",
  ".olsssssssssssssssmo",
  ".olsssssssssssssssmo",
  ".omsssssssssssssmmmo",
  ".ommmmssssssssmmmmmo",
  "oggggmmmmmmmmmmgggggo",
  "gggggggggggggggggggg",
  ".gg.ggg.gggg.ggg.gg.",
  "....................",
];

export const tombstone: SpriteDef = {
  rows: stoneRows.map((r) => r.slice(0, 20).padEnd(20, ".")),
  palette: { o: C.ink, l: C.stoneLight, s: C.stone, d: C.stoneDark, m: C.stoneDark, g: "#3f6b4a" },
};

export const tombstoneCracked: SpriteDef = {
  rows: tombstone.rows.map((r, i) => {
    const crack: Record<number, number[]> = { 3: [10], 4: [10], 5: [9], 6: [9, 10], 7: [10], 8: [11], 9: [11], 10: [10], 11: [10], 12: [9], 13: [9, 8], 14: [8], 15: [9] };
    const xs = crack[i];
    if (!xs) return r;
    const ch = r.split("");
    xs.forEach((x) => (ch[x] = "o"));
    return ch.join("");
  }),
  palette: tombstone.palette,
};

// Beige CRT that rises from the grave once a project is alive. 24x22, "x" = screen (overlaid).
export const crt: SpriteDef = {
  rows: [
    "..oooooooooooooooooooo..",
    ".obbbbbbbbbbbbbbbbbbbbo.",
    "obbhhhhhhhhhhhhhhhhhhbbo",
    "obhoooooooooooooooooohbo",
    "obhoxxxxxxxxxxxxxxxxohbo",
    "obhoxxxxxxxxxxxxxxxxohbo",
    "obhoxxxxxxxxxxxxxxxxohbo",
    "obhoxxxxxxxxxxxxxxxxohbo",
    "obhoxxxxxxxxxxxxxxxxohbo",
    "obhoxxxxxxxxxxxxxxxxohbo",
    "obhoxxxxxxxxxxxxxxxxohbo",
    "obhoxxxxxxxxxxxxxxxxohbo",
    "obhoxxxxxxxxxxxxxxxxohbo",
    "obhoooooooooooooooooohbo",
    "obbbbbbbbbbbbbbbbbbbbbbo",
    "obbbbbbbbbbbbbbbbgbrbbbo",
    "obddddddddddddddddddddbo",
    ".oooooooooooooooooooooo.",
    "....obbbbbbbbbbbbbbo....",
    "...obddddddddddddddbo...",
    "..oooooooooooooooooooo..",
    "........................",
  ],
  palette: { o: "#2a2238", b: "#d9cfb0", h: "#f2ead2", d: "#a99f82", x: "#0f2a1a", g: C.life, r: C.coral },
};

export const heart: SpriteDef = {
  rows: [
    ".rr...rr.",
    "rlrr.rrrr",
    "rlrrrrrrr",
    "rrrrrrrrr",
    ".rrrrrrr.",
    "..rrrrr..",
    "...rrr...",
    "....r....",
  ],
  palette: { r: C.life, l: "#d6ffd9" },
};

export const skull: SpriteDef = {
  rows: [
    ".bbbbb.",
    "bbbbbbb",
    "b.bbb.b",
    "b..b..b",
    "bbb.bbb",
    ".bbbbb.",
    ".b.b.b.",
  ],
  palette: { b: C.bone },
};

export const deadTree: SpriteDef = {
  rows: [
    "..........t.........",
    ".t........t.....t...",
    "..t......tt....t....",
    "...t....t.t...t.....",
    "....t..t..tt.t......",
    ".....tt....tt.......",
    "......t....t....t...",
    "......tt..tt...t....",
    ".......t.tt...t.....",
    ".......tttt..t......",
    "........ttttt.......",
    "........ttt.........",
    "........ttt.........",
    "........ttt.........",
    "........ttt.........",
    ".......tttt.........",
    ".......tttt.........",
    "......ttttt.........",
    ".....tttttttt.......",
    "...tttt...tttt......",
  ],
  palette: { t: "#140e24" },
};

export const mushroom: SpriteDef = {
  rows: [".ggg.", "ggggg", "g.g.g", "..s..", "..s.."],
  palette: { g: C.life, s: "#cfe8d2" },
};

export const shovel: SpriteDef = {
  rows: [
    "..ww..",
    ".w..w.",
    "..ww..",
    "..ss..",
    "..ss..",
    "..ss..",
    "..ss..",
    ".mmmm.",
    "mmmmmm",
    "mmmmmm",
    ".mmmm.",
    "..mm..",
  ],
  palette: { w: "#7a5a3c", s: "#9c7a52", m: "#b9b2d1" },
};
