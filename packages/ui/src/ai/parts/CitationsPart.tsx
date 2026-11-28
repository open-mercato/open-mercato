"use client"

import * as React from 'react'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import type { AiUiPartProps } from '../ui-part-registry'
import {
  fallbackCitation,
  isExternalCitationHref,
  resolveCitation,
  type AiCitationRef,
  type ResolvedCitation,
} from '../citations/registry'
import { readCitationsPayload } from '../citations/merge'

function CitationQuote({ quote }: { quote: string }) {
  const t = useT()
  const [expanded, setExpanded] = React.useState(false)
  const quoteId = React.useId()
  return (
    <div className="flex flex-col items-start gap-1">
      <blockquote
        id={quoteId}
        className={
          expanded
            ? 'border-l-2 border-border pl-2 text-xs text-muted-foreground'
            : 'line-clamp-3 border-l-2 border-border pl-2 text-xs text-muted-foreground'
        }
      >
        {quote}
      </blockquote>
      <Button
        type="button"
        variant="link"
        size="2xs"
        className="px-0"
        aria-expanded={expanded}
        aria-controls={quoteId}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded
          ? t('ui.ai.citations.showLess', 'Show less')
          : t('ui.ai.citations.showMore', 'Show more')}
      </Button>
    </div>
  )
}

function CitationTitle({ resolved }: { resolved: ResolvedCitation }) {
  const t = useT()
  const href = resolved.href
  if (!href) {
    return <span className="font-medium text-foreground">{resolved.title}</span>
  }
  const linkClassName = 'font-medium text-primary underline-offset-4 hover:underline'
  if (isExternalCitationHref(href)) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1 ${linkClassName}`}
        aria-label={t('ui.ai.citations.openSource', 'Open source: {title} (opens in a new tab)', { title: resolved.title })}
      >
        <span>{resolved.title}</span>
        <ExternalLink className="size-3" aria-hidden />
      </a>
    )
  }
  return (
    <Link href={href} className={linkClassName}>
      {resolved.title}
    </Link>
  )
}

function useResolvedCitations(citations: AiCitationRef[]): ResolvedCitation[] {
  const citationsKey = JSON.stringify(citations)
  const fallbacks = React.useMemo(
    () => (JSON.parse(citationsKey) as AiCitationRef[]).map(fallbackCitation),
    [citationsKey],
  )
  const [resolved, setResolved] = React.useState<{ key: string; items: ResolvedCitation[] } | null>(null)
  React.useEffect(() => {
    let cancelled = false
    const pending = JSON.parse(citationsKey) as AiCitationRef[]
    Promise.all(pending.map((citation) => resolveCitation(citation)))
      .then((items) => {
        if (!cancelled) setResolved({ key: citationsKey, items })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [citationsKey])
  return resolved && resolved.key === citationsKey ? resolved.items : fallbacks
}

export function CitationsPart({ payload }: AiUiPartProps) {
  const t = useT()
  const { citations, title } = React.useMemo(() => readCitationsPayload(payload), [payload])
  const resolved = useResolvedCitations(citations)
  const headingId = React.useId()
  if (citations.length === 0) return null
  const heading = title ?? t('ui.ai.citations.title', 'Sources')
  return (
    <section
      className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm"
      aria-labelledby={headingId}
      data-ai-citations=""
    >
      <h4 id={headingId} className="text-xs font-medium text-muted-foreground">
        {heading}
      </h4>
      <ol className="flex flex-col gap-2">
        {citations.map((citation, index) => {
          const entry = resolved[index] ?? fallbackCitation(citation)
          return (
            <li
              key={`${citation.kind}:${citation.ref}:${citation.locator ?? ''}`}
              className="flex gap-2"
              data-ai-citation-kind={citation.kind}
            >
              <span className="shrink-0 font-mono text-xs text-muted-foreground" aria-hidden>
                [{index + 1}]
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <CitationTitle resolved={entry} />
                  {citation.locator ? (
                    <span className="text-xs text-muted-foreground">{citation.locator}</span>
                  ) : null}
                </div>
                {citation.quote ? <CitationQuote quote={citation.quote} /> : null}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export default CitationsPart
