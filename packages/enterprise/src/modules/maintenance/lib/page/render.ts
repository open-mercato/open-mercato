import { escapeHtml, paragraphs, sanitizeUrl } from './escape'
import { loadInstanceTemplate, renderTemplate } from './template'
import type { MaintenanceTranslate } from './i18n'

export type MaintenancePageInput = {
  locale: string
  t: MaintenanceTranslate
  title?: string
  message?: string
  until: string | null
  retryAfterSeconds: number
  timezone: string
  logoUrl: string | null
  supportUrl: string | null
  templatePath: string | null
  now: Date
}

const MAX_REFRESH_SECONDS = 300

const UNTIL_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
}

export function formatUntil(until: string | null, locale: string, timezone: string): string {
  if (!until) return ''
  const parsed = new Date(until)
  if (Number.isNaN(parsed.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(locale, { ...UNTIL_FORMAT, timeZone: timezone }).format(parsed)
  } catch {
    return new Intl.DateTimeFormat(locale, { ...UNTIL_FORMAT, timeZone: 'UTC' }).format(parsed)
  }
}

const BUILTIN_STYLES = `
:root{color-scheme:light dark;--background:oklch(1 0 0);--foreground:oklch(0.145 0 0);--card:oklch(1 0 0);--border:oklch(0.922 0 0);--muted-foreground:oklch(0.545 0 0);--primary:oklch(0.205 0 0);--primary-foreground:oklch(0.985 0 0)}
@media (prefers-color-scheme:dark){:root{--background:oklch(0.145 0 0);--foreground:oklch(0.985 0 0);--card:oklch(0.205 0 0);--border:oklch(1 0 0 / 10%);--muted-foreground:oklch(0.708 0 0);--primary:oklch(0.922 0 0);--primary-foreground:oklch(0.205 0 0)}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem;background:var(--background);color:var(--foreground);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:1rem;line-height:1.5}
main{width:100%;max-width:32rem;background:var(--card);border:1px solid var(--border);border-radius:0.75rem;padding:2rem;text-align:center}
img{max-width:10rem;max-height:3rem;margin:0 auto 1.5rem;display:block}
h1{font-size:1.5rem;line-height:2rem;font-weight:600;margin:0 0 0.75rem}
p{margin:0 0 0.75rem;color:var(--muted-foreground)}
.until{margin-top:1.25rem;font-size:0.875rem;color:var(--foreground)}
a{display:inline-block;margin-top:1.25rem;padding:0.5rem 1rem;border-radius:0.5rem;background:var(--primary);color:var(--primary-foreground);text-decoration:none;font-size:0.875rem;font-weight:500}
`

export function renderMaintenancePage(input: MaintenancePageInput): string {
  const t = input.t
  const title = input.title || t('maintenance.page.defaultTitle', 'We are performing scheduled maintenance')
  const message = input.message || t('maintenance.page.defaultMessage', 'The service is temporarily unavailable. Please try again shortly.')
  const untilLabel = formatUntil(input.until, input.locale, input.timezone)
  const supportUrl = sanitizeUrl(input.supportUrl)
  const logoUrl = sanitizeUrl(input.logoUrl) ?? '/open-mercato.svg'
  const refreshSeconds = Math.min(MAX_REFRESH_SECONDS, Math.max(30, input.retryAfterSeconds))

  const template = loadInstanceTemplate(input.templatePath)
  if (template) {
    return renderTemplate(template.source, {
      title,
      message,
      until: untilLabel,
      untilIso: input.until ?? '',
      retryAfter: String(input.retryAfterSeconds),
      supportUrl: supportUrl ?? '',
      logoUrl,
      lang: input.locale,
    })
  }

  const untilBlock = input.until && untilLabel
    ? `<p class="until">${escapeHtml(t('maintenance.page.expectedBack', 'Expected back:'))} <time datetime="${escapeHtml(input.until)}">${escapeHtml(untilLabel)}</time></p>`
    : ''
  const logoBlock = `<img src="${escapeHtml(logoUrl)}" alt="">`
  const supportBlock = supportUrl ? `<a href="${escapeHtml(supportUrl)}" rel="noopener">${escapeHtml(t('maintenance.page.contactSupport', 'Contact support'))}</a>` : ''

  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(input.locale)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<meta http-equiv="refresh" content="${refreshSeconds}">`,
    `<title>${escapeHtml(title)}</title>`,
    `<style>${BUILTIN_STYLES}</style>`,
    '</head>',
    '<body>',
    '<main role="main">',
    logoBlock,
    `<h1>${escapeHtml(title)}</h1>`,
    paragraphs(message),
    untilBlock,
    supportBlock,
    '</main>',
    '</body>',
    '</html>',
  ].join('')
}
