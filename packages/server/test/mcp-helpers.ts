/** A minimal MCP client over Streamable HTTP (stateless JSON-RPC POSTs to /mcp), for any fetch. */
type Fetch = (r: Request) => Promise<Response>;

let id = 0;
/** One JSON-RPC request; the reply is JSON or a one-message SSE stream. */
export async function mcpRequest(
  fetch: Fetch,
  base: string,
  method: string,
  params: object,
  headers = {},
  // biome-ignore lint/suspicious/noExplicitAny: JSON-RPC results
): Promise<any> {
  const res = await fetch(
    new Request(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    }),
  );
  if (!res.ok) return { status: res.status, body: await res.text() };
  const text = await res.text();
  const json = text.trimStart().startsWith('{') ? text : (/^data: (.*)$/m.exec(text)?.[1] ?? '{}');
  return (JSON.parse(json) as { result: unknown }).result;
}

/** tools/call with the result's structuredContent, isError and text blocks. */
export const mcpCall = (fetch: Fetch, base: string, name: string, args: object = {}, headers = {}) =>
  mcpRequest(fetch, base, 'tools/call', { name, arguments: args }, headers);
