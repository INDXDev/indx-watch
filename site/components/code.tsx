import type { ReactNode } from 'react';

/**
 * A code panel with a file name and light syntax colors for TOML, TypeScript and JSON. The tokenizer is
 * deliberately tiny: comments, strings, table headers, keys and a few keywords — enough for the excerpts.
 */
const TOKEN =
  /(#.*$|\/\/.*$)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(^\s*\[\[?[^\]\n]+\]\]?)|(^[\w.-]+(?=\s*=))|\b(true|false|null|const|await|async|test|expect)\b/gm;

function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(code.slice(last, at));
    const [text, comment, string, table, key] = m;
    let cls = 'tok-kw';
    if (comment) cls = 'tok-comment';
    else if (string) cls = code[at + text.length] === ':' ? 'tok-key' : 'tok-str';
    else if (table) cls = 'tok-table';
    else if (key) cls = 'tok-key';
    out.push(
      <span key={at} className={cls}>
        {text}
      </span>,
    );
    last = at + text.length;
  }
  out.push(code.slice(last));
  return out;
}

export function CodePanel({
  file,
  code,
  caption,
  className,
}: {
  file: string;
  code: string;
  caption?: ReactNode;
  className?: string;
}) {
  return (
    <figure className={`code-panel ${className ?? ''}`}>
      <div className="code-file">
        <span className="code-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="code-name">
          <span>{file}</span>
        </span>
      </div>
      <pre tabIndex={0}>
        <code>{highlight(code)}</code>
      </pre>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
