import type { Layout } from '../types/graph';

export class CanvasCamera {
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private dragging = false;
  private dragDistance = 0;
  private lastX = 0;
  private lastY = 0;
  didDrag = false;

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly viewport: SVGGElement,
    private readonly getLayout: () => Layout,
    canvas: HTMLElement,
  ) {
    this.bindPointerEvents();
    this.svg.addEventListener('wheel', event => {
      event.preventDefault();
      const bounds = this.svg.getBoundingClientRect();
      this.zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - bounds.left, event.clientY - bounds.top);
    }, { passive: false });
    new ResizeObserver(() => this.fit()).observe(canvas);
  }

  fit(): void {
    const { width, height } = this.svg.getBoundingClientRect();
    const layout = this.getLayout();
    this.zoom = Math.max(0.02, Math.min(1.6, (width - 65) / layout.width, (height - 65) / layout.height));
    this.panX = (width - layout.width * this.zoom) / 2;
    this.panY = (height - layout.height * this.zoom) / 2;
    this.updateTransform();
  }

  zoomAt(factor: number, x = this.svg.clientWidth / 2, y = this.svg.clientHeight / 2): void {
    const next = Math.max(0.02, Math.min(4, this.zoom * factor));
    this.panX = x - (x - this.panX) * next / this.zoom;
    this.panY = y - (y - this.panY) * next / this.zoom;
    this.zoom = next;
    this.updateTransform();
  }

  private updateTransform(): void {
    this.viewport.setAttribute('transform', `translate(${this.panX},${this.panY}) scale(${this.zoom})`);
    const label = document.querySelector<HTMLElement>('#zoom-level');
    if (label) label.textContent = `${Math.round(this.zoom * 100)}%`;
  }

  private bindPointerEvents(): void {
    this.svg.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      this.dragging = true;
      this.didDrag = false;
      this.dragDistance = 0;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      // Capture on the initial target so clicking a file still triggers its button.
      (event.target as Element).setPointerCapture(event.pointerId);
    });
    this.svg.addEventListener('pointermove', event => {
      if (!this.dragging) return;
      const dx = event.clientX - this.lastX, dy = event.clientY - this.lastY;
      this.dragDistance += Math.abs(dx) + Math.abs(dy);
      this.didDrag = this.dragDistance > 5;
      if (this.didDrag) {
        this.panX += dx;
        this.panY += dy;
        this.updateTransform();
      }
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    });
    this.svg.addEventListener('pointerup', () => { this.dragging = false; });
    this.svg.addEventListener('pointercancel', () => { this.dragging = false; });
  }
}
