/**
 * Build-time dotted "burst" around an outline (the community page uses the
 * county's state).
 *
 * Places the shape in the middle of a fixed frame, then lays a few rows of dots
 * that trace its outline (offset outward, like contour lines), and finally
 * sends rays of dots outward from the outermost row so the pattern bursts away
 * from the shape.
 *
 * Everything is computed from the outline's points at build time, so it works
 * for any state or county and ships only the resulting <circle> data. A seed (the
 * community slug) makes the jitter stable between builds but different from
 * library to library.
 */

import type { CountyOutline } from './countyOutline';

type Point = [number, number];

export interface BurstDot {
  cx: number;
  cy: number;
  r: number;
  fill: string;
}

export interface CountyBurst {
  /** Dots in frame (viewBox) units. */
  dots: BurstDot[];
  /** SVG transform that places the outline's path inside the frame. */
  transform: string;
  /** The outline's rings as placed in the frame (frame units). */
  rings: [number, number][][];
  /**
   * Where to draw the decorative letter (see placeLetter), or null when no
   * `letter` option was given. `x` is the letter's centre, `y` its baseline.
   */
  letter: LetterPlacement | null;
}

export interface BurstOptions {
  /** Frame (viewBox) size the burst and county are laid out in. */
  width: number;
  height: number;
  /** Any string; the same seed always gives the same pattern. */
  seed: string;
  /** Dot colours; repeat a colour to make it more common. */
  colors: string[];
  /** Share of the frame the county is fitted into (rest is room for dots). */
  countyScale?: number;
  /** Number of outline rows hugging the county. */
  rows?: number;
  /** Distance between outline rows, in frame units. */
  rowGap?: number;
  /** Distance between neighbouring dots along a row or ray. */
  spacing?: number;
  /** Rings (in the outline's units) the letter must never cover (the county). */
  avoid?: [number, number][][];
  /** Decorative letter to place on the shape, clear of `avoid`. */
  letter?: LetterOptions;
  /** Send rays of dots outward from the outermost row (false = rows only). */
  rays?: boolean;
  /** Start a ray at every Nth dot of the outermost row. */
  rayEvery?: number;
  /** Shortest and longest ray, in frame units (rays alternate short/long). */
  rayLength?: [number, number];
}

export function seededRandom(seedText: string) {
  let seed = [...seedText].reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) | 0, 7);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const round = (n: number) => Math.round(n * 100) / 100;

function normalize([x, y]: Point): Point {
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len];
}

/** Even-odd point-in-polygon across all rings (handles holes and islands). */
export function isInside([px, py]: Point, rings: Point[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Shortest distance from a point to any edge of the outline. */
export function distanceToOutline([px, py]: Point, rings: Point[][]): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j];
      const [bx, by] = ring[i];
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
      best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
    }
  }
  return best;
}

/** Points spaced evenly along a closed ring. */
export function resample(ring: Point[], step: number): Point[] {
  const out: Point[] = [];
  let carry = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!len) continue;
    let t = carry;
    for (; t < len; t += step) {
      out.push([a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len]);
    }
    carry = t - len;
  }
  return out;
}

export interface LetterOptions {
  /** The text to place: usually one capital, e.g. "K"; "DC" for Washington, DC.
   * Its rough width is the sum of its letters' widths from LETTER_WIDTHS. */
  text: string;
  /** Allow the text to sit on the county (used for DC, whose one "county" is the
   * whole district). By default the county is never covered. */
  coverCounty?: boolean;
  /** Largest and smallest font size to try, in frame units. */
  maxSize: number;
  minSize: number;
  /** Clear space kept between the letter and the county, and the frame edge. */
  margin?: number;
}

