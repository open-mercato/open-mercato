'use client'

import * as React from 'react'
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { CompactButton } from '@open-mercato/ui/primitives/compact-button'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { SocialButton } from '@open-mercato/ui/primitives/social-button'
import { FancyButton } from '@open-mercato/ui/primitives/fancy-button'
import { ButtonGroup } from '@open-mercato/ui/primitives/button-group'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import appleFilled from '../assets/social-apple-filled.svg'
import githubFilled from '../assets/social-github-filled.svg'
import xFilled from '../assets/social-x-filled.svg'
import googleFilled from '../assets/social-google-filled.svg'
import facebookFilled from '../assets/social-facebook-filled.svg'
import dropboxFilled from '../assets/social-dropbox-filled.svg'
import linkedinFilled from '../assets/social-linkedin-filled.svg'
import appleStroke from '../assets/social-apple-stroke.svg'
import githubStroke from '../assets/social-github-stroke.svg'
import xStroke from '../assets/social-x-stroke.svg'
import googleStroke from '../assets/social-google-stroke.svg'
import facebookStroke from '../assets/social-facebook-stroke.svg'
import dropboxStroke from '../assets/social-dropbox-stroke.svg'
import linkedinStroke from '../assets/social-linkedin-stroke.svg'

export const socialProviders = [
  { brand: 'apple', name: 'Apple', filled: appleFilled, stroke: appleStroke },
  { brand: 'github', name: 'GitHub', filled: githubFilled, stroke: githubStroke },
  { brand: 'x', name: 'X', filled: xFilled, stroke: xStroke },
  { brand: 'google', name: 'Google', filled: googleFilled, stroke: googleStroke },
  { brand: 'facebook', name: 'Facebook', filled: facebookFilled, stroke: facebookStroke },
  { brand: 'dropbox', name: 'Dropbox', filled: dropboxFilled, stroke: dropboxStroke },
  { brand: 'linkedin', name: 'LinkedIn', filled: linkedinFilled, stroke: linkedinStroke },
] as const

export function SocialButtonsDemo({ appearance, iconOnly = false }: { appearance: 'filled' | 'stroke'; iconOnly?: boolean }) {
  const t = useT()
  return (
    <div className="flex flex-wrap gap-3 p-1">
      {socialProviders.map((provider) => {
        const asset = provider[appearance]
        const source = typeof asset === 'string' ? asset : asset.src
        const label = t('design_system.gallery.examples.buttons.provider', { brand: provider.name })
        const useForeground = appearance === 'stroke' && ['apple', 'github', 'x'].includes(provider.brand)
        return (
          <SocialButton key={provider.brand} brand={provider.brand} appearance={appearance} iconOnly={iconOnly} aria-label={iconOnly ? label : undefined}>
            {useForeground ? (
              <span aria-hidden="true" className="size-5 shrink-0 bg-current" style={{ maskImage: `url("${source}")`, maskSize: 'contain', maskPosition: 'center', maskRepeat: 'no-repeat' }} />
            ) : <img src={source} alt="" aria-hidden="true" className="size-5 shrink-0" />}
            {!iconOnly && label}
          </SocialButton>
        )
      })}
    </div>
  )
}

export function CompactButtonExample({ appearance, size, fullRadius, initialPressed, disabled }: {
  appearance: 'stroke' | 'ghost' | 'white' | 'modifiable'
  size: 20 | 24
  fullRadius: boolean
  initialPressed: boolean
  disabled: boolean
}) {
  const t = useT()
  const [pressed, setPressed] = React.useState(initialPressed)
  return (
    <CompactButton appearance={appearance} size={size} fullRadius={fullRadius} disabled={disabled}
      aria-label={t('design_system.gallery.examples.buttons.compactAction')}
      aria-pressed={disabled ? undefined : pressed} onClick={() => setPressed((value) => !value)}>
      <Plus aria-hidden="true" />
    </CompactButton>
  )
}

