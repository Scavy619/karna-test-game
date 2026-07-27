/**
 * RTS input: camera keys + raw pointer events. Game logic subscribes to
 * pointer callbacks (SelectionSystem); the camera reads the key axes.
 */
type PointerCb = (x: number, y: number) => void;
type SimpleCb = () => void;

export class Input {
  private keys = new Set<string>();
  private wheelAccum = 0;

  pointerX = 0;
  pointerY = 0;

  private leftDownCbs: PointerCb[] = [];
  private leftUpCbs: PointerCb[] = [];
  private rightDownCbs: PointerCb[] = [];
  private moveCbs: PointerCb[] = [];
  private cancelCbs: SimpleCb[] = [];

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.cancelCbs.forEach((cb) => cb());
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('pointerdown', (e) => {
      this.pointerX = e.offsetX;
      this.pointerY = e.offsetY;
      if (e.button === 0) this.leftDownCbs.forEach((cb) => cb(e.offsetX, e.offsetY));
      if (e.button === 2) this.rightDownCbs.forEach((cb) => cb(e.offsetX, e.offsetY));
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.leftUpCbs.forEach((cb) => cb(e.offsetX, e.offsetY));
    });
    canvas.addEventListener('pointermove', (e) => {
      this.pointerX = e.offsetX;
      this.pointerY = e.offsetY;
      this.moveCbs.forEach((cb) => cb(e.offsetX, e.offsetY));
    });
    canvas.addEventListener('wheel', (e) => {
      this.wheelAccum += e.deltaY;
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(key: string): boolean {
    return this.keys.has(key);
  }

  /** -1 left .. +1 right (camera pan) */
  get panX(): number {
    return (this.isDown('d') || this.isDown('arrowright') ? 1 : 0) -
           (this.isDown('a') || this.isDown('arrowleft') ? 1 : 0);
  }

  /** -1 back .. +1 forward (camera pan) */
  get panZ(): number {
    return (this.isDown('w') || this.isDown('arrowup') ? 1 : 0) -
           (this.isDown('s') || this.isDown('arrowdown') ? 1 : 0);
  }

  /** -1 (q) .. +1 (e) camera rotation */
  get rotateDir(): number {
    return (this.isDown('e') ? 1 : 0) - (this.isDown('q') ? 1 : 0);
  }

  /** Returns and clears accumulated wheel delta. */
  consumeWheel(): number {
    const v = this.wheelAccum;
    this.wheelAccum = 0;
    return v;
  }

  onLeftDown(cb: PointerCb): void { this.leftDownCbs.push(cb); }
  onLeftUp(cb: PointerCb): void { this.leftUpCbs.push(cb); }
  onRightDown(cb: PointerCb): void { this.rightDownCbs.push(cb); }
  onPointerMove(cb: PointerCb): void { this.moveCbs.push(cb); }
  onCancel(cb: SimpleCb): void { this.cancelCbs.push(cb); }
}
