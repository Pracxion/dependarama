import type { Box, ConfiguredDomain, ImportEdge, Layout, VisibleNode } from '../types/graph';

export const group = (file: Pick<VisibleNode, 'domain'>): string => file.domain ?? '';
export const groupLabel = (key: string): string => key || 'Outside configured domains';

interface HexCell {
  x: number;
  y: number;
}

function hexagonalGrid(
  count: number,
  tileWidth: number,
  tileHeight: number,
  padding: number,
): { cells: HexCell[]; width: number; height: number } {
  const coordinates = hexCoordinates(count);
  const gap = 80;
  const stepX = tileWidth + gap;
  const stepY = tileHeight + gap;
  const raw = coordinates.map(({ q, r }) => ({ x: stepX * (q + r / 2), y: stepY * r }));
  const minX = Math.min(0, ...raw.map(point => point.x));
  const minY = Math.min(0, ...raw.map(point => point.y));
  const maxX = Math.max(0, ...raw.map(point => point.x));
  const maxY = Math.max(0, ...raw.map(point => point.y));
  return {
    cells: raw.map(point => ({ x: padding + point.x - minX, y: padding + point.y - minY })),
    width: padding * 2 + maxX - minX + tileWidth,
    height: padding * 2 + maxY - minY + tileHeight,
  };
}

function hexCoordinates(count: number): Array<{ q: number; r: number }> {
  const cells: Array<{ q: number; r: number }> = [];
  if (count === 0) return cells;
  cells.push({ q: 0, r: 0 });
  const directions = [[0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1], [1, 0]] as const;
  for (let radius = 1; cells.length < count; radius++) {
    let q = radius, r = -radius;
    for (const [dq, dr] of directions) {
      for (let step = 0; step < radius && cells.length < count; step++) {
        cells.push({ q, r });
        q += dq;
        r += dr;
      }
    }
  }
  return cells;
}

function orderConnectedGroups(
  groups: string[],
  edges: ImportEdge[],
  groupForFile: Map<string, string>,
): string[] {
  const weights = new Map<string, number>();
  const degree = new Map(groups.map(key => [key, 0]));
  for (const edge of edges) {
    const source = groupForFile.get(edge.source), target = groupForFile.get(edge.target);
    if (source === undefined || target === undefined || source === target) continue;
    const weight = Math.max(1, edge.references.length);
    const key = JSON.stringify([source, target]);
    weights.set(key, (weights.get(key) ?? 0) + weight);
    degree.set(source, (degree.get(source) ?? 0) + weight);
    degree.set(target, (degree.get(target) ?? 0) + weight);
  }

  const remaining = new Set(groups);
  const ordered: string[] = [];
  while (remaining.size) {
    let best: string | null = null;
    let bestConnectedWeight = -1;
    let bestDegree = -1;
    for (const candidate of remaining) {
      const connectedWeight = ordered.reduce((sum, placed) =>
        sum + (weights.get(JSON.stringify([candidate, placed])) ?? 0)
          + (weights.get(JSON.stringify([placed, candidate])) ?? 0), 0);
      const candidateDegree = degree.get(candidate) ?? 0;
      if (connectedWeight > bestConnectedWeight
        || (connectedWeight === bestConnectedWeight && candidateDegree > bestDegree)
        || (connectedWeight === bestConnectedWeight && candidateDegree === bestDegree
          && (best === null || compareGroups(candidate, best) < 0))) {
        best = candidate;
        bestConnectedWeight = connectedWeight;
        bestDegree = candidateDegree;
      }
    }
    if (best === null) break;
    ordered.push(best);
    remaining.delete(best);
  }
  return ordered;
}

function compareGroups(left: string, right: string): number {
  return left === '' ? right === '' ? 0 : 1 : right === '' ? -1 : left.localeCompare(right);
}

function layer(file: VisibleNode): string {
  const path = file.id;
  if (path.includes('/application/command/')) return 'Command';
  if (path.includes('/application/query/')) return 'Query';
  if (path.includes('/application/feature/')) return 'Feature';
  if (path.includes('/model/')) return 'Model';
  if (path.includes('/infrastructure/')) return 'Persistence & infrastructure';
  return 'Other';
}

