// Tiny inline-markdown renderer. Handles `**bold**`, `*italic*`, `` `code` ``,
// and `[text](url)` links. Good enough for the pro-tips bodies without
// pulling in a full markdown lib for HTML-to-React interop.

import { Fragment, type ReactNode } from 'react';

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; children: Token[] }
  | { kind: 'italic'; children: Token[] }
  | { kind: 'code'; value: string }
  | { kind: 'link'; href: string; children: Token[] };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let buf = '';
  const flushText = () => {
    if (buf) {
      tokens.push({ kind: 'text', value: buf });
      buf = '';
    }
  };
  while (i < src.length) {
    // Inline code spans are highest priority (no nested formatting).
    if (src[i] === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i) {
        flushText();
        tokens.push({ kind: 'code', value: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Bold: **...**
    if (src[i] === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2);
      if (end > i) {
        flushText();
        tokens.push({
          kind: 'bold',
          children: tokenize(src.slice(i + 2, end)),
        });
        i = end + 2;
        continue;
      }
    }
    // Italic: *...*
    if (src[i] === '*') {
      const end = src.indexOf('*', i + 1);
      if (end > i) {
        flushText();
        tokens.push({
          kind: 'italic',
          children: tokenize(src.slice(i + 1, end)),
        });
        i = end + 1;
        continue;
      }
    }
    // Link: [text](url)
    if (src[i] === '[') {
      const closeBracket = src.indexOf(']', i + 1);
      if (closeBracket > i && src[closeBracket + 1] === '(') {
        const closeParen = src.indexOf(')', closeBracket + 2);
        if (closeParen > closeBracket) {
          const text = src.slice(i + 1, closeBracket);
          const href = src.slice(closeBracket + 2, closeParen);
          flushText();
          tokens.push({ kind: 'link', href, children: tokenize(text) });
          i = closeParen + 1;
          continue;
        }
      }
    }
    buf += src[i];
    i++;
  }
  flushText();
  return tokens;
}

function renderToken(t: Token, key: string): ReactNode {
  switch (t.kind) {
    case 'text':
      return <Fragment key={key}>{t.value}</Fragment>;
    case 'bold':
      return <strong key={key}>{renderTokens(t.children)}</strong>;
    case 'italic':
      return <em key={key}>{renderTokens(t.children)}</em>;
    case 'code':
      return <code key={key}>{t.value}</code>;
    case 'link':
      return (
        <a key={key} href={t.href} target="_blank" rel="noopener noreferrer">
          {renderTokens(t.children)}
        </a>
      );
    default:
      return null;
  }
}

function renderTokens(tokens: Token[]): ReactNode {
  return tokens.map((t, idx) => renderToken(t, `tok-${idx}`));
}

export function MarkdownInline({ text }: { text: string }) {
  return <>{renderTokens(tokenize(text))}</>;
}
