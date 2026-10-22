import type { DependencyGraph } from '../types/graph';
import { el, getRequiredElementById } from './dom';

export function bindFileSearch(graph: DependencyGraph, selectFile: (id: string) => void): void {
  const search = getRequiredElementById<HTMLInputElement>('search');
  const results = getRequiredElementById<HTMLDivElement>('search-results');
  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    results.replaceChildren();
    results.hidden = !query;
    if (!query) return;

    const matches = graph.nodes.filter(file => file.id.toLowerCase().includes(query));
    results.append(el('div', 'search-count', `${matches.length} matching files`));
    for (const file of matches.slice(0, 60)) {
      const button = el('button', 'search-result');
      button.append(el('strong', '', file.id.split('/').at(-1)), el('span', '', file.id));
      button.onclick = () => selectFile(file.id);
      results.append(button);
    }
    if (matches.length > 60) results.append(el('p', 'muted small', 'Type more to narrow the results.'));
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') results.hidden = true;
    if (event.key === '/' && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      search.focus();
    }
  });
}
