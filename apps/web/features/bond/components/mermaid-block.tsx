'use client';

import * as React from 'react';
import DOMPurify from 'dompurify';
import type { Mermaid } from 'mermaid';

export interface MermaidBlockProps {
  /** Raw mermaid diagram definition, taken verbatim from a ```mermaid fenced code block. */
  code: string;
}

let mermaidPromise: Promise<Mermaid> | null = null;

/**
 * Lazily imports `mermaid` and calls `mermaid.initialize()` exactly once for
 * the whole app (module-level singleton promise), regardless of how many
 * `MermaidBlock`s mount. Keeps `securityLevel: 'strict'` — the library's own
 * default — so mermaid sanitizes any HTML/script content an LLM-authored
 * diagram definition might try to smuggle in. Never set this to 'loose' or
 * 'antiscript'.
 */
function getMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      return mermaid;
    });
  }
  return mermaidPromise;
}

let diagramCounter = 0;

/** Renders a fenced ```mermaid code block as an SVG diagram, client-side only. */
export function MermaidBlock({ code }: MermaidBlockProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const idRef = React.useRef(`bond-mermaid-${++diagramCounter}`);

  React.useEffect(() => {
    let cancelled = false;

    getMermaid()
      .then((mermaid) => mermaid.render(idRef.current, code))
      .then(({ svg }) => {
        if (cancelled) return;
        setError(null);
        // `code` is a fenced ```mermaid block from an LLM response — content
        // an attacker could influence via prompt injection in ingested
        // documents. This imperative `innerHTML` write carries the exact
        // same DOM-XSS risk profile as React's `dangerouslySetInnerHTML`;
        // using a ref instead of that prop is NOT itself a safety
        // mechanism. The real safety is two independent layers: (1)
        // `mermaid.render()` under `securityLevel: 'strict'` (never
        // 'loose'/'antiscript'), and (2) a DOMPurify pass here as
        // defense-in-depth in case (1) ever regresses.
        const sanitizedSvg = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
        if (containerRef.current) {
          containerRef.current.innerHTML = sanitizedSvg;
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to render diagram.');
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div className="my-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
        Couldn&apos;t render this diagram: {error}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-3 flex justify-center overflow-x-auto rounded-md border border-border bg-card p-3 [&_svg]:max-w-full"
    />
  );
}
