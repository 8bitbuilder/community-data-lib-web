/**
 * Build-time pointillist landscape: a soft, splotch-shaped patch of pale dots
 * (sky over rolling grass, with a sun) to sit behind the
 * state outline on the community page.
 *
 * Dots are laid on a jittered grid, coloured by which part of the scene they
 * fall in, and thinned toward the splotch's ragged edge. Dots under the state,
 * and in a band around its outline (where the outline rows of dots sit), are
 * skipped so the shape and its rows stay crisp. Seeded, so each library's
 * scene is stable between builds but varies (sun position, hill shape).
 */

import { type BurstDot, distanceToOutline, isInside, round, seededRandom } from './countyBurst';

type Point = [number, number];

export interface SceneOptions {
  /** Frame (viewBox) size. */
  width: number;
  height: number;
  /** Any string; the same seed always gives the same scene. */
  seed: string;
  /** State rings in frame units; dots under it and near its edge are skipped. */
  avoid?: Point[][];
  /** Clear band kept around the state's outline, in frame units. */
  avoidGap?: number;
  /** The decorative letter's box; the sun is kept at least mostly out from under it. */
  letterBox?: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Distance between dots. */
  spacing?: number;
  /** Sun radius before any shrinking to fit, in frame units. */
  sunRadius?: number;
  /** How far the horizon rises and falls, in frame units. */
  hillHeight?: number;
  /** Colour sets to use instead of the default pale ones. */
  colors?: Partial<SceneColors>;
}

export interface SceneColors {
  /** Sky, from the top of the sky down toward the horizon. */
  sky: string[];
  grass: string[];
  sun: string[];
}

const DEFAULT_SKY = ['#A9D9E0', '#BFE3EA', '#CFEBEE', '#DCEFF2'];
const DEFAULT_GRASS = ['#A3CE7A', '#B9DA98', '#CFE5B5', '#DDEBC8'];
const DEFAULT_SUN = ['#F5B942', '#F8CD6B', '#FADD94'];

export function pointillistScene({
  width,
  height,
  seed,
  avoid = [],
  avoidGap = 12,
  letterBox = null,
  spacing = 5.5,
  sunRadius: sunR = 20,
  hillHeight = 9,
  colors = {},
}: SceneOptions): BurstDot[] {
  const SKY = colors.sky ?? DEFAULT_SKY;
  const GRASS = colors.grass ?? DEFAULT_GRASS;
  const SUN = colors.sun ?? DEFAULT_SUN;
  const rand = seededRandom(`${seed}:scene`);
  const pick = (colors: string[]) => colors[Math.floor(rand() * colors.length)];
  const cx = width / 2;
  const cy = height / 2;

  // Splotch: an ellipse whose radius wobbles with angle (a few random waves).
  const phases = [rand(), rand(), rand()].map((p) => p * Math.PI * 2);
  const splotch = (angle: number) =>
    0.94 +
    0.07 * Math.sin(3 * angle + phases[0]) +
    0.05 * Math.sin(5 * angle + phases[1]) +
    0.03 * Math.sin(9 * angle + phases[2]);
  const rx = width / 2 - 4;
  const ry = height / 2 - 4;

  // Scene layout: horizon with a gentle hill.
  const hillPhase = rand() * Math.PI * 2;
  const horizon = (x: number) => height * 0.6 + hillHeight * Math.sin((x / width) * Math.PI * 2 + hillPhase);

  // How much room a circle has: distance from its edge to the state (negative
  // when it overlaps) and whether it stays inside the splotch.
  const insideSplotch = ([x, y]: Point, margin = 0.85) => {
    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;
    return Math.hypot(nx, ny) < splotch(Math.atan2(ny, nx)) * margin;
  };
  const clearance = ([x, y]: Point, r: number) => {
    if (!avoid.length) return Infinity;
    if (isInside([x, y], avoid)) return -Infinity;
    return distanceToOutline([x, y], avoid) - r - avoidGap;
  };

  // Put the sun where it'll actually show: of the candidate spots in the sky,
  // take the one with the most clear space around the state, shrinking the sun
  // if needed. Candidates are jittered by the seed, so the spot varies a little
  // from library to library.
  const bestSpot = (
    candidates: Point[],
    radius: number,
    ok: (p: Point) => boolean = () => true
  ): { at: Point; scale: number } | null => {
    for (const scale of [1, 0.75, 0.55]) {
      let best: Point | null = null;
      let bestRoom = 0;
      for (const p of candidates) {
        if (!ok(p)) continue;
        const room = clearance(p, radius * scale);
        if (room > bestRoom) {
          best = p;
          bestRoom = room;
        }
      }
      if (best) return { at: best, scale };
    }
    return null;
  };
  const grid = (x0: number, x1: number, y0: number, y1: number, step = 10): Point[] => {
    const pts: Point[] = [];
    for (let x = x0; x <= x1; x += step) {
      for (let y = y0; y <= y1; y += step) pts.push([x + rand() * 4, y + rand() * 4]);
    }
    return pts;
  };

  // The sun may tuck partly behind the letter, but at most about half of it:
  // its centre must be at least half a radius outside the letter's box.
  const clearOfLetter = ([x, y]: Point, r: number) => {
    if (!letterBox) return true;
    const dx = Math.max(letterBox.x0 - x, 0, x - letterBox.x1);
    const dy = Math.max(letterBox.y0 - y, 0, y - letterBox.y1);
    return Math.hypot(dx, dy) >= r * 0.5;
  };
  const sunSpot = bestSpot(
    grid(20, width - 20, 18, height * 0.4),
    sunR,
    (p) => insideSplotch(p, 0.8) && clearOfLetter(p, sunR)
  );
  const sun: Point | null = sunSpot?.at ?? null;
  const sunRadius = sunR * (sunSpot?.scale ?? 1);

  const dots: BurstDot[] = [];
  const rowStep = spacing * 0.866;
  for (let row = 0, gy = 0; gy <= height; row++, gy += rowStep) {
    for (let gx = row % 2 ? spacing / 2 : 0; gx <= width; gx += spacing) {
      const x = gx + (rand() - 0.5) * 1.6;
      const y = gy + (rand() - 0.5) * 1.6;

      // Inside the splotch, with a ragged, thinning edge.
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const edge = splotch(Math.atan2(ny, nx));
      const reach = Math.hypot(nx, ny) / edge;
      if (reach > 1 || (reach > 0.82 && rand() < (reach - 0.82) / 0.18)) continue;

      // Keep clear of the state and the outline rows around it.
      if (
        avoid.length &&
        (isInside([x, y], avoid) || distanceToOutline([x, y], avoid) < avoidGap)
      ) {
        continue;
      }

      let color: string;
      if (sun && Math.hypot(x - sun[0], y - sun[1]) < sunRadius) color = pick(SUN);
      else if (y > horizon(x)) color = pick(GRASS);
      else {
        // Sky: deeper blue at the top, paling toward the horizon (with a
        // little randomness so the bands blend).
        const band = (y / horizon(x)) * SKY.length + (rand() - 0.5) * 1.5;
        color = SKY[Math.max(0, Math.min(SKY.length - 1, Math.floor(band)))];
      }

      dots.push({ cx: round(x), cy: round(y), r: round(1.1 + rand() * 0.9), fill: color });
    }
  }
  return dots;
}
