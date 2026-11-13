'use client'

import * as React from 'react'
import { ArrowUpRight, Check, Clock3, Heart, Layers, MoveUpRight, Palette, Sparkles } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import product from '../assets/style-studio-product.png'
import portrait from '../assets/landing-teams-01.png'
import creator from '../assets/contact-support-portrait.png'
import workspace from '../assets/blog-photo-0.png'

const assetSource = (asset: string | { readonly src: string }) => typeof asset === 'string' ? asset : asset.src
const CARD = 'flex min-h-112 min-w-0 flex-col overflow-hidden rounded-xl border border-border shadow-sm'
const TASKS = ['collect', 'explore', 'share'] as const
const CATEGORIES = ['identity', 'digital', 'editorial'] as const

export function ColorStudioCompositions({ theme, tokens }: { theme: 'light' | 'dark'; tokens: Record<string, string> }) {
  const t = useT()
  const id = React.useId()
  const copy = (key: string) => t(`design_system.colorStudio.compositions.${key}`)
  const [plan, setPlan] = React.useState('solo')
  const [category, setCategory] = React.useState<typeof CATEGORIES[number]>('identity')
  const [completed, setCompleted] = React.useState<string[]>(['collect'])
  const [saved, setSaved] = React.useState(false)
  const [following, setFollowing] = React.useState(false)
  const [productSaved, setProductSaved] = React.useState(false)
  const primary = { backgroundColor: tokens['--primary'], color: tokens['--primary-foreground'] }
  const secondary = { backgroundColor: tokens['--studio-secondary-soft'], color: tokens['--studio-secondary-soft-foreground'] }
  const tertiary = { backgroundColor: tokens['--studio-tertiary'], color: tokens['--studio-tertiary-foreground'] }
  const gradient = `linear-gradient(145deg, ${tokens['--accent']}, ${tokens['--studio-secondary-soft']}, ${tokens['--studio-tertiary-soft']})`
  const appointments = [
    { key: 'meeting', time: '09:00–10:00', background: tokens['--accent'], foreground: tokens['--accent-foreground'], accent: tokens['--primary'] },
    { key: 'research', time: '11:00–12:30', background: tokens['--studio-secondary-soft'], foreground: tokens['--studio-secondary-soft-foreground'], accent: tokens['--studio-secondary'] },
    { key: 'review', time: '14:00–15:00', background: tokens['--studio-tertiary-soft'], foreground: tokens['--studio-tertiary-soft-foreground'], accent: tokens['--studio-tertiary'] },
  ]
  return <section aria-labelledby={`${id}-title`} data-composition-theme={theme} style={tokens as React.CSSProperties} className="@container/cards min-w-0 space-y-6 rounded-xl bg-background p-4 text-foreground sm:p-6">
    <div className="flex items-end justify-between gap-4"><h4 id={`${id}-title`} className="text-2xl font-medium tracking-tight">{copy('galleryTitle')}</h4><p className="text-xs text-muted-foreground">{copy('live')}</p></div>
    <div className="grid min-w-0 auto-rows-fr gap-6 @md/cards:grid-cols-2 @7xl/cards:grid-cols-4">
      <article className={`${CARD} gap-6 bg-card p-6`} aria-label={t('design_system.colorStudio.agenda')}>
        <div className="space-y-2"><Clock3 aria-hidden className="size-5 text-muted-foreground" /><h5 className="text-xl font-medium tracking-tight">{t('design_system.colorStudio.agenda')}</h5><p className="text-xs text-muted-foreground">{copy('today')}</p></div>
        <div className="flex flex-1 flex-col gap-3">{appointments.map(item => <div key={item.key} className="flex-1 space-y-2 rounded-lg border-l-4 px-4 py-3" style={{ backgroundColor: item.background, color: item.foreground, borderLeftColor: item.accent }}>
          <p className="text-sm font-semibold">{t(`design_system.colorStudio.${item.key}`)}</p><p className="text-xs">{item.time}</p>
        </div>)}</div>
        <AvatarStack size="xs"><Avatar label={copy('creatorName')} src={assetSource(creator)} /><Avatar label={copy('designerName')} src={assetSource(portrait)} /><Avatar label={copy('collaboratorName')} src={assetSource(workspace)} /></AvatarStack>
      </article>

      <article className={`${CARD} relative justify-between border-transparent p-6`} style={secondary} aria-label={copy('poster')}>
        <div className="relative -mx-6 -mt-6 h-56 overflow-hidden" aria-hidden>
          <div className="absolute inset-6 rounded-full border-8" style={{ borderColor: tokens['--studio-secondary'] }} />
          <img src={assetSource(portrait)} alt="" className="relative mx-auto h-full w-full object-contain object-bottom" loading="lazy" />
          <div className="absolute -right-8 -top-8 size-40 rounded-full border-8" style={{ borderColor: tokens['--studio-tertiary'] }} />
        </div>
        <div className="relative space-y-4 pt-6"><Sparkles aria-hidden className="size-6" /><h5 className="text-4xl font-semibold leading-tight tracking-tight">{copy('posterTitle')}</h5><p className="text-sm leading-relaxed">{copy('posterDescription')}</p></div>
      </article>

      <article className={`${CARD} border-transparent bg-card`} aria-label={copy('creator')}>
        <div className="relative min-h-56 flex-1 overflow-hidden" style={{ background: gradient }}><img src={assetSource(creator)} alt={copy('creatorPhoto')} className="absolute inset-0 h-full w-full object-cover" loading="lazy" /><div className="absolute inset-x-0 bottom-0 h-24" style={{ background: `linear-gradient(transparent, ${tokens['--primary']})` }} aria-hidden /></div>
        <div className="space-y-4 p-6" style={primary}><p className="text-xs font-medium uppercase tracking-wider">{copy('creator')}</p><h5 className="text-3xl font-medium leading-tight tracking-tight">{copy('creatorName')}</h5><div className="flex items-center justify-between gap-3"><p className="text-sm">{copy('creatorRole')}</p><IconButton type="button" variant="modifiable" size="lg" aria-label={copy(following ? 'unfollow' : 'follow')} aria-pressed={following} onClick={() => setFollowing(value => !value)} style={{ color: 'inherit' }}>{following ? <Check /> : <ArrowUpRight />}</IconButton></div><p role="status" className="text-xs empty:hidden">{following ? copy('following') : ''}</p></div>
      </article>

      <article className={`${CARD} justify-between gap-6 p-6`} style={{ background: gradient }} aria-label={copy('product')}>
        <div className="flex items-center justify-between gap-3"><span className="rounded-md bg-card px-3 py-2 text-xs font-medium text-card-foreground">{copy('productLabel')}</span><IconButton type="button" variant="white" size="lg" aria-label={copy(productSaved ? 'removeProduct' : 'saveProduct')} aria-pressed={productSaved} onClick={() => setProductSaved(value => !value)}><Heart className={productSaved ? 'fill-current' : ''} /></IconButton></div>
        <img src={assetSource(product)} alt={copy('productPhoto')} className="h-56 w-full rounded-lg object-contain" loading="lazy" />
        <div className="space-y-2 rounded-lg bg-card p-4 text-card-foreground"><p className="text-xs text-muted-foreground">{copy('productCollection')}</p><h5 className="text-2xl font-medium tracking-tight">{copy('productTitle')}</h5><p role="status" className="text-sm text-muted-foreground">{copy(productSaved ? 'productSaved' : 'productHint')}</p></div>
      </article>

      <article className={`${CARD} gap-6 bg-card p-6`} aria-label={copy('plans')}>
        <div className="space-y-3"><Layers aria-hidden className="size-6" style={{ color: tokens['--primary'] }} /><h5 className="text-2xl font-medium tracking-tight">{copy('plans')}</h5><p className="text-sm leading-relaxed text-muted-foreground">{copy('plansHint')}</p></div>
        <div className="space-y-3">{['solo', 'team'].map(choice => <Button key={choice} type="button" variant="outline" aria-pressed={plan === choice} onClick={() => setPlan(choice)} className="h-auto w-full justify-between gap-3 whitespace-normal p-4 text-left" style={plan === choice ? { backgroundColor: tokens['--accent'], color: tokens['--accent-foreground'], borderColor: tokens['--primary'] } : undefined}><span className="space-y-1"><span className="block text-base font-medium">{copy(choice)}</span><span className="block text-xs font-normal">{copy(`${choice}Hint`)}</span></span>{plan === choice ? <Check aria-hidden className="size-5 shrink-0" /> : <span className="size-5 shrink-0 rounded-full border border-border" aria-hidden />}</Button>)}</div>
        <div className="mt-auto space-y-3 border-t border-border pt-5"><p role="status" className="text-sm font-medium">{copy(plan === 'solo' ? 'soloSelected' : 'teamSelected')}</p><p className="text-xs leading-relaxed text-muted-foreground">{copy('planNote')}</p></div>
      </article>

      <article className={`${CARD} gap-6 bg-card p-6`} aria-label={copy('categories')}>
        <div className="space-y-2"><Palette aria-hidden className="size-6 text-muted-foreground" /><h5 className="text-2xl font-medium tracking-tight">{copy('categories')}</h5></div>
        <div className="flex flex-wrap gap-2">{CATEGORIES.map(choice => <Button key={choice} type="button" variant="outline" size="sm" aria-pressed={category === choice} onClick={() => setCategory(choice)} style={category === choice ? tertiary : undefined}>{copy(choice)}</Button>)}</div>
        <div className="relative flex min-h-36 flex-1 items-center justify-center overflow-hidden rounded-lg p-6" style={{ background: gradient }} aria-hidden><div className={`flex size-28 items-center justify-center shadow-lg ${category === 'identity' ? 'rounded-full' : category === 'digital' ? 'rotate-12 rounded-xl' : '-rotate-6 rounded-md'}`} style={category === 'digital' ? secondary : tertiary}>{category === 'identity' ? <Sparkles className="size-12" /> : category === 'digital' ? <Layers className="size-12" /> : <Palette className="size-12" />}</div></div>
        <div role="status" className="space-y-2"><h6 className="text-lg font-medium">{copy(`${category}Title`)}</h6><p className="text-sm leading-relaxed text-muted-foreground">{copy(`${category}Description`)}</p></div>
      </article>

      <article className={`${CARD} gap-6 bg-card p-6`} aria-label={copy('tasks')}>
        <div className="space-y-2"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{copy('workspace')}</p><h5 className="text-2xl font-medium tracking-tight">{copy('tasks')}</h5></div>
        <p className="text-5xl font-medium tracking-tight" style={{ color: tokens['--primary'] }}>{completed.length}<span className="text-xl text-muted-foreground"> / {TASKS.length}</span></p>
        <div className="flex-1 divide-y divide-border">{TASKS.map(task => <label key={task} className="flex cursor-pointer items-start gap-3 py-4"><Checkbox size="md" checked={completed.includes(task)} onCheckedChange={checked => setCompleted(current => checked ? [...current.filter(item => item !== task), task] : current.filter(item => item !== task))} aria-label={copy(task)} /><span className={`text-sm leading-relaxed ${completed.includes(task) ? 'text-muted-foreground line-through' : ''}`}>{copy(task)}</span></label>)}</div>
        <p role="status" className="rounded-lg p-4 text-sm" style={secondary}>{copy(completed.length === TASKS.length ? 'allDone' : 'keepGoing')}</p>
      </article>

      <article className={`${CARD} border-transparent`} aria-label={copy('inspiration')}>
        <div className="relative min-h-56 flex-1"><img src={assetSource(workspace)} alt={copy('workspacePhoto')} className="absolute inset-0 h-full w-full object-cover" loading="lazy" /></div>
        <div className="space-y-5 p-6" style={tertiary}><div className="flex items-center justify-between gap-3"><p className="text-xs font-medium uppercase tracking-wider">{copy('inspiration')}</p><MoveUpRight aria-hidden className="size-5" /></div><h5 className="text-3xl font-medium leading-tight tracking-tight">{copy('inspirationTitle')}</h5><Button type="button" variant="outline" aria-pressed={saved} onClick={() => setSaved(value => !value)} className="w-full" style={{ backgroundColor: tokens['--studio-tertiary-soft'], color: tokens['--studio-tertiary-soft-foreground'], borderColor: 'transparent' }}><Heart aria-hidden className={saved ? 'fill-current' : ''} />{copy(saved ? 'saved' : 'save')}</Button></div>
      </article>
    </div>
  </section>
}
