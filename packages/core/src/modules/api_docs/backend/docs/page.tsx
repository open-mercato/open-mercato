import { getApiDocsResources, resolveApiDocsBaseUrl } from '@open-mercato/core/modules/api_docs/lib/resources'

export default async function ApiDocsPage() {
  const baseUrl = resolveApiDocsBaseUrl()
  const resources = getApiDocsResources()

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">API resources</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Use the links below to explore the Open Mercato platform APIs. The OpenAPI exports are generated from the current module registry.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {resources.map((resource) => (
          <div key={resource.href} className="rounded border bg-card p-4 h-full flex flex-col justify-between">
            <div className="space-y-1.5">
              <div className="text-base font-semibold">{resource.label}</div>
              <p className="text-sm text-muted-foreground">{resource.description}</p>
            </div>
            <div className="pt-4">
              <a
                href={resource.href}
                target={resource.external ? '_blank' : undefined}
                rel={resource.external ? 'noreferrer' : undefined}
                className="inline-flex items-center text-sm font-medium text-primary hover:underline"
              >
                {resource.actionLabel ?? (resource.external ? 'Open docs' : 'Open link')}
              </a>
            </div>
          </div>
        ))}
      </div>
      <div className="rounded border bg-muted/30 p-4 text-sm text-muted-foreground space-y-2">
        <p>
          Current environment base URL:{' '}
          <code className="rounded bg-background px-2 py-0.5 text-xs text-foreground">{baseUrl}</code>
        </p>
        <p>
          Run <code className="rounded bg-background px-2 py-0.5 text-xs text-foreground">npm run modules:prepare</code>{' '}
          whenever APIs change to refresh the generated registry.
        </p>
      </div>
    </div>
  )
}
