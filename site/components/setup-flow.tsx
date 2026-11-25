'use client';

/**
 * The setup guide's architecture, played like the landing page's demo (site/DESIGN.md#the-demo): one node
 * lights up at a time, a dot travels along the arrow to the next, and a caption says what happens there.
 * It plays only while on screen, never faster than a person can read, and can be paused; with reduced
 * motion every node is lit and every caption is listed. Without JavaScript the static list is complete.
 */
import { useEffect, useRef, useState } from 'react';
import type { SetupContent } from '@/content/types';
import { Rich } from './rich';

const STEP_MS = 4200;

export function ArchFlow({ s }: { s: SetupContent }) {
  const a = s.arch;
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setStill(media.matches);
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (still || !playing || !visible) return;
    if (active < 0) setActive(0);
    const id = window.setInterval(() => setActive((i) => (i + 1) % a.nodes.length), STEP_MS);
    return () => window.clearInterval(id);
  }, [still, playing, visible, active, a.nodes.length]);

  const lit = (i: number) => still || active < 0 || i === active;
  return (
    <div ref={ref} className={`su-flow ${still ? 'is-still' : ''}`}>
      <ol className="su-arch">
        {a.nodes.map((node, i) => (
          <li key={node.title} className={`su-arch-item ${lit(i) ? 'is-lit' : ''} ${i === active ? 'is-active' : ''}`}>
            <div className="card su-node">
              <p className="su-node-n" aria-hidden="true">
                {i + 1}
              </p>
              <p className="caption">{node.caption}</p>
              <h3>{node.title}</h3>
              <ul>
                {node.items.map((item) => (
                  <li key={item}>
                    <Rich text={item} />
                  </li>
                ))}
              </ul>
            </div>
            {i < a.edges.length && (
              <span className={`su-edge ${i === active && !still ? 'is-moving' : ''}`} key={`${i}:${active}`}>
                <span className="su-edge-label">{a.edges[i]}</span>
                <i aria-hidden="true" />
              </span>
            )}
          </li>
        ))}
      </ol>
      <div className="su-flow-bar">
        <p className="caption">{s.flow.label}</p>
        {!still && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={!playing}
          >
            {playing ? '❚❚' : '▶'}
            <span className="visually-hidden">{playing ? s.flow.pause : s.flow.play}</span>
          </button>
        )}
      </div>
      <ol className="su-captions" aria-live="off">
        {s.flow.captions.map((c, i) => (
          <li key={c} className={still || i === active || active < 0 ? 'is-on' : ''}>
            <button type="button" onClick={() => setActive(i)} disabled={still}>
              <span className="su-caption-n">{i + 1}</span>
              <span>{c}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
