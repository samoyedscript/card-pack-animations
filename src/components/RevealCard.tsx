import { useRef, type PointerEvent } from "react";

/** A single image with restrained, monochrome pointer lighting. */
export function RevealCard({ image, alt }: { image: string; alt: string }) {
  const face = useRef<HTMLDivElement>(null);
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || !face.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const style = face.current.style;
    style.setProperty("--tilt-x", `${(0.5 - y) * 24}deg`);
    style.setProperty("--tilt-y", `${(x - 0.5) * 24}deg`);
    style.setProperty("--glare-x", `${x * 100}%`);
    style.setProperty("--glare-y", `${y * 100}%`);
    style.setProperty("--glare", "0.3");
  }
  function release() {
    const style = face.current?.style;
    style?.setProperty("--tilt-x", "0deg");
    style?.setProperty("--tilt-y", "0deg");
    style?.setProperty("--glare", "0");
  }
  return <div className="reveal-card" onPointerMove={move} onPointerLeave={release} onPointerUp={release} onPointerCancel={release}>
    <div ref={face} className="reveal-card__face">
      <img src={image} alt={alt} draggable={false} />
      <span className="reveal-card__glare" aria-hidden="true" />
    </div>
  </div>;
}
