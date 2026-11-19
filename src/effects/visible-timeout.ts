// Count foreground time only, so returning to a backgrounded tab cannot skip
// a reveal beat. The returned cleanup also removes the visibility listener.
export function visibleTimeout(callback: () => void, duration: number) {
  let remaining = duration;
  let started = 0;
  let timer: number | undefined;
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", visibility);
  };
  const schedule = () => {
    if (cancelled || document.hidden || timer !== undefined) return;
    started = performance.now();
    timer = window.setTimeout(() => {
      cancel();
      callback();
    }, remaining);
  };
  const visibility = () => {
    if (document.hidden) {
      if (timer !== undefined) remaining = Math.max(0, remaining - (performance.now() - started));
      window.clearTimeout(timer);
      timer = undefined;
    } else schedule();
  };
  document.addEventListener("visibilitychange", visibility);
  schedule();
  return cancel;
}
