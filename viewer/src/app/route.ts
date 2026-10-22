import type { ProjectData } from './project-data';
import type { ViewerState } from '../types/viewer';
import { directoryExists } from './domain-layer';

export interface RouteFilters {
  showOutside: boolean;
  showModules: boolean;
  crossOnly: boolean;
}

export interface ParsedViewerRoute {
  state: ViewerState;
  filters: RouteFilters;
}

export function readViewerRoute(hash: string, defaults: ViewerState, project: ProjectData): ParsedViewerRoute {
  const state: ViewerState = { ...defaults, scope: null, selected: null, sourceOpen: false, directory: null, relatedFiles: [] };
  const filters: RouteFilters = {
    showOutside: true,
    showModules: false,
    crossOnly: false,
  };
  const queryIndex = hash.indexOf('?');
  const route = hash.slice(2, queryIndex < 0 ? undefined : queryIndex).split('/')[0];
  const params = new URLSearchParams(queryIndex < 0 ? '' : hash.slice(queryIndex + 1));

  state.layerOnly = params.has('layer') ? params.get('layer') !== '0' : defaults.layerOnly;

  // Accept existing shared domain links while keeping the viewer in its single file-graph mode.
  const domain = route === 'domains' ? params.get('name') : route === 'files' ? params.get('domain') : null;
  if (domain !== null && (domain === '' || project.domains.some(item => item.name === domain))) {
    state.scope = domain;
  }
  if (route === 'files') {
    const file = params.get('path');
    if (file && project.files.has(file)) {
      state.selected = file;
      state.sourceOpen = params.get('source') === '1';
    }
  }

  const directory = params.get('dir');
  const configuredDomain = project.domains.find(item => item.name === state.scope);
  if (!state.selected && state.layerOnly && state.scope !== null) {
    const validDirectory = !directory
      || (configuredDomain && directoryExists(project.graph.nodes, configuredDomain, directory))
      || (state.scope === '' && directoryExists(project.graph.nodes, null, directory));
    if (validDirectory) {
      state.directory = directory;
      state.relatedFiles = params.getAll('related').filter(id => {
        const file = project.files.get(id);
        if (!file || (file.domain ?? '') !== state.scope) return false;
        if (!directory) return true;
        if (state.scope === '') return id.replaceAll('\\', '/').startsWith(`${directory}/`);
        const domainPath = configuredDomain?.path.replaceAll('\\', '/').replace(/\/$/, '');
        return !!domainPath && id.replaceAll('\\', '/').startsWith(`${domainPath}/${directory}/`);
      });
    }
  }

  filters.showOutside = params.get('outside') !== '0';
  filters.showModules = params.get('modules') === '1';
  filters.crossOnly = params.get('cross') === '1';
  return { state, filters };
}

export function syncViewerRoute(
  state: ViewerState,
  filters: RouteFilters,
  method: 'push' | 'replace',
): void {
  const params = new URLSearchParams();
  if (state.scope !== null) params.set('domain', state.scope);
  if (!state.layerOnly) params.set('layer', '0');
  if (state.layerOnly && state.scope !== null && state.directory) params.set('dir', state.directory);
  if (state.layerOnly && state.scope !== null) {
    for (const file of state.relatedFiles) params.append('related', file);
  }
  if (state.selected) params.set('path', state.selected);
  if (state.selected && state.sourceOpen) params.set('source', '1');
  if (!filters.showOutside) params.set('outside', '0');
  if (filters.showModules) params.set('modules', '1');
  if (filters.crossOnly) params.set('cross', '1');
  const query = params.toString();
  const hash = `#/files${query ? `?${query}` : ''}`;
  if (window.location.hash === hash) return;
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  if (method === 'push') window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}
