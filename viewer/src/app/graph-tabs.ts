import type { GraphOption } from '../types/graph';
import { getRequiredElementById } from '../ui/dom';

export function bindGraphTabs(graphs: GraphOption[], activeId: string): void {
  const tabs = getRequiredElementById<HTMLElement>('graph-tabs');
  tabs.hidden = graphs.length < 2;
  if (graphs.length < 2) return;

  const groups = new Map<string, { label: string | null; graphs: GraphOption[] }>();
  for (const graph of graphs) {
    const label = graph.group?.trim() || null;
    const key = label ?? `graph:${graph.id}`;
    const group = groups.get(key) ?? { label, graphs: [] };
    group.graphs.push(graph);
    groups.set(key, group);
  }

  tabs.replaceChildren(...[...groups.values()].map(group => {
    if (group.label) {
      const container = document.createElement('label');
      container.className = 'graph-group-dropdown';
      container.append(element('span', 'graph-tab-group-label', group.label));

      const select = document.createElement('select');
      select.className = 'graph-group-select';
      select.setAttribute('aria-label', `${group.label} graphs`);
      const options = document.createElement('optgroup');
      options.label = group.label;
      for (const graph of group.graphs) {
        const option = document.createElement('option');
        option.value = graph.id;
        option.textContent = graph.name;
        option.selected = graph.id === activeId;
        options.append(option);
      }
      select.append(options);
      select.addEventListener('change', () => {
        const url = new URL(window.location.href);
        url.searchParams.set('graph', select.value);
        window.location.assign(url.href);
      });
      container.append(select);
      return container;
    }

    const container = document.createElement('div');
    container.className = 'graph-tab-group';
    for (const graph of group.graphs) {
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
      container.append(tab);
    }
    return container;
  }));
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  item.className = className;
  item.textContent = text;
  return item;
}
