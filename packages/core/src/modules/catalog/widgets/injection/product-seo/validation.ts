export type ProductSeoEvaluation = {
  ok: boolean
  issues: string[]
  fieldErrors: Record<string, string>
  message?: string
}

const MESSAGE_PREFIX = 'SEO helper: '

export function buildSeoBlockMessage(issues: string[]): string {
  if (issues.length === 1) return `${MESSAGE_PREFIX}${issues[0]}`
  if (issues.length <= 3) return `${MESSAGE_PREFIX}${issues.join(' ')}`
  return `${MESSAGE_PREFIX}${issues.length} issues found. ${issues.slice(0, 2).join(' ')}`
}

export function evaluateProductSeo(data: Record<string, unknown> | null | undefined): ProductSeoEvaluation {
  const issues: string[] = []
  const fieldErrors: Record<string, string> = {}

  const title = (data?.title as unknown) || (data?.name as unknown)
  if (typeof title === 'string' && title.length > 0) {
    if (title.length < 10) {
      issues.push('Title is too short (min 10 characters).')
      fieldErrors.title = 'Title is too short for good SEO (min 10 characters).'
    } else if (title.length > 60) {
      issues.push('Title is too long (max 60 characters recommended).')
      fieldErrors.title = 'Title is too long for optimal SEO (max 60 characters).'
    }
  }

  const description = data?.description
  if (typeof description === 'string') {
    if (description.trim().length === 0) {
      issues.push('Add a product description for better SEO.')
      fieldErrors.description = 'Provide a description to help search engines understand this product.'
    } else if (description.length < 50) {
      issues.push('Description is too short (min 50 characters).')
      fieldErrors.description = 'Description is too short for good SEO (min 50 characters).'
    }
  }

  if (issues.length) {
    return { ok: false, issues, fieldErrors, message: buildSeoBlockMessage(issues) }
  }

  return { ok: true, issues: [], fieldErrors: {} }
}
