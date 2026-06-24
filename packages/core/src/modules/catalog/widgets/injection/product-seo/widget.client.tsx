"use client"
import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { subscribeProductSeoValidation } from './state'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { Alert } from '@open-mercato/ui/primitives/alert'

type SeoData = {
  title?: string | null
  name?: string | null
  description?: string | null
}

type ValidationState = { ok: boolean; issues: string[]; message?: string }

type IssueKey = 'addTitle' | 'titleTooShort' | 'titleTooLong' | 'addDescription' | 'descriptionTooShort'

type SeoScore = { text: string; variant: StatusBadgeVariant }

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

  const titleScore = React.useMemo<SeoScore>(() => {
    if (!title) return { text: t('catalog.products.create.seoWidget.missing', 'Missing'), variant: 'error' }
    if (title.length < 10) return { text: t('catalog.products.create.seoWidget.tooShort', 'Too short'), variant: 'warning' }
    if (title.length > 60) return { text: t('catalog.products.create.seoWidget.tooLong', 'Too long'), variant: 'warning' }
    return { text: t('catalog.products.create.seoWidget.good', 'Good'), variant: 'success' }
  }, [title, t])

  const descScore = React.useMemo<SeoScore>(() => {
    if (!description) return { text: t('catalog.products.create.seoWidget.missing', 'Missing'), variant: 'error' }
    if (description.length < 50) return { text: t('catalog.products.create.seoWidget.tooShort', 'Too short'), variant: 'warning' }
    return { text: t('catalog.products.create.seoWidget.good', 'Good'), variant: 'success' }
  }, [description, t])

  const statusBadge = validation.ok ? (
    <StatusBadge variant="success">
      {t('catalog.products.create.seoWidget.ready', 'Ready')}
    </StatusBadge>
  ) : (
    <StatusBadge variant="warning">
      {t('catalog.products.create.seoWidget.needsAttention', 'Needs attention')}
    </StatusBadge>
  )

  const translateIssue = (issueKey: string): string => {
    return t(`catalog.products.create.seoWidget.issues.${issueKey}`, issueKey)
  }

  return (
    <div className="mt-4 w-full space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">{t('catalog.products.create.seoWidget.title', 'SEO Optimization')}</div>
          <p className="text-xs text-muted-foreground">{t('catalog.products.create.seoWidget.hint', 'Keep titles 10–60 chars and descriptions 50+ chars.')}</p>
        </div>
        {statusBadge}
      </div>

      {validation.message || validation.issues.length ? (
        <Alert
          status={validation.ok ? 'success' : 'warning'}
          style="lighter"
          size="sm"
          showIcon={false}
          className="text-xs"
        >
          {validation.message ? <div className="font-medium">{validation.message}</div> : null}
          {validation.issues.length ? (
            <ul className="ml-4 list-disc space-y-1 pt-1">
              {validation.issues.map((issue) => (
                <li key={issue}>{translateIssue(issue)}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <div className="rounded border bg-muted/30 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t('catalog.products.create.seoWidget.titleLabel', 'Title ({{count}} chars)', { count: title.length })}</span>
          <StatusBadge variant={titleScore.variant}>{titleScore.text}</StatusBadge>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-muted-foreground">{t('catalog.products.create.seoWidget.descriptionLabel', 'Description ({{count}} chars)', { count: description.length })}</span>
          <StatusBadge variant={descScore.variant}>{descScore.text}</StatusBadge>
        </div>
      </div>

      <p className="text-overline text-muted-foreground">
        {t('catalog.products.create.seoWidget.footer', 'Example widget powered by the injection system.')}{' '}
        <a className="text-primary underline" href="/docs/framework/admin-ui/widget-injection" target="_blank" rel="noreferrer">
          {t('catalog.products.create.seoWidget.learnMore', 'Learn how to build your own')}
        </a>
        .
      </p>
    </div>
  )
}
