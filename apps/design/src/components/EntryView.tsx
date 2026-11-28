'use client'

import * as React from 'react'
import { Check, ChevronDown, ExternalLink, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Anchor, type AnchorItem } from '@open-mercato/ui/primitives/anchor'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { entryTabSearch, parseEntryTab, resolveEntryTab, tabForHash, tabsForGroup, type EntryTab } from '@/lib/entry-tabs'
import { GROUP_LABEL_FALLBACKS } from '@/lib/groups'
import { githubFileUrl, issuesUrl, publicSourceUrl } from '@/lib/links'
import { splitRuleText } from '@/lib/rule-text'
import type { EntryViewData } from './entry-types'
import { PageHeader } from './PageHeader'
import { PropsTable } from './PropsTable'
import { StatesMatrix } from './StatesMatrix'
import { UsageVisuals, hasUsageVisuals, visibleUsageRules } from './UsageVisuals'
import { VariantExample } from './VariantExample'

function ImportLine({ importPath, source = false }: { importPath: string; source?: boolean }) {
  const t = useT()
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>{source ? t('design.entry.sourceLabel', 'Source') : t('design.entry.importLabel')}</span>
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

const VISIBLE_RULES = 3

function RuleList({ tone, title, rules }: { tone: 'do' | 'avoid'; title: string; rules: string[] }) {
  const t = useT()
  const [expanded, setExpanded] = React.useState(false)
  const listId = React.useId()
  const Icon = tone === 'do' ? Check : X
  const iconTone = tone === 'do' ? 'bg-status-success-bg text-status-success-icon' : 'bg-status-error-bg text-status-error-icon'
  const markTone = tone === 'do' ? 'text-status-success-icon' : 'text-status-error-icon'
  const hasMore = rules.length > VISIBLE_RULES
  const shown = expanded || !hasMore ? rules : rules.slice(0, VISIBLE_RULES)
  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-border bg-card" data-usage-tone={tone}>
      <h3 className="flex items-center gap-2 px-panel pt-3 text-sm font-normal text-foreground">
        <span aria-hidden className={`flex size-5 items-center justify-center rounded-full ${iconTone}`}>
          <Icon className="size-3" />
        </span>
        {title}
      </h3>
      <ul id={listId} className="px-panel py-2">
        {shown.map((rule) => (
          <li key={rule} className="flex gap-2 py-1 text-sm leading-5 text-foreground">
            <span aria-hidden className="flex h-5 shrink-0 items-center"><Icon className={`size-4 ${markTone}`} /></span>
            <span className="min-w-0">
              {splitRuleText(rule).map((part, index) =>
                part.kind === 'code'
                  ? <code key={index} className="rounded-sm bg-muted px-1 font-mono text-xs text-foreground">{part.value}</code>
                  : <React.Fragment key={index}>{part.value}</React.Fragment>,
              )}
            </span>
          </li>
        ))}
      </ul>
      {hasMore ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
          className="flex h-8 items-center gap-1 border-t border-border px-panel text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:shadow-focus"
        >
          {expanded
            ? t('design.entry.showFewerRules', 'Show fewer')
            : t('design.entry.showAllRules', 'Show all {count}', { count: rules.length })}
          <ChevronDown aria-hidden className={`size-4 ${expanded ? 'rotate-180' : ''}`} />
        </button>
      ) : null}
    </div>
  )
}

function WhenToUse({ entryId, usage }: { entryId: string; usage: EntryViewData['usage'] }) {
  const t = useT()
  const withVisuals = hasUsageVisuals(entryId)
  if (usage.do.length === 0 && usage.dont.length === 0 && !withVisuals) return null
  const rules = visibleUsageRules(entryId, usage)
  return (
    <section className="scroll-mt-20 space-y-4" id="when-to-use" aria-labelledby="entry-when-to-use">
      <h2 id="entry-when-to-use" className="text-xl font-normal text-foreground">{t('design.entry.whenToUse')}</h2>
      <UsageVisuals entryId={entryId} />
      {rules.do.length > 0 || rules.dont.length > 0 ? (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {rules.do.length > 0 ? <RuleList tone="do" title={t('design.entry.do')} rules={rules.do} /> : null}
          {rules.dont.length > 0 ? <RuleList tone="avoid" title={t('design.entry.dont')} rules={rules.dont} /> : null}
        </div>
      ) : null}
    </section>
  )
}

function ExamplesPanel({ data }: { data: EntryViewData }) {
  const t = useT()
  return (
    <section className="scroll-mt-20 space-y-8" id="examples" aria-label={t('design.entry.examples')}>
      {data.variants.map((variant) => (
        <VariantExample key={variant.id} entryId={data.id} variant={variant} />
      ))}
    </section>
  )
}

function UsagePanel({ data }: { data: EntryViewData }) {
  const t = useT()
  return (
    <div className="space-y-12">
      <WhenToUse entryId={data.id} usage={data.usage} />
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
  const local = data.group === 'blocks' || data.group === 'screens'
  return (
    <div className="space-y-4">
      {data.sources.component ? null : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t('design.source.noFile')}</p>
          <ImportLine importPath={data.importPath} />
        </div>
      )}
      <ul className="space-y-3">
        {data.sources.component ? <SourceLink local={local} label={data.group === 'screens' ? t('design.source.screen', 'Screen source') : t('design.source.component')} path={data.sources.component} /> : null}
        {data.sources.contract ? <SourceLink local={local} label={t('design.source.contract')} path={data.sources.contract} /> : null}
        <SourceLink local={local} label={t('design.source.gallery')} path={data.sources.gallery} />
      </ul>
    </div>
  )
}

