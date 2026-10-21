import { distance } from './geo';
import { decodePolyline, type Mode, type Route } from './route';

/**
 * The shape of each junction on a road route, for the banner to draw what the driver will see
 * rather than a generic arrow: from the router's `trace_attributes` (the request that brings
 * the speed limits), every road meeting at each node with the heading it leaves in. Angles are
 * degrees clockwise from the way the route comes in, so straight on is 0 and the way in 180.
 */
export type Junction =
  | {
      kind: 'turn';
      /** The way the route goes on. */
      out: number;
      /** Every other road there. */
      others: number[];
    }
  | {
      kind: 'roundabout';
      /** The exit taken, as a turn from the way in. */
      out: number;
      /** The exits passed on the way round. */
      passed: number[];
      /** Driven anticlockwise (traffic on the right). */
      right: boolean;
    };

/** What the request asks for besides the speed limits. */
export const JUNCTION_ATTRIBUTES = [
  'shape',
  'edge.begin_heading',
  'edge.end_heading',
  'edge.begin_shape_index',
  'edge.end_shape_index',
  'edge.roundabout',
  'edge.internal_intersection',
  'edge.drive_on_right',
  'node.intersecting_edge.begin_heading',
  'node.intersecting_edge.driveability',
  'node.intersecting_edge.cyclability',
  'node.intersecting_edge.walkability',
];

interface VCross {
  begin_heading?: number;
  driveability?: string;
  cyclability?: string;
  walkability?: string;
}
interface VEdge {
  begin_heading?: number;
  end_heading?: number;
  begin_shape_index?: number;
  end_shape_index?: number;
  roundabout?: boolean;
  /** Across a dual carriageway's central reservation: part of one junction with its ends. */
  internal_intersection?: boolean;
  drive_on_right?: boolean;
  end_node?: { intersecting_edges?: VCross[] };
}

/** Valhalla's types for entering a roundabout; leaving it, arriving and setting off. */
const ENTER = 26;
const NONE = new Set([1, 2, 3, 4, 5, 6, 27]);
/** A maneuver's point this far from the node the trace puts there is another place. */
const NODE_M = 15;
/** A road this close to the way out or the way in is that road drawn twice. */
const SAME_DEG = 15;

/** -180 < a <= 180. */
const rel = (deg: number) => {
  const a = (((deg % 360) + 360) % 360) as number;
  return a > 180 ? a - 360 : a;
};

/** A road the way of travel can use, one way or both; unknown counts. */
const usable = (x: VCross, mode: Mode) => {
  const v = mode === 'car' ? x.driveability : mode === 'bike' ? x.cyclability : x.walkability;
  return v !== 'none';
};
/** A road that can be left by: an exit, not an entry. */
const leaves = (x: VCross, mode: Mode) => {
  const v = mode === 'car' ? x.driveability : mode === 'bike' ? x.cyclability : x.walkability;
  return v === undefined || v === 'forward' || v === 'both';
};

/**
 * Each maneuver's junction, by its index, from the trace of the route (`json`); none where the
 * trace has no node at the maneuver or nothing else meets there.
 */
export function junctionsOf(json: unknown, route: Route, mode: Mode): Map<number, Junction> {
  const out = new Map<number, Junction>();
  const r = json as { edges?: VEdge[]; shape?: string } | null;
  const edges = r?.edges;
  if (!Array.isArray(edges) || !edges.length || typeof r?.shape !== 'string') return out;
  const shape = decodePolyline(r.shape);
  const at = (i: number | undefined) => (i === undefined ? undefined : shape[i]);
  let from = 0;
  route.maneuvers.forEach((m, n) => {
    if (NONE.has(m.type)) return;
    const p = route.coords[m.begin];
    if (!p) return;
    // The edge arriving at the maneuver's node: the nearest node from the last one on.
    let best = -1;
    let bestM = NODE_M;
    for (let i = from; i < edges.length - 1; i++) {
      const q = at(edges[i].end_shape_index);
      if (!q) continue;
      const d = distance({ lng: p[0], lat: p[1] }, { lng: q[0], lat: q[1] });
      if (d < bestM) {
        best = i;
        bestM = d;
      } else if (best !== -1 && d > 10 * NODE_M) break;
    }
    if (best === -1) return;
    from = best + 1;
    const inEdge = edges[best];
    const inH = inEdge.end_heading;
    if (inH === undefined) return;
    const j = m.type === ENTER ? roundabout(edges, best, inH, mode) : turn(edges, best, inH, mode);
    if (j) out.set(n, j);
  });
  return out;
}

