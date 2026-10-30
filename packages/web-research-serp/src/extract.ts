import { canonicalizeUrl, tokenizeHtml, type RawResult } from '@open-mercato/web-research'

export type SerpSelector = {
  /** Class carried by each result's primary anchor. */
  readonly linkClass: string
  /** Class carried by each result's snippet element. */
  readonly snippetClass?: string
}

function hasClass(attributes: ReadonlyMap<string, string>, wanted: string): boolean {
  const raw = attributes.get('class')
  if (!raw) return false
  return raw.split(/\s+/).includes(wanted)
}

type Draft = {
  url: string
  title: string
  snippet: string | null
}

/**
 * Pulls results out of a search engine's HTML.
 *
 * Runs over the shared tokenizer rather than regex: SERP markup is deeply nested
 * and attribute-heavy, which is exactly where a lazy-quantifier regex either
 * mismatches or stalls.
 */
export function extractSerpResults(
  html: string,
  selector: SerpSelector,
  baseUrl: string,
  limit: number,
): RawResult[] {
  const drafts: Draft[] = []
  let linkDepth = 0
  let pendingHref: string | null = null
  let pendingTitle = ''
  let snippetDepth = 0
  let snippetTag: string | null = null
  let pendingSnippet = ''

  const finishLink = (): void => {
    if (pendingHref === null) return
    const title = pendingTitle.replace(/\s+/g, ' ').trim()
    let resolved: string
    try {
      resolved = new URL(pendingHref, baseUrl).toString()
    } catch {
      pendingHref = null
      pendingTitle = ''
      return
    }
    // Engines wrap outbound links in their own redirector; canonicalizeUrl
    // unwraps the known ones and rejects anything that is not http(s).
    const canonical = canonicalizeUrl(resolved)
    pendingHref = null
    pendingTitle = ''
    if (canonical === null) return
    drafts.push({ url: canonical.url, title, snippet: null })
  }

  for (const token of tokenizeHtml(html)) {
    if (drafts.length >= limit && linkDepth === 0 && snippetDepth === 0) break

    if (token.kind === 'open') {
      if (linkDepth > 0) {
        if (token.name === 'a') linkDepth += 1
        continue
      }
      if (snippetDepth > 0) {
        if (token.name === snippetTag) snippetDepth += 1
        continue
      }
      if (token.name === 'a' && hasClass(token.attributes, selector.linkClass)) {
        const href = token.attributes.get('href')
        if (href) {
          pendingHref = href
          pendingTitle = ''
          linkDepth = 1
        }
        continue
      }
      if (selector.snippetClass && hasClass(token.attributes, selector.snippetClass)) {
        snippetDepth = 1
        snippetTag = token.name
        pendingSnippet = ''
      }
      continue
    }

    if (token.kind === 'close') {
      // Only the capturing element's own close ends a capture. Decrementing on
      // any close tag would truncate at the first nested `<b>`/`<span>`, which
      // real SERP markup is full of.
      if (linkDepth > 0) {
        if (token.name === 'a') {
          linkDepth -= 1
          if (linkDepth === 0) finishLink()
        }
        continue
      }
      if (snippetDepth > 0 && token.name === snippetTag) {
        snippetDepth -= 1
        if (snippetDepth === 0) {
          const snippet = pendingSnippet.replace(/\s+/g, ' ').trim()
          const target = drafts[drafts.length - 1]
          if (target && target.snippet === null && snippet.length > 0) target.snippet = snippet
          pendingSnippet = ''
        }
      }
      continue
    }

    if (linkDepth > 0) pendingTitle += token.value
    else if (snippetDepth > 0) pendingSnippet += token.value
  }

  return drafts.slice(0, limit).map((draft) => ({
    url: draft.url,
    title: draft.title.length > 0 ? draft.title : draft.url,
    snippet: draft.snippet,
  }))
}