function EntryMeta({ data }: { data: EntryViewData }) {
  const t = useT()
  const linkClass = 'inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
  return (
    <div className="flex flex-col gap-3">
      <ImportLine importPath={data.importPath} source={data.group === 'screens'} />
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

function hasUsageContent(data: EntryViewData): boolean {
  return data.usage.do.length > 0 || data.usage.dont.length > 0 || hasUsageVisuals(data.id) || data.accessibility.length > 0 || data.faq.length > 0
}

function examplesContents(data: EntryViewData): AnchorItem[] {
  return data.variants.map((variant) => ({ href: `#variant-${variant.id}`, title: variant.title }))
}

function usageContents(data: EntryViewData, t: ReturnType<typeof useT>): AnchorItem[] {
  const items: AnchorItem[] = []
  if (data.usage.do.length > 0 || data.usage.dont.length > 0 || hasUsageVisuals(data.id)) items.push({ href: '#when-to-use', title: t('design.entry.whenToUse') })
  if (data.accessibility.length > 0) items.push({ href: '#accessibility', title: t('design.entry.accessibility') })
  if (data.faq.length > 0) items.push({ href: '#faq', title: t('design.entry.faq') })
  return items
}

function PanelWithContents({ items, label, children }: { items: AnchorItem[]; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-10">
      <div className="min-w-0 flex-1">{children}</div>
      <aside className="hidden w-56 shrink-0 xl:block">
        {items.length > 1 ? (
          <div className="sticky top-20 max-h-screen overflow-y-auto pb-24">
            <Anchor items={items} offset={80} label={label} />
          </div>
        ) : null}
      </aside>
    </div>
  )
}

function replaceLocation(search: string, hash: string): void {
  window.history.replaceState(null, '', `${window.location.pathname}${search}${hash}`)
}

export function EntryView({ data }: { data: EntryViewData }) {
  const t = useT()
  const [tab, setTab] = React.useState<EntryTab>('examples')
  const [pendingAnchor, setPendingAnchor] = React.useState<string | null>(null)
  const showStates = tabsForGroup(data.group).includes('states')
  const showApi = tabsForGroup(data.group).includes('api')
  const showUsage = hasUsageContent(data)

  React.useEffect(() => {
    const read = () => setTab(parseEntryTab(window.location.search, data.group))
    const fromHash = window.location.search.includes('tab=') ? null : tabForHash(window.location.hash)
    if (fromHash) setTab(fromHash)
    else read()
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [data.group])

  React.useEffect(() => {
    if (tab !== 'examples' || !pendingAnchor) return
    document.getElementById(pendingAnchor)?.scrollIntoView({ block: 'start' })
    replaceLocation(entryTabSearch(window.location.search, 'examples'), `#${pendingAnchor}`)
    setPendingAnchor(null)
  }, [tab, pendingAnchor])

  const selectTab = (value: string) => {
    const next = resolveEntryTab(value, data.group)
    setTab(next)
    replaceLocation(entryTabSearch(window.location.search, next), '')
  }

  const openVariant = (variantId: string) => {
    setPendingAnchor(`variant-${variantId}`)
    setTab('examples')
  }

  return (
    <div className="mx-auto flex max-w-7xl gap-10">
      <article className="min-w-0 max-w-6xl flex-1 space-y-8">
        <PageHeader overline={t(`design.nav.${data.group}`, GROUP_LABEL_FALLBACKS[data.group])} title={data.title} lead={data.description} />
        <Tabs value={tab === 'usage' && !showUsage ? 'examples' : tab} onValueChange={selectTab} variant="underline" className="min-w-0 space-y-8">
          <TabsList aria-label={t('design.entry.tabsLabel')} className="flex w-full">
            <TabsTrigger value="examples">{t('design.entry.tabExamples', 'Examples')}</TabsTrigger>
            {showUsage ? <TabsTrigger value="usage">{t('design.entry.tabUsage')}</TabsTrigger> : null}
            {showApi ? <TabsTrigger value="api">{t('design.entry.tabApi')}</TabsTrigger> : null}
            <TabsTrigger value="source">{t('design.entry.tabSource')}</TabsTrigger>
            {showStates ? <TabsTrigger value="states">{t('design.entry.tabStates')}</TabsTrigger> : null}
          </TabsList>
          <TabsContent value="examples">
            <PanelWithContents items={examplesContents(data)} label={t('design.entry.onThisPage')}><ExamplesPanel data={data} /></PanelWithContents>
          </TabsContent>
          {showUsage ? (
            <TabsContent value="usage">
              <PanelWithContents items={usageContents(data, t)} label={t('design.entry.onThisPage')}><UsagePanel data={data} /></PanelWithContents>
            </TabsContent>
          ) : null}
          {showApi ? <TabsContent value="api"><div className="space-y-10"><EntryMeta data={data} /><ApiPanel data={data} /></div></TabsContent> : null}
          <TabsContent value="source"><div className="space-y-10">{showApi ? null : <EntryMeta data={data} />}<SourcePanel data={data} /></div></TabsContent>
          {showStates ? (
            <TabsContent value="states">
              <StatesMatrix entryId={data.id} group={data.group} title={data.title} variants={data.variants} onOpenVariant={openVariant} />
            </TabsContent>
          ) : null}
        </Tabs>
      </article>
    </div>
  )
}
