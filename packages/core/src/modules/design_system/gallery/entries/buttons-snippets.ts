// Copy-paste snippets for the Buttons family. Kept out of buttons.tsx so the entry file stays a
// short canonical example the agent harness can read within its byte budget.

export const compactButtonDefaultCode = `import * as React from 'react'
import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CompactButton } from '@open-mercato/ui/primitives/compact-button'

function CompactButtonExample({ appearance, size, fullRadius, initialPressed, disabled }: {
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

function CompactButtonMatrix({ initialPressed = false, disabled = false }: { initialPressed?: boolean; disabled?: boolean }) {
  return (
    <div className="grid w-full gap-4 sm:grid-cols-2">
      {(['stroke', 'ghost', 'white', 'modifiable'] as const).map((appearance) => (
        <div key={appearance} className={appearance === 'modifiable' ? 'grid gap-4 rounded-md bg-primary p-4 text-primary-foreground' : appearance === 'white' ? 'grid gap-4 rounded-md border border-border bg-muted p-4' : 'grid gap-4 rounded-md border border-border p-4'}>
          <code className="text-xs">{appearance}</code>
          <div className="flex flex-wrap gap-6">
            {([20, 24] as const).flatMap((size) => [false, true].map((fullRadius) => (
              <div key={\`\${size}-\${fullRadius}\`} className="flex flex-col items-center gap-2">
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

<CompactButtonMatrix />`

export const compactButtonActiveCode = `import * as React from 'react'
import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CompactButton } from '@open-mercato/ui/primitives/compact-button'

function CompactButtonExample({ appearance, size, fullRadius, initialPressed, disabled }: {
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

function CompactButtonMatrix({ initialPressed = false, disabled = false }: { initialPressed?: boolean; disabled?: boolean }) {
  return (
    <div className="grid w-full gap-4 sm:grid-cols-2">
      {(['stroke', 'ghost', 'white', 'modifiable'] as const).map((appearance) => (
        <div key={appearance} className={appearance === 'modifiable' ? 'grid gap-4 rounded-md bg-primary p-4 text-primary-foreground' : appearance === 'white' ? 'grid gap-4 rounded-md border border-border bg-muted p-4' : 'grid gap-4 rounded-md border border-border p-4'}>
          <code className="text-xs">{appearance}</code>
          <div className="flex flex-wrap gap-6">
            {([20, 24] as const).flatMap((size) => [false, true].map((fullRadius) => (
              <div key={\`\${size}-\${fullRadius}\`} className="flex flex-col items-center gap-2">
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

<CompactButtonMatrix initialPressed />`

export const compactButtonDisabledCode = `import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CompactButton } from '@open-mercato/ui/primitives/compact-button'

function CompactButtonDisabledPreview() {
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
                <div key={\`\${size}-\${fullRadius}\`} className="flex flex-col items-center gap-2">
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

<CompactButtonDisabledPreview />`

export const iconButtonVariantsCode = `import { Pencil } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

<IconButton variant="primary" aria-label="Add"><Plus /></IconButton>
<IconButton variant="outline" aria-label="Edit"><Pencil /></IconButton>
<IconButton variant="ghost" aria-label="More"><MoreHorizontal /></IconButton>
<IconButton variant="white" aria-label="Edit"><Pencil /></IconButton>
<IconButton variant="destructive" aria-label="Delete"><Trash2 /></IconButton>`

export const iconButtonSizesCode = `import { Pencil } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

<IconButton size="lg" aria-label="Edit"><Pencil /></IconButton>
<IconButton size="default" aria-label="Edit"><Pencil /></IconButton>
<IconButton size="sm" aria-label="Edit"><Pencil /></IconButton>
<IconButton size="xs" aria-label="Edit"><Pencil /></IconButton>`

export const iconButtonFullRadiusCode = `import { Plus } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

<IconButton fullRadius aria-label="Add"><Plus /></IconButton>`

export const iconButtonDisabledCode = `import { Pencil } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

<IconButton type="button" variant="outline" disabled aria-label={t('design_system.gallery.samples.states.edit')}>
  <Pencil aria-hidden="true" />
</IconButton>`

