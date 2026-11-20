/**
 * Build-time county outlines.
 *
 * Reads the same TIGER-derived topology the interactive map uses
 * (public/geo/boundaries/us-2025-20m.topo.json) on the Node side during the
 * build, finds the county whose feature `id` matches a 5-digit county FIPS
 * code, and returns a ready-to-inline SVG path.
 *
 * The ~800 KB file is parsed once per build (module-level cache) and never
 * ships to the browser: only the few hundred bytes of path data do.
 */

import fs from 'node:fs';
import path from 'node:path';

const TOPO_FILE = path.join(
  process.cwd(),
  'public',
  'geo',
  'boundaries',
  'us-2025-20m.topo.json'
);

type Position = [number, number];

interface TopoTransform {
  scale: [number, number];
  translate: [number, number];
}

interface TopoGeometry {
  type: string;
  id?: string | number;
  arcs?: unknown;
  geometries?: TopoGeometry[];
}

interface Topology {
  type: 'Topology';
  transform?: TopoTransform;
  arcs: number[][][];
  objects: Record<string, TopoGeometry>;
}

export interface CountyOutline {
  /** SVG path data, already projected and fitted to the viewBox below. */
  d: string;
  /** viewBox dimensions (origin is always 0 0). */
  width: number;
  height: number;
  /** The same rings as `d`, as points in viewBox units (for build-time geometry). */
  rings: Position[][];
}

export interface OutlineOptions {
  /** Longest edge the shape is scaled to fit, in viewBox units. */
  maxWidth?: number;
  maxHeight?: number;
  /** Blank margin kept around the shape, in viewBox units. */
  padding?: number;
  /**
   * Decorative tilt (degrees, counter-clockwise = rising to the right). Shapes
   * that already lean by at least `target` degrees either way are left as they
   * are; straighter ones are turned so they lean `target` degrees, never by
   * more than `max`. See tiltFor().
   */
  tilt?: { target: number; max: number };
}

let topologyCache: Topology | null | undefined;
const outlineCache = new Map<string, CountyOutline | null>();

function loadTopology(): Topology | null {
  if (topologyCache !== undefined) return topologyCache;
  try {
    topologyCache = JSON.parse(fs.readFileSync(TOPO_FILE, 'utf8')) as Topology;
  } catch {
    // Missing or unreadable topology: callers fall back to no graphic.
    topologyCache = null;
  }
  return topologyCache;
}

/** Undo TopoJSON delta encoding + quantization for a single arc. */
function decodeArc(topology: Topology, index: number): Position[] {
  const arc = topology.arcs[index] ?? [];
  const { scale, translate } = topology.transform ?? {
    scale: [1, 1] as [number, number],
    translate: [0, 0] as [number, number],
  };

  let x = 0;
  let y = 0;
  return arc.map((point) => {
    if (topology.transform) {
      x += point[0];
      y += point[1];
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as Position;
    }
    return [point[0], point[1]] as Position;
  });
}

/** Stitch an arc-index list into one ring (negative index = traverse reversed). */
function ringFromArcs(topology: Topology, arcIndexes: number[]): Position[] {
  const ring: Position[] = [];
  for (const index of arcIndexes) {
    const reversed = index < 0;
    const points = decodeArc(topology, reversed ? ~index : index);
    const ordered = reversed ? [...points].reverse() : points;
    // The first point of each following arc repeats the previous arc's last point.
    for (let i = ring.length ? 1 : 0; i < ordered.length; i++) ring.push(ordered[i]);
  }
  return ring;
}

function ringsFromGeometry(topology: Topology, geometry: TopoGeometry): Position[][] {
  if (geometry.type === 'Polygon') {
    return (geometry.arcs as number[][]).map((r) => ringFromArcs(topology, r));
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.arcs as number[][][]).flatMap((polygon) =>
      polygon.map((r) => ringFromArcs(topology, r))
    );
  }
  return [];
}