/** A way out this close to straight back is a U-turn, drawn by its own arrow. */
const BACK_DEG = 150;

/**
 * A junction from the node edge `i` arrives at. Across a dual carriageway the router goes by
 * a short edge between its two halves (`internal_intersection`): the roads at both its ends
 * are one junction, and the way out is the edge after it.
 */
function turn(edges: VEdge[], i: number, inH: number, mode: Mode): Junction | null {
  let k = i + 1;
  while (k < edges.length - 1 && edges[k].internal_intersection) k++;
  const next = edges[k]?.begin_heading;
  if (next === undefined) return null;
  const o = rel(next - inH);
  if (Math.abs(o) > BACK_DEG) return null;
  const others: number[] = [];
  for (let e = i; e < k; e++) {
    for (const x of edges[e].end_node?.intersecting_edges ?? []) {
      if (x.begin_heading === undefined || !usable(x, mode)) continue;
      const a = rel(x.begin_heading - inH);
      // The other carriageway of the way in, or the way out's own twin: drawn already.
      if (Math.abs(rel(a - 180)) < SAME_DEG || Math.abs(rel(a - o)) < SAME_DEG) continue;
      // Both halves of the road crossed, one arm each way.
      if (others.some((b) => Math.abs(rel(a - b)) < SAME_DEG)) continue;
      others.push(a);
    }
  }
  return others.length ? { kind: 'turn', out: o, others: others.sort((a, b) => a - b) } : null;
}

function roundabout(edges: VEdge[], i: number, inH: number, mode: Mode): Junction | null {
  // Round the ring to the first edge that is not part of it: the exit taken.
  let k = i + 1;
  while (k < edges.length && edges[k].roundabout) k++;
  if (k === i + 1 || k >= edges.length) return null;
  const exitH = edges[k].begin_heading;
  if (exitH === undefined) return null;
  const passed: number[] = [];
  // The nodes passed on the ring, not the one left by (its other roads are the ring going on).
  for (let e = i + 1; e < k - 1; e++) {
    for (const x of edges[e].end_node?.intersecting_edges ?? []) {
      if (x.begin_heading === undefined || !leaves(x, mode)) continue;
      const a = rel(x.begin_heading - inH);
      if (!passed.some((b) => Math.abs(rel(a - b)) < SAME_DEG)) passed.push(a);
    }
  }
  return {
    kind: 'roundabout',
    out: rel(exitH - inH),
    passed,
    right: edges[i + 1].drive_on_right !== false,
  };
}

/** A point `r` from the centre at `deg` clockwise from straight up, in a 24-unit square. */
export const polar = (c: [number, number], r: number, deg: number): [number, number] => [
  c[0] + r * Math.sin((deg * Math.PI) / 180),
  c[1] - r * Math.cos((deg * Math.PI) / 180),
];

const fmt = (p: [number, number]) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;

/** An arrowhead at `tip` pointing `deg`. */
const head = (tip: [number, number], deg: number) =>
  `M${fmt(polar(tip, 3.2, deg + 145))}L${fmt(tip)}L${fmt(polar(tip, 3.2, deg - 145))}`;

/** The drawing: the roads there faint, the way taken bold with its arrowhead (SVG paths). */
export function junctionPaths(j: Junction): { faint: string; way: string; ring?: number } {
  if (j.kind === 'turn') {
    const c: [number, number] = [12, 13];
    const faint = j.others.map((a) => `M${fmt(c)}L${fmt(polar(c, 9, a))}`).join('');
    const tip = polar(c, 8.5, j.out);
    return { faint, way: `M12 22L${fmt(c)}L${fmt(tip)}${head(tip, j.out)}` };
  }
  const c: [number, number] = [12, 12];
  const R = 4;
  const faint = j.passed.map((a) => `M${fmt(polar(c, R, a))}L${fmt(polar(c, R + 5, a))}`).join('');
  // From the way in (at the bottom) round in the way of traffic to the exit taken.
  const end = j.right ? (j.out >= 180 ? -180 : j.out) : j.out + 360;
  const sweep = j.right ? 180 - end : end - 180;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / 15));
  const arc = Array.from({ length: steps + 1 }, (_, s) =>
    fmt(polar(c, R, 180 + ((j.right ? -1 : 1) * sweep * s) / steps)),
  ).join('L');
  const tip = polar(c, R + 5.5, j.out);
  return {
    faint,
    ring: R,
    way: `M12 22L${fmt(polar(c, R, 180))}L${arc}L${fmt(tip)}${head(tip, j.out)}`,
  };
}