export const linkButtonVariantsCode = `import { LinkButton } from '@open-mercato/ui/primitives/link-button'

<LinkButton>primary</LinkButton>
<LinkButton variant="gray">gray</LinkButton>
<LinkButton variant="black">black</LinkButton>
<LinkButton variant="error">error</LinkButton>`

export const linkButtonUnderlineCode = `import { LinkButton } from '@open-mercato/ui/primitives/link-button'

<LinkButton underline="always">always</LinkButton>
<LinkButton underline="hover">hover</LinkButton>
<LinkButton underline="none">none</LinkButton>`

export const linkButtonAsAnchorCode = `import { LinkButton } from '@open-mercato/ui/primitives/link-button'

<LinkButton asChild>
  <a href="/backend/docs">Open link</a>
</LinkButton>`

export const socialButtonFilledCode = `import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SocialButton } from '@open-mercato/ui/primitives/social-button'
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

const socialProviders = [
  { brand: 'apple', name: 'Apple', filled: appleFilled, stroke: appleStroke },
  { brand: 'github', name: 'GitHub', filled: githubFilled, stroke: githubStroke },
  { brand: 'x', name: 'X', filled: xFilled, stroke: xStroke },
  { brand: 'google', name: 'Google', filled: googleFilled, stroke: googleStroke },
  { brand: 'facebook', name: 'Facebook', filled: facebookFilled, stroke: facebookStroke },
  { brand: 'dropbox', name: 'Dropbox', filled: dropboxFilled, stroke: dropboxStroke },
  { brand: 'linkedin', name: 'LinkedIn', filled: linkedinFilled, stroke: linkedinStroke },
] as const

function SocialButtonsDemo({ appearance, iconOnly = false }: { appearance: 'filled' | 'stroke'; iconOnly?: boolean }) {
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
              <span aria-hidden="true" className="size-5 shrink-0 bg-current" style={{ maskImage: \`url("\${source}")\`, maskSize: 'contain', maskPosition: 'center', maskRepeat: 'no-repeat' }} />
            ) : <img src={source} alt="" aria-hidden="true" className="size-5 shrink-0" />}
            {!iconOnly && label}
          </SocialButton>
        )
      })}
    </div>
  )
}

<SocialButtonsDemo appearance="filled" />`

export const socialButtonStrokeCode = `import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SocialButton } from '@open-mercato/ui/primitives/social-button'
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

const socialProviders = [
  { brand: 'apple', name: 'Apple', filled: appleFilled, stroke: appleStroke },
  { brand: 'github', name: 'GitHub', filled: githubFilled, stroke: githubStroke },
  { brand: 'x', name: 'X', filled: xFilled, stroke: xStroke },
  { brand: 'google', name: 'Google', filled: googleFilled, stroke: googleStroke },
  { brand: 'facebook', name: 'Facebook', filled: facebookFilled, stroke: facebookStroke },
  { brand: 'dropbox', name: 'Dropbox', filled: dropboxFilled, stroke: dropboxStroke },
  { brand: 'linkedin', name: 'LinkedIn', filled: linkedinFilled, stroke: linkedinStroke },
] as const

function SocialButtonsDemo({ appearance, iconOnly = false }: { appearance: 'filled' | 'stroke'; iconOnly?: boolean }) {
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
              <span aria-hidden="true" className="size-5 shrink-0 bg-current" style={{ maskImage: \`url("\${source}")\`, maskSize: 'contain', maskPosition: 'center', maskRepeat: 'no-repeat' }} />
            ) : <img src={source} alt="" aria-hidden="true" className="size-5 shrink-0" />}
            {!iconOnly && label}
          </SocialButton>
        )
      })}
    </div>
  )
}

<SocialButtonsDemo appearance="stroke" />`

