/**
 * Rewrites an email body so opens and clicks can be attributed.
 *
 * Regex over HTML, deliberately: the alternative is a DOM parser as a production dependency of a
 * worker, for the sake of one attribute. The trade is made safe by being CONSERVATIVE — anything
 * that does not match the narrow shape of a plain `href="http..."` is left exactly as it was, so a
 * body this does not understand goes out unmodified rather than mangled.
 */

const HREF_PATTERN = /href\s*=\s*(["'])(.*?)\1/gi

/** Only absolute http(s) links are rewritten; a mailto, a tel or an in-message anchor is not a click. */
function isTrackableTarget(target: string): boolean {
  return /^https?:\/\//i.test(target.trim())
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

export type RewriteOptions = {
  /** Returns the tracking URL for a target, or null to leave the link alone. */
  makeClickUrl: (target: string) => string | null
  /** The open-pixel URL, or null to embed nothing. */
  pixelUrl: string | null
}

export function rewriteLinksForTracking(html: string, makeClickUrl: RewriteOptions['makeClickUrl']): string {
  return html.replace(HREF_PATTERN, (match, quote: string, target: string) => {
    if (!isTrackableTarget(target)) return match
    // An already-rewritten link must not be wrapped twice; a body can legitimately be re-rendered.
    const tracked = makeClickUrl(decodeAttribute(target))
    if (!tracked) return match
    return `href=${quote}${escapeAttribute(tracked)}${quote}`
  })
}

/** Attributes arrive HTML-escaped; the target has to be un-escaped before it is signed. */
function decodeAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/**
 * Embeds the open pixel.
 *
 * Before `</body>` when there is one, appended otherwise — a campaign body is often a fragment
 * rather than a whole document, and an image after the closing tag is still fetched but reads as a
 * mistake to anyone viewing the source.
 */
export function appendTrackingPixel(html: string, pixelUrl: string): string {
  const pixel = `<img src="${escapeAttribute(pixelUrl)}" width="1" height="1" alt="" style="display:none" />`
  const closing = html.lastIndexOf('</body>')
  if (closing === -1) return `${html}${pixel}`
  return `${html.slice(0, closing)}${pixel}${html.slice(closing)}`
}

export function applyTracking(html: string, options: RewriteOptions): string {
  const withLinks = rewriteLinksForTracking(html, options.makeClickUrl)
  return options.pixelUrl ? appendTrackingPixel(withLinks, options.pixelUrl) : withLinks
}
