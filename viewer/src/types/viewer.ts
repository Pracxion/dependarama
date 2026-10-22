export interface ViewerState {
  scope: string | null;
  selected: string | null;
  sourceOpen: boolean;
  directory: string | null;
  layerOnly: boolean;
  relatedFiles: string[];
}
