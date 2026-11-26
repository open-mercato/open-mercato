'use client'

import * as React from 'react'
import { ExternalLink } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Anchor, type AnchorItem } from '@open-mercato/ui/primitives/anchor'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { githubFileUrl, issuesUrl, publicSourceUrl } from '@/lib/links'
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

function CopyCommandLine({ blockId }: { blockId: string }) {
  const t = useT()
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>{t('design.entry.copyIntoModuleLabel')}</span>
      <code className="min-w-0 break-all rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
        {`yarn mercato ui add ${blockId} --module <moduleId>`}
      </code>
    </p>
  )
}

function WhenToUse({ usage }: { usage: EntryViewData['usage'] }) {
  const t = useT()
  if (usage.do.length === 0 && usage.dont.length === 0) return null
  return (
    <section className="scroll-mt-20 space-y-4" id="when-to-use" aria-labelledby="entry-when-to-use">
      <h2 id="entry-when-to-use" className="text-xl font-normal text-foreground">{t('design.entry.whenToUse')}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {usage.do.length > 0 ? (
          <div className="rounded-xl border border-border p-4">
            <h3 className="mb-2 text-sm text-status-success-text">{t('design.entry.do')}</h3>
            <ul className="list-disc space-y-2 pl-4 text-sm text-muted-foreground">
              {usage.do.map((rule) => <li key={rule}>{rule}</li>)}
            </ul>
          </div>
        ) : null}
        {usage.dont.length > 0 ? (
          <div className="rounded-xl border border-border p-4">
            <h3 className="mb-2 text-sm text-status-error-text">{t('design.entry.dont')}</h3>
            <ul className="list-disc space-y-2 pl-4 text-sm text-muted-foreground">
              {usage.dont.map((rule) => <li key={rule}>{rule}</li>)}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function UsagePanel({ data }: { data: EntryViewData }) {
  const t = useT()
  return (
    <div className="space-y-12">
      <WhenToUse usage={data.usage} />
      <section className="scroll-mt-20 space-y-8" id="examples" aria-labelledby="entry-examples">
        <h2 id="entry-examples" className="text-xl font-normal text-foreground">{t('design.entry.examples')}</h2>
        {data.variants.map((variant) => (
          <VariantExample key={variant.id} entryId={data.id} variant={variant} />
        ))}
      </section>
      {data.accessibility.length > 0 ? (
        <section className="scroll-mt-20 space-y-4" id="accessibility" aria-labelledby="entry-accessibility">
          <h2 id="entry-accessibility" className="text-xl font-normal text-foreground">{t('design.entry.accessibility')}</h2>
          <ul className="max-w-3xl list-disc space-y-2 pl-4 text-sm text-muted-foreground">
            {data.accessibility.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </section>
      ) : null}
      {data.faq.length > 0 ? (
        <section className="scroll-mt-20 space-y-4" id="faq" aria-labelledby="entry-faq">
          <h2 id="entry-faq" className="text-xl font-normal text-foreground">{t('design.entry.faq')}</h2>
          <dl className="max-w-3xl divide-y divide-border border-y border-border">
            {data.faq.map((item, index) => (
              <div key={item.question} id={`faq-${index}`} className="scroll-mt-20 space-y-1 py-4">
                <dt className="text-base text-foreground">{item.question}</dt>
                <dd className="text-sm text-muted-foreground">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  )
}

function TokensSection({ tokens }: { tokens: string[] }) {
  const t = useT()
  if (tokens.length === 0) return null
  return (
    <section className="space-y-3" aria-labelledby="entry-tokens">
      <h2 id="entry-tokens" className="text-xl font-normal text-foreground">{t('design.api.tokens')}</h2>
      <p className="max-w-3xl text-sm text-muted-foreground">{t('design.api.tokensLead')}</p>
      <ul className="flex flex-wrap gap-2">
        {tokens.map((token) => (
          <li key={token}>
            <code className="inline-flex items-center gap-2 rounded-md border border-border px-2 py-1 font-mono text-xs text-foreground">
              <span aria-hidden className="size-3 rounded-sm border border-border" style={{ background: `var(${token})` }} />
              {token}
            </code>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ApiPanel({ data }: { data: EntryViewData }) {
  const t = useT()
  if (!data.contract) {
    return (
      <div className="space-y-10">
        <div className="space-y-4">
          <p className="max-w-3xl text-sm text-muted-foreground">{t('design.api.notDocumented')}</p>
          <ImportLine importPath={data.importPath} />
        </div>
        <TokensSection tokens={data.tokens} />
      </div>
    )
  }
  return (
    <div className="space-y-10">
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
    <TokensSection tokens={data.tokens} />
    </div>
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

function EntryMeta({ data }: { data: EntryViewData }) {
  const t = useT()
  const linkClass = 'inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
  return (
    <div className="flex flex-col gap-3">
      <ImportLine importPath={data.importPath} />
      {data.group === 'blocks' ? <CopyCommandLine blockId={data.id} /> : null}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {data.since ? <span className="text-sm text-muted-foreground">{t('design.entry.since', { version: data.since })}</span> : null}
        <a href={issuesUrl(data.title)} target="_blank" rel="noreferrer" className={linkClass}>
          {t('design.entry.reportIssue')}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
        <a href={githubFileUrl(data.sources.gallery)} target="_blank" rel="noreferrer" className={linkClass}>
          {t('design.entry.editPage')}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
    </div>
  )
}

function tableOfContents(data: EntryViewData, t: ReturnType<typeof useT>): AnchorItem[] {
  const items: AnchorItem[] = []
  if (data.usage.do.length > 0 || data.usage.dont.length > 0) items.push({ href: '#when-to-use', title: t('design.entry.whenToUse') })
  items.push({
    href: '#examples',
    title: t('design.entry.examples'),
    children: data.variants.map((variant) => ({ href: `#variant-${variant.id}`, title: variant.title })),
  })
  if (data.accessibility.length > 0) items.push({ href: '#accessibility', title: t('design.entry.accessibility') })
  if (data.faq.length > 0) items.push({ href: '#faq', title: t('design.entry.faq') })
  return items
}

export function EntryView({ data }: { data: EntryViewData }) {
  const t = useT()
  const [tab, setTab] = React.useState('usage')
  return (
    <div className="mx-auto flex max-w-7xl gap-10">
      <article className="min-w-0 max-w-6xl flex-1 space-y-8">
        <PageHeader overline={t(`design.nav.${data.group}`)} title={data.title} lead={data.description}>
          <EntryMeta data={data} />
        </PageHeader>
        <Tabs value={tab} onValueChange={setTab} variant="underline" className="min-w-0 space-y-8">
          <TabsList aria-label={t('design.entry.tabsLabel')} className="flex w-full">
            <TabsTrigger value="usage">{t('design.entry.tabUsage')}</TabsTrigger>
            <TabsTrigger value="api">{t('design.entry.tabApi')}</TabsTrigger>
            <TabsTrigger value="source">{t('design.entry.tabSource')}</TabsTrigger>
          </TabsList>
          <TabsContent value="usage"><UsagePanel data={data} /></TabsContent>
          <TabsContent value="api"><ApiPanel data={data} /></TabsContent>
          <TabsContent value="source"><SourcePanel data={data} /></TabsContent>
        </Tabs>
      </article>
      {tab === 'usage' ? (
        <aside className="hidden w-56 shrink-0 xl:block">
          <div className="sticky top-20 max-h-screen overflow-y-auto pb-24">
            <Anchor items={tableOfContents(data, t)} offset={80} label={t('design.entry.onThisPage')} />
          </div>
        </aside>
      ) : null}
    </div>
  )
}
