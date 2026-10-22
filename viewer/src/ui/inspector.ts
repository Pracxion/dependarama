import type { ImportEdge, SourceFile } from '../types/graph';
import { el, getRequiredElementById } from './dom';

export interface InspectorOptions {
  scope: string | null;
  selected: string | null;
  relatedFiles: string[];
  files: Map<string, SourceFile>;
  color: (domain: string | null) => string;
  currentEdges: () => ImportEdge[];
  selectFile: (id: string) => void;
  clearSelection: () => void;
}

export function renderInspector(options: InspectorOptions): void {
  const { scope, selected, relatedFiles, files, color, currentEdges, selectFile, clearSelection } = options;
  const panel = getRequiredElementById<HTMLElement>('inspector-content');
  panel.replaceChildren();
  const showingDomain = scope !== null;
  panel.append(el('div', 'nav-heading', selected ? 'FILE INSPECTOR'
    : showingDomain ? 'DOMAIN CONNECTIONS' : 'DOMAIN OVERVIEW'));

  if (!selected) {
    panel.append(
      el('div', 'inspector-symbol', '⇄'),
      el('h2', '', showingDomain ? scope || 'Outside configured domains' : 'Domain Overview'),
      el('p', 'muted', showingDomain
        ? 'The graph shows files or directory packages in this group. Incoming and outgoing links to other groups are listed below. Select a file to inspect its relationships.'
        : 'The file graph is grouped by configured domain. Arrows point from importer to imported file; the list below summarizes links between domains and other project files.'),
      el('div', 'note', 'Only files under configured domain paths are colored and clustered. Other files stay neutral.'),
      el('p', 'muted small', 'This is a dependency graph, so cycles and shared dependencies are shown as connections.'),
    );
    if (relatedFiles.length) renderRelatedFiles(panel, relatedFiles, files, currentEdges(), color, selectFile);
    if (showingDomain && scope !== null) {
      renderDomainConnections(panel, scope, files, currentEdges(), color, selectFile);
    } else {
      renderDomainOverviewConnections(panel, files, currentEdges(), color, selectFile);
    }
    return;
  }

  const file = files.get(selected);
  if (!file) return;
  const clear = el('button', 'text-button', '← Clear selection');
  clear.onclick = clearSelection;
  panel.append(clear);
  const badge = el('span', 'badge', file.domain || 'Outside configured domains');
  badge.style.color = color(file.domain);
  panel.append(badge);
  panel.append(el('h2', 'file-title', file.id.split('/').at(-1)), el('code', 'file-path', file.id));
  panel.append(el('p', 'muted small', `${file.language.toUpperCase()} source file`));

  const edges = currentEdges();
  for (const [outgoing, label] of [[true, 'Imports'], [false, 'Imported by']] as const) {
    const related = edges.filter(edge => (outgoing ? edge.source : edge.target) === selected);
    const groups = new Map<string, ImportEdge[]>();
    for (const edge of related) {
      const id = outgoing ? edge.target : edge.source;
      groups.set(id, [...(groups.get(id) ?? []), edge]);
    }
    panel.append(el('h3', '', `${label} · ${groups.size}`));
    if (!groups.size) panel.append(el('p', 'muted small', 'No relationships with the current filters.'));
    for (const [id, entries] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      const relatedFile = files.get(id);
      if (!relatedFile) continue;
      const button = el('button', 'relation');
      const dot = el('i');
      dot.style.background = color(relatedFile.domain);
      const name = el('span', 'relation-name', id.split('/').at(-1));
      name.prepend(dot);
      button.append(name, el('span', 'relation-path', id));
      button.onclick = () => selectFile(id);
      panel.append(button);
      const details = el('details', 'references');
      details.append(el('summary', '', 'Import locations'));
      for (const edge of entries) {
        for (const ref of edge.references) details.append(el('code', '', `${edge.source}:${ref.line}\n${ref.path}`));
        if (edge.kind === 'module') details.append(el('code', '', `${edge.source} · mod declaration`));
      }
      panel.append(details);
    }
  }
}

function renderRelatedFiles(
  panel: HTMLElement,
  relatedFiles: string[],
  files: Map<string, SourceFile>,
  edges: ImportEdge[],
  color: (domain: string | null) => string,
  selectFile: (id: string) => void,
): void {
  const entries = [...new Set(relatedFiles)].filter(id => files.has(id)).sort();
  if (!entries.length) return;
  panel.append(el('h3', '', `Files linked to the package you opened · ${entries.length}`));
  panel.append(el('p', 'muted small related-files-note', 'Highlighted in the graph. These are the exact files represented by the package connection.'));
  for (const id of entries) {
    const file = files.get(id)!;
    const button = el('button', 'relation related-file-entry');
    const name = el('span', 'relation-name', id.split('/').at(-1));
    const dot = el('i'); dot.style.background = color(file.domain); name.prepend(dot);
    button.append(name, el('span', 'relation-path', id));
    button.onclick = () => selectFile(id);
    panel.append(button);

    const connections = edges.filter(edge => edge.source === id || edge.target === id);
    const counterpartIds = [...new Set(connections.map(edge => edge.source === id ? edge.target : edge.source))].sort();
    for (const counterpartId of counterpartIds) {
      const counterpart = files.get(counterpartId);
      if (!counterpart) continue;
      const relation = connections.find(edge => edge.source === id && edge.target === counterpartId
        || edge.target === id && edge.source === counterpartId)!;
      const direction = relation.source === id ? 'imports' : 'imported by';
      panel.append(el('p', 'muted small related-file-context', `${id} ${direction} ${counterpartId}`));
    }
  }
}

