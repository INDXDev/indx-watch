/** In-browser mock of the HTTP API (dev only, `VITE_MOCK=1`). Writes live in memory until the page reloads. */
import type { Transport } from '../api';
import * as D from './data';
import { json, notFound, routes } from './routes';
import { createState } from './state';

/** A fake app screenshot so evidence thumbnails have something to show. */
export function fakeShot(title: string, line: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#f4f1ea"/><rect width="640" height="48" fill="#2b2f36"/><text x="20" y="31" font-family="sans-serif" font-size="18" fill="#fff">${esc(title)}</text><rect x="20" y="80" width="600" height="120" rx="8" fill="#fff" stroke="#d9d4c7"/><text x="40" y="148" font-family="sans-serif" font-size="20" fill="#2b2f36">${esc(line)}</text><rect x="20" y="230" width="220" height="44" rx="6" fill="#2f6f4e"/><text x="44" y="258" font-family="sans-serif" font-size="16" fill="#fff">Place order</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** A `Transport` that answers the HTTP API from in-memory state (see ./routes). */
export function mockTransport(): Transport {
  const state = createState();
  const blobs = new Map<string, string>();
  return {
    async fetch(path, init) {
      const url = new URL(path, 'http://mock/');
      const method = init?.method ?? 'GET';
      const p = url.pathname.slice(1);
      await new Promise((r) => setTimeout(r, 80));
      if (method === 'POST' && p === 'api/blobs') return uploadBlob(blobs, init?.body as Blob);
      for (const [m, re, handle] of routes) {
        const match = method === m ? p.match(re) : null;
        if (match) return handle(state, match, url, init?.body ? JSON.parse(String(init.body)) : undefined);
      }
      return notFound(`${method} ${p}`);
    },
    blobUrl: (sha) => blobs.get(sha) ?? fakeShot(...(D.SHOT_LABELS[sha] ?? ['Evidence', sha.slice(0, 12)])),
  };
}

/** Stores an uploaded blob under its SHA-256 and answers like `POST /api/blobs`. */
async function uploadBlob(blobs: Map<string, string>, blob: Blob): Promise<Response> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  const sha = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
  blobs.set(sha, URL.createObjectURL(blob));
  return json({ sha256: sha, size: blob.size, media_type: blob.type }, 201);
}
