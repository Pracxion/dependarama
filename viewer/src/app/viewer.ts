import { bindControls } from './controls';
import { renderGraphView } from './graph-view';
import { buildNavigation } from './navigation';
import { bindGraphTabs } from './graph-tabs';
import { loadProjectData } from './project-data';
import { readViewerRoute, syncViewerRoute, type RouteFilters } from './route';
import { CanvasCamera } from '../graph/camera';
import { bindDiagnostics } from '../ui/diagnostics';
import { getRequiredElementById } from '../ui/dom';
import { bindFileSearch } from '../ui/search';
import { renderShell } from '../ui/shell';
import { bindSidebarToggles } from '../ui/sidebar';
import { bindThemeToggle } from '../ui/theme';
import type { ImportEdge, Layout } from '../types/graph';
import type { ViewerState } from '../types/viewer';

export async function startViewer(): Promise<void> {
  const project = await loadProjectData();
  const { graph, files, domains, languages } = project;

  renderShell(getRequiredElementById<HTMLDivElement>('app'));
  bindGraphTabs(project.graphs, graph.id);
  bindSidebarToggles();
  bindThemeToggle();
  renderProjectSummary(graph.name, graph.nodes.length, languages.length, domains.length);

  const defaults: ViewerState = { scope: null, selected: null, sourceOpen: false, directory: null, layerOnly: true, relatedFiles: [] };
  const initialRoute = readViewerRoute(window.location.hash, defaults, project);
  const state = initialRoute.state;
  setRouteFilters(initialRoute.filters);
  setLayerOnly(state.layerOnly);
  let routeWriteMode: 'push' | 'replace' = 'replace';
  const svg = getRequiredElementById<SVGSVGElement>('graph');
  const viewport = getRequiredElementById<SVGGElement>('viewport');
  let layout: Layout = { boxes: [], clusters: [], width: 1000, height: 700 };
  const camera = new CanvasCamera(svg, viewport, () => layout, getRequiredElementById<HTMLDivElement>('canvas'));
  const checked = (id: string): boolean => getRequiredElementById<HTMLInputElement>(id).checked;
  const currentEdges = (): ImportEdge[] => graph.edges.filter(edge => {
    if (!checked('show-modules') && edge.kind === 'module') return false;
    const source = files.get(edge.source)!, target = files.get(edge.target)!;
    if (!checked('show-outside') && (!source.domain || !target.domain)) return false;
    return !checked('cross-only') || (!!source.domain && !!target.domain && source.domain !== target.domain);
  });

  function render(resetCamera = true): void {
    layout = renderGraphView(project, state, camera, svg, viewport, {
      currentEdges,
      checked,
      selectFile,
      openDirectory,
      render: (resetCamera = true) => render(resetCamera),
    }, resetCamera);
    syncViewerRoute(state, routeFilters(), routeWriteMode);
    routeWriteMode = 'push';
  }

  function openDomain(domain: string): void {
    state.scope = domain;
    state.selected = null;
    state.sourceOpen = false;
    state.directory = null;
    state.relatedFiles = [];
    getRequiredElementById('search-results').hidden = true;
    render();
  }

  function selectFile(id: string): void {
    const wasSelected = state.selected === id;
    state.selected = id;
    state.sourceOpen = wasSelected;
    state.scope = null;
    state.directory = null;
    state.relatedFiles = [];
    if (!files.get(id)?.domain) getRequiredElementById<HTMLInputElement>('show-outside').checked = true;
    getRequiredElementById('search-results').hidden = true;
    render();
  }

  function openDirectory(domain: string, directory: string | null, relatedFiles: string[] = []): void {
    state.scope = domain;
    state.directory = directory;
    state.selected = null;
    state.sourceOpen = false;
    state.relatedFiles = relatedFiles;
    render();
  }

  buildNavigation(project, { openDomain });
  bindControls({ state, project, camera, render, openDomain });
  bindFileSearch(graph, selectFile);
  bindDiagnostics(graph);
  const restoreRoute = (): void => {
    const route = readViewerRoute(window.location.hash, defaults, project);
    Object.assign(state, route.state);
    setRouteFilters(route.filters);
    setLayerOnly(state.layerOnly);
    getRequiredElementById('search-results').hidden = true;
    routeWriteMode = 'replace';
    render();
  };
  window.addEventListener('hashchange', restoreRoute);
  window.addEventListener('popstate', restoreRoute);
  render();
}

function routeFilters(): RouteFilters {
  return {
    showOutside: getRequiredElementById<HTMLInputElement>('show-outside').checked,
    showModules: getRequiredElementById<HTMLInputElement>('show-modules').checked,
    crossOnly: getRequiredElementById<HTMLInputElement>('cross-only').checked,
  };
}

function setRouteFilters(filters: RouteFilters): void {
  getRequiredElementById<HTMLInputElement>('show-outside').checked = filters.showOutside;
  getRequiredElementById<HTMLInputElement>('show-modules').checked = filters.showModules;
  getRequiredElementById<HTMLInputElement>('cross-only').checked = filters.crossOnly;
}

function setLayerOnly(layerOnly: boolean): void {
  getRequiredElementById<HTMLInputElement>('layer-only').checked = layerOnly;
}

function renderProjectSummary(name: string, files: number, languages: number, domains: number): void {
  getRequiredElementById('project-name').textContent = `${name} / source dependencies`;
  getRequiredElementById('totals').textContent = `${files} files  /  ${languages} languages  /  ${domains} domains`;
}