export function CompactButtonMatrix({ initialPressed = false, disabled = false }: { initialPressed?: boolean; disabled?: boolean }) {
  return (
    <div className="grid w-full gap-4 sm:grid-cols-2">
      {(['stroke', 'ghost', 'white', 'modifiable'] as const).map((appearance) => (
        <div key={appearance} className={appearance === 'modifiable' ? 'grid gap-4 rounded-md bg-primary p-4 text-primary-foreground' : appearance === 'white' ? 'grid gap-4 rounded-md border border-border bg-muted p-4' : 'grid gap-4 rounded-md border border-border p-4'}>
          <code className="text-xs">{appearance}</code>
          <div className="flex flex-wrap gap-6">
            {([20, 24] as const).flatMap((size) => [false, true].map((fullRadius) => (
              <div key={`${size}-${fullRadius}`} className="flex flex-col items-center gap-2">
                <CompactButtonExample appearance={appearance} size={size} fullRadius={fullRadius} initialPressed={initialPressed} disabled={disabled} />
                <code className="text-xs">{size}px · {fullRadius ? 'full' : '6px'}</code>
              </div>
            )))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function CompactButtonDisabledPreview() {
  const t = useT()
  return (
    <div className="grid w-full gap-4">
      <p className="max-w-prose text-sm text-muted-foreground">{t('design_system.gallery.examples.buttons.compactDisabledNote')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {(['stroke', 'modifiable'] as const).map((appearance) => (
          <div key={appearance} className={appearance === 'modifiable' ? 'grid gap-4 rounded-md bg-primary p-4 text-primary-foreground' : 'grid gap-4 rounded-md border border-border p-4'}>
            <code className="text-xs">{appearance === 'modifiable' ? 'modifiable' : 'stroke · ghost · white'}</code>
            <div className="flex flex-wrap gap-6">
              {([20, 24] as const).flatMap((size) => [false, true].map((fullRadius) => (
                <div key={`${size}-${fullRadius}`} className="flex flex-col items-center gap-2">
                  <CompactButton appearance={appearance} size={size} fullRadius={fullRadius} disabled
                    aria-label={t('design_system.gallery.examples.buttons.compactAction')}>
                    <Plus aria-hidden="true" />
                  </CompactButton>
                  <code className="text-xs">{size}px · {fullRadius ? 'full' : '6px'}</code>
                </div>
              )))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ButtonGroupMatrix({ content = false }: { content?: boolean }) {
  const t = useT()
  return (
    <div className="grid w-full min-w-0 gap-6">
      {([24, 32, 36] as const).flatMap((size) => (content ? [5] : [2, 3, 4, 5, 6]).map((count) => (
        <div key={`${size}-${count}`} className="grid min-w-0 gap-2">
          <code className="text-xs text-muted-foreground">{size}px · {count}</code>
          <div className="max-w-full overflow-x-auto p-1">
            <ButtonGroup size={size} aria-label={t('design_system.gallery.examples.buttons.groupActions')}>
              {content ? (
                <>
                  <Button type="button" variant="outline">{t('design_system.gallery.examples.buttons.groupItem', { number: 1 })}</Button>
                  <Button type="button" variant="outline"><Pencil aria-hidden="true" />{t('design_system.gallery.examples.buttons.groupItem', { number: 2 })}</Button>
                  <Button type="button" variant="outline">{t('design_system.gallery.examples.buttons.groupItem', { number: 3 })}<Plus aria-hidden="true" /></Button>
                  <Button type="button" variant="outline"><Pencil aria-hidden="true" />{t('design_system.gallery.examples.buttons.groupItem', { number: 4 })}<Plus aria-hidden="true" /></Button>
                  <IconButton aria-label={t('design_system.gallery.examples.buttons.moreActions')}><MoreHorizontal aria-hidden="true" /></IconButton>
                </>
              ) : Array.from({ length: count }, (_, index) => (
                <Button key={index} type="button" variant="outline">{t('design_system.gallery.examples.buttons.groupItem', { number: index + 1 })}</Button>
              ))}
            </ButtonGroup>
          </div>
        </div>
      )))}
    </div>
  )
}

export function ButtonStatePreview({ loading = false }: { loading?: boolean }) {
  const t = useT()
  return (
    <Button type="button" disabled aria-busy={loading || undefined}>
      {loading ? <Spinner size="sm" className="motion-reduce:animate-none" /> : null}
      {t(loading ? 'design_system.gallery.samples.states.saving' : 'design_system.gallery.samples.primaryAction')}
    </Button>
  )
}

export function PrimaryButtonPreview() {
  const t = useT()
  return <Button type="button" variant="primary-filled">{t('design_system.gallery.samples.primaryAction')}</Button>
}

export function DisabledIconButtonPreview() {
  const t = useT()
  return (
    <IconButton type="button" variant="outline" disabled aria-label={t('design_system.gallery.samples.states.edit')}>
      <Pencil aria-hidden="true" />
    </IconButton>
  )
}

export function ButtonButtonsDefaultSample() {
  const t = useT()
  return (<Button>{t('design_system.gallery.samples.primaryAction')}</Button>)
}

export function ButtonButtonsDestructiveSample() {
  const t = useT()
  return (<Button variant="destructive">{t('design_system.gallery.sampleCopy.delete')}</Button>)
}

export function ButtonButtonsDestructiveOutlineSample() {
  const t = useT()
  return (<Button variant="destructive-outline">{t('design_system.gallery.sampleCopy.delete')}</Button>)
}

export function ButtonButtonsDestructiveSoftSample() {
  const t = useT()
  return (<Button variant="destructive-soft">{t('design_system.gallery.sampleCopy.deleteDraft')}</Button>)
}

export function ButtonButtonsDestructiveGhostSample() {
  const t = useT()
  return (<Button variant="destructive-ghost">{t('design_system.gallery.samples.hr.remove')}</Button>)
}

export function ButtonButtonsOutlineSample() {
  const t = useT()
  return (<Button variant="outline">{t('design_system.gallery.samples.overlay.cancel')}</Button>)
}

export function ButtonButtonsSecondarySample() {
  const t = useT()
  return (<Button variant="secondary">{t('design_system.gallery.sampleCopy.duplicate')}</Button>)
}

export function ButtonButtonsGhostSample() {
  const t = useT()
  return (<Button variant="ghost">{t('design_system.gallery.sampleCopy.dismiss')}</Button>)
}

export function ButtonButtonsMutedSample() {
  const t = useT()
  return (<Button variant="muted">{t('design_system.gallery.sampleCopy.showMore')}</Button>)
}

export function ButtonButtonsLinkSample() {
  const t = useT()
  return (<Button variant="link">{t('design_system.gallery.samples.banner.details')}</Button>)
}

export function ButtonButtonsSizesSample() {
  const t = useT()
  return (<>
          <Button size="lg">{t('design_system.gallery.sampleCopy.large')}</Button>
          <Button size="default">{t('design_system.gallery.examples.aiProduct.default')}</Button>
          <Button size="sm">{t('design_system.gallery.sampleCopy.small')}</Button>
          <Button size="2xs">{t('design_system.gallery.sampleCopy.2xsmall')}</Button>
          <Button size="icon" aria-label={t('design_system.gallery.examples.separator.add')}>
            <Plus />
          </Button>
        </>)
}

export function IconButtonButtonsVariantsSample() {
  const t = useT()
  return (<>
          <IconButton variant="primary" aria-label={t('design_system.gallery.examples.separator.add')}>
            <Plus />
          </IconButton>
          <IconButton variant="outline" aria-label={t('design_system.gallery.sampleCopy.edit')}>
            <Pencil />
          </IconButton>
          <IconButton variant="ghost" aria-label={t('design_system.gallery.samples.richEditor.labels.more')}>
            <MoreHorizontal />
          </IconButton>
          <IconButton variant="white" aria-label={t('design_system.gallery.sampleCopy.edit')}>
            <Pencil />
          </IconButton>
          <IconButton variant="destructive" aria-label={t('design_system.gallery.sampleCopy.delete')}>
            <Trash2 />
          </IconButton>
        </>)
}

export function IconButtonButtonsSizesSample() {
  const t = useT()
  return (<>
          <IconButton size="lg" aria-label={t('design_system.gallery.sampleCopy.edit')}>
            <Pencil />
          </IconButton>
          <IconButton size="default" aria-label={t('design_system.gallery.sampleCopy.edit')}>
            <Pencil />
          </IconButton>
          <IconButton size="sm" aria-label={t('design_system.gallery.sampleCopy.edit')}>
            <Pencil />
          </IconButton>
          <IconButton size="xs" aria-label={t('design_system.gallery.sampleCopy.edit')}>
            <Pencil />
          </IconButton>
        </>)
}

export function IconButtonButtonsFullRadiusSample() {
  const t = useT()
  return (<IconButton fullRadius aria-label={t('design_system.gallery.examples.separator.add')}>
          <Plus />
        </IconButton>)
}

export function LinkButtonButtonsAsAnchorSample() {
  const t = useT()
  return (<LinkButton asChild>
          <a href="#gallery-entry-link-button">{t('design_system.gallery.sampleCopy.openLink')}</a>
        </LinkButton>)
}

export function FancyButtonButtonsIntentsSample() {
  const t = useT()
  return (<>
          <FancyButton intent="neutral">{t('design_system.gallery.sampleCopy.neutral')}</FancyButton>
          <FancyButton intent="basic">{t('design_system.gallery.sampleCopy.basic')}</FancyButton>
          <FancyButton intent="primary">{t('design_system.gallery.sampleCopy.primary')}</FancyButton>
          <FancyButton intent="destructive">{t('design_system.gallery.sampleCopy.destructive')}</FancyButton>
        </>)
}

export function FancyButtonButtonsSizesSample() {
  const t = useT()
  return (<>
          <FancyButton size="default">{t('design_system.gallery.examples.aiProduct.default')}</FancyButton>
          <FancyButton size="sm">{t('design_system.gallery.sampleCopy.small')}</FancyButton>
          <FancyButton size="xs">{t('design_system.gallery.sampleCopy.xsmall')}</FancyButton>
        </>)
}

export function ButtonGroupButtonsHorizontalSample() {
  const t = useT()
  return (<ButtonGroup>
          <Button variant="outline">{t('design_system.gallery.samples.hr.save')}</Button>
          <Button variant="outline">{t('design_system.gallery.sampleCopy.saveNew')}</Button>
          <IconButton size="lg" aria-label={t('design_system.gallery.samples.richEditor.labels.more')}>
            <MoreHorizontal />
          </IconButton>
        </ButtonGroup>)
}

export function ButtonGroupButtonsVerticalSample() {
  const t = useT()
  return (<ButtonGroup orientation="vertical" size="sm">
          <Button variant="outline" size="sm">{t('design_system.gallery.sampleCopy.top')}</Button>
          <Button variant="outline" size="sm">{t('design_system.gallery.sampleCopy.middle')}</Button>
          <Button variant="outline" size="sm">{t('design_system.gallery.sampleCopy.bottom')}</Button>
        </ButtonGroup>)
}
