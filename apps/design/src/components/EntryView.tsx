'use client'

import * as React from 'react'
import { ExternalLink } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { githubFileUrl, publicSourceUrl } from '@/lib/links'
import type { EntryViewData } from './entry-types'
import { PageHeader } from './PageHeader'
import { PropsTable } from './PropsTable'
import { VariantExample } from './VariantExample'

function ImportLine({ importPath }: { importPath: string }) {
  const t = useT()
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>{t('design.entry.importLabel')}</span>
      <code className="min-w-0 break-all rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">{importPath}</code>
    </p>
  )
}

function UsagePanel({ data }: { data: EntryViewData }) {
  const t = useT()
  const hasGuidelines = data.usage.do.length > 0 || data.usage.dont.length > 0
  return (
    <div className="space-y-10">
      <section className="space-y-8" aria-labelledby="entry-examples">
        <h2 id="entry-examples" className="text-xl font-normal text-foreground">{t('design.entry.examples')}</h2>
        {data.variants.map((variant) => (
          <VariantExample key={variant.id} entryId={data.id} variant={variant} />
        ))}
      </section>
      {hasGuidelines ? (
        <section className="space-y-4" aria-labelledby="entry-guidelines">
          <h2 id="entry-guidelines" className="text-xl font-normal text-foreground">{t('design.entry.guidelines')}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {data.usage.do.length > 0 ? (
              <div className="rounded-xl border border-border p-4">
                <h3 className="mb-2 text-sm text-status-success-text">{t('design.entry.do')}</h3>
                <ul className="list-disc space-y-2 pl-4 text-sm text-muted-foreground">
                  {data.usage.do.map((rule) => <li key={rule}>{rule}</li>)}
                </ul>
              </div>
            ) : null}
            {data.usage.dont.length > 0 ? (
              <div className="rounded-xl border border-border p-4">
                <h3 className="mb-2 text-sm text-status-error-text">{t('design.entry.dont')}</h3>
                <ul className="list-disc space-y-2 pl-4 text-sm text-muted-foreground">
                  {data.usage.dont.map((rule) => <li key={rule}>{rule}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function ApiPanel({ data }: { data: EntryViewData }) {
  const t = useT()
  if (!data.contract) {
    return (
      <div className="space-y-4">
        <p className="max-w-3xl text-sm text-muted-foreground">{t('design.api.notDocumented')}</p>
        <ImportLine importPath={data.importPath} />
      </div>
    )
  }
  return (
    <section className="space-y-4" aria-labelledby="entry-props">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="entry-props" className="text-xl font-normal text-foreground">{t('design.api.title')}</h2>
        <a
          href={data.group === 'blocks' ? publicSourceUrl(data.contract.file) : githubFileUrl(data.contract.file)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {t('design.api.contractSource')}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
      <PropsTable rows={data.contract.rows} />
    </section>
  )
}

function SourceLink({ label, path, local }: { label: string; path: string; local: boolean }) {
  const t = useT()
  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="min-w-0 space-y-1">
        <span className="block text-sm text-foreground">{label}</span>
        <code className="block break-all font-mono text-xs text-muted-foreground">{path}</code>
      </span>
      <a
        href={local ? publicSourceUrl(path) : githubFileUrl(path)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-1 text-sm text-foreground underline-offset-4 hover:underline"
      >
        {t(local ? 'design.source.openFile' : 'design.source.openOnGithub')}
        <ExternalLink className="size-3.5" aria-hidden />
      </a>
    </li>
  )
}

function SourcePanel({ data }: { data: EntryViewData }) {
  const t = useT()
  return (
    <div className="space-y-4">
      {data.sources.component ? null : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t('design.source.noFile')}</p>
          <ImportLine importPath={data.importPath} />
        </div>
      )}
      <ul className="space-y-3">
        {data.sources.component ? <SourceLink local={data.group === 'blocks'} label={t('design.source.component')} path={data.sources.component} /> : null}
        {data.sources.contract ? <SourceLink local={data.group === 'blocks'} label={t('design.source.contract')} path={data.sources.contract} /> : null}
        <SourceLink local={data.group === 'blocks'} label={t('design.source.gallery')} path={data.sources.gallery} />
      </ul>
    </div>
  )
}

export function EntryView({ data }: { data: EntryViewData }) {
  const t = useT()
  return (
    <article className="mx-auto max-w-6xl space-y-8">
      <PageHeader overline={t(`design.nav.${data.group}`)} title={data.title} lead={data.description}>
        <ImportLine importPath={data.importPath} />
      </PageHeader>
      <Tabs defaultValue="usage" variant="underline" className="min-w-0 space-y-8">
        <TabsList aria-label={t('design.entry.tabsLabel')}>
          <TabsTrigger value="usage">{t('design.entry.tabUsage')}</TabsTrigger>
          <TabsTrigger value="api">{t('design.entry.tabApi')}</TabsTrigger>
          <TabsTrigger value="source">{t('design.entry.tabSource')}</TabsTrigger>
        </TabsList>
        <TabsContent value="usage"><UsagePanel data={data} /></TabsContent>
        <TabsContent value="api"><ApiPanel data={data} /></TabsContent>
        <TabsContent value="source"><SourcePanel data={data} /></TabsContent>
      </Tabs>
    </article>
  )
}
