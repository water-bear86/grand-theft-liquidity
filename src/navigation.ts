export interface StreetPoint {
  x: number;
  z: number;
}
// A lane-width circuit through both streets and their marked intersections.
export const TRAFFIC_CIRCUIT: StreetPoint[] = [
  { x: -3.6, z: 10 }, { x: -3.6, z: -277 }, { x: -57, z: -277 },
  { x: -57, z: -231 }, { x: 3.6, z: -231 }, { x: 3.6, z: 10 },
];
const nodes: StreetPoint[] = [
  { x: 0, z: 18 },
  { x: 0, z: -233 },
  { x: 0, z: -280 },
  { x: 0, z: -360 },
  { x: -60, z: -120 },
  { x: -60, z: -233 },
  { x: -60, z: -280 },
];
const edges = [
  [0, 1],
  [1, 2],
  [2, 3],
  [4, 5],
  [5, 6],
  [1, 5],
  [2, 6],
];
const distance = (a: StreetPoint, b: StreetPoint) =>
  Math.hypot(a.x - b.x, a.z - b.z);
function project(point: StreetPoint) {
  return edges
    .map(([a, b], edge) => {
      const start = nodes[a],
        end = nodes[b];
      const dx = end.x - start.x,
        dz = end.z - start.z;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point.x - start.x) * dx + (point.z - start.z) * dz) /
            (dx * dx + dz * dz),
        ),
      );
      const position = { x: start.x + t * dx, z: start.z + t * dz };
      return { position, edge, distance: distance(point, position) };
    })
    .sort((a, b) => a.distance - b.distance)[0];
}
/** Route along the two roads and their actual intersections, never through the frontage. */
export function streetRoute(from: StreetPoint, to: StreetPoint): StreetPoint[] {
  const a = project(from),
    b = project(to);
  const points = [...nodes, a.position, b.position];
  const start = nodes.length,
    end = start + 1;
  const links = [
    ...edges,
    ...edges[a.edge].map((n) => [start, n]),
    ...edges[b.edge].map((n) => [end, n]),
  ];
  if (a.edge === b.edge) links.push([start, end]);
  const costs = points.map(() => Infinity),
    previous = points.map(() => -1),
    visited = new Set<number>();
  costs[start] = 0;
  while (visited.size < points.length) {
    let current = -1;
    for (let n = 0; n < points.length; n++)
      if (!visited.has(n) && (current < 0 || costs[n] < costs[current]))
        current = n;
    if (current === end || !Number.isFinite(costs[current])) break;
    visited.add(current);
    for (const [u, v] of links) {
      const next = u === current ? v : v === current ? u : -1;
      if (next < 0) continue;
      const cost = costs[current] + distance(points[current], points[next]);
      if (cost < costs[next]) {
        costs[next] = cost;
        previous[next] = current;
      }
    }
  }
  const route: StreetPoint[] = [];
  for (let n = end; n >= 0; n = previous[n]) route.unshift(points[n]);
  return route;
}
export function streetTarget(from: StreetPoint, to: StreetPoint): StreetPoint {
  return streetRoute(from, to).find((point) => distance(from, point) > 3) ?? to;
}