function findFeature(
  topology: Topology,
  objectName: 'counties' | 'states',
  id: string
): TopoGeometry | null {
  const geometries = topology.objects?.[objectName]?.geometries ?? [];
  return geometries.find((feature) => String(feature.id) === id) ?? null;
}

function ringsFor(topology: Topology, geometry: TopoGeometry | null): Position[][] {
  if (!geometry) return [];
  return ringsFromGeometry(topology, geometry).filter((ring) => ring.length > 2);
}

/**
 * Alaska's Aleutians cross the antimeridian (longitudes near +180 and -180 in
 * the same state), which would stretch the shape across the whole globe. Shift
 * the eastern-hemisphere points west by 360 degrees when that happens.
 */
function unwrapAntimeridian(ringSets: Position[][][]): Position[][][] {
  const all = ringSets.flat(2);
  const crosses = all.some(([lon]) => lon > 150) && all.some(([lon]) => lon < -150);
  if (!crosses) return ringSets;
  return ringSets.map((rings) =>
    rings.map((ring) => ring.map(([lon, lat]) => [lon > 0 ? lon - 360 : lon, lat] as Position))
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

function toPath(rings: Position[][]): string {
  return rings
    .map((ring) => `${ring.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join('')}Z`)
    .join('');
}

/** Convex hull (Andrew's monotone chain). */
function convexHull(points: Position[]): Position[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Position, a: Position, b: Position) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Position[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Position[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * How far a shape leans from the nearest horizontal/vertical, in degrees
 * (counter-clockwise positive, as seen on screen, in -45..45). Measured from
 * the smallest rectangle that fits around the shape, which tracks a boxy
 * state's straight borders better than averaging its points.
 */
export function shapeLean(points: Position[]): number {
  const hull = convexHull(points);
  let bestArea = Infinity;
  let bestAngle = 0;
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i];
    const [bx, by] = hull[(i + 1) % hull.length];
    const angle = Math.atan2(by - ay, bx - ax);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, y] of hull) {
      const u = x * cos + y * sin;
      const v = -x * sin + y * cos;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      bestAngle = angle;
    }
  }
  // Screen y points down, so a counter-clockwise lean is a negative atan2 angle.
  let lean = (-bestAngle * 180) / Math.PI;
  lean = ((((lean + 45) % 90) + 90) % 90) - 45; // fold into -45..45
  return Math.round(lean * 10) / 10;
}

/**
 * Rotation (degrees, counter-clockwise) to give a shape with this lean.
 * Leaning shapes keep their real orientation; straighter ones are topped up to
 * the target lean, by no more than `max`.
 */
export function tiltFor(lean: number, { target, max }: { target: number; max: number }): number {
  if (Math.abs(lean) >= target) return 0;
  return Math.min(target - lean, max);
}

/**
 * Project several ring sets with one shared projection and fit them into a box.
 * The box is sized to the FIRST set (e.g. a state); later sets (e.g. one of its
 * counties) land in the same coordinates so they overlay it exactly. With
 * `tilt`, every set is rotated by the amount chosen for the first set.
 *
 * Projection is a cosine-corrected plate carrée centred on the first set, which
 * keeps a county's or state's proportions right without a projection dependency.
 */
