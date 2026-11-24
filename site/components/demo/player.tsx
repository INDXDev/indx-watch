'use client';

/**
 * The product demo: four chapters played like a video (Clerk's hero), drawn as HTML on a fixed
 * 1200 × 720 canvas that is scaled to the page, so it stays sharp at any width and readable without
 * JavaScript. It plays only while on screen, loops, pauses on request, and jumps to the chapter of the
 * role the reader picks. With prefers-reduced-motion it does not play: each chapter shows its last frame.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DemoText, Role } from '@/content/types';
import { useRole } from '../role';
import { Clock } from './kit';
import { CiScene, ciTimes } from './scene-ci';
import { DesignScene, designTimes } from './scene-design';
import { RunScene, runTimes } from './scene-run';
import { ShipScene, shipTimes } from './scene-ship';

const CHAPTER_OF: Record<Role, number> = { developer: 0, tester: 2, product: 3 };

export function Demo({ t }: { t: DemoText }) {
  const durations = useMemo(() => [designTimes(t).end, ciTimes().end, runTimes().end, shipTimes(t).end], [t]);
  const [chapter, setChapter] = useState(0);
  const [ms, setMs] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(false);
  const [still, setStill] = useState(false);
  const [scale, setScale] = useState(1);
  const stage = useRef<HTMLDivElement>(null);
  const { role, picked } = useRole();

  // Reduced motion: no autoplay, show each chapter's last frame.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      setStill(mq.matches);
      if (mq.matches) setPlaying(false);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Scale the canvas to the stage.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / 1200);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Play only while on screen.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // A reader's role choice jumps to that role's chapter.
  useEffect(() => {
    if (!picked) return;
    setChapter(CHAPTER_OF[role]);
    setMs(0);
  }, [picked, role]);

  // The clock.
  useEffect(() => {
    if (!playing || !visible || still) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      setMs((prev) => prev + dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, visible, still]);

  // Next chapter at the end of this one, looping.
  useEffect(() => {
    if (ms >= durations[chapter]) {
      setChapter((c) => (c + 1) % durations.length);
      setMs(0);
    }
  }, [ms, chapter, durations]);

  const shown = still ? durations[chapter] - 1 : ms;
  const progress = Math.min(1, shown / durations[chapter]);
  const scenes = [DesignScene, CiScene, RunScene, ShipScene];
  const Scene = scenes[chapter];

  function go(i: number) {
    setChapter(i);
    setMs(0);
    if (!still) setPlaying(true);
  }

  return (
    <section className="demo" id="demo" aria-label={t.label}>
      <div className="demo-tabs" role="tablist" aria-label={t.label}>
        {t.chapters.map((c, i) => (
          <button
            key={c.title}
            type="button"
            role="tab"
            id={`demo-tab-${i}`}
            aria-selected={i === chapter}
            aria-controls="demo-stage"
            className="demo-tab"
            onClick={() => go(i)}
          >
            <span className="dot" aria-hidden="true" />
            <span className="num" aria-hidden="true">
              0{i + 1}
            </span>
            {c.title}
            <span className="bar" aria-hidden="true">
              <i style={{ transform: `scaleX(${i === chapter ? progress : i < chapter ? 1 : 0})` }} />
            </span>
          </button>
        ))}
      </div>
      <div
        className="demo-stage"
        id="demo-stage"
        role="tabpanel"
        aria-labelledby={`demo-tab-${chapter}`}
        ref={stage}
      >
        <div className="demo-canvas dm" style={{ transform: `scale(${scale})` }} aria-hidden="true">
          <Clock.Provider value={shown}>
            <Scene t={t} />
          </Clock.Provider>
        </div>
        <p className="visually-hidden">{t.chapters[chapter].caption}</p>
      </div>
      <div className="demo-foot">
        <p className="demo-caption" aria-live="polite">
          <b>{t.chapters[chapter].title}.</b> {t.chapters[chapter].caption}
        </p>
        {!still && (
          <button
            type="button"
            className="demo-play"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? t.pause : t.play}
          >
            {playing ? (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <rect x="3.5" y="2.5" width="3" height="11" rx="1" />
                <rect x="9.5" y="2.5" width="3" height="11" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.5 2.8v10.4L13 8z" />
              </svg>
            )}
          </button>
        )}
      </div>
    </section>
  );
}
