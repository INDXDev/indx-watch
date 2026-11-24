import { closeSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Screenshots are copied into public/images by scripts/copy-images.mjs before dev and build. This runs at
 * build time only (static export): it returns the PNG's size, or null when the file is missing, so the
 * page can leave the picture out instead of showing a broken image.
 */
export function imageSize(name: string): { width: number; height: number } | null {
  try {
    const fd = openSync(join(process.cwd(), 'public', 'images', name), 'r');
    const header = Buffer.alloc(24);
    readSync(fd, header, 0, 24, 0);
    closeSync(fd);
    if (header.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/** A screenshot in a browser frame, cropped to its top. Renders nothing if the file is missing. */
export function Screenshot({ name, alt }: { name: string; alt: string }) {
  const size = imageSize(name);
  if (!size) return null;
  return (
    <div className="frame">
      <div className="frame-bar" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="frame-view">
        <img src={`/images/${name}`} alt={alt} width={size.width} height={size.height} loading="lazy" decoding="async" />
      </div>
    </div>
  );
}
