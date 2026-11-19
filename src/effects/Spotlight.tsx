import { useEffect, useState } from "react";
import { visibleTimeout } from "./visible-timeout";

/** A soft CSS spotlight; its introduction counts visible tab time only. */
export function Spotlight({ onIntroComplete }: { onIntroComplete: () => void }) {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setStarted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (started) return visibleTimeout(onIntroComplete, 300);
  }, [started, onIntroComplete]);
  return <div className="pack-spotlight" data-started={started || undefined} aria-hidden="true"><div /></div>;
}
