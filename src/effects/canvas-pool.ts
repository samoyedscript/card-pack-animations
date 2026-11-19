type CanvasKind = "packs";
type DrawingContext = WebGLRenderingContext | WebGL2RenderingContext;

// Safari can count released contexts until garbage collection. Keep one empty
// canvas per effect so repeated openings reuse contexts instead of exhausting
// that limit. Programs, textures, listeners and frames are disposed by callers.
// https://bugs.webkit.org/show_bug.cgi?id=218305
const idle = new Map<CanvasKind, { canvas: HTMLCanvasElement; context: DrawingContext }>();

export function acquireCanvas(kind: CanvasKind) {
  const previous = idle.get(kind);
  idle.delete(kind);
  if (previous && !previous.context.isContextLost()) return previous.canvas;
  return document.createElement("canvas");
}

export function releaseCanvas(kind: CanvasKind, canvas: HTMLCanvasElement, context: DrawingContext | null) {
  canvas.remove();
  canvas.width = canvas.height = 1;
  canvas.removeAttribute("style");
  if (!context || context.isContextLost()) return;
  const previous = idle.get(kind);
  if (previous && previous.canvas !== canvas && !previous.context.isContextLost()) {
    previous.context.getExtension("WEBGL_lose_context")?.loseContext();
  }
  idle.set(kind, { canvas, context });
}
