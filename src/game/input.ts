export class InputController {
  private readonly keyDown = new Set<string>();
  private readonly keyPressed = new Set<string>();
  private readonly mouseDown = new Set<number>();
  private readonly mousePressed = new Set<number>();
  private lookDeltaX = 0;
  private lookDeltaY = 0;
  private wheelSteps = 0;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.bindEvents();
  }

  isKeyDown(code: string): boolean {
    return this.keyDown.has(code);
  }

  wasKeyPressed(code: string): boolean {
    return this.keyPressed.has(code);
  }

  isMouseDown(button: number): boolean {
    return this.mouseDown.has(button);
  }

  wasMousePressed(button: number): boolean {
    return this.mousePressed.has(button);
  }

  isPointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  consumeLookDelta(): { dx: number; dy: number } {
    const dx = this.lookDeltaX;
    const dy = this.lookDeltaY;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    return { dx, dy };
  }

  consumeWheelSteps(): number {
    const steps = this.wheelSteps;
    this.wheelSteps = 0;
    return steps;
  }

  endFrame(): void {
    this.keyPressed.clear();
    this.mousePressed.clear();
  }

  private bindEvents(): void {
    this.canvas.addEventListener("click", () => {
      if (!this.isPointerLocked()) {
        void this.canvas.requestPointerLock();
      }
    });

    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    window.addEventListener("keydown", (event) => {
      if (!this.keyDown.has(event.code)) {
        this.keyPressed.add(event.code);
      }
      this.keyDown.add(event.code);
      if (event.code === "Tab") {
        event.preventDefault();
      }
    });

    window.addEventListener("keyup", (event) => {
      this.keyDown.delete(event.code);
    });

    window.addEventListener("mousedown", (event) => {
      if (!this.mouseDown.has(event.button)) {
        this.mousePressed.add(event.button);
      }
      this.mouseDown.add(event.button);
    });

    window.addEventListener("mouseup", (event) => {
      this.mouseDown.delete(event.button);
    });

    window.addEventListener("mousemove", (event) => {
      if (!this.isPointerLocked()) {
        return;
      }
      this.lookDeltaX += event.movementX;
      this.lookDeltaY += event.movementY;
    });

    window.addEventListener(
      "wheel",
      (event) => {
        if (!this.isPointerLocked()) {
          return;
        }
        this.wheelSteps += Math.sign(event.deltaY);
      },
      { passive: true }
    );
  }
}
