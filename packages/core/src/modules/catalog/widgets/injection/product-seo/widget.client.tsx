"use client"
import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { subscribeProductSeoValidation } from './state'
import { useT } from '@/lib/i18n/context'

type SeoData = {
  title?: string | null
  name?: string | null
  description?: string | null
}

type ValidationState = { ok: boolean; issues: string[]; message?: string }

type IssueKey = 'addTitle' | 'titleTooShort' | 'titleTooLong' | 'addDescription' | 'descriptionTooShort'

function computeIssueKeys(title: string, description: string): IssueKey[] {
  const issues: IssueKey[] = []
  if (!title) {
    issues.push('addTitle')
  } else {
    if (title.length < 10) issues.push('titleTooShort')
    if (title.length > 60) issues.push('titleTooLong')
  }
  if (!description) {
    issues.push('addDescription')
  } else if (description.length < 50) {
    issues.push('descriptionTooShort')
  }
  return issues
}

export default function ProductSeoWidget({ data }: InjectionWidgetComponentProps<unknown, SeoData>) {
  const t = useT()
  const title = (data?.title || data?.name || '') ?? ''
  const description = data?.description ?? ''
  const baselineIssueKeys = React.useMemo(() => computeIssueKeys(title, description), [title, description])
  const [validation, setValidation] = React.useState<ValidationState>({ ok: baselineIssueKeys.length === 0, issues: baselineIssueKeys })

  React.useEffect(() => {
    setValidation({ ok: baselineIssueKeys.length === 0, issues: baselineIssueKeys })
  }, [baselineIssueKeys])

  React.useEffect(() => {
    return subscribeProductSeoValidation((payload) => {
      setValidation({
        ok: payload.ok,
        issues: payload.issues,
        message: payload.message,
      })
    })
  }, [])

  const titleScore = React.useMemo(() => {
    if (!title) return { text: t('catalog.products.create.seoWidget.missing', 'Missing'), color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' }
    if (title.length < 10) return { text: t('catalog.products.create.seoWidget.tooShort', 'Too short'), color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' }
    if (title.length > 60) return { text: t('catalog.products.create.seoWidget.tooLong', 'Too long'), color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' }
    return { text: t('catalog.products.create.seoWidget.good', 'Good'), color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' }
  }, [title, t])

  const descScore = React.useMemo(() => {
    if (!description) return { text: t('catalog.products.create.seoWidget.missing', 'Missing'), color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' }
    if (description.length < 50) return { text: t('catalog.products.create.seoWidget.tooShort', 'Too short'), color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' }
    return { text: t('catalog.products.create.seoWidget.good', 'Good'), color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' }
  }, [description, t])

  const statusBadge = validation.ok ? (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">
      {t('catalog.products.create.seoWidget.ready', 'Ready')}
    </span>
  ) : (
    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 border border-amber-200">
      {t('catalog.products.create.seoWidget.needsAttention', 'Needs attention')}
    </span>
  )

  const translateIssue = (issueKey: string): string => {
    return t(`catalog.products.create.seoWidget.issues.${issueKey}`, issueKey)
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">{t('catalog.products.create.seoWidget.title', 'SEO Optimization')}</div>
          <p className="text-xs text-muted-foreground">{t('catalog.products.create.seoWidget.hint', 'Keep titles 10–60 chars and descriptions 50+ chars.')}</p>
        </div>
        {statusBadge}
      </div>

      {validation.message || validation.issues.length ? (
        <div className={`rounded-md border p-3 text-xs ${validation.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          {validation.message ? <div className="font-medium">{validation.message}</div> : null}
          {validation.issues.length ? (
            <ul className="ml-4 list-disc space-y-1 pt-1">
              {validation.issues.map((issue) => (
                <li key={issue}>{translateIssue(issue)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="rounded border bg-muted/30 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t('catalog.products.create.seoWidget.titleLabel', 'Title ({{count}} chars)', { count: title.length })}</span>
          <span className={`font-medium ${titleScore.color}`}>{titleScore.text}</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-muted-foreground">{t('catalog.products.create.seoWidget.descriptionLabel', 'Description ({{count}} chars)', { count: description.length })}</span>
          <span className={`font-medium ${descScore.color}`}>{descScore.text}</span>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {t('catalog.products.create.seoWidget.footer', 'Example widget powered by the injection system.')}{' '}
        <a className="text-primary underline" href="/docs/framework/admin-ui/widget-injection" target="_blank" rel="noreferrer">
          {t('catalog.products.create.seoWidget.learnMore', 'Learn how to build your own')}
        </a>
        .
      </p>
    </div>
  )
}
