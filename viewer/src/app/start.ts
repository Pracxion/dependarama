import { el, getRequiredElementById } from '../ui/dom';
import { startViewer } from './viewer';

export async function startApp(): Promise<void> {
  try {
    await startViewer();
  } catch (error) {
    const app = getRequiredElementById<HTMLDivElement>('app');
    app.replaceChildren();
    app.append(el('div', 'error', error instanceof Error ? error.message : String(error)));
  }
}
