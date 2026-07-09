import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export type ProductSeoEvaluation = {
  ok: boolean
  issues: string[]
  fieldErrors: Record<string, string>
  message?: string
}

// English-fallback translator: keeps this pure module usable (and unit-testable)
// when no real `t` is threaded in — every string still ships its English default,
// interpolating `{{param}}` placeholders the same way the real translator does.
const englishFallback: TranslateFn = (_key, fallbackOrParams, params) => {
  const template = typeof fallbackOrParams === 'string' ? fallbackOrParams : ''
  const resolvedParams = typeof fallbackOrParams === 'string' ? params : fallbackOrParams
  if (!resolvedParams) return template
  return template.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (match, doubleKey, singleKey) => {
    const key = doubleKey ?? singleKey
    const value = resolvedParams[key]
    return value === undefined ? match : String(value)
  })
}

const K = 'catalog.products.create.seoWidget.validation'

export function buildSeoBlockMessage(issues: string[], t: TranslateFn = englishFallback): string {
  if (issues.length <= 3) {
    return t(`${K}.block.list`, 'SEO helper: {{issues}}', { issues: issues.join(' ') })
  }
  return t(`${K}.block.summary`, 'SEO helper: {{count}} issues found. {{issues}}', {
    count: issues.length,
    issues: issues.slice(0, 2).join(' '),
  })
}

export function evaluateProductSeo(
  data: Record<string, unknown> | null | undefined,
  t: TranslateFn = englishFallback,
): ProductSeoEvaluation {
  const issues: string[] = []
  const fieldErrors: Record<string, string> = {}

  const title = (data?.title as unknown) || (data?.name as unknown)
  if (typeof title === 'string' && title.length > 0) {
    if (title.length < 10) {
      issues.push(t(`${K}.issue.titleTooShort`, 'Title is too short (min 10 characters).'))
      fieldErrors.title = t(`${K}.fieldError.titleTooShort`, 'Title is too short for good SEO (min 10 characters).')
    } else if (title.length > 60) {
      issues.push(t(`${K}.issue.titleTooLong`, 'Title is too long (max 60 characters recommended).'))
      fieldErrors.title = t(`${K}.fieldError.titleTooLong`, 'Title is too long for optimal SEO (max 60 characters).')
    }
  }

  const description = data?.description
  if (typeof description === 'string') {
    if (description.trim().length === 0) {
      issues.push(t(`${K}.issue.descriptionMissing`, 'Add a product description for better SEO.'))
      fieldErrors.description = t(`${K}.fieldError.descriptionMissing`, 'Provide a description to help search engines understand this product.')
    } else if (description.length < 50) {
      issues.push(t(`${K}.issue.descriptionTooShort`, 'Description is too short (min 50 characters).'))
      fieldErrors.description = t(`${K}.fieldError.descriptionTooShort`, 'Description is too short for good SEO (min 50 characters).')
    }
  }

  if (issues.length) {
    return { ok: false, issues, fieldErrors, message: buildSeoBlockMessage(issues, t) }
  }

  return { ok: true, issues: [], fieldErrors: {} }
}
