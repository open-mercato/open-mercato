'use client'

import * as React from 'react'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { getAllRegisteredComponents, getAllOverrides } from '@open-mercato/shared/modules/widgets/component-registry'

function print(value: unknown) {
  return JSON.stringify(value ?? null)
}

const hintClassName = 'inline-flex items-center rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-xs text-amber-100/90'

type InterceptorResponse = {
  _example?: {
    serverTimestamp?: string
    processingTimeMs?: number
    intercepted?: boolean
  }
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Phase E — API Interceptors
// ---------------------------------------------------------------------------

function PhaseESection() {
  const [response, setResponse] = React.useState<unknown>(null)
  const [status, setStatus] = React.useState<'idle' | 'pending' | 'ok' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const runRequest = React.useCallback(async (label: string, url: string, init?: RequestInit) => {
    setStatus('pending')
    setErrorMessage(null)
    setResponse(null)
    try {
      if (init?.method === 'POST') {
        const result = await apiCallOrThrow(url, init)
        const json = await result.json().catch(() => ({}))
        setResponse({ label, status: result.status, body: json })
        setStatus('ok')
      } else {
        const result = await readApiResultOrThrow<InterceptorResponse>(url)
        setResponse({ label, body: result })
        setStatus('ok')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed'
      setResponse({ label, error: message })
      setErrorMessage(message)
      setStatus('error')
    }
  }, [])

  const postBlocked = React.useCallback(() => {
    void runRequest('POST blocked', '/api/example/todos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'BLOCKED test' }),
    })
  }, [runRequest])

  const postValid = React.useCallback(() => {
    void runRequest('POST valid', '/api/example/todos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: `Interceptor test ${Date.now()}` }),
    })
  }, [runRequest])

  const getList = React.useCallback(() => {
    void runRequest('GET list', '/api/example/todos?pageSize=3')
  }, [runRequest])

  return (
    <div className="space-y-3 rounded border border-border p-4">
      <div>
        <h2 className="text-lg font-semibold">Phase E — API Interceptors</h2>
        <p className="text-sm text-muted-foreground">
          Tests before/after interceptors on example/todos routes.
        </p>
      </div>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button data-testid="phase-e-blocked-post" type="button" onClick={postBlocked}>
            POST &quot;BLOCKED test&quot;
          </Button>
          <span className={hintClassName}>Expect 422 rejection from block-test-todos interceptor</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button data-testid="phase-e-valid-post" type="button" onClick={postValid}>
            POST valid todo
          </Button>
          <span className={hintClassName}>Expect success — title passes interceptor validation</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button data-testid="phase-e-get-list" type="button" onClick={getList}>
            GET todos list
          </Button>
          <span className={hintClassName}>Expect _example.serverTimestamp in response (after interceptor)</span>
        </div>
      </div>
      <div data-testid="phase-e-status" className="text-xs text-muted-foreground">
        interceptorStatus={status}
      </div>
      {errorMessage ? (
        <div data-testid="phase-e-error" className="text-xs text-destructive">
          {errorMessage}
        </div>
      ) : null}
      <div data-testid="phase-e-response" className="max-h-48 overflow-auto text-xs text-muted-foreground">
        response={print(response)}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Phase F — DataTable Extensions
// ---------------------------------------------------------------------------

function PhaseFSection() {
  return (
    <div className="space-y-3 rounded border border-border p-4">
      <div>
        <h2 className="text-lg font-semibold">Phase F — DataTable Extensions</h2>
        <p className="text-sm text-muted-foreground">
          Injected columns and row actions on the Customers People DataTable.
        </p>
      </div>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild data-testid="phase-f-link-customers" type="button" variant="outline">
            <Link href="/backend/customers/people">Open Customers People</Link>
          </Button>
          <span className={hintClassName}>Look for injected columns and row actions from the example module</span>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        Injected columns and row actions require widget registration in <code>widgets/injection-table.ts</code> and
        corresponding components in <code>widgets/injection/</code>. Check the DataTable for example-prefixed columns
        and row action menu entries.
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Phase G — CrudForm Field Injection
// ---------------------------------------------------------------------------

function PhaseGSection() {
  return (
    <div className="space-y-3 rounded border border-border p-4">
      <div>
        <h2 className="text-lg font-semibold">Phase G — CrudForm Field Injection</h2>
        <p className="text-sm text-muted-foreground">
          Injected fields on CrudForm via the widget injection triad pattern.
        </p>
      </div>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild data-testid="phase-g-link-customer-form" type="button" variant="outline">
            <Link href="/backend/customers/people">Open a Customer edit form</Link>
          </Button>
          <span className={hintClassName}>Click a person row, then check for injected fields from the example module</span>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        The triad pattern: (1) declare widget in <code>widgets/injection/</code>, (2) map slot
        in <code>injection-table.ts</code>, (3) target CrudForm injects via <code>injectionSpotId</code>.
        Injected fields appear alongside native fields in the form.
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Phase H — Component Replacement
// ---------------------------------------------------------------------------

function PhaseHSection() {
  const [componentCount, setComponentCount] = React.useState(0)
  const [overrideCount, setOverrideCount] = React.useState(0)
  const [overrideSummary, setOverrideSummary] = React.useState<string[]>([])

  React.useEffect(() => {
    const update = () => {
      const components = getAllRegisteredComponents()
      const overrides = getAllOverrides()
      setComponentCount(components.length)
      setOverrideCount(overrides.length)
      setOverrideSummary(
        overrides.map((entry) => {
          const mode = 'replacement' in entry.override
            ? 'replace'
            : 'wrapper' in entry.override
              ? 'wrapper'
              : 'propsTransform'
          return `${entry.moduleId} -> ${entry.override.target.componentId} (${mode}, p${entry.override.priority})`
        }),
      )
    }
    update()
    const interval = window.setInterval(update, 1000)
    return () => {
      window.clearInterval(interval)
    }
  }, [])

  return (
    <div className="space-y-3 rounded border border-border p-4">
      <div>
        <h2 className="text-lg font-semibold">Phase H — Component Replacement</h2>
        <p className="text-sm text-muted-foreground">
          Component registry status — registered replaceable components and active overrides.
        </p>
      </div>
      <div className="grid gap-2 text-xs text-muted-foreground">
        <div data-testid="phase-h-component-count">
          registeredComponents={componentCount}
        </div>
        <div data-testid="phase-h-override-count">
          activeOverrides={overrideCount}
        </div>
        {overrideSummary.length > 0 ? (
          <div data-testid="phase-h-override-summary" className="grid gap-1">
            {overrideSummary.map((line, index) => (
              <div key={index}>{line}</div>
            ))}
          </div>
        ) : (
          <div data-testid="phase-h-override-summary" className="text-amber-500">
            No component overrides registered
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Combined export
// ---------------------------------------------------------------------------

export default function PhaseEHSections() {
  return (
    <>
      <PhaseESection />
      <PhaseFSection />
      <PhaseGSection />
      <PhaseHSection />
    </>
  )
}
