import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Button } from '../primitives/button'
import { Combobox, type ComboboxItem } from '../primitives/combobox'
import { Sheet } from '../primitives/sheet'
import { ChevronRightIcon, SearchIcon, XIcon } from '../lib/icons'
import { HeartIcon, photos } from '../../.storybook/commerce'

/**
 * Patterns are app-level compositions (apps/storefront), drawn on the DS library page
 * "Navigation [E-commerce]". Nothing in this file is exported.
 */
const meta = {
  title: 'Patterns/Navigation',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj
type Tone = 'plain' | 'primary'
type HeaderTone = Tone | 'overlay'

function Glyph({ children }: React.PropsWithChildren) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
}
const MenuIcon = () => <Glyph><path d="M4 5h16" /><path d="M4 12h16" /><path d="M4 19h16" /></Glyph>
const UserIcon = () => <Glyph><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></Glyph>
const BagIcon = () => <Glyph><path d="M16 10a4 4 0 0 1-8 0" /><path d="M3.103 6.034h17.794" /><path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z" /></Glyph>
const GlobeIcon = () => <Glyph><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></Glyph>

const shopLinks = ['Coffee', 'Tea', 'Equipment', 'Subscriptions', 'For cafés']

function AnnouncementBar() {
  const [open, setOpen] = React.useState(true)
  if (!open) return null
  return (
    <div className="relative flex h-9 items-center justify-center bg-accent px-12 text-sf-body-sm text-accent-foreground">
      <p>Free delivery from 150 zł</p>
      <button type="button" aria-label="Dismiss announcement" onClick={() => setOpen(false)} className="absolute right-1 flex size-8 cursor-pointer items-center justify-center rounded-sf-button outline-none focus-visible:shadow-focus [&_svg]:size-4">
        <XIcon />
      </button>
    </div>
  )
}

const suggestions: ComboboxItem[] = [
  { id: 'coffee', group: 'Categories', label: 'Coffee', trailing: '48' },
  { id: 'single', group: 'Categories', label: 'Single origin', trailing: '24' },
  { id: 'huila', group: 'Products', label: 'Huila Pink Bourbon', description: '99,00 zł', leading: <img src={photos.beansInHand} alt="" className="h-14 w-12 rounded-sf-field object-cover" /> },
  { id: 'decaf', group: 'Products', label: 'Huila Decaf', description: '119,00 zł', leading: <img src={photos.beansTopDown} alt="" className="h-14 w-12 rounded-sf-field object-cover" /> },
  { id: 'blend', group: 'Products', label: 'Huila Blend', description: '84,00 zł', leading: <img src={photos.paperBagAndCup} alt="" className="h-14 w-12 rounded-sf-field object-cover" /> },
]

function HeaderSearch({ tone }: { tone: 'quiet' | 'inverse' }) {
  const [value, setValue] = React.useState('')
  const items = value.length > 1 ? suggestions : []
  return (
    <div className="w-80">
      <Combobox
        label="Search"
        tone={tone}
        placeholder="Search coffee, gear, SKU"
        value={value}
        onValueChange={setValue}
        items={items}
        onSelect={() => setValue('')}
        clearLabel="Clear search"
        footer={items.length ? <a href="#search">See all 12 results</a> : undefined}
      />
    </div>
  )
}

function MobileMenu({ trigger }: { trigger: React.ReactNode }) {
  return (
    <Sheet>
      <Sheet.Trigger asChild>{trigger}</Sheet.Trigger>
      <Sheet.Content side="left" closeLabel="Close menu">
        <Sheet.Header><Sheet.Title>Ziarno</Sheet.Title></Sheet.Header>
        <Sheet.Body className="gap-2">
          <nav aria-label="Shop">
            <ul>
              {shopLinks.map((link) => (
                <li key={link}><a href="#category" className="flex h-13 items-center justify-between rounded-sf-button text-sf-title-sm outline-none focus-visible:shadow-focus [&_svg]:size-4 [&_svg]:text-muted-foreground">{link}<ChevronRightIcon /></a></li>
              ))}
            </ul>
          </nav>
          <hr className="border-border" />
          <ul>
            {['Sign in', 'Help and contact'].map((link) => (
              <li key={link}><a href="#account" className="flex h-12 items-center justify-between rounded-sf-button text-sf-body outline-none focus-visible:shadow-focus [&_svg]:size-4 [&_svg]:text-muted-foreground">{link}<ChevronRightIcon /></a></li>
            ))}
          </ul>
        </Sheet.Body>
        <Sheet.Footer className="border-t-0"><LocaleSwitcher tone="plain" /></Sheet.Footer>
      </Sheet.Content>
    </Sheet>
  )
}

function LocaleSwitcher({ tone }: { tone: Tone }) {
  return (
    <button type="button" className={`inline-flex h-10 w-fit cursor-pointer items-center gap-2 rounded-sf-button px-4 text-sf-body-sm outline-none focus-visible:shadow-focus [&_svg]:size-4.5 ${tone === 'primary' ? 'bg-sf-primary-soft text-primary-foreground' : 'border border-border bg-background text-foreground'}`}>
      <GlobeIcon />English, PLN
    </button>
  )
}

