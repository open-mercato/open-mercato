import { getAuthFromCookies } from '@/lib/auth/server'
import { redirect } from 'next/navigation'
import { DashboardScreen } from '@open-mercato/ui/backend/dashboard'
import { getApiDocsResources, resolveApiDocsBaseUrl } from '@open-mercato/core/modules/api_docs/lib/resources'

export default async function BackendIndex() {
  const auth = await getAuthFromCookies()
  if (!auth) redirect('/api/auth/session/refresh?redirect=/backend')
  const apiDocs = getApiDocsResources()
  const baseUrl = resolveApiDocsBaseUrl()
  return (
    <div className="p-6 space-y-6">
      <DashboardScreen />
      <section className="rounded border bg-card p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">API resources</h2>
            <p className="text-sm text-muted-foreground">
              Quick links to the official documentation and machine-readable OpenAPI exports.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {apiDocs.map((resource) => (
            <a
              key={resource.href}
              href={resource.href}
              target={resource.external ? '_blank' : undefined}
              rel={resource.external ? 'noreferrer' : undefined}
              className="rounded border bg-background p-3 text-sm transition hover:border-primary"
            >
              <div className="font-medium text-foreground">{resource.label}</div>
              <p className="mt-1 text-xs text-muted-foreground">{resource.description}</p>
              <span className="mt-3 inline-flex text-xs font-medium text-primary">{resource.actionLabel ?? 'Open link'}</span>
            </a>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Current API base URL:{' '}
          <code className="rounded bg-muted px-2 py-0.5 text-[10px] text-foreground">{baseUrl}</code>
        </p>
      </section>
    </div>
  )
}