function renderDomainOverviewConnections(
  panel: HTMLElement,
  files: Map<string, SourceFile>,
  edges: ImportEdge[],
  color: (domain: string | null) => string,
  selectFile: (id: string) => void,
): void {
  const pairs = new Map<string, { sourceDomain: string | null; targetDomain: string | null; edges: ImportEdge[] }>();
  for (const edge of edges) {
    const source = files.get(edge.source), target = files.get(edge.target);
    if (!source || !target || source.domain === target.domain) continue;
    const key = JSON.stringify([source.domain, target.domain]);
    const pair = pairs.get(key) ?? { sourceDomain: source.domain, targetDomain: target.domain, edges: [] };
    pair.edges.push(edge);
    pairs.set(key, pair);
  }

  panel.append(el('h3', '', `Domain connections · ${pairs.size}`));
  if (!pairs.size) {
    panel.append(el('p', 'muted small', 'No connections between domains and other project files match the current filters.'));
    return;
  }

  const orderedPairs = [...pairs.values()].sort((left, right) =>
    domainLabel(left.sourceDomain).localeCompare(domainLabel(right.sourceDomain))
      || domainLabel(left.targetDomain).localeCompare(domainLabel(right.targetDomain)));
  for (const pair of orderedPairs) {
    const details = el('details', 'references');
    details.append(el('summary', '', `${domainLabel(pair.sourceDomain)} → ${domainLabel(pair.targetDomain)} · ${pair.edges.length} links`));
    pair.edges.sort((left, right) => left.source.localeCompare(right.source) || left.target.localeCompare(right.target));
    for (const edge of pair.edges) {
      const button = el('button', 'relation');
      button.title = `${edge.source} → ${edge.target}`;
      const name = el('span', 'relation-name', `${edgeKindLabel(edge.kind)} · ${edge.source.split('/').at(-1)} → ${edge.target.split('/').at(-1)}`);
      const dot = el('i'); dot.style.background = color(pair.sourceDomain);
      name.prepend(dot);
      button.append(name, el('span', 'relation-path', `${edge.source} → ${edge.target}`));
      button.onclick = () => selectFile(edge.source);
      details.append(button);
    }
    panel.append(details);
  }
}

function domainLabel(domain: string | null): string {
  return domain ?? 'Outside configured domains';
}

function renderDomainConnections(
  panel: HTMLElement,
  scope: string,
  files: Map<string, SourceFile>,
  edges: ImportEdge[],
  color: (domain: string | null) => string,
  selectFile: (id: string) => void,
): void {
  const outgoing: ImportEdge[] = [];
  const incoming: ImportEdge[] = [];
  for (const edge of edges) {
    const source = files.get(edge.source), target = files.get(edge.target);
    if (!source || !target) continue;
    const sourceGroup = source.domain ?? '';
    const targetGroup = target.domain ?? '';
    if (sourceGroup === scope && targetGroup !== scope) outgoing.push(edge);
    if (sourceGroup !== scope && targetGroup === scope) incoming.push(edge);
  }

  panel.append(el('p', 'muted small', 'Arrow direction is importer → imported file.'));
  appendConnectionDetails(panel, 'Outgoing · this group imports from others', outgoing, files, color, selectFile, true);
  appendConnectionDetails(panel, 'Incoming · other groups import from here', incoming, files, color, selectFile, false);
}

function appendConnectionDetails(
  panel: HTMLElement,
  title: string,
  edges: ImportEdge[],
  files: Map<string, SourceFile>,
  color: (domain: string | null) => string,
  selectFile: (id: string) => void,
  outgoing: boolean,
): void {
  const importCount = edges.filter(edge => edge.kind === 'import').length;
  const reExportCount = edges.filter(edge => edge.kind === 're-export').length;
  const moduleCount = edges.filter(edge => edge.kind === 'module').length;
  const summary = `${title} · ${edges.length} links (${importCount} imports, ${reExportCount} re-exports${moduleCount ? `, ${moduleCount} module declarations` : ''})`;
  const details = el('details', 'references');
  details.append(el('summary', '', summary));
  if (!edges.length) details.append(el('p', 'muted small', 'No links in this direction.'));

  for (const edge of edges) {
    const externalId = outgoing ? edge.target : edge.source;
    const externalFile = files.get(externalId);
    if (!externalFile) continue;
    const button = el('button', 'relation');
    button.title = `${edge.source} → ${edge.target}`;
    const name = el('span', 'relation-name', `${edgeKindLabel(edge.kind)} · ${externalId.split('/').at(-1)}`);
    const dot = el('i'); dot.style.background = color(externalFile.domain);
    name.prepend(dot);
    const path = el('span', 'relation-path', `${edge.source} → ${edge.target}`);
    button.append(name, path);
    button.onclick = () => selectFile(externalId);
    details.append(button);
  }
  panel.append(details);
}

function edgeKindLabel(kind: ImportEdge['kind']): string {
  if (kind === 're-export') return 'Re-export';
  if (kind === 'module') return 'Module declaration';
  return 'Import';
}
