import type { ProjectData } from './project-data';
import type { ViewerState } from '../types/viewer';
import { CanvasCamera } from '../graph/camera';
import { getRequiredElementById } from '../ui/dom';

export interface ControlActions {
  state: ViewerState;
  project: ProjectData;
  camera: CanvasCamera;
  render(): void;
  openDomain(domain: string): void;
}

export function bindControls(actions: ControlActions): void {
  const { state, project, camera, render, openDomain } = actions;
  getRequiredElementById<HTMLButtonElement>('domain-overview').onclick = () => {
    state.scope = null; state.selected = null; state.sourceOpen = false;
    state.directory = null; state.relatedFiles = []; render();
  };
  getRequiredElementById<HTMLButtonElement>('outside').onclick = () => {
    getRequiredElementById<HTMLInputElement>('show-outside').checked = true;
    openDomain('');
  };
  for (const id of ['show-outside', 'show-modules', 'cross-only']) {
    getRequiredElementById<HTMLInputElement>(id).addEventListener('change', () => {
      if (!getRequiredElementById<HTMLInputElement>('show-outside').checked
        && state.selected && !project.files.get(state.selected)?.domain) {
        state.selected = null;
        state.sourceOpen = false;
      }
      render();
    });
  }
  getRequiredElementById<HTMLInputElement>('layer-only').addEventListener('change', event => {
    state.layerOnly = (event.currentTarget as HTMLInputElement).checked;
    state.directory = null;
    state.relatedFiles = [];
    render();
  });
  getRequiredElementById<HTMLButtonElement>('fit').onclick = () => camera.fit();
  getRequiredElementById<HTMLButtonElement>('zoom-in').onclick = () => camera.zoomAt(1.25);
  getRequiredElementById<HTMLButtonElement>('zoom-out').onclick = () => camera.zoomAt(0.8);
}
