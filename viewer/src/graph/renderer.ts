import { edgePath } from './layout';
import type { Box, ImportEdge, Layout, VisibleNode } from '../types/graph';
import { svgEl } from '../ui/dom';

export interface GraphRendererOptions {
  graph: SVGSVGElement;
  viewport: SVGGElement;
  layout: Layout;
  visible: VisibleNode[];
  edges: ImportEdge[];
  selected: string | null;
  relatedFiles: string[];
  color: (domain: string | null) => string;
  selectFile: (id: string) => void;
  openDirectory: (domain: string, path: string | null, relatedFiles: string[]) => void;
  hasDragged: () => boolean;
}

export function renderGraph(options: GraphRendererOptions): number {
  const { graph, viewport, layout, visible, edges, selected, relatedFiles, color, selectFile, openDirectory, hasDragged } = options;
  viewport.replaceChildren();
  const defs = graph.querySelector('defs')!;
  defs.replaceChildren();

  for (const cluster of layout.clusters) drawCluster(viewport, cluster, color);

  const boxes = new Map(layout.boxes.map(box => [box.id, box]));
  const visibleIds = new Set(visible.map(file => file.id));
  const drawnEdges = aggregateEdges(edges, visibleIds);
  drawEdges(viewport, defs, drawnEdges, boxes, selected, color);

  for (const box of layout.boxes) drawBox(viewport, box, {
    selected, relatedFiles, color, selectFile, openDirectory, hasDragged,
  });
  return drawnEdges.size;
}

type DrawnEdge = { source: string; target: string; count: number; kind: ImportEdge['kind'] };

function aggregateEdges(edges: ImportEdge[], visibleIds: Set<string>): Map<string, DrawnEdge> {
  const result = new Map<string, DrawnEdge>();
  for (const edge of edges) {
    if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) continue;
    const key = JSON.stringify([edge.source, edge.target, edge.kind]);
    const existing = result.get(key);
    if (existing) existing.count++;
    else result.set(key, { source: edge.source, target: edge.target, count: 1, kind: edge.kind });
  }
  return result;
}

function drawCluster(viewport: SVGGElement, box: Box, color: (domain: string | null) => string): void {
  const fill = color(box.domain);
  const cluster = svgEl('g', { class: 'domain-cluster', 'data-domain': box.domain! });
  cluster.append(svgEl('rect', { x: box.x, y: box.y, width: box.width, height: box.height,
    rx: 16, fill, 'fill-opacity': 0.035, stroke: fill, 'stroke-opacity': 0.3 }));
  const title = svgEl('text', { x: box.x + 20, y: box.y + 29, fill, 'font-size': 16, 'font-weight': 600 });
  title.textContent = box.label;
  const subtitle = svgEl('text', { x: box.x + 20, y: box.y + 47, fill: '#7b8798', 'font-size': 10, class: 'cluster-subtitle' });
  subtitle.textContent = box.subtitle;
  cluster.append(title, subtitle);
  viewport.append(cluster);
}