export interface LetterPlacement {
  /** Horizontal centre and baseline, in frame units. */
  x: number;
  y: number;
  /** Font size, in frame units. */
  size: number;
  /** The letter's approximate box (width × cap height), in frame units. */
  box: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Rough capital-letter widths (in em) for a bold serif like Philosopher.
 * Deliberately generous: overestimating only makes the letter keep a little
 * more distance from the county.
 */
const LETTER_WIDTHS: Record<string, number> = { I: 0.42, J: 0.55, M: 1.0, W: 1.05 };
const DEFAULT_LETTER_WIDTH = 0.82;
/** Capital height as a share of the font size (Philosopher/Georgia ≈ 0.7). */
export const CAP_HEIGHT = 0.72;

/** Approximate width of a run of capitals, in em (see LETTER_WIDTHS). */
export function letterWidthEm(text: string): number {
  return [...text].reduce((sum, ch) => sum + (LETTER_WIDTHS[ch] ?? DEFAULT_LETTER_WIDTH), 0);
}

/**
 * Choose where (and how big) to draw a decorative capital so it NEVER covers
 * the county, stays inside the frame, and otherwise sits as large as possible
 * on the state, near the middle of the composition.
 *
 * The letter is modelled as its box (width × cap height, padded by `margin`).
 * Candidate centres on a grid across the frame are each given the largest size
 * at which that box is clear of every point along the county's border (and the
 * frame edge), found by binary search. Each candidate is then scored by size,
 * by how much of the box lies on the state, and by closeness to the centre.
 */
function placeLetter(
  state: Point[][],
  county: Point[][],
  width: number,
  height: number,
  { text, coverCounty = false, maxSize, minSize, margin = 8 }: LetterOptions
): LetterPlacement | null {
  const widthEm = letterWidthEm(text);
  const countyPoints = coverCounty ? [] : county.flatMap((ring) => resample(ring, 2));
  const frameMargin = 4;

  const halfW = (size: number) => (widthEm * size) / 2 + margin;
  const halfH = (size: number) => (CAP_HEIGHT * size) / 2 + margin;

  const fits = (cx: number, cy: number, size: number) => {
    const hw = halfW(size);
    const hh = halfH(size);
    // Inside the frame (margin only applies against the county).
    if (cx - hw + margin < frameMargin || cx + hw - margin > width - frameMargin) return false;
    if (cy - hh + margin < frameMargin || cy + hh - margin > height - frameMargin) return false;
    // No part of the county's border inside the padded box…
    for (const [x, y] of countyPoints) {
      if (Math.abs(x - cx) < hw && Math.abs(y - cy) < hh) return false;
    }
    // …and the box isn't sitting entirely inside the county.
    return coverCounty || !isInside([cx, cy], county);
  };

  // Share of the letter's box that lies on the state.
  const coverage = (cx: number, cy: number, size: number) => {
    const hw = halfW(size) - margin;
    const hh = halfH(size) - margin;
    let hits = 0;
    const n = 5;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const p: Point = [cx - hw + (2 * hw * (i + 0.5)) / n, cy - hh + (2 * hh * (j + 0.5)) / n];
        if (isInside(p, state)) hits++;
      }
    }
    return hits / (n * n);
  };

  const maxDist = Math.hypot(width / 2, height / 2);
  let best: (LetterPlacement & { score: number }) | null = null;
  // Candidate centres: the middle of the frame (where the shape is centred),
  // plus — unless the county may be covered, in which case the middle is the
  // natural spot — a grid across the whole frame.
  const candidates: Point[] = [[width / 2, height / 2]];
  if (!coverCounty) {
    const cols = 36;
    const rows = 27;
    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j <= rows; j++) candidates.push([(width * i) / cols, (height * j) / rows]);
    }
  }
  for (const [cx, cy] of candidates) {
    if (!fits(cx, cy, minSize)) continue;
    let lo = minSize;
    let hi = maxSize;
    if (fits(cx, cy, hi)) lo = hi;
    else {
      for (let k = 0; k < 10; k++) {
        const mid = (lo + hi) / 2;
        if (fits(cx, cy, mid)) lo = mid;
        else hi = mid;
      }
    }
    const size = lo;
    const centred = 1 - Math.hypot(cx - width / 2, cy - height / 2) / maxDist;
    const score = size * (0.4 + 0.6 * coverage(cx, cy, size)) * (0.8 + 0.2 * centred);
    if (!best || score > best.score) best = { x: cx, y: cy, size, score };
  }
  if (!best) return null;

  const hw = (widthEm * best.size) / 2;
  const hh = (CAP_HEIGHT * best.size) / 2;
  return {
    x: round(best.x),
    // Baseline sits half a cap height below the box's centre.
    y: round(best.y + hh),
    size: Math.round(best.size),
    box: {
      x0: round(best.x - hw),
      y0: round(best.y - hh),
      x1: round(best.x + hw),
      y1: round(best.y + hh),
    },
  };
}

