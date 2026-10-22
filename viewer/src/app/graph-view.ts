import { connections, fileLayout, group } from '../graph/layout';
import type { ImportEdge, Layout, VisibleNode } from '../types/graph';
import type { ViewerState } from '../types/viewer';
import { CanvasCamera } from '../graph/camera';
import { renderGraph } from '../graph/renderer';
import { renderInspector } from '../ui/inspector';
import { renderSourceWindow } from '../ui/source-window';
import { getRequiredElementById } from '../ui/dom';
import { updateNavigationState } from './navigation';
import type { ProjectData } from './project-data';
import { buildDomainLayer, relativeToDomain } from './domain-layer';

export interface GraphViewActions {
  currentEdges(): ImportEdge[];
  checked(elementId: string): boolean;
  selectFile(id: string): void;
  openDirectory(domain: string, path: string | null, relatedFiles?: string[]): void;
  render(resetCamera?: boolean): void;
}

export function renderGraphView(
  project: ProjectData,
  state: ViewerState,
  camera: CanvasCamera,
  svg: SVGSVGElement,
  viewport: SVGGElement,
  actions: GraphViewActions,
  resetCamera = true,
): Layout {
  const { graph, files, color, domains } = project;
  const { scope, selected, directory, layerOnly } = state;
  const allEdges = actions.currentEdges();
  let visibleEdges = allEdges;
  let inspectorEdges = allEdges;
  let visible: VisibleNode[] = graph.nodes
    .filter(file => actions.checked('show-outside') || file.domain !== null);

  if (scope !== null) {
    const scopedFiles = new Set(graph.nodes.filter(file => group(file) === scope).map(file => file.id));
    const outsideDirectory = scope === '' && layerOnly && directory !== null && !selected;
    const currentFiles = outsideDirectory
      ? new Set(graph.nodes.filter(file => file.domain === null && parentDirectory(file.id) === directory).map(file => file.id))
      : scope && layerOnly && directory !== null && !selected
        ? new Set(graph.nodes.filter(file => file.domain === scope && isWithinDirectory(file.id,
          domains.find(item => item.name === scope)?.path ?? '', directory)).map(file => file.id))
        : scopedFiles;
    inspectorEdges = allEdges.filter(edge => currentFiles.has(edge.source) || currentFiles.has(edge.target));
    visibleEdges = inspectorEdges;
    const relatedFiles = new Set(currentFiles);
    for (const edge of inspectorEdges) {
      relatedFiles.add(edge.source);
      relatedFiles.add(edge.target);
    }
    const relatedNodes = graph.nodes.filter(file => relatedFiles.has(file.id));
    const configuredDomain = domains.find(item => item.name === scope);
    if (outsideDirectory) {
      visible = graph.nodes.filter(file => currentFiles.has(file.id));
      visibleEdges = inspectorEdges.filter(edge => currentFiles.has(edge.source) && currentFiles.has(edge.target));
    } else if (configuredDomain && layerOnly && !selected) {
      const layer = buildDomainLayer(relatedNodes, visibleEdges, configuredDomain, domains, directory);
      visible = layer.nodes;
      visibleEdges = layer.edges;
    } else {
      visible = relatedNodes;
    }
  }

  if (selected) {
    const neighbors = connections(visibleEdges, selected);
    visible = visible.filter(file => neighbors.has(file.id));
  }
  const outsideDirectory = scope === '' && layerOnly && directory !== null && !selected;
  if (actions.checked('cross-only') && !outsideDirectory) {
    const involved = new Set(visibleEdges.flatMap(edge => [edge.source, edge.target]));
    visible = visible.filter(file => involved.has(file.id) || file.id === selected);
  }

  const layout = fileLayout(visible, visibleEdges,
    selected ? { id: selected, edges: visibleEdges } : undefined, domains);
  const relationshipCount = renderGraph({
    graph: svg, viewport, layout, visible, edges: visibleEdges, selected, color,
    selectFile: actions.selectFile,
    relatedFiles: state.relatedFiles,
    openDirectory: actions.openDirectory,
    hasDragged: () => camera.didDrag,
  });

  updateSummary(visible, relationshipCount);
  updateNavigationState(scope);
  renderCanvasHint(scope, layerOnly, directory, state.relatedFiles);
  renderPackageBreadcrumb(scope, layerOnly, directory, domains, actions.openDirectory);
  renderInspector({
    scope, selected, relatedFiles: state.relatedFiles, files, color,
    currentEdges: () => scope !== null ? inspectorEdges : actions.currentEdges(),
    selectFile: actions.selectFile,
    clearSelection: () => { state.selected = null; state.sourceOpen = false; actions.render(); },
  });
  renderSourceWindow(getRequiredElementById<HTMLDivElement>('source-window-host'),
    state.sourceOpen && selected ? files.get(selected) : undefined, () => {
      state.sourceOpen = false;
      actions.render(false);
    });
  if (resetCamera) camera.fit();
  return layout;
}