function drawEdges(
  viewport: SVGGElement,
  defs: SVGDefsElement,
  edges: Map<string, DrawnEdge>,
  boxes: Map<string, Box>,
  selected: string | null,
  color: (domain: string | null) => string,
): void {
  const orderedEdges = [...edges.values()].sort((left, right) =>
    left.source.localeCompare(right.source) || left.target.localeCompare(right.target) || left.kind.localeCompare(right.kind));
  const lanesByPair = new Map<string, DrawnEdge[]>();
  for (const edge of orderedEdges) {
    const pair = [edge.source, edge.target].sort();
    const key = JSON.stringify(pair);
    lanesByPair.set(key, [...(lanesByPair.get(key) ?? []), edge]);
  }

  let index = 0;
  for (const edge of orderedEdges) {
    const source = boxes.get(edge.source), target = boxes.get(edge.target);
    if (!source || !target) continue;
    const stroke = color(source.domain);
    const connected = !!selected && (edge.source === selected || edge.target === selected);
    const markerId = `arrow-${index++}`;
    const pairLanes = lanesByPair.get(JSON.stringify([edge.source, edge.target].sort()))!;
    const marker = svgEl('marker', { id: markerId, viewBox: '0 0 10 10', refX: 9, refY: 5,
      markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse', markerUnits: 'strokeWidth' });
    marker.append(svgEl('path', { d: 'M0,0 L10,5 L0,10 Z', fill: stroke }));
    defs.append(marker);
    const path = svgEl('path', { d: edgePath(source, target, pairLanes.indexOf(edge), pairLanes.length), fill: 'none', stroke,
      'stroke-width': connected ? 2 : 1.1,
      'stroke-opacity': connected ? 0.85 : 0.22,
      'marker-end': `url(#${markerId})`, class: 'edge', 'data-source': edge.source, 'data-target': edge.target });
    if (edge.kind === 're-export') path.setAttribute('stroke-dasharray', '8 5');
    if (edge.kind === 'module') {
      path.setAttribute('stroke-dasharray', '2 5');
      path.setAttribute('stroke-linecap', 'round');
    }
    const title = svgEl('title');
    const kind = edge.kind === 're-export' ? 're-export' : edge.kind === 'module' ? 'module declaration' : 'import';
    title.textContent = `${edge.source} → ${edge.target}\n${edge.count} ${kind}${edge.count === 1 ? '' : 's'}`;
    path.append(title);
    viewport.append(path);
  }
}

interface BoxActions {
  selected: string | null;
  relatedFiles: string[];
  color: (domain: string | null) => string;
  selectFile: (id: string) => void;
  openDirectory: (domain: string, path: string | null, relatedFiles: string[]) => void;
  hasDragged: () => boolean;
}

function drawBox(viewport: SVGGElement, box: Box, actions: BoxActions): void {
  const { selected, relatedFiles, color, selectFile, openDirectory, hasDragged } = actions;
  const active = selected === box.id;
  const related = relatedFiles.some(id => box.id === id
    || box.memberFileIds?.includes(id) || box.relatedFileIds?.includes(id));
  const fill = color(box.domain);
  const isDirectory = box.kind === 'directory';
  const node = svgEl('g', { class: `node${active ? ' selected' : ''}${isDirectory ? ' directory-node' : ''}${related ? ' related-file' : ''}`, 'data-id': box.id,
    role: 'button', tabindex: 0, 'aria-label': `${isDirectory ? `Open directory ${box.directoryPath ?? box.label}` : box.id}${related ? ', related file' : ''}` });
  node.append(svgEl('rect', { x: box.x, y: box.y, width: box.width, height: box.height, rx: 9,
    fill: active ? box.domain ? '#eff6ff' : '#f1f3f6' : '#fff', stroke: fill, 'stroke-width': active ? 3 : 1.2,
    class: 'node-card' }));
  if (box.domain) node.append(svgEl('rect', { x: box.x + 1, y: box.y + 10, width: 3, height: box.height - 20, rx: 1, fill }));
  const label = svgEl('text', { x: box.x + 16, y: box.y + 22,
    fill: '#17243b', 'font-size': 12, 'font-weight': 600, class: 'node-label' });
  label.textContent = box.label.length > 34 ? `${box.label.slice(0, 31)}…` : box.label;
  const subtitle = svgEl('text', { x: box.x + 16, y: box.y + 39,
    fill: '#718096', 'font-size': 9, class: 'node-subtitle' });
  subtitle.textContent = box.subtitle.length > 40 ? `…${box.subtitle.slice(-37)}` : box.subtitle;
  node.append(label, subtitle);
  const title = svgEl('title'); title.textContent = isDirectory
    ? `Open ${box.directoryPath ?? box.label}` : box.id;
  node.append(title);
  const activate = (): void => {
    if (isDirectory) openDirectory(box.domain ?? '', box.directoryPath ?? null, box.relatedFileIds ?? []);
    else selectFile(box.id);
  };
  node.addEventListener('click', () => { if (!hasDragged()) activate(); });
  node.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  });
  node.addEventListener('pointerenter', () => refreshEdgeHighlight(viewport));
  node.addEventListener('pointerleave', () => refreshEdgeHighlight(viewport));
  node.addEventListener('focus', () => refreshEdgeHighlight(viewport));
  node.addEventListener('blur', () => refreshEdgeHighlight(viewport));
  viewport.append(node);
}

function refreshEdgeHighlight(viewport: SVGGElement): void {
  const activeNode = viewport.querySelector<SVGGElement>('.node:hover, .node:focus');
  const activeId = activeNode?.dataset.id;
  for (const edge of viewport.querySelectorAll<SVGPathElement>('.edge')) {
    const connected = activeId !== undefined
      && (edge.dataset.source === activeId || edge.dataset.target === activeId);
    edge.classList.toggle('edge-highlighted', connected);
    edge.classList.toggle('edge-muted', activeId !== undefined && !connected);
  }
}