export function countyBurst(outline: CountyOutline, options: BurstOptions): CountyBurst {
  const {
    width,
    height,
    seed,
    colors,
    countyScale = 0.58,
    rows = 3,
    rowGap = 9,
    spacing = 9,
    rays = true,
    rayEvery = 2,
    rayLength = [26, 60],
    avoid = [],
    letter,
  } = options;

  const rand = seededRandom(seed);
  const pickColor = () => colors[Math.floor(rand() * colors.length)];

  // Fit the county into the middle of the frame.
  const s = Math.min(
    (width * countyScale) / outline.width,
    (height * countyScale) / outline.height
  );
  const ox = (width - outline.width * s) / 2;
  const oy = (height - outline.height * s) / 2;
  const place = (input: [number, number][][]): Point[][] =>
    input
      .map((ring) => ring.map(([x, y]) => [ox + x * s, oy + y * s] as Point))
      .filter((ring) => ring.length > 2);
  const rings = place(outline.rings);

  const dots: BurstDot[] = [];
  const minGap = spacing * 0.75;
  const crowded = ([x, y]: Point, gap = minGap) =>
    dots.some((dot) => Math.hypot(dot.cx - x, dot.cy - y) < gap);
  const inFrame = ([x, y]: Point, margin = 3) =>
    x > margin && x < width - margin && y > margin && y < height - margin;
  const addDot = ([x, y]: Point, r: number) =>
    dots.push({ cx: round(x), cy: round(y), r: round(r), fill: pickColor() });

  // Sample the outline evenly and work out which way is "outward" at each sample.
  const samples = rings.flatMap((ring) => {
    const pts = resample(ring, spacing);
    return pts.map((p, i) => {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const next = pts[(i + 1) % pts.length];
      let n = normalize([next[1] - prev[1], prev[0] - next[0]]);
      if (isInside([p[0] + n[0] * 2, p[1] + n[1] * 2], rings)) n = [-n[0], -n[1]];
      return { p, n };
    });
  });

  // Outline rows: each sample pushed out by k row gaps. Points that land too
  // close to the county (inside a bay or notch) or on top of another dot are
  // dropped, so the rows stay clean around concave shapes.
  let outerRow: { p: Point; n: Point }[] = [];
  for (let k = 1; k <= rows; k++) {
    const offset = rowGap * k;
    const row: { p: Point; n: Point }[] = [];
    for (const { p, n } of samples) {
      const q: Point = [p[0] + n[0] * offset, p[1] + n[1] * offset];
      if (!inFrame(q) || isInside(q, rings)) continue;
      if (distanceToOutline(q, rings) < offset * 0.85 || crowded(q)) continue;
      addDot(q, 2.3 - 0.25 * (k - 1) + rand() * 0.3);
      row.push({ p: q, n });
    }
    outerRow = row;
  }

  // Rays: from every Nth dot of the outermost row, step outward (along the
  // outline's normal, nudged away from the frame centre so rays fan out).
  // A ray stops when it leaves the frame, turns back toward the county, or
  // runs into another dot.
  const centre: Point = [width / 2, height / 2];
  outerRow.forEach(({ p, n }, j) => {
    if (!rays || j % rayEvery !== 0) return;
    const radial = normalize([p[0] - centre[0], p[1] - centre[1]]);
    const dir = normalize([n[0] + radial[0] * 0.6, n[1] + radial[1] * 0.6]);
    const [short, long] = rayLength;
    const base = (j / rayEvery) % 2 === 0 ? long : short;
    const length = base * (0.8 + rand() * 0.4);

    let lastDistance = distanceToOutline(p, rings);
    for (let d = spacing; d <= length; d += spacing) {
      const q: Point = [p[0] + dir[0] * d, p[1] + dir[1] * d];
      const distance = distanceToOutline(q, rings);
      if (!inFrame(q) || distance <= lastDistance || crowded(q, minGap * 0.9)) break;
      lastDistance = distance;
      addDot(q, 1.9 - (d / length) * 1.0 + rand() * 0.25); // shrinks toward the tip
    }
  });

  return {
    dots,
    rings,
    letter: letter ? placeLetter(rings, place(avoid), width, height, letter) : null,
    transform: `translate(${round(ox)} ${round(oy)}) scale(${round(s * 1000) / 1000})`,
  };
}
