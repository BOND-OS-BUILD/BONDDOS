'use client';

// App Router allows importing global CSS from any component file, not just
// layouts. If this ever errors during build, move this line into
// apps/web/app/globals.css instead and delete it here.
import 'katex/dist/katex.min.css';

import * as React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from 'next-themes';
import { Check, Copy } from 'lucide-react';

import { Button, cn } from '@bond-os/ui';

import { MermaidBlock } from './mermaid-block';

export interface MarkdownMessageProps {
  /** Raw Markdown for one chat message (GFM tables/task-lists + math are supported). */
  content: string;
}

/** Extracts the fenced-code language and raw text from a `<pre>` node's single `<code>` child, if any. */
function getCodeChildInfo(children: React.ReactNode): { language: string | null; code: string } | null {
  if (!React.isValidElement(children)) return null;
  const props = children.props as { className?: string; children?: React.ReactNode };
  const match = /language-(\w+)/.exec(props.className ?? '');
  const code = String(props.children ?? '').replace(/\n$/, '');
  return { language: match?.[1] ?? null, code };
}

/** Fenced code block (non-mermaid): syntax highlighting + a copy-to-clipboard button. */
function CodeBlock({ language, code }: { language: string; code: string }) {
  const { resolvedTheme } = useTheme();
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (unsupported browser/permissions) — ignore.
    }
  }

  return (
    <div className="my-3 overflow-hidden rounded-md border border-border text-xs">
      <div className="flex items-center justify-between bg-muted/50 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{language}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          <span className="sr-only">Copy code</span>
        </Button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={resolvedTheme === 'dark' ? oneDark : oneLight}
        PreTag="div"
        customStyle={{ margin: 0, padding: '0.75rem', background: 'transparent', fontSize: '0.8rem' }}
        wrapLongLines
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

const markdownComponents: Components = {
  pre({ children }) {
    const info = getCodeChildInfo(children);
    if (!info) return <pre>{children}</pre>;
    if (info.language === 'mermaid') return <MermaidBlock code={info.code} />;
    return <CodeBlock language={info.language ?? 'text'} code={info.code} />;
  },
  code({ className, children, ...props }) {
    // Only reached for inline `code` spans — `pre` above fully owns fenced blocks.
    return (
      <code className={cn('rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]', className)} {...props}>
        {children}
      </code>
    );
  },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-xs">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-muted/50">{children}</thead>;
  },
  th({ children }) {
    return (
      <th className="border-b border-border px-3 py-1.5 text-left font-medium text-foreground">{children}</th>
    );
  },
  td({ children }) {
    return <td className="border-b border-border px-3 py-1.5 align-top text-muted-foreground">{children}</td>;
  },
  ul({ children }) {
    return <ul className="my-2 ml-5 list-disc space-y-1 text-sm marker:text-muted-foreground">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="my-2 ml-5 list-decimal space-y-1 text-sm marker:text-muted-foreground">{children}</ol>;
  },
  li({ className, children, ...props }) {
    const isTaskItem = typeof className === 'string' && className.includes('task-list-item');
    return (
      <li
        className={cn('leading-relaxed', isTaskItem && 'ml-[-1.25rem] flex list-none items-start gap-2', className)}
        {...props}
      >
        {children}
      </li>
    );
  },
  input({ className, ...props }) {
    // GFM only ever emits `<input>` for task-list checkboxes.
    return (
      <input
        {...props}
        disabled
        className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border accent-primary', className)}
      />
    );
  },
  a({ children, href, ...props }) {
    // react-markdown does not sanitize link protocols — an LLM response
    // (itself possibly steered by prompt-injected content in a retrieved
    // document) could emit `[text](javascript:...)`. Only allow the
    // protocols a chat link legitimately needs; anything else renders as
    // plain (non-clickable) text instead of a live anchor.
    const isSafeHref = typeof href === 'string' && /^(https?:|mailto:|\/)/i.test(href);
    if (!isSafeHref) return <>{children}</>;

    return (
      <a
        {...props}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
      >
        {children}
      </a>
    );
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-2 border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
        {children}
      </blockquote>
    );
  },
  hr() {
    return <hr className="my-4 border-border" />;
  },
  h1({ children }) {
    return <h1 className="mb-2 mt-4 text-lg font-semibold text-foreground first:mt-0">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="mb-2 mt-4 text-base font-semibold text-foreground first:mt-0">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="mb-1.5 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h3>;
  },
  h4({ children }) {
    return <h4 className="mb-1.5 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h4>;
  },
  p({ children }) {
    return <p className="mb-2 text-sm leading-relaxed last:mb-0">{children}</p>;
  },
};

/** Rich-response Markdown renderer for BOND chat messages: GFM tables/task-lists, math (KaTeX), fenced-code syntax highlighting with copy buttons, and mermaid diagrams. */
export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="max-w-none break-words text-sm text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
