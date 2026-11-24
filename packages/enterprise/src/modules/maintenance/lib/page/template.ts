import { readFileSync } from 'node:fs'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { escapeHtml } from './escape'

const logger = createLogger('maintenance').child({ component: 'page-template' })

export const TEMPLATE_PLACEHOLDERS = ['title', 'message', 'until', 'untilIso', 'retryAfter', 'supportUrl', 'logoUrl', 'lang'] as const
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number]
export const REQUIRED_TEMPLATE_PLACEHOLDERS: TemplatePlaceholder[] = ['title', 'message']

export type TemplateValidation = { ok: true } | { ok: false; reason: string }

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z]+)\s*\}\}/g

export function validateTemplate(source: string): TemplateValidation {
  if (/<script\b/i.test(source)) return { ok: false, reason: 'template contains a <script> element' }
  if (/<[^>]*\son[a-z]+\s*=/i.test(source)) return { ok: false, reason: 'template contains an inline event handler' }
  if (/javascript\s*:/i.test(source)) return { ok: false, reason: 'template contains a javascript: URL' }
  if (/<style\b[^>]*>[\s\S]*?\{\{[\s\S]*?<\/style>/i.test(source)) return { ok: false, reason: 'template uses a placeholder inside <style>' }
  if (/\sstyle\s*=\s*("[^"]*\{\{[^"]*"|'[^']*\{\{[^']*')/i.test(source)) return { ok: false, reason: 'template uses a placeholder inside a style attribute' }
  const found = new Set<string>()
  for (const match of source.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1]
    if (!(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(name)) {
      return { ok: false, reason: `template uses unknown placeholder {{${name}}}` }
    }
    found.add(name)
  }
  for (const required of REQUIRED_TEMPLATE_PLACEHOLDERS) {
    if (!found.has(required)) return { ok: false, reason: `template is missing the {{${required}}} placeholder` }
  }
  return { ok: true }
}

export function renderTemplate(source: string, values: Record<TemplatePlaceholder, string>): string {
  return source.replace(PLACEHOLDER_PATTERN, (_match, name: string) => escapeHtml(values[name as TemplatePlaceholder] ?? ''))
}

export type LoadedTemplate = { source: string } | null

const TEMPLATE_CACHE_KEY = '__openMercatoMaintenanceTemplate__'
type TemplateGlobal = typeof globalThis & { [TEMPLATE_CACHE_KEY]?: { path: string; template: LoadedTemplate } }

/** Loads and validates the instance template once per path. Invalid templates log an error and fall back to the built-in page. */
export function loadInstanceTemplate(templatePath: string | null): LoadedTemplate {
  if (!templatePath) return null
  const scope = globalThis as TemplateGlobal
  const cached = scope[TEMPLATE_CACHE_KEY]
  if (cached && cached.path === templatePath) return cached.template
  let template: LoadedTemplate = null
  try {
    const source = readFileSync(templatePath, 'utf8')
    const validation = validateTemplate(source)
    if (validation.ok) template = { source }
    else logger.error('Maintenance page template rejected; serving the built-in page', { templatePath, reason: validation.reason })
  } catch (error) {
    logger.error('Maintenance page template could not be read; serving the built-in page', { templatePath, err: error })
  }
  scope[TEMPLATE_CACHE_KEY] = { path: templatePath, template }
  return template
}

export function resetTemplateCacheForTests(): void {
  delete (globalThis as TemplateGlobal)[TEMPLATE_CACHE_KEY]
}
