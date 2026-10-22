export interface SourceFile {
  id: string;
  domain: string | null;
  language: string;
  content?: string;
}

export interface VisibleNode extends SourceFile {
  kind?: 'file' | 'directory';
  label?: string;
  subtitle?: string;
  directoryPath?: string;
  fileCount?: number;
  memberFileIds?: string[];
  relatedFileIds?: string[];
}

export interface ImportReference {
  line: number;
  path: string;
}

export interface ImportEdge {
  source: string;
  target: string;
  kind: 'import' | 're-export' | 'module';
  references: ImportReference[];
}

export interface UnresolvedImport {
  file: string;
  line: number;
  path: string;
}

export interface ConfiguredDomain {
  name: string;
  path: string;
}

export interface DependencyGraph {
  id: string;
  name: string;
  group?: string | null;
  domains: ConfiguredDomain[];
  nodes: SourceFile[];
  edges: ImportEdge[];
  unresolved: UnresolvedImport[];
  warnings: string[];
  limitations: string;
}

export interface GraphOption {
  id: string;
  name: string;
  group?: string | null;
}

export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  subtitle: string;
  domain: string | null;
  kind?: 'file' | 'directory';
  directoryPath?: string;
  memberFileIds?: string[];
  relatedFileIds?: string[];
}

export interface Layout {
  boxes: Box[];
  clusters: Box[];
  width: number;
  height: number;
}
