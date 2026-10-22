import type { ProjectData } from './project-data';
import { el, getRequiredElementById } from '../ui/dom';

export interface NavigationActions {
  openDomain(domain: string): void;
}

export function buildNavigation(project: ProjectData, actions: NavigationActions): void {
  const { graph, domains } = project;
  getRequiredElementById('domain-overview-count').textContent = String(domains.length);
  getRequiredElementById('outside-count').textContent = String(graph.nodes.filter(file => !file.domain).length);
  getRequiredElementById<HTMLDivElement>('configured-domains-section').hidden = domains.length === 0;
  const domainsList = getRequiredElementById<HTMLDivElement>('domains');

  for (const domain of domains) {
    const button = el('button', 'domain-button');
    button.dataset.domain = domain.name;
    button.title = domain.path;
    const name = el('span');
    const dot = el('i'); dot.style.background = project.color(domain.name);
    const label = el('span', 'domain-label');
    label.append(el('span', 'domain-name', domain.name), el('span', 'domain-path', domain.path));
    name.append(dot, label);
    button.append(name, el('span', 'count', String(graph.nodes.filter(file => file.domain === domain.name).length)));
    button.onclick = () => actions.openDomain(domain.name);
    domainsList.append(button);
  }
}

export function updateNavigationState(scope: string | null): void {
  getRequiredElementById('domain-overview').classList.toggle('active', scope === null);
  getRequiredElementById('outside').classList.toggle('active', scope === '');
  for (const button of document.querySelectorAll<HTMLElement>('[data-domain].domain-button')) {
    button.classList.toggle('active', button.dataset.domain === scope);
  }
}
