import type { ConfiguredDomain, DependencyGraph, GraphOption, SourceFile } from '../types/graph';

const DOMAIN_PALETTE = [
  '#2563eb', '#7c3aed', '#db2777', '#c2410c', '#b58508',
  '#15803d', '#0f766e', '#0284c7', '#9333ea',
  '#4f46e5', '#be123c', '#ea580c', '#a16207', '#65a30d',
  '#059669', '#0e7490', '#1d4ed8', '#c026d3', '#e11d48',
  '#854d0e', '#4d7c0f', '#64748b', '#6d28d9', '#9f1239',
];

export interface ProjectData {
  graph: DependencyGraph;
  graphs: GraphOption[];
  files: Map<string, SourceFile>;
  domains: ConfiguredDomain[];
  languages: string[];
  color(domain: string | null): string;
}
export async function loadProjectData(): Promise<ProjectData> {
  const response = await fetch(`${import.meta.env.BASE_URL}graph.json`, { cache: 'no-store' });
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
    throw new Error('Graph data is missing. Run “just generate” from the repository root, then reload.');
  }
  const data = await response.json() as unknown;
  const graphs = readGraphs(data);
  const selectedId = new URLSearchParams(window.location.search).get('graph');
  const graph = graphs.find(candidate => candidate.id === selectedId) ?? graphs[0]!;

  const files = new Map(graph.nodes.map(file => [file.id, file]));
  const languages = [...new Set(graph.nodes.map(file => file.language))].sort();

  return {
    graph,
    graphs: graphs.map(({ id, name }) => ({ id, name })),
    files,
    domains: graph.domains,
    languages,
    color: domain => domain ? domainColor(domain, graph.domains.findIndex(item => item.name === domain)) : '#8793a5',
  };
}

function readGraphs(data: unknown): DependencyGraph[] {
  const candidates = isRecord(data) && Array.isArray(data.graphs)
    ? data.graphs
    : [data];
  if (candidates.length === 0) throw new Error('Invalid graph.json: expected at least one graph.');

  return candidates.map((candidate, index) => {
    if (!isRecord(candidate) || !Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)
      || !Array.isArray(candidate.domains)) {
      throw new Error('Invalid graph.json: each graph must include nodes, edges, and domains arrays.');
    }
    const name = typeof candidate.name === 'string' && candidate.name.trim()
      ? candidate.name
      : `Graph ${index + 1}`;
    const id = typeof candidate.id === 'string' && candidate.id.trim()
      ? candidate.id
      : slug(name, index);
    return { ...candidate, id, name } as unknown as DependencyGraph;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function slug(name: string, index: number): string {
  const value = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return value || `graph-${index + 1}`;
}

function domainColor(domain: string, index: number): string {
  if (index >= 0 && index < DOMAIN_PALETTE.length) return DOMAIN_PALETTE[index]!;

  const hash = [...domain].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 7);
  const hue = index >= 0 ? (index * 137.508) % 360 : hash % 360;
  const lightness = [39, 45, 42, 36][hash % 4];
  return `hsl(${hue.toFixed(1)} 70% ${lightness}%)`;
}
