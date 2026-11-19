/** SHA-256 via WebCrypto: works on Node >= 20 and Cloudflare Workers. */
const enc = new TextEncoder();

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** First 12 hex chars of SHA-256: versions and translation source hashes. */
export async function shortHash(data: Uint8Array | string): Promise<string> {
  return (await sha256Hex(data)).slice(0, 12);
}
