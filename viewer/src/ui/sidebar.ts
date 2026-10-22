import { getRequiredElementById } from './dom';

type SidebarSide = 'left' | 'right';
const STORAGE_PREFIX = 'dependency-atlas-sidebar-';

export function bindSidebarToggles(): void {
  const workspace = getRequiredElementById('workspace');
  bindSidebarToggle(workspace, 'left', 'left-sidebar', 'toggle-left-sidebar', 'Explorer');
  bindSidebarToggle(workspace, 'right', 'inspector', 'toggle-right-sidebar', 'Inspector');
}

function bindSidebarToggle(
  workspace: HTMLElement,
  side: SidebarSide,
  sidebarId: string,
  buttonId: string,
  label: string,
): void {
  const sidebar = getRequiredElementById<HTMLElement>(sidebarId);
  const button = getRequiredElementById<HTMLButtonElement>(buttonId);
  const collapsed = readCollapsed(side);
  setCollapsedState(workspace, sidebar, button, side, label, collapsed);
  button.addEventListener('click', () => {
    const next = !sidebar.classList.contains('is-collapsed');
    setCollapsedState(workspace, sidebar, button, side, label, next);
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${side}`, String(next));
    } catch {
      // The current page remains usable when storage is unavailable.
    }
  });
}

function setCollapsedState(
  workspace: HTMLElement,
  sidebar: HTMLElement,
  button: HTMLButtonElement,
  side: SidebarSide,
  label: string,
  collapsed: boolean,
): void {
  sidebar.classList.toggle('is-collapsed', collapsed);
  workspace.classList.toggle(`${side}-collapsed`, collapsed);
  button.textContent = side === 'left'
    ? collapsed ? '›' : '‹'
    : collapsed ? '‹' : '›';
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${label.toLowerCase()} sidebar`);
}

function readCollapsed(side: SidebarSide): boolean {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${side}`) === 'true';
  } catch {
    return false;
  }
}
