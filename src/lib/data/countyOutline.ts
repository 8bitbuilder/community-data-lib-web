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
}

export interface OutlineOptions {
  /** Longest edge the shape is scaled to fit, in viewBox units. */
  maxWidth?: number;
  maxHeight?: number;
  /** Blank margin kept around the shape, in viewBox units. */
  padding?: number;
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

function findCounty(topology: Topology, fips: string): TopoGeometry | null {
  const counties = topology.objects?.counties;
  const geometries = counties?.geometries ?? [];
  return geometries.find((feature) => String(feature.id) === fips) ?? null;
}

/**
 * SVG path for one county, or null when the FIPS code isn't in the topology.
 *
 * Coordinates are projected with a cosine-corrected plate carrée centred on the
 * county, which keeps a single county's proportions right without pulling in a
 * projection dependency, then scaled to fit the requested box.
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
  const geometry = topology ? findCounty(topology, fips) : null;
  if (!topology || !geometry) {
    outlineCache.set(cacheKey, null);
    return null;
  }

  const rings = ringsFromGeometry(topology, geometry).filter((ring) => ring.length > 2);
  if (!rings.length) {
    outlineCache.set(cacheKey, null);
    return null;
  }

  // Centre latitude drives the horizontal squeeze.
  let latSum = 0;
  let count = 0;
  for (const ring of rings) {
    for (const [, lat] of ring) {
      latSum += lat;
      count++;
    }
  }
  const kx = Math.cos((latSum / count) * (Math.PI / 180)) || 1;

  const projected = rings.map((ring) =>
    ring.map(([lon, lat]) => [lon * kx, -lat] as Position)
  );

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of projected) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const spanX = maxX - minX || 1e-6;
  const spanY = maxY - minY || 1e-6;
  const scale = Math.min(maxWidth / spanX, maxHeight / spanY);

  const width = Math.round(spanX * scale + padding * 2);
  const height = Math.round(spanY * scale + padding * 2);
  const round = (n: number) => Math.round(n * 100) / 100;

  const d = projected
    .map((ring) => {
      const commands = ring.map(([x, y], i) => {
        const px = round((x - minX) * scale + padding);
        const py = round((y - minY) * scale + padding);
        return `${i === 0 ? 'M' : 'L'}${px} ${py}`;
      });
      return `${commands.join('')}Z`;
    })
    .join('');

  const outline: CountyOutline = { d, width, height };
  outlineCache.set(cacheKey, outline);
  return outline;
}
