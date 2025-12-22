"use client"
import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { subscribeProductSeoValidation } from './state'

type SeoData = {
  title?: string | null
  name?: string | null
  description?: string | null
}

type ValidationState = { ok: boolean; issues: string[]; message?: string }

function computeIssues(title: string, description: string): string[] {
  const issues: string[] = []
  if (!title) {
    issues.push('Add a descriptive product title.')
  } else {
    if (title.length < 10) issues.push('Title is too short (min 10 characters).')
    if (title.length > 60) issues.push('Title is too long (max 60 characters recommended).')
  }
  if (!description) {
    issues.push('Add a product description (50+ characters).')
  } else if (description.length < 50) {
    issues.push('Description is too short for good SEO (min 50 characters).')
  }
  return issues
}

export default function ProductSeoWidget({ data }: InjectionWidgetComponentProps<unknown, SeoData>) {
  const title = (data?.title || data?.name || '') ?? ''
  const description = data?.description ?? ''
  const baselineIssues = React.useMemo(() => computeIssues(title, description), [title, description])
  const [validation, setValidation] = React.useState<ValidationState>({ ok: baselineIssues.length === 0, issues: baselineIssues })

  React.useEffect(() => {
    setValidation({ ok: baselineIssues.length === 0, issues: baselineIssues })
  }, [baselineIssues])

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
    if (!title) return { text: 'Missing', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' }
    if (title.length < 10) return { text: 'Too short', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' }
    if (title.length > 60) return { text: 'Too long', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' }
    return { text: 'Good', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' }
  }, [title])

  const descScore = React.useMemo(() => {
    if (!description) return { text: 'Missing', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' }
    if (description.length < 50) return { text: 'Too short', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' }
    return { text: 'Good', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' }
  }, [description])

  const statusBadge = validation.ok ? (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">
      Ready
    </span>
  ) : (
    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 border border-amber-200">
      Needs attention
    </span>
  )

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">SEO Optimization</div>
          <p className="text-xs text-muted-foreground">Keep titles 10–60 chars and descriptions 50+ chars.</p>
        </div>
        {statusBadge}
      </div>

      {validation.message || validation.issues.length ? (
        <div className={`rounded-md border p-3 text-xs ${validation.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          {validation.message ? <div className="font-medium">{validation.message}</div> : null}
          {validation.issues.length ? (
            <ul className="ml-4 list-disc space-y-1 pt-1">
              {validation.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="rounded border bg-muted/30 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Title ({title.length} chars)</span>
          <span className={`font-medium ${titleScore.color}`}>{titleScore.text}</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-muted-foreground">Description ({description.length} chars)</span>
          <span className={`font-medium ${descScore.color}`}>{descScore.text}</span>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Example widget powered by the injection system.{' '}
        <a className="text-primary underline" href="/docs/framework/admin-ui/widget-injection" target="_blank" rel="noreferrer">
          Learn how to build your own
        </a>
        .
      </p>
    </div>
  )
}
