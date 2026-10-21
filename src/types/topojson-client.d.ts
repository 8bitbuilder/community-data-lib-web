// Minimal types for the two topojson-client functions /maps uses (the package ships none).
declare module 'topojson-client' {
  /** Convert a TopoJSON object to a GeoJSON Feature or FeatureCollection. */
  export function feature(topology: unknown, object: unknown): unknown;
  /** One MultiLineString of the object's arcs; shared borders appear once. */
  export function mesh(topology: unknown, object?: unknown, filter?: (a: unknown, b: unknown) => boolean): unknown;
}
