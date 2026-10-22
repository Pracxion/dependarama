import type { SourceFile } from '../types/graph';
import { el } from './dom';

export function renderSourceWindow(host: HTMLElement, file: SourceFile | undefined, onClose: () => void): void {
  host.replaceChildren();
  host.hidden = !file;
  if (!file) return;

  const overlay = el('div', 'source-window-overlay');
  overlay.addEventListener('click', event => {
    if (event.target === overlay) onClose();
  });

  const window = el('section', 'source-window');
  window.setAttribute('role', 'dialog');
  window.setAttribute('aria-modal', 'true');
  window.setAttribute('aria-labelledby', 'source-window-title');

  const titlebar = el('div', 'source-window-titlebar');
  const lights = el('span', 'source-window-lights');
  lights.setAttribute('aria-hidden', 'true');
  lights.append(el('i'), el('i'), el('i'));
  const title = el('strong', '', file.id.split('/').at(-1) ?? file.id);
  title.id = 'source-window-title';
  const close = el('button', 'source-window-close', '×');
  close.setAttribute('type', 'button');
  close.setAttribute('aria-label', 'Close source window');
  close.onclick = onClose;
  titlebar.append(lights, title, close);

  const fileInfo = el('div', 'source-window-file-info');
  fileInfo.append(el('code', '', file.id), el('span', '', file.language.toUpperCase()));

  const content = file.content;
  if (content === undefined) {
    fileInfo.append(el('span', 'source-line-count', 'Source unavailable'));
    window.append(titlebar, fileInfo, el('p', 'source-unavailable', 'Source text is not available in this graph. Regenerate the graph to include it.'));
  } else {
    const lines = content.split(/\r\n|\n|\r/);
    if (content.endsWith('\n') || content.endsWith('\r')) lines.pop();
    fileInfo.append(el('span', 'source-line-count', `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`));

    const pre = el('pre', 'source-code');
    pre.setAttribute('aria-label', `Source code for ${file.id}`);
    const code = el('code');
    for (const [index, text] of lines.entries()) {
      const line = el('span', 'source-line');
      line.append(el('span', 'source-line-number', String(index + 1)));
      line.append(el('span', 'source-line-content', text || ' '));
      code.append(line);
    }
    pre.append(code);
    window.append(titlebar, fileInfo, pre);
  }

  overlay.append(window);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') onClose();
  });
  host.append(overlay);
  close.focus();
}