function fitRingSets(
  ringSets: Position[][][],
  { maxWidth = 460, maxHeight = 260, padding = 8, tilt }: OutlineOptions
): { width: number; height: number; fitted: Position[][][]; lean: number; rotation: number } {
  // Centre latitude drives the horizontal squeeze.
  const lats = ringSets[0].flat().map(([, lat]) => lat);
  const kx = Math.cos((lats.reduce((a, b) => a + b, 0) / lats.length) * (Math.PI / 180)) || 1;
  let projected = ringSets.map((rings) =>
    rings.map((ring) => ring.map(([lon, lat]) => [lon * kx, -lat] as Position))
  );

  const lean = shapeLean(projected[0].flat());
  const rotation = tilt ? tiltFor(lean, tilt) : 0;
  if (rotation) {
    // Counter-clockwise on screen (y points down).
    const a = (rotation * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    projected = projected.map((rings) =>
      rings.map((ring) => ring.map(([x, y]) => [x * cos + y * sin, -x * sin + y * cos] as Position))
    );
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of projected[0].flat()) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  const spanX = maxX - minX || 1e-6;
  const spanY = maxY - minY || 1e-6;
  const scale = Math.min(maxWidth / spanX, maxHeight / spanY);

  const fitted = projected.map((rings) =>
    rings.map((ring) =>
      ring.map(
        ([x, y]) =>
          [round((x - minX) * scale + padding), round((y - minY) * scale + padding)] as Position
      )
    )
  );

  return {
    width: Math.round(spanX * scale + padding * 2),
    height: Math.round(spanY * scale + padding * 2),
    fitted,
    lean,
    rotation,
  };
}

/**
 * SVG path for one county, or null when the FIPS code isn't in the topology.
 */
export function countyOutline(
  countyFips: string | null | undefined,
  options: OutlineOptions = {}
): CountyOutline | null {
  const fips = (countyFips ?? '').trim();
  if (!/^\d{5}$/.test(fips)) return null;

  const { maxWidth = 460, maxHeight = 260, padding = 8 } = options;
  const cacheKey = `${fips}:${maxWidth}:${maxHeight}:${padding}`;
  if (outlineCache.has(cacheKey)) return outlineCache.get(cacheKey) ?? null;

  const topology = loadTopology();
  const rings = topology ? ringsFor(topology, findFeature(topology, 'counties', fips)) : [];
  if (!rings.length) {
    outlineCache.set(cacheKey, null);
    return null;
  }

  const {
    width,
    height,
    fitted: [countyRings],
  } = fitRingSets(unwrapAntimeridian([rings]), options);
  const outline: CountyOutline = { d: toPath(countyRings), width, height, rings: countyRings };
  outlineCache.set(cacheKey, outline);
  return outline;
}

export interface StateCountyOutline {
  /** The whole state, fitted to the viewBox below. */
  state: CountyOutline;
  /** The county, in the same coordinates so it sits in place on the state. */
  county: CountyOutline;
  /** The state's natural lean and the decorative rotation applied, in degrees. */
  lean: number;
  rotation: number;
}

const stateCountyCache = new Map<string, StateCountyOutline | null>();

/**
 * The state containing a county (its first two FIPS digits) plus the county
 * itself, projected and fitted together so the county can be drawn on top of
 * the state. Null when either shape is missing from the topology.
 */
export function stateCountyOutline(
  countyFips: string | null | undefined,
  options: OutlineOptions = {}
): StateCountyOutline | null {
  const fips = (countyFips ?? '').trim();
  if (!/^\d{5}$/.test(fips)) return null;

  const { maxWidth = 460, maxHeight = 260, padding = 8, tilt } = options;
  const cacheKey = `${fips}:${maxWidth}:${maxHeight}:${padding}:${tilt?.target}:${tilt?.max}`;
  if (stateCountyCache.has(cacheKey)) return stateCountyCache.get(cacheKey) ?? null;

  const topology = loadTopology();
  const stateRings = topology ? ringsFor(topology, findFeature(topology, 'states', fips.slice(0, 2))) : [];
  const countyRings = topology ? ringsFor(topology, findFeature(topology, 'counties', fips)) : [];
  if (!stateRings.length || !countyRings.length) {
    stateCountyCache.set(cacheKey, null);
    return null;
  }

  const {
    width,
    height,
    fitted: [state, county],
    lean,
    rotation,
  } = fitRingSets(unwrapAntimeridian([stateRings, countyRings]), options);
  const result: StateCountyOutline = {
    state: { d: toPath(state), width, height, rings: state },
    county: { d: toPath(county), width, height, rings: county },
    lean,
    rotation,
  };
  stateCountyCache.set(cacheKey, result);
  return result;
}