export function fileLayout(
  files: VisibleNode[],
  edges: ImportEdge[],
  selection?: { id: string; edges: ImportEdge[] },
  domains: ConfiguredDomain[] = [],
): Layout {
  const groups = new Map<string, VisibleNode[]>();
  for (const file of files) groups.set(group(file), [...(groups.get(group(file)) ?? []), file]);
  const boxes: Box[] = [], clusters: Box[] = [];
  const groupForFile = new Map(files.map(file => [file.id, group(file)]));
  const keys = orderConnectedGroups([...groups.keys()], edges, groupForFile);
  const incoming = new Set(selection?.edges.filter(edge => edge.target === selection.id).map(edge => edge.source));
  const outgoing = new Set(selection?.edges.filter(edge => edge.source === selection.id).map(edge => edge.target));
  const panels = keys.map(key => {
    const members = groups.get(key)!.sort((a, b) => layer(a).localeCompare(layer(b)) || a.id.localeCompare(b.id));
    const buckets = selection ? [
      members.filter(file => file.id !== selection.id && incoming.has(file.id) && !outgoing.has(file.id)),
      members.filter(file => file.id === selection.id),
      members.filter(file => file.id !== selection.id && outgoing.has(file.id)),
      members.filter(file => file.id !== selection.id && !incoming.has(file.id) && !outgoing.has(file.id)),
    ].filter(bucket => bucket.length) : [];
    const columns = selection ? buckets.reduce((sum, bucket) => sum + Math.ceil(bucket.length / 16), 0)
      : members.length > 32 ? 3 : members.length > 10 ? 2 : 1;
    const width = columns * 300 + 32;
    const rows = selection ? Math.max(...buckets.map(bucket => Math.min(16, bucket.length))) : Math.ceil(members.length / columns);
    const height = rows * 70 + 88;
    let nextColumn = 0;
    const positions = selection ? buckets.flatMap(bucket => {
      const column = nextColumn;
      nextColumn += Math.ceil(bucket.length / 16);
      return bucket.map((file, index) => ({ file, column: column + Math.floor(index / 16), row: index % 16 }));
    }) : members.map((file, index) => ({ file, column: index % columns, row: Math.floor(index / columns) }));
    return { key, members, width, height, positions };
  });

  const cellWidth = Math.max(1, ...panels.map(panel => panel.width));
  const cellHeight = Math.max(1, ...panels.map(panel => panel.height));
  const grid = hexagonalGrid(panels.length, cellWidth, cellHeight, 40);
  panels.forEach((panel, panelIndex) => {
    const { key, members, width, height, positions } = panel;
    const { x, y } = grid.cells[panelIndex]!;
    if (key) {
      const fileCount = members.reduce((count, member) => count + (member.fileCount ?? 1), 0);
      const packageCount = members.filter(member => member.kind === 'directory').length;
      clusters.push({ id: key, x, y, width, height, label: key,
        subtitle: `${fileCount} files${packageCount ? ` · ${packageCount} packages` : ''} · ${domainPath(domains, key) ?? 'configured domain'}`,
        domain: key });
    }
    positions.forEach(({ file, column, row }) => {
      const configuredPath = file.domain ? domainPath(domains, file.domain) : undefined;
      const prefix = configuredPath ? `${configuredPath}/` : '';
      const relative = file.id.startsWith(prefix) ? file.id.slice(prefix.length) : file.id;
      boxes.push({ id: file.id, x: x + 18 + column * 300,
        y: y + 65 + row * 70, width: 270, height: 52,
        label: file.label ?? relative.split('/').at(-1)!,
        subtitle: (file.subtitle ?? relative.split('/').slice(0, -1).join('/')) || 'module root',
        domain: file.domain, kind: file.kind ?? 'file', directoryPath: file.directoryPath,
        memberFileIds: file.memberFileIds, relatedFileIds: file.relatedFileIds });
    });
  });
  return { boxes, clusters, width: Math.max(500, grid.width), height: Math.max(350, grid.height) };
}

function domainPath(domains: ConfiguredDomain[], name: string): string | undefined {
  return domains.find(domain => domain.name === name)?.path;
}

export function connections(edges: ImportEdge[], id: string): Set<string> {
  const connected = new Set([id]);
  for (const edge of edges) {
    if (edge.source === id) connected.add(edge.target);
    if (edge.target === id) connected.add(edge.source);
  }
  return connected;
}

export function edgePath(source: Box, target: Box, lane = 0, laneCount = 1): string {
  const dx = target.x - source.x, dy = target.y - source.y;
  const start = rectangleAnchor(source, dx, dy);
  const end = rectangleAnchor(target, -dx, -dy);
  const distance = Math.hypot(dx, dy) || 1;
  const direction = dx < 0 || (dx === 0 && dy < 0) ? -1 : 1;
  const laneOffset = (lane - (laneCount - 1) / 2) * 22 * direction;
  const normalX = -dy / distance, normalY = dx / distance;
  const controlOneX = start.x + dx * 0.32 + normalX * laneOffset;
  const controlOneY = start.y + dy * 0.32 + normalY * laneOffset;
  const controlTwoX = end.x - dx * 0.32 + normalX * laneOffset;
  const controlTwoY = end.y - dy * 0.32 + normalY * laneOffset;
  return `M${start.x},${start.y} C${controlOneX},${controlOneY} ${controlTwoX},${controlTwoY} ${end.x},${end.y}`;
}

function rectangleAnchor(box: Box, dx: number, dy: number): { x: number; y: number } {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  if (dx === 0 && dy === 0) dx = 1;
  const scale = 1 / Math.max(Math.abs(dx) / (box.width / 2), Math.abs(dy) / (box.height / 2));
  return { x: centerX + dx * scale, y: centerY + dy * scale };
}
