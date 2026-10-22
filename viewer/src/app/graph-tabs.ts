import type { GraphOption } from '../types/graph';
import { getRequiredElementById } from '../ui/dom';

export function bindGraphTabs(graphs: GraphOption[], activeId: string): void {
  const tabs = getRequiredElementById<HTMLElement>('graph-tabs');
  tabs.hidden = graphs.length < 2;
  if (graphs.length < 2) return;

  tabs.replaceChildren(...graphs.map(graph => {
    const tab = document.createElement('a');
    const url = new URL(window.location.href);
    url.searchParams.set('graph', graph.id);
    tab.href = `${url.pathname}${url.search}${url.hash}`;
    tab.className = 'graph-tab';
    tab.textContent = graph.name;
    if (graph.id === activeId) {
      tab.classList.add('active');
      tab.setAttribute('aria-current', 'page');
    }
    return tab;
  }));
}
