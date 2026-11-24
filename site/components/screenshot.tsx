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

export function hasImage(name: string): boolean {
  return imageSize(name) !== null;
}

/** A screenshot in a browser frame, cropped to the top of the page. Renders nothing if the file is missing. */
export function Screenshot({
  name,
  alt,
  priority = false,
  className,
}: {
  name: string;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  const size = imageSize(name);
  if (!size) return null;
  const phone = size.width < 600;
  return (
    <div className={`shot ${phone ? 'shot-phone' : ''} ${className ?? ''}`}>
      {!phone && (
        <div className="shot-bar" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}
      <div className="shot-view">
        <img
          src={`/images/${name}`}
          alt={alt}
          width={size.width}
          height={size.height}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
        />
      </div>
    </div>
  );
}
