import * as React from 'react'
import { Globe, UserRound } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import mastercard from '../assets/menu-mastercard.svg'
import apex from '../assets/menu-apex.svg'
import spotify from '../assets/menu-spotify.svg'
import unitedStates from '../assets/menu-united-states.svg'
import google from '../assets/select-google.png'
import poland from '../assets/select-poland.png'
import avatar from '../assets/avatar-illustration.png'

export type MenuKind = 'basic' | 'country' | 'avatar' | 'provider' | 'brand' | 'company' | 'icon'
export const selectKinds: MenuKind[] = ['basic', 'country', 'avatar', 'provider', 'brand', 'company']
export const commandKinds: MenuKind[] = ['basic', 'avatar', 'icon', 'brand', 'company', 'country']

const imageSource = (asset: string | { readonly src: string }) => typeof asset === 'string' ? asset : asset.src

export function useMenuChoices(kind: MenuKind) {
  const t = useT()
  return [0, 1, 2].map((index) => ({
    value: `${kind}-${index}`,
    label: t(`design_system.gallery.samples.menu.${kind}.${index}`),
    description: t('design_system.gallery.samples.menu.description'),
    disabled: index === 2,
    alternative: index !== 0,
  }))
}

export function MenuVisual({ kind, large = false, alternative = false, providerSize = 'row' }: {
  kind: MenuKind
  large?: boolean
  alternative?: boolean
  providerSize?: 'row' | 'select'
}) {
  if (kind === 'avatar') {
    return <Avatar size={large ? 40 : 20} label={alternative ? 'Sophia Williams' : 'James Brown'} src={alternative ? undefined : imageSource(avatar)} />
  }
  const asset = kind === 'country' ? alternative ? poland : unitedStates
    : kind === 'provider' ? mastercard
      : kind === 'brand' ? alternative ? google : spotify
        : kind === 'company' ? apex : undefined
  const Icon = kind === 'icon' ? UserRound : Globe
  const content = asset
    ? <img src={imageSource(asset)} alt="" className={kind === 'provider' ? providerSize === 'select' ? 'h-6 w-8 object-contain' : 'h-5 w-6.5 object-contain' : large ? 'size-6 object-contain' : 'size-5 object-contain'} />
    : <Icon aria-hidden="true" className={large ? 'size-6' : 'size-5'} />
  return <span aria-hidden="true" className={large ? 'flex size-10 shrink-0 items-center justify-center rounded-full border border-input bg-background text-muted-foreground' : 'inline-flex shrink-0 items-center justify-center text-muted-foreground'}>{content}</span>
}
