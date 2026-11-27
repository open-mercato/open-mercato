import { createHash } from 'node:crypto'
import { escapeHtml } from './escape'
import { BYPASS_PATH } from '../bypass'
import type { MaintenanceTranslate } from './i18n'

/** Strict CSP for self-contained gate pages: no scripts, inline styles pinned by hash. */
export function buildPageContentSecurityPolicy(html: string): string {
  const styleHashes: string[] = []
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    styleHashes.push(`'sha256-${createHash('sha256').update(match[1], 'utf8').digest('base64')}'`)
  }
  return [
    "default-src 'none'",
    `style-src ${styleHashes.length ? styleHashes.join(' ') : "'none'"}`,
    "img-src 'self' https: http: data:",
    "script-src 'none'",
    "script-src-attr 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

const FORM_STYLES = `
:root{color-scheme:light dark;--background:oklch(1 0 0);--foreground:oklch(0.145 0 0);--card:oklch(1 0 0);--border:oklch(0.922 0 0);--muted-foreground:oklch(0.545 0 0);--primary:oklch(0.205 0 0);--primary-foreground:oklch(0.985 0 0);--destructive:oklch(0.577 0.245 27.325)}
@media (prefers-color-scheme:dark){:root{--background:oklch(0.145 0 0);--foreground:oklch(0.985 0 0);--card:oklch(0.205 0 0);--border:oklch(1 0 0 / 10%);--muted-foreground:oklch(0.708 0 0);--primary:oklch(0.922 0 0);--primary-foreground:oklch(0.205 0 0);--destructive:oklch(0.704 0.191 22.216)}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem;background:var(--background);color:var(--foreground);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:1rem;line-height:1.5}
main{width:100%;max-width:28rem;background:var(--card);border:1px solid var(--border);border-radius:0.75rem;padding:2rem}
h1{font-size:1.25rem;line-height:1.75rem;font-weight:600;margin:0 0 0.5rem}
p{margin:0 0 1rem;color:var(--muted-foreground);font-size:0.875rem}
label{display:block;font-size:0.875rem;font-weight:500;margin-bottom:0.25rem}
input{width:100%;padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:0.5rem;background:var(--background);color:var(--foreground);font-size:0.875rem}
button{margin-top:1rem;width:100%;padding:0.5rem 1rem;border:0;border-radius:0.5rem;background:var(--primary);color:var(--primary-foreground);font-size:0.875rem;font-weight:500;cursor:pointer}
.error{color:var(--destructive)}
`

export function renderBypassForm(input: { locale: string; t: MaintenanceTranslate; error: string | null }): string {
  const t = input.t
  const title = t('maintenance.bypass.title', 'Maintenance bypass')
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(input.locale)}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${FORM_STYLES}</style>`,
    '</head><body><main role="main">',
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>${escapeHtml(t('maintenance.bypass.description', 'Enter the bypass token printed by the maintenance command to access the application during this window.'))}</p>`,
    input.error ? `<p class="error" role="alert">${escapeHtml(input.error)}</p>` : '',
    `<form method="post" action="${BYPASS_PATH}" autocomplete="off">`,
    `<label for="token">${escapeHtml(t('maintenance.bypass.tokenLabel', 'Bypass token'))}</label>`,
    '<input id="token" name="token" type="password" required autofocus>',
    `<button type="submit">${escapeHtml(t('maintenance.bypass.submit', 'Continue'))}</button>`,
    '</form></main></body></html>',
  ].join('')
}
