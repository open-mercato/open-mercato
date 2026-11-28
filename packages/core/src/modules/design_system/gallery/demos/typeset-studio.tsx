'use client'

import * as React from 'react'
import { Copy } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { createTypesetStylesheet, typesetPresets, typesetRules, typesetVariables, type TypesetContext, type TypesetSettings } from '@open-mercato/ui/theme/typeset'

const prefix = 'design_system.foundations.typeset.'
const controls = [
  { key: 'size', values: [16, 18, 20], unit: ' px' },
  { key: 'leading', values: [1.5, 1.65, 1.8], unit: '' },
  { key: 'measure', values: [48, 54, 66, 72], unit: ' ch' },
] as const

function Specimen({ context }: { context: TypesetContext }) {
  const t = useT()
  const locale = useLocale()
  if (context === 'document') {
    return <>
      <p data-type="meta">{t(prefix + 'handbook')}</p>
      <h1>{t(prefix + 'docTitle')}</h1>
      <p>{t(prefix + 'intro')}</p>
      <h2>{t(prefix + 'checklist')}</h2>
      <ol><li>{t(prefix + 'inspect')}</li><li>{t(prefix + 'confirm')}</li></ol>
      <blockquote>{t(prefix + 'note')}</blockquote>
    </>
  }
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' })
  return <>
    <p data-type="meta">{t(prefix + 'order')} · <span data-type="id">WO-2048</span></p>
    <h1>{t(prefix + 'recordTitle')}</h1>
    <dl>
      <div><dt>{t(prefix + 'location')}</dt><dd>{t(prefix + 'workshop')}</dd></div>
      <div><dt>{t(prefix + 'status')}</dt><dd>{t(prefix + 'approved')}</dd></div>
    </dl>
    <h2>{t(prefix + 'estimate')}</h2>
    <table aria-label={t(prefix + 'estimate')}>
      <thead><tr><th scope="col">{t(prefix + 'item')}</th><th scope="col" data-type="amount">{t(prefix + 'amount')}</th></tr></thead>
      <tbody>
        <tr><td>{t(prefix + 'labor')}</td><td data-type="amount">{money.format(240)}</td></tr>
        <tr><td>{t(prefix + 'parts')}</td><td data-type="amount">{money.format(38.5)}</td></tr>
      </tbody>
      <tfoot><tr><th scope="row">{t(prefix + 'total')}</th><td data-type="amount"><strong>{money.format(278.5)}</strong></td></tr></tfoot>
    </table>
  </>
}

export function TypesetStudio() {
  const t = useT()
  const [context, setContext] = React.useState<TypesetContext>('record')
  const [presets, setPresets] = React.useState(typesetPresets)
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'copyError'>('idle')
  const settings = presets[context]
  const update = (key: keyof TypesetSettings, value: number) => {
    setCopyState('idle')
    setPresets(previous => ({ ...previous, [context]: { ...previous[context], [key]: value } }))
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(createTypesetStylesheet(context, settings))
      setCopyState('copied')
    } catch {
      setCopyState('copyError')
    }
  }
  return (
    <div className="@container min-w-0 space-y-4">
      <style>{typesetRules}</style>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl aria-label={t(prefix + 'context')} value={context} onValueChange={next => {
          if (next === 'record' || next === 'document') { setContext(next); setCopyState('idle') }
        }}>
          <SegmentedControlItem value="record">{t(prefix + 'record')}</SegmentedControlItem>
          <SegmentedControlItem value="document">{t(prefix + 'document')}</SegmentedControlItem>
        </SegmentedControl>
        <Button type="button" size="sm" variant="outline" onClick={copy}><Copy aria-hidden />{t(prefix + 'copy')}</Button>
      </div>
      <div className="grid overflow-hidden rounded-card border border-border bg-card text-card-foreground @3xl:grid-cols-4">
        <div className="min-w-0 px-5 py-6 sm:px-8 sm:py-8 @3xl:col-span-3">
          <article className={`om-typeset om-typeset-${context} mx-auto`} style={typesetVariables(settings) as React.CSSProperties}>
            <Specimen context={context} />
          </article>
        </div>
        <div className="flex flex-wrap content-start gap-4 border-t border-border bg-muted/40 p-4 @3xl:flex-col @3xl:content-stretch @3xl:border-t-0 @3xl:border-s">
          {controls.map(({ key, values, unit }) => (
            <label key={key} className="grid min-w-20 gap-1.5 text-sm font-medium text-muted-foreground">
              {t(prefix + key)}
              <select className="h-9 w-full rounded-field border border-input bg-background ps-3 pe-7 text-sm text-foreground"
                value={settings[key]} onChange={event => update(key, Number(event.target.value))}>
                {values.map(value => <option key={value} value={value}>{value}{unit}</option>)}
              </select>
            </label>
          ))}
          <code className="basis-full break-words text-xs leading-relaxed text-muted-foreground @3xl:basis-auto">
            {`<article class="om-typeset om-typeset-${context}">`}
          </code>
        </div>
      </div>
      <div role="status" className="text-sm text-muted-foreground">{copyState !== 'idle' && t(prefix + copyState)}</div>
      {copyState === 'copyError' && <textarea readOnly aria-label={t(prefix + 'copy')} className="w-full rounded-field border border-input bg-background p-3 font-mono text-xs" rows={6} value={createTypesetStylesheet(context, settings)} onFocus={event => event.target.select()} />}
    </div>
  )
}
