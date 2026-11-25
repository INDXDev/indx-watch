'use client';

import { useId, useState } from 'react';

/** A command with a copy button. Without JavaScript the command is still selectable text. */
export function CopyCommand({ command, copy, copied }: { command: string; copy: string; copied: string }) {
  const [done, setDone] = useState(false);
  const id = useId();
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      const node = document.getElementById(id);
      if (!node) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand('copy');
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 2000);
  }
  return (
    <div className="copy-command">
      <span className="prompt" aria-hidden="true">
        $
      </span>
      <code id={id}>{command}</code>
      <button type="button" onClick={onCopy} aria-label={`${copy}: ${command}`} title={done ? copied : copy}>
        {done ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8.5l3 3L13 4.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" />
            <path d="M10.5 3.5V3A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5" />
          </svg>
        )}
      </button>
      <span className="visually-hidden" aria-live="polite">
        {done ? copied : ''}
      </span>
    </div>
  );
}

/** A small copy button for a block of commands (the setup guide's terminals). */
export function CopyButton({ text, copy, copied }: { text: string; copy: string; copied: string }) {
  const [done, setDone] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 2000);
    } catch {
      // without clipboard access the commands are still selectable text
    }
  }
  return (
    <button type="button" className="copy-btn" onClick={onCopy} aria-label={copy}>
      {done ? copied : copy}
    </button>
  );
}
