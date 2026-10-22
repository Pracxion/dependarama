import type { ConfiguredDomain, ImportEdge, SourceFile, VisibleNode } from '../types/graph';

export interface DomainLayer {
  nodes: VisibleNode[];
  edges: ImportEdge[];
}

export function buildDomainLayer(
  files: SourceFile[],
  edges: ImportEdge[],
  domain: ConfiguredDomain,
  domains: ConfiguredDomain[],
  directory: string | null,
): DomainLayer {
  const packageNodes = new Map<string, VisibleNode>();
  const representativeByFile = new Map<string, string>();
  const nodes: VisibleNode[] = [];

  for (const file of files) {
    if (file.domain !== domain.name) {
      const owner = domains.find(candidate => candidate.name === file.domain);
      if (!owner) {
        const parentPath = parentDirectory(file.id);
        addPackage(file, null, parentPath || null, parentPath.split('/').at(-1) || 'Other files',
          packageNodes, representativeByFile);
        continue;
      }
      const relativePath = relativeToDomain(file.id, owner.path);
      const parentPath = relativePath?.split('/').slice(0, -1).join('/') ?? '';
      const label = parentPath.split('/').at(-1) || owner.name;
      addPackage(file, owner.name, parentPath || null, label, packageNodes, representativeByFile);
      continue;
    }

    const relativePath = relativeToDomain(file.id, domain.path);
    if (relativePath === null) continue;

    const localPath = pathInsideDirectory(relativePath, directory);
    if (localPath === null) {
      const parentPath = relativePath.split('/').slice(0, -1).join('/');
      const label = parentPath.split('/').at(-1) || domain.name;
      addPackage(file, domain.name, parentPath || null, label, packageNodes, representativeByFile);
      continue;
    }

    const slash = localPath.indexOf('/');
    if (slash < 0) {
      nodes.push(file);
      representativeByFile.set(file.id, file.id);
      continue;
    }

    const directoryName = localPath.slice(0, slash);
    const childPath = directory ? `${directory}/${directoryName}` : directoryName;
    addPackage(file, domain.name, childPath, directoryName, packageNodes, representativeByFile);
  }

  nodes.push(...packageNodes.values());
  const visibleIds = new Set(nodes.map(node => node.id));
  const mappedEdges: ImportEdge[] = [];
  const relatedFilesByPackage = new Map<string, Set<string>>();
  for (const edge of edges) {
    const source = representativeByFile.get(edge.source);
    const target = representativeByFile.get(edge.target);
    if (!source || !target || source === target || !visibleIds.has(source) || !visibleIds.has(target)) continue;
    mappedEdges.push({ ...edge, source, target });
    if (packageNodes.has(source)) addRelatedFile(relatedFilesByPackage, source, edge.source);
    if (packageNodes.has(target)) addRelatedFile(relatedFilesByPackage, target, edge.target);
  }
  for (const [id, relatedFiles] of relatedFilesByPackage) {
    packageNodes.get(id)!.relatedFileIds = [...relatedFiles];
  }
  return { nodes, edges: mappedEdges };
}

export function directoryExists(files: SourceFile[], domain: ConfiguredDomain | null, directory: string): boolean {
  return files.some(file => {
    if (domain === null) {
      return file.domain === null && normalizePath(file.id).startsWith(`${normalizePath(directory)}/`);
    }
    const relativePath = relativeToDomain(file.id, domain.path);
    return relativePath !== null && relativePath.startsWith(`${directory}/`);
  });
}

export function directoryId(domain: string | null, path: string): string {
  return `@directory:${JSON.stringify([domain, path])}`;
}

function addPackage(
  file: SourceFile,
  domain: string | null,
  path: string | null,
  label: string,
  packages: Map<string, VisibleNode>,
  representativeByFile: Map<string, string>,
): void {
  const id = directoryId(domain, path ?? '');
  let packageNode = packages.get(id);
  if (!packageNode) {
    packageNode = {
      id,
      domain,
      language: 'package',
      kind: 'directory',
      label,
      subtitle: 'directory',
      directoryPath: path ?? undefined,
      fileCount: 0,
      memberFileIds: [],
    };
    packages.set(id, packageNode);
  }
  packageNode.fileCount = (packageNode.fileCount ?? 0) + 1;
  packageNode.memberFileIds!.push(file.id);
  packageNode.subtitle = `${packageNode.fileCount} related file${packageNode.fileCount === 1 ? '' : 's'} · open directory`;
  representativeByFile.set(file.id, id);
}

function addRelatedFile(packages: Map<string, Set<string>>, packageId: string, fileId: string): void {
  const files = packages.get(packageId) ?? new Set<string>();
  files.add(fileId);
  packages.set(packageId, files);
}

export function relativeToDomain(filePath: string, domainPath: string): string | null {
  const normalizedFile = normalizePath(filePath);
  const normalizedDomain = normalizePath(domainPath);
  if (normalizedFile === normalizedDomain) return '';
  return normalizedFile.startsWith(`${normalizedDomain}/`)
    ? normalizedFile.slice(normalizedDomain.length + 1)
    : null;
}

function pathInsideDirectory(filePath: string, directory: string | null): string | null {
  if (!directory) return filePath;
  if (!filePath.startsWith(`${directory}/`)) return null;
  return filePath.slice(directory.length + 1);
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function parentDirectory(path: string): string {
  return normalizePath(path).split('/').slice(0, -1).join('/');
}
