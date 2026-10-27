// Map camera: world units <-> screen pixels, pan/zoom, DPR-aware resize.
// Adapted from rts-mons/web/src/render.js `View` (top-down mode only) and the
// wheel/drag handling in rts-mons/web/src/battle.js.

export class Camera {
  readonly cv: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** world coordinate at the screen's top-left */
  x = 0;
  y = 0;
  /** screen px per world unit */
  zoom = 1;
  vw = 0;
  vh = 0;
  dpr = 1;
  worldW = 1;
  worldH = 1;
  onChange: () => void = () => {};
  private ro?: ResizeObserver;

  constructor(canvas: HTMLCanvasElement) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  setWorld(w: number, h: number): void {
    this.worldW = w;
    this.worldH = h;
    this.fit();
  }

  get minZoom(): number {
    return Math.min(Math.max(200, this.vw - this.insetRight) / this.worldW, this.vh / this.worldH) * (this.tight ? 0.95 : 0.9);
  }

  /** fit with a thin margin instead of the roomy one */
  tight = false;

  get maxZoom(): number {
    return this.minZoom * 8;
  }

  /**
   * Fast play: the map is drawn at one pixel per screen point (not two). Each redrawn map has to be copied
   * out whole for display, and on a sharp screen that copy, not the drawing, kept taps waiting.
   */
  lowRes = false;

  resize(): void {
    const r = this.cv.getBoundingClientRect();
    const dpr = this.lowRes ? 1 : Math.min(2, window.devicePixelRatio || 1);
    // Measuring before layout yields 0; fall back to the parent so we never stay blank.
    const w = r.width || this.cv.parentElement?.clientWidth || 960;
    const h = r.height || this.cv.parentElement?.clientHeight || 600;
    this.cv.width = Math.floor(w * dpr);
    this.cv.height = Math.floor(h * dpr);
    this.dpr = dpr;
    this.vw = w;
    this.vh = h;
    if (!this.ro && 'ResizeObserver' in window) {
      this.ro = new ResizeObserver(() => {
        const b = this.cv.getBoundingClientRect();
        if (b.width && (Math.abs(b.width - this.vw) > 1 || Math.abs(b.height - this.vh) > 1)) this.resize();
      });
      this.ro.observe(this.cv);
    }
    this.clamp();
    this.onChange();
  }

  /** screen px on the right covered by a side panel (kept clear by fit) */
  insetRight = 0;

  fit(): void {
    const availW = Math.max(200, this.vw - this.insetRight);
    // tight: keep only a thin margin so the board is as large as possible (battle map)
    this.zoom = this.tight
      ? Math.max(this.minZoom, Math.min((availW - 8) / this.worldW, (this.vh - 8) / this.worldH))
      : Math.max(this.minZoom, Math.min(availW / this.worldW, (this.vh - (this.vh > 600 ? 80 : 20)) / this.worldH) * 0.97);
    this.x = this.worldW / 2 - availW / 2 / this.zoom;
    this.y = this.worldH / 2 - this.vh / 2 / this.zoom;
    this.onChange();
  }

  toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.x) * this.zoom, (wy - this.y) * this.zoom];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [sx / this.zoom + this.x, sy / this.zoom + this.y];
  }

  centerOn(wx: number, wy: number): void {
    this.x = wx - this.vw / 2 / this.zoom;
    this.y = wy - this.vh / 2 / this.zoom;
    this.clamp();
    this.onChange();
  }

  panBy(dsx: number, dsy: number): void {
    this.x -= dsx / this.zoom;
    this.y -= dsy / this.zoom;
    this.clamp();
    this.onChange();
  }

  /** zoom by factor keeping the world point under (sx,sy) fixed */
  zoomAt(sx: number, sy: number, factor: number): void {
    const [wx, wy] = this.toWorld(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    this.x = wx - sx / this.zoom;
    this.y = wy - sy / this.zoom;
    this.clamp();
    this.onChange();
  }

  /** keep the map on screen; centre it when it is smaller than the view */
  clamp(): void {
    const vwW = this.vw / this.zoom, vhW = this.vh / this.zoom;
    const pad = 40 / this.zoom;
    const availW = (this.vw - this.insetRight) / this.zoom;
    if (availW >= this.worldW) this.x = (this.worldW - availW) / 2;
    else if (vwW >= this.worldW) this.x = Math.max(this.worldW - vwW, Math.min(0, this.x));
    else this.x = Math.max(-pad, Math.min(this.worldW - vwW + pad, this.x));
    if (vhW >= this.worldH) this.y = (this.worldH - vhW) / 2;
    else this.y = Math.max(-pad, Math.min(this.worldH - vhW + pad, this.y));
  }

  private flight = 0;

  /** smooth move so that (wx,wy) ends at the centre of the free area, at zoom z */
  flyTo(wx: number, wy: number, z: number, ms = 1800): void {
    cancelAnimationFrame(this.flight);
    const z0 = this.zoom;
    const z1 = Math.max(this.minZoom, Math.min(this.maxZoom, z));
    const availW = this.vw - this.insetRight;
    const c0x = this.x + availW / 2 / z0, c0y = this.y + this.vh / 2 / z0;
    const t0 = performance.now();
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      const e = ease(t);
      // zoom out a little mid-flight for long hops
      const z = z0 + (z1 - z0) * e;
      const cx = c0x + (wx - c0x) * e, cy = c0y + (wy - c0y) * e;
      this.zoom = z;
      this.x = cx - availW / 2 / z;
      this.y = cy - this.vh / 2 / z;
      this.clamp();
      this.onChange();
      if (t < 1) this.flight = requestAnimationFrame(tick);
    };
    this.flight = requestAnimationFrame(tick);
  }

  /** visible world rectangle [x0,y0,x1,y1] */
  visible(): [number, number, number, number] {
    return [this.x, this.y, this.x + this.vw / this.zoom, this.y + this.vh / this.zoom];
  }

  /** mouse wheel zoom, drag pan (left or middle button), pinch zoom */
  attachInput(onHover?: (sx: number, sy: number) => void, onClick?: (sx: number, sy: number, touch: boolean) => void): void {
    const cv = this.cv;
    let drag: { x: number; y: number; moved: number } | null = null;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = Math.pow(1.0015, -e.deltaY);
      this.zoomAt(e.offsetX, e.offsetY, step);
    }, { passive: false });

    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pointers.size === 1 && (e.button === 0 || e.button === 1)) drag = { x: e.clientX, y: e.clientY, moved: 0 };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        drag = null;
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
        pinchDist = d;
        return;
      }
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        drag.x = e.clientX; drag.y = e.clientY;
        this.panBy(dx, dy);
        cv.style.cursor = 'grabbing';
      } else if (onHover) {
        onHover(e.offsetX, e.offsetY);
      }
    });
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      // fingers wobble: allow a little movement in a tap
      if (drag && e.type === 'pointerup' && drag.moved < (e.pointerType === 'mouse' ? 4 : 12) && onClick) onClick(e.offsetX, e.offsetY, e.pointerType !== 'mouse');
      drag = null;
      pinchDist = 0;
      cv.style.cursor = '';
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }
}