export const socialButtonIconOnlyCode = `import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SocialButton } from '@open-mercato/ui/primitives/social-button'
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

const socialProviders = [
  { brand: 'apple', name: 'Apple', filled: appleFilled, stroke: appleStroke },
  { brand: 'github', name: 'GitHub', filled: githubFilled, stroke: githubStroke },
  { brand: 'x', name: 'X', filled: xFilled, stroke: xStroke },
  { brand: 'google', name: 'Google', filled: googleFilled, stroke: googleStroke },
  { brand: 'facebook', name: 'Facebook', filled: facebookFilled, stroke: facebookStroke },
  { brand: 'dropbox', name: 'Dropbox', filled: dropboxFilled, stroke: dropboxStroke },
  { brand: 'linkedin', name: 'LinkedIn', filled: linkedinFilled, stroke: linkedinStroke },
] as const

function SocialButtonsDemo({ appearance, iconOnly = false }: { appearance: 'filled' | 'stroke'; iconOnly?: boolean }) {
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
              <span aria-hidden="true" className="size-5 shrink-0 bg-current" style={{ maskImage: \`url("\${source}")\`, maskSize: 'contain', maskPosition: 'center', maskRepeat: 'no-repeat' }} />
            ) : <img src={source} alt="" aria-hidden="true" className="size-5 shrink-0" />}
            {!iconOnly && label}
          </SocialButton>
        )
      })}
    </div>
  )
}

<SocialButtonsDemo appearance="filled" iconOnly />
<SocialButtonsDemo appearance="stroke" iconOnly />`

export const fancyButtonIntentsCode = `import { FancyButton } from '@open-mercato/ui/primitives/fancy-button'

<FancyButton intent="neutral">Neutral</FancyButton>
<FancyButton intent="basic">Basic</FancyButton>
<FancyButton intent="primary">Primary</FancyButton>
<FancyButton intent="destructive">Destructive</FancyButton>`

export const fancyButtonSizesCode = `import { FancyButton } from '@open-mercato/ui/primitives/fancy-button'

<FancyButton size="default">Default</FancyButton>
<FancyButton size="sm">Small</FancyButton>
<FancyButton size="xs">X-Small</FancyButton>`

export const buttonGroupSizeQuantityMatrixCode = `import { MoreHorizontal, Pencil, Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { ButtonGroup } from '@open-mercato/ui/primitives/button-group'

function ButtonGroupMatrix({ content = false }: { content?: boolean }) {
  const t = useT()
  return (
    <div className="grid w-full min-w-0 gap-6">
      {([24, 32, 36] as const).flatMap((size) => (content ? [5] : [2, 3, 4, 5, 6]).map((count) => (
        <div key={\`\${size}-\${count}\`} className="grid min-w-0 gap-2">
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

<ButtonGroupMatrix />`

export const buttonGroupItemContentCode = `import { MoreHorizontal, Pencil, Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { ButtonGroup } from '@open-mercato/ui/primitives/button-group'

function ButtonGroupMatrix({ content = false }: { content?: boolean }) {
  const t = useT()
  return (
    <div className="grid w-full min-w-0 gap-6">
      {([24, 32, 36] as const).flatMap((size) => (content ? [5] : [2, 3, 4, 5, 6]).map((count) => (
        <div key={\`\${size}-\${count}\`} className="grid min-w-0 gap-2">
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

<ButtonGroupMatrix content />`

export const buttonGroupHorizontalCode = `import { MoreHorizontal } from 'lucide-react'
import { ButtonGroup } from '@open-mercato/ui/primitives/button-group'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

<ButtonGroup>
  <Button variant="outline">Save</Button>
  <Button variant="outline">Save & New</Button>
  <IconButton size="lg" aria-label="More"><MoreHorizontal /></IconButton>
</ButtonGroup>`

export const buttonGroupVerticalCode = `import { ButtonGroup } from '@open-mercato/ui/primitives/button-group'
import { Button } from '@open-mercato/ui/primitives/button'

<ButtonGroup orientation="vertical" size="sm">
  <Button variant="outline" size="sm">Top</Button>
  <Button variant="outline" size="sm">Middle</Button>
  <Button variant="outline" size="sm">Bottom</Button>
</ButtonGroup>`