function updateSummary(visible: VisibleNode[], relationshipCount: number): void {
  getRequiredElementById('empty').hidden = visible.length > 0;
  const fileCount = visible.reduce((count, node) => count + (node.fileCount ?? 1), 0);
  const packageCount = visible.filter(node => node.kind === 'directory').length;
  getRequiredElementById('visible-count').textContent = `${fileCount} files${packageCount ? ` · ${packageCount} packages` : ''} · ${relationshipCount} connections shown`;
}

function renderCanvasHint(scope: string | null, layerOnly: boolean, directory: string | null, relatedFiles: string[]): void {
  getRequiredElementById('canvas-hint').textContent = scope !== null && layerOnly && directory !== null
    ? `Showing files in ${directory}${relatedFiles.length ? ` · ${relatedFiles.length} related file${relatedFiles.length === 1 ? '' : 's'} highlighted` : ''} · Click files to focus them`
    : scope !== null && scope !== '' && layerOnly
      ? 'Showing one directory layer · Click directories to drill down; click files to focus'
    : scope !== null
      ? 'Showing imports into and out of this group · Click a file to focus it, then click again to open source'
    : 'Drag to pan · Scroll to zoom · Click a file to focus it, then click again to open source';
}

function renderPackageBreadcrumb(
  scope: string | null,
  layerOnly: boolean,
  directory: string | null,
  domains: ProjectData['domains'],
  openDirectory: (domain: string, path: string | null, relatedFiles?: string[]) => void,
): void {
  const breadcrumb = getRequiredElementById<HTMLElement>('package-breadcrumb');
  breadcrumb.replaceChildren();
  breadcrumb.hidden = scope === null || !layerOnly || scope === '' && directory === null;
  if (breadcrumb.hidden || scope === null) return;

  const appendCrumb = (label: string, path: string | null, current = false): void => {
    if (breadcrumb.childElementCount) breadcrumb.append(document.createTextNode(' / '));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'package-crumb';
    button.textContent = label;
    button.disabled = current;
    button.onclick = () => openDirectory(scope, path, []);
    breadcrumb.append(button);
  };
  const domainPath = domains.find(domain => domain.name === scope)?.path;
  appendCrumb(scope === '' ? 'Other files' : scope, null, directory === null);
  if (directory) {
    const parts = directory.split('/');
    parts.forEach((part, index) => appendCrumb(part, parts.slice(0, index + 1).join('/'), index === parts.length - 1));
  }
  breadcrumb.setAttribute('aria-label', `${scope === '' ? 'Other files' : scope}${domainPath ? ` under ${domainPath}` : ''}${directory ? ` / ${directory}` : ''}`);
}

function isWithinDirectory(filePath: string, domainPath: string, directory: string): boolean {
  const relativePath = relativeToDomain(filePath, domainPath);
  return relativePath !== null && relativePath.startsWith(`${directory}/`);
}

function parentDirectory(path: string): string {
  return path.replaceAll('\\', '/').split('/').slice(0, -1).join('/');
}
