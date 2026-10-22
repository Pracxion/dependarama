import type { DependencyGraph } from '../types/graph';
import { el, getRequiredElementById } from './dom';

export function bindDiagnostics(graph: DependencyGraph): void {
  const content = getRequiredElementById<HTMLDivElement>('scan-content');
  const dialog = getRequiredElementById<HTMLDialogElement>('scan-dialog');
  content.append(
    el('p', 'muted', graph.limitations),
    el('h3', '', `${graph.unresolved.length} unresolved local imports`),
  );
  for (const item of graph.unresolved) {
    content.append(el('code', 'diagnostic', `${item.file}:${item.line}\n${item.path}`));
  }
  for (const warning of graph.warnings) content.append(el('p', 'note', warning));
  getRequiredElementById<HTMLButtonElement>('diagnostics').onclick = () => dialog.showModal();
  getRequiredElementById<HTMLButtonElement>('close-dialog').onclick = () => dialog.close();
}
