import { getRequiredElementById } from './dom';

const THEME_STORAGE_KEY = 'dependency-atlas-theme';
type Theme = 'light' | 'dark';

export function initializeTheme(): void {
  const stored = readStoredTheme();
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  applyTheme(stored ?? (prefersDark ? 'dark' : 'light'));
}

export function bindThemeToggle(): void {
  const button = getRequiredElementById<HTMLButtonElement>('theme-toggle');
  updateButton(button);
  button.addEventListener('click', () => {
    const next: Theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // The current page still switches themes when storage is unavailable.
    }
    updateButton(button);
  });
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

function updateButton(button: HTMLButtonElement): void {
  const isDark = document.documentElement.dataset.theme === 'dark';
  button.textContent = isDark ? '☀ Light' : '☾ Dark';
  button.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} mode`);
  button.setAttribute('aria-pressed', String(isDark));
}

function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}