function Header({ tone = 'plain' }: { tone?: HeaderTone }) {
  const overlay = tone === 'overlay'
  const primary = tone === 'primary' || overlay
  const quiet = primary ? 'bg-sf-primary-soft' : 'bg-sf-surface'
  const quietDesktop = primary ? 'lg:bg-sf-primary-soft' : 'lg:bg-sf-surface'
  const iconButton = `flex size-10 cursor-pointer items-center justify-center rounded-sf-button outline-none focus-visible:shadow-focus [&_svg]:size-4.5`
  return (
    <header className={overlay ? 'absolute inset-x-0 top-0 z-sticky text-primary-foreground' : primary ? 'bg-primary text-primary-foreground' : 'border-b border-border bg-background text-foreground'}>
      <div className="flex h-14 items-center gap-1 px-2 lg:h-18 lg:gap-8 lg:px-sf-gutter-md">
        <MobileMenu trigger={<button type="button" aria-label="Open menu" className={`${iconButton} lg:hidden`}><MenuIcon /></button>} />
        <a href="#home" className="rounded-sf-button text-sf-title outline-none focus-visible:shadow-focus">Ziarno</a>
        <nav aria-label="Shop" className="hidden lg:block">
          <ul className="flex gap-7 text-sf-body-sm">{shopLinks.map((link) => <li key={link}><a href="#category" className="rounded-sf-badge outline-none hover:underline focus-visible:shadow-focus">{link}</a></li>)}</ul>
        </nav>
        <div className="ml-auto flex items-center lg:gap-2">
          <div className="hidden lg:block"><HeaderSearch tone={primary ? 'inverse' : 'quiet'} /></div>
          <button type="button" aria-label="Search" className={`${iconButton} lg:hidden`}><SearchIcon /></button>
          <a href="#favourites" aria-label="Favourites" className={`${iconButton} ${quietDesktop}`}><HeartIcon /></a>
          <a href="#account" aria-label="Account" className={`${iconButton} hidden lg:flex ${quiet}`}><UserIcon /></a>
          <a href="#cart" className={`relative flex h-10 items-center gap-2 rounded-sf-button outline-none focus-visible:shadow-focus [&_svg]:size-4.5 lg:pl-3.5 lg:pr-3 ${quiet} max-lg:w-10 max-lg:justify-center max-lg:bg-transparent`}>
            <BagIcon /><span className="sr-only lg:not-sr-only lg:text-sf-body-sm">Cart</span>
            <span className={`flex size-5 items-center justify-center rounded-full text-sf-body-xs max-lg:absolute max-lg:right-0.5 max-lg:top-0.5 ${primary ? 'bg-accent text-accent-foreground' : 'bg-primary text-primary-foreground'}`}>3<span className="sr-only"> items</span></span>
          </a>
        </div>
      </div>
    </header>
  )
}

function Footer({ tone = 'primary' }: { tone?: Tone }) {
  const primary = tone === 'primary'
  const columns: Array<[string, string[]]> = [['Help', ['Delivery', 'Returns', 'Contact']], ['Company', ['Our story', 'Journal']]]
  return (
    <footer className={primary ? 'bg-primary text-primary-foreground' : 'bg-sf-surface text-foreground'}>
      <div className="flex flex-col gap-8 px-sf-gutter-sm pb-6 pt-10 sm:px-sf-gutter-md lg:gap-16 lg:pt-16">
        <div className="flex flex-col gap-7 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex gap-8 lg:gap-20">
            {columns.map(([heading, links]) => (
              <nav key={heading} aria-label={heading} className="flex flex-col gap-2.5">
                <h2 className={`text-sf-body-xs ${primary ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{heading}</h2>
                <ul className="flex flex-col gap-2.5 text-sf-body">{links.map((link) => <li key={link}><a href="#page" className="rounded-sf-badge outline-none hover:underline focus-visible:shadow-focus">{link}</a></li>)}</ul>
              </nav>
            ))}
          </div>
          <LocaleSwitcher tone={tone} />
        </div>
        <div className={`flex items-center justify-between text-sf-body-xs ${primary ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
          <p>© 2026 Ziarno Roastery, Kraków</p>
          <a href="#privacy" className={`rounded-sf-badge underline underline-offset-4 outline-none focus-visible:shadow-focus ${primary ? 'text-primary-foreground' : 'text-foreground'}`}>Privacy</a>
        </div>
      </div>
    </footer>
  )
}

function Shell({ header = 'plain', footer = 'primary' }: { header?: Tone; footer?: Tone }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AnnouncementBar />
      <Header tone={header} />
      <main className="w-full flex-1 px-sf-gutter-sm py-16 sm:px-sf-gutter-md">
        <h1 className="text-sf-display-s lg:text-sf-display-l">Coffee</h1>
        <Button variant="outline" className="mt-6">Page content</Button>
      </main>
      <Footer tone={footer} />
    </div>
  )
}

export const Plain: Story = { name: 'Header plain, footer primary', render: () => <Shell /> }
export const Primary: Story = { name: 'Header and footer primary', render: () => <Shell header="primary" footer="primary" /> }
export const Quiet: Story = { name: 'Header and footer plain', render: () => <Shell header="plain" footer="plain" /> }
export const Overlay: Story = {
  name: 'Header on a hero photo',
  render: () => (
    <div className="flex min-h-dvh flex-col">
      <AnnouncementBar />
      <div className="relative flex h-140 flex-col justify-end lg:h-170">
        <img src={photos.pourIntoCup} alt="" className="absolute inset-0 size-full object-cover" />
        <div aria-hidden="true" className="absolute inset-0 bg-linear-to-b from-foreground/45 via-transparent via-30% to-transparent" />
        <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-foreground/65 to-transparent to-55%" />
        <Header tone="overlay" />
        <div className="relative flex max-w-190 flex-col items-start gap-5 px-sf-gutter-sm pb-6 text-primary-foreground sm:px-sf-gutter-md lg:pb-10">
          <h1 className="text-sf-display-s lg:text-sf-display-xl">Coffee roasted on Tuesday, with you by Friday</h1>
          <Button size="lg" variant="outline">Shop coffee</Button>
        </div>
      </div>
      <div className="flex-1" />
      <Footer />
    </div>
  ),
}
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'phone' } }, render: () => <Shell /> }
