import type { PageVerdict } from '../contract/results'

export type PageClassification = {
  readonly verdict: PageVerdict
  readonly reason?: string
}

export type ClassifyInput = {
  readonly status: number
  readonly contentType: string | null
  readonly html: string
  readonly text: string
}

const CHALLENGE_MARKERS = [
  'cf-browser-verification',
  'cf_chl_opt',
  'just a moment',
  'checking your browser',
  'enable cookies to continue',
  'ddos protection by',
  'access denied',
  'captcha',
  'are you a robot',
]

const JS_REQUIRED_MARKERS = [
  'enable javascript',
  'javascript is required',
  'javascript is disabled',
  "doesn't work properly without javascript",
  'you need to enable javascript to run this app',
]

const EMPTY_ROOT = /<div[^<>]{0,200}\bid=["']?(root|__next|app|__nuxt)["']?[^<>]{0,200}>\s*<\/div>/i

/** Below this, a text-bearing HTML page is almost certainly a shell, not content. */
const MIN_MEANINGFUL_TEXT = 200
const SHELL_HTML_THRESHOLD = 4_000

/**
 * Decides whether an HTTP read actually produced readable content. The verdict
 * drives browser escalation in code rather than leaving the judgement to the
 * model, which costs a full round-trip and answers differently each time.
 */
export function classifyPage(input: ClassifyInput): PageClassification {
  const haystack = input.html.slice(0, 200_000).toLowerCase()

  if (input.status === 403 || input.status === 429 || input.status === 503) {
    return { verdict: 'blocked', reason: `HTTP ${input.status}` }
  }

  const text = input.text.trim()
  if (text.length === 0 && input.html.trim().length === 0) {
    return { verdict: 'empty', reason: 'no response body' }
  }

  // Marker matching runs over raw markup, including script bundles, so plenty of
  // ordinary pages mention "captcha" or "access denied" without being one. A
  // challenge page is content-free by definition, so the markers only count when
  // the page also failed to yield readable text — otherwise a working page gets
  // flagged and triggers a pointless browser escalation.
  if (text.length < MIN_MEANINGFUL_TEXT) {
    const challenge = CHALLENGE_MARKERS.find((marker) => haystack.includes(marker))
    if (challenge) return { verdict: 'blocked', reason: `anti-bot challenge (${challenge})` }
  }

  const jsMarker = JS_REQUIRED_MARKERS.find((marker) => haystack.includes(marker))
  if (jsMarker && text.length < MIN_MEANINGFUL_TEXT) {
    return { verdict: 'js-shell', reason: `page requires JavaScript (${jsMarker})` }
  }
  if (EMPTY_ROOT.test(input.html) && text.length < MIN_MEANINGFUL_TEXT) {
    return { verdict: 'js-shell', reason: 'empty client-side render root' }
  }
  if (text.length < MIN_MEANINGFUL_TEXT && input.html.length > SHELL_HTML_THRESHOLD) {
    return { verdict: 'js-shell', reason: `only ${text.length} chars of text in ${input.html.length} of markup` }
  }
  if (text.length === 0) return { verdict: 'empty', reason: 'no extractable text' }

  return { verdict: 'ok' }
}
