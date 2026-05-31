import sanitizeHtml from 'sanitize-html'

/**
 * HTML sanitizer for channel-supplied payloads (email MIME, Slack rich-text, future channel types).
 *
 * The hub owns this helper; every widget that renders channel HTML — in the hub itself or in
 * downstream provider packages — imports it. The Messages module's `channel-payload-renderer`
 * widget calls this before any `dangerouslySetInnerHTML`-style render.
 *
 * Implementation note: backed by `sanitize-html` (CommonJS, server-friendly) rather than
 * DOMPurify so the same code runs in Jest without ESM transform gymnastics. SPEC-045d §4.6
 * specifies "DOMPurify or equivalent" — `sanitize-html` is an allowlist-based equivalent
 * widely used for the same sanitization shape.
 *
 * Allowlist is tuned for email + chat HTML:
 *   - Preserves typical email layout primitives (table-based layouts, inline images, basic typography).
 *   - Strips `<script>`, `<style>`, `<iframe>`, all event-handler attributes (`on*`).
 *   - Blocks `javascript:` and `data:` URLs except `data:image/*;base64,…` (inline base64 images, common in email).
 */

const ALLOWED_TAGS = [
  'a',
  'img',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'p',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'blockquote',
  'code',
  'pre',
  'span',
  'div',
]

const ALLOWED_SCHEMES = ['http', 'https', 'mailto', 'tel']
const ALLOWED_SCHEMES_BY_TAG = {
  img: ['http', 'https', 'data'],
}

/**
 * Safe CSS color value shapes only: hex (#rgb / #rgba / #rrggbb / #rrggbbaa),
 * rgb()/rgba(), hsl()/hsla(), and bare named colors (`red`, `transparent`,
 * `currentcolor`, …). Deliberately rejects any value containing `url(` or
 * `expression(` so a `color`/`background-color` declaration can never smuggle a
 * CSS-based tracking beacon or legacy-IE script expression past the sanitizer.
 */
const SAFE_CSS_COLOR =
  /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$|^rgba?\(\s*[\d.,\s%]+\)$|^hsla?\(\s*[\d.,\s%]+\)$|^[a-z]+$/i

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'title', 'class'],
    img: ['src', 'alt', 'title', 'class', 'width', 'height'],
    '*': ['class', 'style', 'colspan', 'rowspan', 'width', 'height'],
  },
  allowedSchemes: ALLOWED_SCHEMES,
  allowedSchemesByTag: ALLOWED_SCHEMES_BY_TAG,
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  // disable inline scripts in style attributes
  allowedStyles: {
    '*': {
      'background-color': [SAFE_CSS_COLOR],
      color: [SAFE_CSS_COLOR],
      'text-align': [/^left$|^right$|^center$|^justify$/i],
      'font-size': [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
      'font-weight': [/^\d{3}$|^bold$|^normal$/],
      'font-style': [/^italic$|^normal$/],
      'text-decoration': [/^underline$|^line-through$|^none$/],
      padding: [/^[\d\s.]+(?:px|em|rem|%)?$/],
      margin: [/^[\d\s.]+(?:px|em|rem|%)?$/],
      border: [/^[\d\s\w.]+$/],
      'border-radius': [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
      // Permit only `display:none` so the hidden thread-token footer span
      // (`buildBodyFooter`) stays hidden when a sent email body is re-rendered.
      // Every other display value is stripped.
      display: [/^none$/],
    },
  },
  /**
   * data:image/<mime>;base64,... URLs in <img src=...> are explicitly allowed so inline
   * email images render. sanitize-html validates the base64 payload shape; if a future
   * payload tries to smuggle a non-image MIME type via data URL we strip it.
   */
  exclusiveFilter: (frame) => {
    if (frame.tag === 'img' && frame.attribs?.src) {
      const src = frame.attribs.src
      if (src.startsWith('data:') && !/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(src)) {
        return true
      }
    }
    return false
  },
}

/**
 * Sanitize an HTML string for safe rendering.
 *
 * @param html Raw HTML — may originate from an external channel (email body, Slack mrkdwn rendered to HTML, …).
 * @returns Sanitized HTML safe for `dangerouslySetInnerHTML`.
 */
export function sanitizeChannelHtml(html: string): string {
  if (!html) return ''
  return sanitizeHtml(html, SANITIZE_OPTIONS)
}

export default sanitizeChannelHtml
