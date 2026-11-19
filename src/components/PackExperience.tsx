import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import PackScene, { type PackBounds, type PackSceneHandle } from "./pack-scene";
import { RevealCard } from "./RevealCard";
import { Spotlight } from "../effects/Spotlight";
import { visibleTimeout } from "../effects/visible-timeout";
import "./pack-experience.css";

export interface PackExperienceProps {
  packFront: string;
  packBack: string;
  card: { image: string; alt: string };
}

type Phase = "browsing" | "selecting" | "selected" | "tearing" | "rip-delay" | "rays" | "revealed" | "error";

function Arrow() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
}

export function PackExperience({ packFront, packBack, card }: PackExperienceProps) {
  const [phase, setPhase] = useState<Phase>("browsing");
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [tear, setTear] = useState(0);
  const [packExiting, setPackExiting] = useState(false);
  const [bounds, setBounds] = useState<PackBounds | null>(null);
  const [fallback, setFallback] = useState(false);
  const [ready, setReady] = useState(false);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [image, setImage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [raysIntroDone, setRaysIntroDone] = useState(false);
  const [revealReady, setRevealReady] = useState(false);
  const root = useRef<HTMLElement>(null);
  const controls = useRef<PackSceneHandle>(null);
  const tearTarget = useRef<HTMLButtonElement>(null);
  const closeTarget = useRef<HTMLButtonElement>(null);
  const imageURL = useRef<string | null>(null);
  const drawing = useRef(false);
  const restoreFocus = useRef(false);
  const tearGesture = useRef<{ id: number; start: number; width: number } | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const helpId = useId();
  const tearHintId = useId();
  const immersive = phase !== "browsing";
  const loading = phase === "rip-delay" || phase === "rays";
  const showingReveal = loading || phase === "revealed" || phase === "error";
  const onUnavailable = useCallback(() => { setFallback(true); setReady(true); }, []);
  const onReady = useCallback(() => setReady(true), []);
  const onPrepared = useCallback(() => {}, []);
  const onOpened = useCallback(() => setPackExiting(false), []);
  const onIntroComplete = useCallback(() => setRaysIntroDone(true), []);

  const reset = useCallback(() => {
    tearGesture.current = null;
    drawing.current = false;
    if (imageURL.current) URL.revokeObjectURL(imageURL.current);
    imageURL.current = null;
    setImage(null);
    setRaysIntroDone(false);
    setRevealReady(false);
    setTear(0);
    setPackExiting(false);
    setBounds(null);
    setSelected(null);
    setActive(0);
    setSceneVersion(value => value + 1);
    restoreFocus.current = true;
    setPhase("browsing");
  }, []);

  useEffect(() => {
    if (ready && phase === "browsing" && restoreFocus.current) {
      restoreFocus.current = false;
      root.current?.focus({ preventScroll: true });
    }
  }, [ready, phase, sceneVersion]);
  useEffect(() => {
    if (immersive) closeTarget.current?.focus({ preventScroll: true });
  }, [immersive]);
  useEffect(() => {
    if (showingReveal) closeTarget.current?.focus({ preventScroll: true });
  }, [showingReveal]);
  useEffect(() => () => { if (imageURL.current) URL.revokeObjectURL(imageURL.current); }, []);
  useEffect(() => {
    const visibility = () => root.current?.toggleAttribute("data-page-hidden", document.hidden);
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    if (phase !== "selecting") return;
    return visibleTimeout(() => {
      setPhase(current => current === "selecting" ? "selected" : current);
    }, 750);
  }, [phase]);
  useEffect(() => {
    if (phase === "selected") tearTarget.current?.focus({ preventScroll: true });
  }, [phase]);
  useEffect(() => {
    if (packExiting && fallback) return visibleTimeout(onOpened, 450);
  }, [packExiting, fallback, onOpened]);
  useEffect(() => {
    if (phase !== "rip-delay") return;
    return visibleTimeout(() => setPhase(current => current === "rip-delay" ? "rays" : current), 200);
  }, [phase]);
  useEffect(() => {
    if (loading && raysIntroDone) return visibleTimeout(() => setRevealReady(true), 200);
  }, [loading, raysIntroDone]);
  useEffect(() => {
    if (!loading) return;
    let cancelled = false;
    let retained = false;
    let url: string | null = null;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(card.image, { signal: controller.signal });
        if (!response.ok) throw new Error("Card image unavailable");
        const blob = await response.blob();
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        const decoded = new Image();
        decoded.src = url;
        await decoded.decode();
        if (cancelled) return;
        imageURL.current = url;
        retained = true;
        setImage(url);
      } catch {
        if (!cancelled) setPhase("error");
      }
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (!retained && url) URL.revokeObjectURL(url);
    };
  }, [loading, attempt, card.image]);
  useEffect(() => {
    if (phase !== "rays" || !revealReady || !image) return;
    const reveal = () => { if (!document.hidden) setPhase("revealed"); };
    reveal();
    document.addEventListener("visibilitychange", reveal);
    return () => document.removeEventListener("visibilitychange", reveal);
  }, [phase, revealReady, image]);

  function select(index: number) {
    if (phaseRef.current !== "browsing" || !ready) return;
    setActive(index);
    setSelected(index);
    setPhase("selecting");
  }
  function step(direction: number) {
    if (fallback) setActive(index => (index + direction + 5) % 5);
    else controls.current?.step(direction);
  }
  function completeTear() {
    if (drawing.current || !["selected", "tearing"].includes(phaseRef.current)) return;
    drawing.current = true;
    tearGesture.current = null;
    setTear(1);
    setPackExiting(true);
    setPhase("rip-delay");
  }
  function startTear(event: PointerEvent<HTMLButtonElement>) {
    if (!["selected", "tearing"].includes(phaseRef.current) || !event.isPrimary || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX > rect.left + rect.width * 0.3) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    tearGesture.current = { id: event.pointerId, start: event.clientX, width: rect.width };
    setPhase("tearing");
  }
  function moveTear(event: PointerEvent<HTMLButtonElement>) {
    const gesture = tearGesture.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    const progress = Math.max(0, Math.min(1, (event.clientX - gesture.start) / (gesture.width * 0.76)));
    setTear(progress);
    if (progress >= 1) completeTear();
  }
  function endTear(event: PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!tearGesture.current || tearGesture.current.id !== event.pointerId) return;
    tearGesture.current = null;
    setTear(0);
    setPhase("selected");
  }
  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && immersive) { event.preventDefault(); reset(); }
    if (!immersive && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); select(active); }
    if (!immersive && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      if (event.shiftKey && !fallback) controls.current?.spin(direction);
      else step(direction);
    }
    if (event.key !== "Tab" || !immersive) return;
    const buttons = Array.from(root.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex='0']") ?? []).filter(element => element.getClientRects().length);
    const first = buttons[0], last = buttons.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  const seamStyle: CSSProperties | undefined = bounds && !fallback ? { left: bounds.left, top: bounds.seamY - 27, width: bounds.width } : undefined;

  return <section ref={root} className="tcg" data-phase={phase} data-immersive={immersive || undefined}
    data-pack-exiting={packExiting || undefined} data-fallback={fallback || undefined} data-ready={ready || undefined} data-active-pack={active + 1}
    tabIndex={immersive ? -1 : 0} aria-roledescription={immersive ? undefined : "carousel"} aria-describedby={!immersive ? helpId : undefined}
    role={immersive ? "dialog" : "region"} aria-modal={immersive || undefined} aria-label={immersive ? "Open a mystery pack" : "Silver mystery packs"} onKeyDown={keyDown}>
    {!fallback ? <PackScene front={packFront} back={packBack} selected={selected} tear={tear} opening={packExiting} reduced={false}
      paused={showingReveal && !packExiting} resetVersion={sceneVersion} controls={controls} onSelect={select} onActive={setActive} onBounds={setBounds}
      onPrepared={onPrepared} onReady={onReady} onOpened={onOpened} onUnavailable={onUnavailable} /> : null}
    {!showingReveal || packExiting ? <>
      {fallback ? <div className="tcg-flat-packs" style={{ "--tear": tear } as CSSProperties}>
        {Array.from({ length: 5 }, (_, index) => <button key={index} className="tcg-flat-pack" aria-label={`Select pack ${index + 1}`}
          data-active={active === index || undefined} style={{ "--offset": ((index - active + 7) % 5) - 2 } as CSSProperties}
          tabIndex={-1} disabled={immersive} onClick={() => select(index)}>
          <img src={packFront} alt="" draggable={false} />
          <span className="tcg-flat-strip" style={{ backgroundImage: `url("${packFront}")` }} />
        </button>)}
      </div> : null}
      {!ready ? <p className="tcg-loading" role="status">Preparing packs…</p> : null}
      {immersive && ["selected", "tearing"].includes(phase) ? <>
        <button ref={tearTarget} className="tcg-tear" style={seamStyle} aria-label="Tear open this pack" aria-describedby={tearHintId}
          onPointerDown={startTear} onPointerMove={moveTear} onPointerUp={endTear} onPointerCancel={endTear} onLostPointerCapture={endTear}
          onClick={event => { if (event.detail === 0) completeTear(); }}>
          <span className="tcg-tear-label">Start here</span>
          <span className="tcg-tear-track"><span style={{ transform: `scaleX(${tear})` }} /></span>
          <span className="tcg-tear-dot" style={{ left: `${tear * 100}%` }} aria-hidden="true"><Arrow /></span>
          {phase === "selected" ? <span className="tcg-gesture" aria-hidden="true"><Arrow /></span> : null}
        </button>
        <p id={tearHintId} className="tcg-opening-hint">Drag from the dot to the right to rip open<span className="tcg-keyboard-hint"> · or press Enter</span></p>
      </> : null}
      {!immersive ? <>
        <p className="tcg-browse-hint" aria-hidden="true">Drag to explore. Choose a pack.</p>
        <span id={helpId} className="sr-only">Drag the front pack to turn it. Drag outside it or use the arrow keys to browse. Shift and an arrow key turns the front pack. Click a pack or press Enter or Space to select it.</span>
        <span className="sr-only" aria-live="polite">Pack {active + 1} of 5.</span>
      </> : null}
    </> : null}
    {showingReveal ? <div className="tcg-reveal">
      {["rays", "revealed"].includes(phase) ? <Spotlight key={attempt} onIntroComplete={onIntroComplete} /> : null}
      {phase === "rays" ? <span className={revealReady ? "tcg-waiting" : "sr-only"} role="status">Revealing card…</span> : null}
      {phase === "revealed" && image ? <>
        <button className="tcg-reset-backdrop" onClick={reset} aria-label="Open another pack" />
        <div className="tcg-card"><RevealCard image={image} alt={card.alt} /></div>
        <p className="tcg-reset-hint">Tap outside the card to open another pack.</p>
        <span className="sr-only" role="status">You opened {card.alt}.</span>
      </> : null}
      {phase === "error" ? <div className="tcg-error" role="alert">
        <h2>The card couldn’t load.</h2><p>Try the reveal again.</p>
        <button className="tcg-retry" onClick={() => { setAttempt(value => value + 1); setRaysIntroDone(false); setRevealReady(false); setPhase("rip-delay"); }}>Try again</button>
      </div> : null}
    </div> : null}
    {immersive ? <button ref={closeTarget} className="tcg-close" onClick={reset} aria-label="Back to packs">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
    </button> : null}
  </section>;
}
