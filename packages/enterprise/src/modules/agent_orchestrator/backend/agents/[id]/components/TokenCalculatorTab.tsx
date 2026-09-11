"use client"

import * as React from 'react'
import { Upload, Trash2, Coins, Info } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatNumber } from '../../../../components/types'
import { utf8Bytes } from './filesShared'

type Estimate = { tokens: number; encoding: string }

const MAX_TEXT_LENGTH = 500_000

export function TokenCalculatorTab() {
  const t = useT()
  const locale = useLocale()
  const [text, setText] = React.useState('')
  const [fileName, setFileName] = React.useState('')
  const [tokens, setTokens] = React.useState(0)
  const [encoding, setEncoding] = React.useState('o200k_base')
  const [estimating, setEstimating] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const seqRef = React.useRef(0)

  const chars = [...text].length
  const words = (text.trim().match(/\S+/g) ?? []).length
  const lines = text === '' ? 0 : text.split('\n').length
  const bytes = utf8Bytes(text)

  // Estimate tokens with the SAME backend tokenizer the Files tab uses. Debounced
  // so a keystroke burst issues one request; a sequence guard drops stale replies.
  React.useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (text.trim() === '') {
      setTokens(0)
      setEstimating(false)
      return
    }
    setEstimating(true)
    const seq = ++seqRef.current
    timerRef.current = setTimeout(async () => {
      const call = await apiCall<Estimate>('/api/agent_orchestrator/tokens/estimate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (seq !== seqRef.current) return
      if (call.ok && call.result) {
        setTokens(call.result.tokens)
        setEncoding(call.result.encoding)
      }
      setEstimating(false)
    }, 250)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [text])

  const openFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const content = String(reader.result ?? '')
      if (content.length > MAX_TEXT_LENGTH) {
        flash(t('agent_orchestrator.tokens.tooLong', 'File is too long to estimate.'), 'error')
        return
      }
      setText(content)
      setFileName(file.name)
    }
    reader.onerror = () => flash(t('agent_orchestrator.tokens.readFailed', 'Could not read the file.'), 'error')
    reader.readAsText(file)
  }

  const stats: Array<{ label: string; value: number }> = [
    { label: t('agent_orchestrator.tokens.characters', 'Characters'), value: chars },
    { label: t('agent_orchestrator.tokens.words', 'Words'), value: words },
    { label: t('agent_orchestrator.tokens.lines', 'Lines'), value: lines },
    { label: t('agent_orchestrator.tokens.bytes', 'UTF-8 bytes'), value: bytes },
  ]

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2.5">
        <input ref={fileInputRef} type="file" accept=".md,.markdown,.txt,.json,.ts,.tsx,.yaml,.yml" hidden onChange={openFile} />
        <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
          <Upload className="mr-1.5 size-3.5" />
          {t('agent_orchestrator.tokens.openFile', 'Open file…')}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={text === ''} onClick={() => { setText(''); setFileName('') }}>
          <Trash2 className="mr-1.5 size-3.5" />
          {t('agent_orchestrator.tokens.clear', 'Clear')}
        </Button>
        {fileName ? <span className="font-mono text-xs text-muted-foreground">{fileName}</span> : null}
        <div className="flex-1" />
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground" title={t('agent_orchestrator.tokens.encodingHint', 'The same o200k_base tokenizer the Files tab uses. An approximation, not an exact model count.')}>
          <Coins className="size-3" />
          {encoding}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_304px]">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          placeholder={t('agent_orchestrator.tokens.placeholder', 'Paste text or Markdown here, or open a file from disk — the token count updates as you type.')}
          className="min-h-[440px] resize-none rounded-none border-0 border-b border-border font-mono text-sm md:border-b-0 md:border-r"
        />
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums tracking-tight">{formatNumber(tokens, locale)}</span>
            <span className="text-sm text-muted-foreground">{t('agent_orchestrator.tokens.tokens', 'tokens')}</span>
            {estimating ? <Spinner size="sm" /> : null}
          </div>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {t('agent_orchestrator.tokens.estimateNote', 'Estimated with o200k_base — an approximation, not an exact model count.')}
          </p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 border-t border-border pt-4 text-sm">
            {stats.map((stat) => (
              <React.Fragment key={stat.label}>
                <dt className="text-muted-foreground">{stat.label}</dt>
                <dd className="text-right font-semibold tabular-nums">{formatNumber(stat.value, locale)}</dd>
              </React.Fragment>
            ))}
          </dl>
          <p className="mt-auto flex items-start gap-1.5 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Coins className="mt-0.5 size-3.5 shrink-0 text-brand-violet" />
            {t('agent_orchestrator.tokens.sameBackend', 'Runs the same backend token estimator as the per-file counts on the Files tab.')}
          </p>
        </div>
      </div>
    </div>
  )
}

export default TokenCalculatorTab
