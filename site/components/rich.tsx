import { Fragment, type ReactNode } from 'react';

/** Renders `code`, **bold** and line breaks in content strings; everything else stays text. */
export function Rich({ text }: { text: string }): ReactNode {
  return text.split('\n').map((line, i) => (
    <Fragment key={`${i}:${line}`}>
      {i > 0 && <br />}
      {line.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, j) => {
        const key = `${j}:${part}`;
        if (part.length > 2 && part.startsWith('`') && part.endsWith('`'))
          return <code key={key}>{part.slice(1, -1)}</code>;
        if (part.length > 4 && part.startsWith('**') && part.endsWith('**'))
          return <strong key={key}>{part.slice(2, -2)}</strong>;
        return part;
      })}
    </Fragment>
  ));
}
