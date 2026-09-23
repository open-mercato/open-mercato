'use client'

import * as React from 'react'
import { Command } from 'cmdk'
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Gift,
  House,
  Info,
  LoaderCircle,
  LogOut,
  MessageSquare,
  Moon,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react'
import { useT, type TranslateParams } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card } from '@open-mercato/ui/primitives/card'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import {
  CommandMenuInput,
  CommandMenuList,
  CommandMenuItem,
  CommandMenuEmpty,
  CommandMenuFooter,
} from '@open-mercato/ui/primitives/command-menu'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@open-mercato/ui/primitives/tabs'
import { cryptoArtwork } from '../assets/cryptocurrency-artwork'

export type CryptoPreviewState =
  | 'default'
  | 'hover'
  | 'active'
  | 'filled'
  | 'disabled'
  | 'error'
  | 'selected'
  | 'searching'
  | 'empty'
export type CryptoPart =
  | 'status-icon'
  | 'token-icon'
  | 'navigation-item'
  | 'navigation-search'
  | 'navigation-wallet'
  | 'navigation-action'
  | 'chart-item'
  | 'swap-select'
  | 'chart-switch'
  | 'table-button'
  | 'table-switch-item'
  | 'table-tab'
  | 'table-filter'
  | 'table-switch'
  | 'swap-input'
  | 'swap'
  | 'search-modal'
  | 'search-input'
  | 'navigation'
  | 'social-button'
  | 'menu-dropdown'
  | 'favorites-dropdown'
  | 'profile-dropdown'
  | 'wallet-dropdown'
  | 'swap-token-dropdown'
  | 'notifications-dropdown'
  | 'connect-wallet'
  | 'banner'
  | 'filter-type'
  | 'filter-date'
  | 'filter-status'
  | 'filter-token'
  | 'mobile-navigation'
  | 'mobile-bottom-navigation'
export type CryptocurrencyDemoProps = {
  part: CryptoPart
  state?: CryptoPreviewState
  kind?: string
  size?: 24 | 28
  onlyIcon?: boolean
  profile?: boolean
  step?: 1 | 2 | 3
}

const useCryptoLabels = () => {
  const t = useT()
  return (key: string, params?: TranslateParams) => t(`design_system.gallery.samples.crypto.${key}`, params)
}

const tokenFixtures = [
  { symbol: 'btc', name: 'Bitcoin', price: 116236.51, change: 2.5, balance: 0.0095 },
  { symbol: 'eth', name: 'Ethereum', price: 2348, change: 1.3, balance: 242.4 },
  { symbol: 'xrp', name: 'XRP', price: 1.55, change: -0.2, balance: 510.82 },
  { symbol: 'usdt', name: 'TetherUS', price: 1, change: 0, balance: 125.63 },
  { symbol: 'trx', name: 'Tron', price: 123.08, change: -1.1, balance: 0 },
  { symbol: 'sol', name: 'Solana', price: 765.12, change: -2.3, balance: 0 },
  { symbol: 'usdc', name: 'USDC', price: 1, change: 0, balance: 100 },
  { symbol: 'bnb', name: 'BNB', price: 456.18, change: -1.5, balance: 0 },
  { symbol: 'avax', name: 'Avalanche', price: 789.7, change: -2, balance: 0 },
  { symbol: 'ada', name: 'Cardano', price: 101.26, change: 0.4, balance: 0 },
  { symbol: 'hbar', name: 'Hedera', price: 0.18, change: 0.1, balance: 0 },
  { symbol: 'dot', name: 'Polkadot', price: 4.2, change: -0.4, balance: 0 },
] as const

type CryptoToken = (typeof tokenFixtures)[number]['symbol']
const tokenBySymbol = (symbol: string) => tokenFixtures.find((token) => token.symbol === symbol) ?? tokenFixtures[0]
const formatAmount = (amount: number, maximumFractionDigits = 2) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(amount)
const money = (amount: number) =>
  `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`
const greenButton =
  'rounded-full bg-status-success-solid text-status-success-solid-foreground hover:bg-status-success-solid/90'
const pill = 'rounded-full text-muted-foreground hover:bg-muted hover:text-foreground'
const previewSurface = (state: CryptoPreviewState) =>
  (state === 'hover' || state === 'active') && 'bg-muted text-foreground'

function CryptoGlyph({
  name,
  className,
}: {
  name: 'crown' | 'star' | 'menu' | 'history' | 'clock' | 'rewards' | 'link' | 'more'
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-4.5 shrink-0 bg-current', className)}
      style={{
        maskImage: `url(${cryptoArtwork[name]})`,
        WebkitMaskImage: `url(${cryptoArtwork[name]})`,
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
      }}
    />
  )
}

function TokenIcon({ symbol, className }: { symbol: CryptoToken; className?: string }) {
  return <img src={cryptoArtwork[symbol]} alt="" className={cn('size-4 shrink-0 rounded-full', className)} />
}

function CryptoPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Card
      className={cn(
        'gap-0 overflow-hidden rounded-2xl border-0 bg-background p-0 shadow-md ring-1 ring-inset ring-border',
        className,
      )}
    >
      {children}
    </Card>
  )
}

function CryptoNotice({ message }: { message: string }) {
  return message ? (
    <p role="status" className="px-4 py-2 text-xs text-status-success-text">
      {message}
    </p>
  ) : null
}

function CryptoNavigationItem({
  state = 'default',
  size = 28,
  label,
  onClick,
  pressed,
}: {
  state?: CryptoPreviewState
  size?: 24 | 28
  label?: string
  onClick?: () => void
  pressed?: boolean
}) {
  const cryptoLabel = useCryptoLabels()
  const [selected, setSelected] = React.useState(state === 'active')
  return (
    <Button
      type="button"
      variant="ghost"
      size="2xs"
      aria-pressed={pressed ?? selected}
      onClick={() => {
        setSelected(!selected)
        onClick?.()
      }}
      className={cn(
        pill,
        'px-3 py-0.5 font-medium',
        size === 24 ? 'h-6 text-compact' : 'h-7 text-sm',
        previewSurface(state),
        (pressed ?? selected) && 'bg-muted text-foreground',
      )}
    >
      {label ?? cryptoLabel('overview')}
    </Button>
  )
}

function CryptoSegments({
  type = 'chart',
  initialValue,
  size = 24,
  itemOnly = false,
  state = 'default',
}: {
  type?: 'chart' | 'table'
  initialValue?: string
  size?: 24 | 28
  itemOnly?: boolean
  state?: CryptoPreviewState
}) {
  const cryptoLabel = useCryptoLabels()
  const values = type === 'chart' ? ['1D', '1W', '1M', '3M', '1Y'] : ['compact', 'detailed']
  const [value, setValue] = React.useState(initialValue ?? (itemOnly && state !== 'active' ? '' : values[0]))
  return (
    <SegmentedControl
      size="sm"
      value={value}
      onValueChange={setValue}
      aria-label={cryptoLabel(type === 'chart' ? 'chartRange' : 'tableDensity')}
      className={cn(
        'border-0 bg-muted',
        type === 'chart' ? 'h-6 p-0.75' : 'p-0',
        type === 'table' && (size === 28 ? 'h-7' : 'h-6'),
        itemOnly && 'h-auto p-0',
      )}
    >
      {(itemOnly ? [values[0]] : values).map((option) => (
        <SegmentedControlItem
          key={option}
          value={option}
          className={cn(
            'px-0 text-xs leading-4 font-medium data-[state=checked]:font-medium',
            type === 'chart' ? 'h-4.5 w-10' : size === 28 ? 'h-7 w-20' : 'h-6 w-20',
            previewSurface(state),
          )}
        >
          {type === 'chart' ? option : cryptoLabel(option)}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  )
}

function CryptoTokenList({
  onSelect,
  favorites,
  onFavorite,
  showPrices = false,
  query = '',
  limit = 10,
}: {
  onSelect?: (token: CryptoToken) => void
  favorites?: readonly string[]
  onFavorite?: (token: CryptoToken) => void
  showPrices?: boolean
  query?: string
  limit?: number
}) {
  const cryptoLabel = useCryptoLabels()
  const matches = tokenFixtures
    .slice(0, limit)
    .filter((token) => `${token.name} ${token.symbol}`.toLowerCase().includes(query.toLowerCase()))
  return (
    <div className="min-h-0 overflow-auto p-2" data-slot="crypto-token-list">
      {matches.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">{cryptoLabel('noTokens')}</div>
      ) : (
        matches.map((token) => (
          <div key={token.symbol} className="flex items-center gap-1 rounded-xl hover:bg-muted">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onSelect?.(token.symbol)}
              className="h-10 min-w-0 flex-1 justify-start gap-2 rounded-xl px-2 text-compact font-medium"
              aria-label={token.name}
            >
              <TokenIcon symbol={token.symbol} className="size-4.5" />
              <span className="truncate">
                {token.name}{' '}
                <span className="font-mono text-xs text-muted-foreground">{`{${token.symbol.toUpperCase()}}`}</span>
              </span>
              {showPrices && (
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  <span className="font-mono text-sm">${formatAmount(token.price)}</span>
                  <span
                    className={cn(
                      'text-xs',
                      token.change < 0
                        ? 'text-status-error-text'
                        : token.change > 0
                          ? 'text-status-success-text'
                          : 'text-muted-foreground',
                    )}
                  >
                    {token.change > 0 ? '+' : ''}
                    {token.change}%
                  </span>
                </span>
              )}
            </Button>
            {onFavorite && (
              <Button
                type="button"
                variant="ghost"
                size="2xs"
                className="size-7 rounded-full p-1"
                aria-label={cryptoLabel(favorites?.includes(token.symbol) ? 'removeFavorite' : 'addFavorite', {
                  token: token.name,
                })}
                aria-pressed={favorites?.includes(token.symbol)}
                onClick={() => onFavorite(token.symbol)}
              >
                <Star
                  className={cn(
                    'size-4',
                    favorites?.includes(token.symbol)
                      ? 'fill-status-warning-icon text-status-warning-icon'
                      : 'text-muted-foreground',
                  )}
                />
              </Button>
            )}
          </div>
        ))
      )}
    </div>
  )
}

function CryptoTokenPicker({
  value = 'btc',
  onValueChange,
  appearance = 'lighter',
  state = 'default',
  disabled,
}: {
  value?: CryptoToken
  onValueChange?: (token: CryptoToken) => void
  appearance?: string
  state?: CryptoPreviewState
  disabled?: boolean
}) {
  const cryptoLabel = useCryptoLabels()
  const [selection, setSelection] = React.useState(value)
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  React.useEffect(() => setSelection(value), [value])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="2xs"
          disabled={disabled}
          aria-label={cryptoLabel('selectToken')}
          className={cn(
            pill,
            'h-7 gap-1 px-1.5 font-mono text-sm',
            appearance === 'stroke' ? 'border border-border bg-background' : 'bg-muted',
            previewSurface(state),
          )}
        >
          <TokenIcon symbol={selection} />
          {selection.toUpperCase()}
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-70 min-w-0 overflow-hidden rounded-2xl" align="end">
        <SearchInput
          aria-label={cryptoLabel('searchTokens')}
          placeholder={cryptoLabel('searchTokens')}
          value={query}
          onChange={setQuery}
          className="h-10 rounded-none border-0 border-b shadow-none"
          inputClassName="text-compact"
        />
        <div className="max-h-68 overflow-auto">
          <CryptoTokenList
            query={query}
            onSelect={(token) => {
              setSelection(token)
              onValueChange?.(token)
              setOpen(false)
            }}
            limit={12}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function CryptoSearch({
  state = 'default',
  inputOnly = false,
  onSelect,
}: {
  state?: CryptoPreviewState
  inputOnly?: boolean
  onSelect?: (token: CryptoToken) => void
}) {
  const cryptoLabel = useCryptoLabels()
  const [query, setQuery] = React.useState(
    state === 'empty' ? 'unlisted token' : state === 'searching' || state === 'active' ? 'Ethereum' : '',
  )
  const [selected, setSelected] = React.useState('')
  const [tab, setTab] = React.useState('tokens')
  const searchTokens = query.toLowerCase().includes('ethereum')
    ? [
        { ...tokenFixtures[1], name: 'Ethereum' },
        { ...tokenFixtures[1], name: 'Arbitrum ETH', price: 123.08, change: -0.2 },
        { ...tokenFixtures[1], name: 'Optimistic ETH', price: 98.04, change: 0.9 },
        { ...tokenFixtures[1], name: 'Base ETH', price: 456.18, change: -2.3 },
      ]
    : tokenFixtures.slice(0, 10)
  return (
    <CryptoPanel
      className={cn(
        'w-120 max-w-full',
        !inputOnly && (query ? 'h-99' : 'h-137'),
        inputOnly && 'rounded-none border-0 shadow-none',
      )}
    >
      <Command
        shouldFilter={!query.toLowerCase().includes('ethereum')}
        className="flex min-h-0 flex-1 flex-col"
        label={cryptoLabel('searchTokens')}
      >
        <CommandMenuInput
          value={query}
          onValueChange={setQuery}
          showShortcut={false}
          showClear
          appearance="source"
          placeholder={cryptoLabel('searchPairs')}
          aria-label={cryptoLabel('searchPairs')}
          className="text-compact"
          wrapperClassName="h-12 shrink-0 px-4 py-3.5 [&>svg]:size-4.5 focus-within:[&>svg]:text-status-success-icon"
        />
        {!inputOnly && (
          <>
            {!query && (
              <div
                className="flex h-9 shrink-0 items-center gap-5 border-b border-border px-5"
                role="tablist"
                aria-label={cryptoLabel('searchCategory')}
              >
                {['tokens', 'trade', 'rewards'].map((option) => (
                  <Button
                    type="button"
                    role="tab"
                    aria-selected={tab === option}
                    key={option}
                    variant="ghost"
                    size="2xs"
                    onClick={() => setTab(option)}
                    className={cn(
                      'h-10 rounded-none border-b px-0 font-mono text-xs uppercase',
                      tab === option
                        ? 'border-status-success-icon text-foreground'
                        : 'border-transparent text-muted-foreground',
                    )}
                  >
                    {cryptoLabel(option)}
                  </Button>
                ))}
              </div>
            )}
            {query && (
              <div className="flex h-9 shrink-0 items-end px-5 pb-1 font-mono text-overline text-muted-foreground">
                {cryptoLabel('results')}
              </div>
            )}
            <CommandMenuList className="min-h-0 max-h-none flex-1 p-2">
              <CommandMenuEmpty className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                <span className="flex size-20 items-center justify-center rounded-full bg-muted">
                  <img src={cryptoArtwork.sadFace} alt="" className="size-8" />
                </span>
                <strong className="text-compact font-medium text-foreground">{cryptoLabel('noTokens')}</strong>
                <span className="text-xs">{cryptoLabel('tryAnotherSearch')}</span>
              </CommandMenuEmpty>
              {searchTokens.map((token) => (
                <CommandMenuItem
                  key={token.name}
                  value={token.name}
                  keywords={[token.symbol]}
                  onSelect={() => {
                    setSelected(cryptoLabel('selectedToken', { token: token.name }))
                    onSelect?.(token.symbol)
                  }}
                  hideChevron
                  className="h-10 gap-2 rounded-xl px-2 py-2 text-compact [&_[data-slot=command-menu-item-text]>div>span]:text-compact"
                  leading={<TokenIcon symbol={token.symbol} />}
                  sublabel={`{${token.symbol.toUpperCase()}}`}
                  shortcut={
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-sm">${formatAmount(token.price)}</span>
                      <span
                        className={cn(
                          'text-xs',
                          token.change < 0 ? 'text-status-error-text' : 'text-status-success-text',
                        )}
                      >
                        {token.change > 0 ? '+' : ''}
                        {token.change}%
                      </span>
                    </span>
                  }
                >
                  {token.name}
                </CommandMenuItem>
              ))}
            </CommandMenuList>
            <CommandMenuFooter className="h-12 shrink-0 border-t border-border px-4 font-mono text-overline uppercase [&_kbd]:rounded-full" />
          </>
        )}
      </Command>
      <CryptoNotice message={selected} />
    </CryptoPanel>
  )
}

function CryptoNavigationSearch({ state = 'default' }: { state?: CryptoPreviewState }) {
  const cryptoLabel = useCryptoLabels()
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target instanceof HTMLElement && event.target.isContentEditable)) return
      if (
        ((event.ctrlKey || event.metaKey) && event.key === 'k') ||
        (event.key === '/' &&
          !(event.target instanceof HTMLInputElement) &&
          !(event.target instanceof HTMLTextAreaElement))
      ) {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn(
          'h-8 w-91 max-w-full justify-start gap-2 rounded-full bg-muted py-1.5 pl-2 pr-1.5 text-compact text-muted-foreground',
          previewSurface(state),
        )}
      >
        <Search className="size-4" />
        {cryptoLabel('searchPairs')}
        <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-background text-xs">/</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-120 max-w-full border-0 bg-transparent p-0 shadow-none [&>button]:hidden">
          <DialogTitle className="sr-only">{cryptoLabel('searchTokens')}</DialogTitle>
          <DialogDescription className="sr-only">{cryptoLabel('chooseToken')}</DialogDescription>
          <CryptoSearch onSelect={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}

function CryptoSwapInput({
  type = 'selling',
  state = 'default',
  value: controlledValue,
  onValueChange,
  token: controlledToken,
  onTokenChange,
  available = 0.0095,
}: {
  type?: string
  state?: CryptoPreviewState
  value?: string
  onValueChange?: (value: string) => void
  token?: CryptoToken
  onTokenChange?: (token: CryptoToken) => void
  available?: number
}) {
  const cryptoLabel = useCryptoLabels()
  const [inputValue, setInputValue] = React.useState(
    ['active', 'filled', 'error'].includes(state) ? (type === 'receive' ? '1050.64' : '0.0095') : '',
  )
  const [token, setToken] = React.useState<CryptoToken>(type === 'receive' ? 'usdc' : 'btc')
  const value = controlledValue ?? inputValue
  const activeToken = controlledToken ?? token
  const error =
    state === 'error' ||
    (type !== 'receive' &&
      value !== '' &&
      (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > available))
  const tokenValue = tokenBySymbol(activeToken)
  return (
    <div
      data-slot="crypto-swap-input"
      className="relative flex h-32 w-94 max-w-full gap-4 bg-background px-6 pt-6 pb-5"
    >
      <div
        className={cn(
          'min-w-0 flex-1 border-b border-border pb-4 focus-within:border-status-success-icon',
          error && 'border-status-error-icon focus-within:border-status-error-icon',
          state === 'active' && 'border-status-success-icon',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <label className="min-w-0 flex-1 text-compact text-muted-foreground">
            {cryptoLabel(type === 'receive' ? 'receiving' : 'selling')}
            <Input
              aria-label={cryptoLabel(type === 'receive' ? 'receiving' : 'selling')}
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(event) => {
                setInputValue(event.target.value)
                onValueChange?.(event.target.value)
              }}
              placeholder="0"
              disabled={state === 'disabled'}
              aria-invalid={error || undefined}
              className="h-10 border-0 bg-transparent p-0 shadow-none hover:bg-transparent focus-within:shadow-none has-[input:disabled]:bg-transparent"
              inputClassName={cn('text-title-4 tracking-tight text-foreground', error && 'text-status-error-text')}
            />
          </label>
          <div className="flex shrink-0 flex-col items-end gap-4">
            <CryptoTokenPicker
              value={activeToken}
              onValueChange={(next) => {
                setToken(next)
                onTokenChange?.(next)
              }}
              disabled={state === 'disabled'}
            />
            {type !== 'receive' && value && (
              <Button
                type="button"
                variant="ghost"
                size="2xs"
                className="h-4 gap-1 px-0 text-xs text-muted-foreground hover:bg-transparent"
                disabled={state === 'disabled'}
                onClick={() => {
                  const next = String(available)
                  setInputValue(next)
                  onValueChange?.(next)
                }}
              >
                <span className="hidden sm:inline">{cryptoLabel('available')}</span>
                <span className="underline">
                  {available} {activeToken.toUpperCase()}
                </span>
              </Button>
            )}
          </div>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          {money(Number.isFinite(Number(value)) ? Number(value) * tokenValue.price : 0)}
        </p>
      </div>
    </div>
  )
}

function CryptoSwap({ step = 1 }: { step?: 1 | 2 | 3 }) {
  const cryptoLabel = useCryptoLabels()
  const [amount, setAmount] = React.useState(step === 1 ? '' : '0.0095')
  const [sellingToken, setSellingToken] = React.useState<CryptoToken>('btc')
  const [receivingToken, setReceivingToken] = React.useState<CryptoToken>('usdc')
  const [phase, setPhase] = React.useState<'input' | 'quote' | 'ready' | 'confirmed'>(
    step === 1 ? 'input' : step === 2 ? 'quote' : 'ready',
  )
  const [mode, setMode] = React.useState('swap')
  const [slippage, setSlippage] = React.useState('0.5')
  const selling = tokenBySymbol(sellingToken)
  const receiving = tokenBySymbol(receivingToken)
  const numericAmount = Number(amount)
  const valid =
    amount.trim() !== '' &&
    Number.isFinite(numericAmount) &&
    numericAmount > 0 &&
    numericAmount <= selling.balance &&
    sellingToken !== receivingToken
  const quote = valid ? (numericAmount * selling.price) / receiving.price : 0
  const updateAmount = (next: string) => {
    setAmount(next)
    setPhase('input')
  }
  const submit = () => {
    if (!valid) return
    setPhase(phase === 'ready' ? 'confirmed' : 'ready')
  }
  return (
    <div
      className="flex min-h-129 w-94 max-w-full flex-col bg-background"
      data-slot="crypto-swap"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          submit()
        }
      }}
    >
      <div className="flex h-12 items-center justify-between gap-2 border-b border-border px-4">
        <SegmentedControl
          size="sm"
          value={mode}
          onValueChange={setMode}
          className="h-6 border-0 bg-transparent p-0"
          aria-label={cryptoLabel('transactionMode')}
        >
          {['swap', 'send', 'buy'].map((option) => (
            <SegmentedControlItem
              key={option}
              value={option}
              className="h-6 px-3 text-compact data-[state=checked]:bg-muted data-[state=checked]:shadow-none"
            >
              {cryptoLabel(option)}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="2xs"
              className="size-7 rounded-full p-1"
              aria-label={cryptoLabel('swapSettings')}
            >
              <Settings className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-60 min-w-0 p-4">
            <label className="grid gap-2 text-sm">
              {cryptoLabel('slippage')}
              <Input
                type="number"
                min="0"
                max="5"
                step="0.1"
                value={slippage}
                onChange={(event) => setSlippage(event.target.value)}
              />
            </label>
          </PopoverContent>
        </Popover>
      </div>
      <div className="relative flex flex-1 flex-col ring-1 ring-inset ring-border">
        <CryptoSwapInput
          value={amount}
          onValueChange={updateAmount}
          token={sellingToken}
          onTokenChange={(token) => {
            setSellingToken(token)
            setAmount('')
            setPhase('input')
          }}
          available={selling.balance}
        />
        <Button
          type="button"
          variant="ghost"
          size="2xs"
          className="absolute top-28 left-1/2 z-10 size-9 -translate-x-1/2 rounded-full border-4 border-background bg-muted p-1.5"
          aria-label={cryptoLabel('reverseTokens')}
          onClick={() => {
            setSellingToken(receivingToken)
            setReceivingToken(sellingToken)
            setAmount('')
            setPhase('input')
          }}
        >
          <ArrowDown className="size-4" />
        </Button>
        <CryptoSwapInput
          type="receive"
          value={phase === 'ready' || phase === 'confirmed' ? String(Number(quote.toFixed(receivingToken === 'usdc' || receivingToken === 'usdt' ? 2 : 6))) : ''}
          onValueChange={(next) => {
            const input = (Number(next) * receiving.price) / selling.price
            updateAmount(Number.isFinite(input) ? String(input) : '')
          }}
          token={receivingToken}
          onTokenChange={(token) => {
            setReceivingToken(token)
            setPhase('input')
          }}
        />
        <div className="grid min-h-44 flex-1 gap-3 border-t border-border px-6 py-6">
          <div className="grid gap-2 text-xs text-muted-foreground">
            {['transactionFee', 'serviceFee', 'executionDifference'].map((key, index) => (
              <div key={key} className="flex justify-between">
                <span>{cryptoLabel(key)}</span>
                <span className="font-mono">{index === 0 ? `0 ${receivingToken.toUpperCase()}` : '0%'}</span>
              </div>
            ))}
          </div>
          <Button
            type="button"
            disabled={!valid || phase === 'confirmed'}
            onClick={submit}
            className={cn(
              'w-full rounded-full',
              phase === 'ready' ? greenButton : 'bg-muted text-foreground hover:bg-muted/70',
            )}
          >
            {phase === 'quote' && (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-status-success-icon" />
            )}
            {cryptoLabel(
              phase === 'confirmed'
                ? 'swapConfirmed'
                : phase === 'ready'
                  ? 'confirmSwap'
                  : phase === 'quote'
                    ? 'finalizingQuote'
                    : valid
                      ? 'getQuote'
                      : 'enterAmount',
            )}
          </Button>
          {amount && !valid && (
            <p role="alert" className="text-xs text-status-error-text">
              {cryptoLabel(sellingToken === receivingToken ? 'differentTokens' : 'invalidAmount')}
            </p>
          )}
        </div>
      </div>
      <p className="flex h-9 shrink-0 items-center justify-center px-6 text-center text-xs text-muted-foreground">
        {cryptoLabel('localSimulation')}
      </p>
    </div>
  )
}

const filterValues: Record<string, string[]> = {
  type: ['swap', 'buy', 'send'],
  date: ['last24Hours', 'last7Days', 'lastMonth', 'lastQuarter', 'lastYear'],
  status: ['success', 'pending', 'failed', 'cancelled'],
  token: tokenFixtures.slice(0, 7).map((token) => token.symbol),
}

function CryptoFilterOptions({
  kind,
  value,
  onChange,
}: {
  kind: string
  value: string[]
  onChange: (value: string[]) => void
}) {
  const cryptoLabel = useCryptoLabels()
  const [query, setQuery] = React.useState('')
  const options = filterValues[kind] ?? filterValues.type
  const shown = options.filter((option) =>
    (kind === 'token' ? tokenBySymbol(option).name : cryptoLabel(option)).toLowerCase().includes(query.toLowerCase()),
  )
  const toggle = (option: string) =>
    onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option])
  const all = options.every((option) => value.includes(option))
  return (
    <div className={cn(kind === 'token' ? 'w-93 max-w-full' : 'w-42')} data-slot="crypto-filter-options">
      {kind === 'token' && (
        <SearchInput
          aria-label={cryptoLabel('searchTokens')}
          placeholder={cryptoLabel('searchTokens')}
          value={query}
          onChange={setQuery}
          className="h-10 rounded-none border-0 border-b shadow-none"
          inputClassName="text-compact"
        />
      )}
      <div className={cn('overflow-auto p-1', kind === 'token' ? 'max-h-79.5' : 'max-h-80 pb-1.5')}>
        <label className="mx-1 flex h-8 cursor-pointer items-center gap-2 border-b border-border px-1 text-xs">
          <Checkbox
            checked={all ? true : value.length ? 'indeterminate' : false}
            onCheckedChange={() => onChange(all ? [] : [...options])}
            className="size-3.5 rounded-sm data-[state=checked]:border-status-success-icon data-[state=checked]:bg-status-success-icon data-[state=indeterminate]:bg-status-success-icon data-[state=indeterminate]:border-status-success-icon"
          />
          {cryptoLabel(kind === 'date' ? 'allTime' : 'selectAll')}
          {kind === 'token' && (
            <Button
              type="button"
              variant="ghost"
              size="2xs"
              className="ml-auto h-6 px-1 text-xs text-muted-foreground"
              onClick={(event) => {
                event.preventDefault()
                onChange([])
              }}
            >
              {cryptoLabel('clear')}
            </Button>
          )}
        </label>
        {shown.map((option) => (
          <label
            key={option}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-lg px-2 text-xs hover:bg-muted',
              kind === 'token' ? 'h-10' : 'h-7.5',
            )}
          >
            <Checkbox
              checked={value.includes(option)}
              onCheckedChange={() => toggle(option)}
              className="size-3.5 rounded-sm data-[state=checked]:border-status-success-icon data-[state=checked]:bg-status-success-icon"
            />
            {kind === 'token' ? (
              <>
                <TokenIcon symbol={tokenBySymbol(option).symbol} />
                {tokenBySymbol(option).name}
                <span className="font-mono text-muted-foreground">{`{${option.toUpperCase()}}`}</span>
              </>
            ) : (
              cryptoLabel(option)
            )}
          </label>
        ))}
        {shown.length === 0 && <p className="p-4 text-xs text-muted-foreground">{cryptoLabel('noTokens')}</p>}
      </div>
    </div>
  )
}

function CryptoFilter({
  kind = 'type',
  state = 'default',
  standalone = false,
}: {
  kind?: string
  state?: CryptoPreviewState
  standalone?: boolean
}) {
  const cryptoLabel = useCryptoLabels()
  const [value, setValue] = React.useState<string[]>(
    state === 'selected'
      ? [kind === 'date' ? 'last24Hours' : kind === 'token' ? 'eth' : kind === 'status' ? 'pending' : 'swap']
      : standalone
        ? [kind === 'date' ? 'lastMonth' : kind === 'token' ? 'usdt' : kind === 'status' ? 'failed' : 'send']
        : [],
  )
  const [open, setOpen] = React.useState(false)
  if (standalone)
    return (
      <CryptoPanel className="w-fit max-w-full">
        <CryptoFilterOptions kind={kind} value={value} onChange={setValue} />
      </CryptoPanel>
    )
  const selectedLabel =
    value.length === 0
      ? cryptoLabel(kind === 'date' ? 'allTime' : 'all')
      : value.length === 1
        ? kind === 'token'
          ? tokenBySymbol(value[0]).name
          : cryptoLabel(value[0])
        : cryptoLabel('selectedCount', { count: value.length })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="2xs"
          aria-label={cryptoLabel('filterBy', { filter: cryptoLabel(kind) })}
          className="h-6 gap-0 overflow-hidden rounded-full border border-border p-0 text-xs"
        >
          <span className="flex h-full items-center border-r border-border px-3 text-muted-foreground">{cryptoLabel(kind)}</span>
          <span className={cn('flex h-full items-center gap-1 pr-2 pl-2.5', previewSurface(state))}>
            {kind === 'token' && value.length === 1 && (
              <TokenIcon symbol={tokenBySymbol(value[0]).symbol} className="size-3.5" />
            )}
            {kind === 'status' && value.length === 1 && (
              <img src={cryptoArtwork.statusPending} alt="" className="size-3" />
            )}
            {selectedLabel}
            <ChevronDown className={cn('size-4', open && 'rotate-180')} />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-fit min-w-0 rounded-xl">
        <CryptoFilterOptions kind={kind} value={value} onChange={setValue} />
      </PopoverContent>
    </Popover>
  )
}

function CryptoTableTabs({ kind = 'transaction', state = 'default' }: { kind?: string; state?: CryptoPreviewState }) {
  const cryptoLabel = useCryptoLabels()
  const [value, setValue] = React.useState(state === 'active' ? kind : '')
  return (
    <Tabs variant="underline" value={value} onValueChange={setValue}>
      <TabsList className="h-9 gap-6 border-0 p-0">
        {[kind].map((option) => (
          <TabsTrigger
            key={option}
            value={option}
            leading={
              <CryptoGlyph
                name={option === 'transaction' ? 'history' : option === 'open-orders' ? 'clock' : 'rewards'}
              />
            }
            className={cn(
              'h-9 gap-1.5 rounded-none border-b border-border px-0 pt-0 pb-4 text-sm hover:bg-transparent hover:text-foreground [&_[data-slot=tabs-trigger-leading]]:text-current [&_[data-slot=tabs-trigger-leading]]:group-hover:text-current data-[state=active]:border-status-success-icon data-[state=active]:text-foreground after:hidden',
              previewSurface(state),
            )}
          >
            {cryptoLabel(option === 'transaction' ? 'transactions' : option === 'open-orders' ? 'openOrders' : 'rewards')}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={kind} className="sr-only">
        <p className="sr-only">{cryptoLabel('selectedTab')}</p>
      </TabsContent>
    </Tabs>
  )
}

function CryptoTableButton({ kind = 'explorer', state = 'default' }: { kind?: string; state?: CryptoPreviewState }) {
  const cryptoLabel = useCryptoLabels()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="2xs"
          aria-label={cryptoLabel(kind === 'explorer' ? 'explorer' : 'transactionDetails')}
          className={cn(pill, 'size-7 p-1', previewSurface(state))}
        >
          <CryptoGlyph name={kind === 'explorer' ? 'link' : 'more'} className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4">
        <h4 className="text-sm font-medium">{cryptoLabel('transactionDetails')}</h4>
        <dl className="mt-3 grid gap-2 text-xs">
          <div className="flex justify-between">
            <dt>{cryptoLabel('type')}</dt>
            <dd>{cryptoLabel('swap')}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{cryptoLabel('status')}</dt>
            <dd className="text-status-success-text">{cryptoLabel('success')}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{cryptoLabel('transactionId')}</dt>
            <dd className="font-mono">0x7a4b…c8f2</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">{cryptoLabel('localSimulation')}</p>
      </PopoverContent>
    </Popover>
  )
}

function CryptoSocialButton({
  provider = 'phantom',
  onlyIcon = false,
  state = 'default',
  onConnect,
}: {
  provider?: string
  onlyIcon?: boolean
  state?: CryptoPreviewState
  onConnect?: (provider: string) => void
}) {
  const cryptoLabel = useCryptoLabels()
  const [connected, setConnected] = React.useState(false)
  const key = provider === 'walletconnect' ? 'walletconnect' : provider === 'metamask' ? 'metamask' : 'phantom'
  const name = key === 'walletconnect' ? 'WalletConnect' : key === 'metamask' ? 'MetaMask' : 'Phantom'
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={cryptoLabel(connected ? 'connectedProvider' : 'connectProvider', { provider: name })}
      onClick={() => {
        setConnected(true)
        onConnect?.(name)
      }}
      className={cn(
        'max-w-full gap-3 rounded-full bg-muted text-sm text-foreground hover:bg-accent',
        onlyIcon ? 'w-30' : 'w-94',
        state === 'hover' && 'bg-accent',
      )}
    >
      <img src={cryptoArtwork[key]} alt="" className="size-5" />
      {!onlyIcon && (
        <span>
          {connected ? (
            <>
              <Check className="mr-1 inline size-4" />
              {cryptoLabel('connectedProvider', { provider: name })}
            </>
          ) : (
            <>
              <span className="text-muted-foreground">{cryptoLabel('connect')} </span>
              {name}
            </>
          )}
        </span>
      )}
    </Button>
  )
}

function CryptoConnectWallet({ onConnect }: { onConnect?: (provider: string) => void }) {
  const cryptoLabel = useCryptoLabels()
  const [connected, setConnected] = React.useState('')
  const [help, setHelp] = React.useState(false)
  return (
    <CryptoPanel className="w-112 max-w-full rounded-4xl p-9 text-center">
      <img src={cryptoArtwork.brand} className="mx-auto size-14 rounded-full border border-border p-3" alt="" />
      <h3 className="mt-4 text-base font-medium">{cryptoLabel(connected ? 'walletConnected' : 'connectWallet')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {connected ? cryptoLabel('connectedProvider', { provider: connected }) : cryptoLabel('chooseWallet')}
      </p>
      <div className="mt-6 grid gap-2">
        {['phantom', 'walletconnect', 'metamask'].map((provider) => (
          <CryptoSocialButton
            key={provider}
            provider={provider}
            onConnect={(name) => {
              setConnected(name)
              onConnect?.(name)
            }}
          />
        ))}
      </div>
      <Button
        type="button"
        variant="link"
        size="2xs"
        onClick={() => setHelp(!help)}
        className="mt-5 h-6 text-status-success-text"
      >
        {cryptoLabel('setUpWallet')}
        <ArrowUpRight className="size-4" />
      </Button>
      {help && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {cryptoLabel('walletHelp')}
        </p>
      )}
    </CryptoPanel>
  )
}

function CryptoFavorites() {
  const cryptoLabel = useCryptoLabels()
  const [favorites, setFavorites] = React.useState<string[]>(['btc', 'eth', 'xrp', 'usdt'])
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState('')
  return (
    <CryptoPanel className="w-93 max-w-full">
      <div className="flex h-12 items-center justify-between border-b border-border px-4 text-compact">
        <span>{cryptoLabel('favoritesCount', { count: favorites.length })}</span>
        <Button
          type="button"
          variant="ghost"
          size="2xs"
          onClick={() => setFavorites([])}
          className="px-0 text-compact text-muted-foreground"
        >
          {cryptoLabel('clear')}
        </Button>
      </div>
      <SearchInput
        aria-label={cryptoLabel('searchTokens')}
        placeholder={cryptoLabel('searchTokens')}
        value={query}
        onChange={setQuery}
        className="h-11 rounded-none border-0 border-b px-4 shadow-none"
        inputClassName="text-compact"
      />
      <div className="h-99 overflow-auto">
        <CryptoTokenList
          query={query}
          favorites={favorites}
          onFavorite={(token) =>
            setFavorites(favorites.includes(token) ? favorites.filter((item) => item !== token) : [...favorites, token])
          }
          onSelect={(token) => setSelected(cryptoLabel('selectedToken', { token: tokenBySymbol(token).name }))}
        />
      </div>
      <CryptoNotice message={selected} />
    </CryptoPanel>
  )
}

function CryptoMenu({ profile = false }: { profile?: boolean }) {
  const cryptoLabel = useCryptoLabels()
  const [dark, setDark] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const items = [
    { key: profile ? 'accountSettings' : 'settings', Icon: Settings },
    { key: 'preferences', Icon: SlidersHorizontal },
    { key: 'helpCenter', Icon: MessageSquare },
    { key: 'community', Icon: Share2 },
  ]
  const divider = (
    <div className="flex h-1 items-center">
      <div className="h-px w-full bg-border" />
    </div>
  )
  return (
    <div className={dark ? 'dark' : undefined} data-slot="crypto-menu-theme">
      <CryptoPanel className="w-74 max-w-full gap-1 p-1.5">
        {profile && (
          <>
            <div className="flex h-14 items-center gap-3 p-2">
              <Avatar label="Wei Chen" src={cryptoArtwork.wei} size={40} />
              <div>
                <strong className="block text-sm font-medium">Wei Chen</strong>
                <span className="text-sm text-muted-foreground">wei@example.com</span>
              </div>
            </div>
            {divider}
          </>
        )}
        <label className="flex h-9 cursor-pointer items-center gap-2 px-2.5 text-sm">
          <Moon className="size-5 text-muted-foreground" />
          {cryptoLabel('darkMode')}
          <Switch checked={dark} onCheckedChange={setDark} className="ml-auto" />
        </label>
        {divider}
        {items.map(({ key, Icon }, index) => (
          <React.Fragment key={key}>
            {index === 3 && !profile && divider}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 w-full justify-start rounded-xl px-2.5 text-sm font-normal"
              onClick={() => setMessage(cryptoLabel('openedPanel', { panel: cryptoLabel(key) }))}
            >
              <Icon className="size-5 text-muted-foreground" />
              {cryptoLabel(key)}
              {key === 'preferences' && <ChevronRight className="ml-auto size-5" />}
            </Button>
          </React.Fragment>
        ))}
        {profile && (
          <>
            {divider}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 justify-start px-2.5 text-sm font-normal"
              onClick={() => setMessage(cryptoLabel('signedOut'))}
            >
              <LogOut className="size-5 text-status-error-icon" />
              {cryptoLabel('signOut')}
            </Button>
          </>
        )}
        <p className="flex h-8 items-center px-2.5 text-xs text-muted-foreground">{cryptoLabel('demoTerms')}</p>
        <CryptoNotice message={message} />
      </CryptoPanel>
    </div>
  )
}

function CryptoWallet() {
  const cryptoLabel = useCryptoLabels()
  const [copied, setCopied] = React.useState(false)
  const [connected, setConnected] = React.useState(true)
  const [verified, setVerified] = React.useState(false)
  const [all, setAll] = React.useState(false)
  const [action, setAction] = React.useState('')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText('0x1cf2000000000000000000000000000000009a56')
      setCopied(true)
    } catch {
      setAction(cryptoLabel('copyUnavailable'))
    }
  }
  return (
    <CryptoPanel className="w-91 max-w-full">
      <div className="flex h-18 items-center gap-3 border-b border-border px-4">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted">
          <CryptoGlyph name="crown" className="size-5 text-status-success-icon" />
        </span>
        <div className="min-w-0">
          <p className="text-sm">0x1cf2…9a56</p>
          <p className={cn('text-compact', connected ? 'text-status-success-text' : 'text-muted-foreground')}>
            {cryptoLabel(connected ? 'connected' : 'disconnected')}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="2xs"
          onClick={copy}
          className="ml-auto h-6 rounded-full bg-muted text-xs"
        >
          <Copy className="size-3" />
          {cryptoLabel(copied ? 'copied' : 'copy')}
        </Button>
      </div>
      <div className="grid min-h-33 gap-4 border-b border-border p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{cryptoLabel('totalBalance')}</p>
            <p className="mt-1 text-2xl font-medium tracking-tight">$460,890.02</p>
          </div>
          <CryptoTokenPicker value="eth" appearance="stroke" />
        </div>
        <div className="flex gap-2">
          {['swap', 'buy', 'send'].map((mode) => (
            <Button
              type="button"
              key={mode}
              variant="ghost"
              size="2xs"
              disabled={!connected}
              className="rounded-full bg-muted px-3 text-sm"
              onClick={() => setAction(mode)}
            >
              <ArrowDownUp className="size-4 text-status-success-icon" />
              {cryptoLabel(mode)}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1 p-2">
        <div className="flex h-7.5 items-center justify-between px-2 text-xs uppercase text-muted-foreground">
          <span>{cryptoLabel('topAssets')}</span>
          <Button
            type="button"
            variant="ghost"
            size="2xs"
            className="px-0 font-mono text-xs text-status-success-text"
            onClick={() => setAll(!all)}
          >
            {cryptoLabel(all ? 'showLess' : 'viewAll')}
          </Button>
        </div>
        <div className="flex h-1 items-center">
          <div className="h-px w-full bg-border" />
        </div>
        {tokenFixtures.slice(0, all ? 10 : 4).map((token) => (
          <div key={token.symbol} className="flex h-9 items-center gap-2 rounded-xl px-2 hover:bg-muted">
            <TokenIcon symbol={token.symbol} />
            <span className="text-compact">
              {token.name} <span className="font-mono text-xs text-muted-foreground">{token.symbol.toUpperCase()}</span>
            </span>
            <span className="ml-auto font-mono text-xs">{formatAmount(token.balance, 6)}</span>
          </div>
        ))}
      </div>
      <div className="flex h-18 items-center gap-3 border-y border-border px-4">
        <div>
          <p className="text-sm">{cryptoLabel('verify2FA')}</p>
          <p className="text-compact text-muted-foreground">{cryptoLabel('securityHint')}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="2xs"
          className="ml-auto rounded-full bg-status-success-bg px-4 text-status-success-text"
          onClick={() => setVerified(!verified)}
        >
          {cryptoLabel(verified ? 'verified' : 'verify')}
        </Button>
      </div>
      <div className="grid gap-2 p-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 justify-start text-sm font-normal"
          onClick={() => setAction('settings')}
        >
          <Settings className="size-4.5 text-muted-foreground" />
          {cryptoLabel('walletSettings')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 justify-start text-sm font-normal"
          onClick={() => setConnected(!connected)}
        >
          <LogOut className="size-4.5 text-status-error-icon" />
          {cryptoLabel(connected ? 'disconnectWallet' : 'connectWallet')}
        </Button>
      </div>
      <p className="px-4 pb-4 text-xs text-muted-foreground">{cryptoLabel('demoTerms')}</p>
      {action && (
        <CryptoNotice
          message={
            ['swap', 'buy', 'send', 'settings'].includes(action) ? cryptoLabel('openedPanel', { panel: cryptoLabel(action) }) : action
          }
        />
      )}
    </CryptoPanel>
  )
}

function CryptoNotifications() {
  const cryptoLabel = useCryptoLabels()
  const [read, setRead] = React.useState<string[]>([])
  const [viewAll, setViewAll] = React.useState(false)
  const rows = [
    {
      id: 'security',
      title: 'notificationSecurity',
      body: 'notificationDevice',
      time: 'fiveMinutes',
      Icon: Info,
      tone: 'text-status-error-icon',
    },
    {
      id: 'swap',
      title: 'notificationSwap',
      body: 'notificationSwapBody',
      time: 'now',
      Icon: ArrowDownUp,
      tone: 'text-status-success-icon',
    },
    {
      id: 'reward',
      title: 'notificationRewards',
      body: 'notificationRewardsBody',
      time: 'oneHour',
      Icon: Gift,
      tone: 'text-status-success-icon',
    },
    {
      id: 'login',
      title: 'notificationLogin',
      body: 'notificationDevice',
      time: 'tenMinutes',
      Icon: ShieldCheck,
      tone: 'text-status-warning-icon',
    },
    {
      id: 'maintenance',
      title: 'notificationMaintenance',
      body: 'notificationMaintenanceBody',
      time: 'yesterday',
      Icon: Settings,
      tone: 'text-badge-purple-solid',
    },
  ]
  return (
    <CryptoPanel className="w-100 max-w-full">
      <div className="flex h-12 items-center justify-between border-b border-border px-4 text-compact">
        <span>{cryptoLabel('notifications')}</span>
        <Button
          type="button"
          variant="ghost"
          size="2xs"
          className="px-0 text-xs text-status-success-text"
          onClick={() => setRead(rows.map((row) => row.id))}
        >
          {cryptoLabel('markAllRead')}
        </Button>
      </div>
      {rows.map(({ id, title, body, time, Icon, tone }) => (
        <Button
          type="button"
          key={id}
          variant="ghost"
          className={cn(
            'w-full items-start gap-3 rounded-none border-b border-border px-4 py-4 text-left font-normal',
            !read.includes(id) && ['swap', 'login'].includes(id) && 'bg-muted',
            ['security', 'reward'].includes(id) ? 'h-18' : 'h-19',
          )}
          onClick={() => setRead([...read, id])}
        >
          <Icon className={cn('mt-0.5 size-4.5 shrink-0', tone)} />
          <span className="min-w-0 flex-1">
            <strong className="block whitespace-normal text-compact font-medium">{cryptoLabel(title)}</strong>
            <span
              className={cn(
                'block whitespace-normal text-compact text-muted-foreground',
                !['security', 'reward'].includes(id) && 'mt-1',
              )}
            >
              {cryptoLabel(body)}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {cryptoLabel(time)}
            {!read.includes(id) && ['swap', 'login'].includes(id) && (
              <span className="size-1.5 rounded-full bg-status-success-icon" />
            )}
          </span>
        </Button>
      ))}
      <Button
        type="button"
        variant="ghost"
        className="h-12 rounded-none text-compact"
        onClick={() => setViewAll(!viewAll)}
      >
        {cryptoLabel('viewAllNotifications')}
      </Button>
      {viewAll && <CryptoNotice message={cryptoLabel('allNotificationsShown', { count: rows.length })} />}
    </CryptoPanel>
  )
}

function CryptoWalletTrigger({ state = 'default' }: { state?: CryptoPreviewState }) {
  const cryptoLabel = useCryptoLabels()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="2xs"
          className={cn(pill, 'h-7 gap-1.5 pl-2.5 pr-1.75 text-sm', previewSurface(state))}
          aria-label={cryptoLabel('wallet')}
        >
          <CryptoGlyph name="crown" className="size-4 text-status-success-icon" />
          0x1cf2…9a56
          <ChevronDown className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-fit min-w-0 border-0 bg-transparent shadow-none">
        <CryptoWallet />
      </PopoverContent>
    </Popover>
  )
}

function CryptoAction({
  kind = 'favorite',
  state = 'default',
  profile = false,
}: {
  kind?: string
  state?: CryptoPreviewState
  profile?: boolean
}) {
  const cryptoLabel = useCryptoLabels()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="2xs"
          className={cn(pill, 'relative size-7 p-1.25', previewSurface(state))}
          aria-label={cryptoLabel(
            profile
              ? 'profile'
              : kind === 'favorite'
                ? 'favorites'
                : kind === 'notification'
                  ? 'notifications'
                  : 'menu',
          )}
        >
          {profile ? (
            <Avatar label="Wei Chen" src={cryptoArtwork.wei} size={24} />
          ) : kind === 'notification' ? (
            <>
              <Bell className="size-4.5" />
              <span className="absolute top-1 right-1 size-1 rounded-full bg-status-warning-icon" />
            </>
          ) : (
            <CryptoGlyph name={kind === 'favorite' ? 'star' : 'menu'} />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-fit min-w-0 border-0 bg-transparent shadow-none" align="end">
        {profile ? (
          <CryptoMenu profile />
        ) : kind === 'favorite' ? (
          <CryptoFavorites />
        ) : kind === 'notification' ? (
          <CryptoNotifications />
        ) : (
          <CryptoMenu />
        )}
      </PopoverContent>
    </Popover>
  )
}

function CryptoNavigation({ profile = false, mobile = false }: { profile?: boolean; mobile?: boolean }) {
  const cryptoLabel = useCryptoLabels()
  const [selected, setSelected] = React.useState('overview')
  return (
    <div
      className={cn(
        'flex h-16 items-center gap-3 border-y border-border bg-background',
        mobile ? 'w-97.5 max-w-full px-4' : 'w-full min-w-0 flex-wrap px-4 lg:flex-nowrap lg:px-11',
      )}
      data-slot="crypto-navigation"
    >
      {mobile && <CryptoAction kind="hamburger" />}
      <img src={cryptoArtwork.brand} className="size-7 shrink-0" alt={cryptoLabel('cryptoBrand')} />
      {!mobile && (
        <div className="hidden items-center gap-1 md:flex">
          {['overview', 'markets', 'trade', 'rewards'].map((item) => (
            <CryptoNavigationItem
              key={item}
              state={selected === item ? 'active' : 'default'}
              pressed={selected === item}
              label={cryptoLabel(item)}
              onClick={() => setSelected(item)}
            />
          ))}
        </div>
      )}
      {!mobile && (
        <div className="mx-auto hidden min-w-0 lg:block">
          <CryptoNavigationSearch />
        </div>
      )}
      <div className="ml-auto flex items-center gap-2">
        {!mobile && (
          <div className="hidden sm:block">
            <CryptoWalletTrigger />
          </div>
        )}
        <CryptoAction kind="favorite" />
        <CryptoAction kind="notification" />
        {mobile ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="2xs"
                aria-label={cryptoLabel('searchTokens')}
                className="size-7 rounded-full p-1"
              >
                <Search className="size-4.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-fit min-w-0 border-0 bg-transparent shadow-none" align="end">
              <CryptoSearch />
            </PopoverContent>
          </Popover>
        ) : (
          <CryptoAction kind="hamburger" profile={profile} />
        )}
        {mobile && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={cryptoLabel('wallet')}
                className="size-8 rounded-full bg-status-success-bg p-2"
              >
                <CryptoGlyph name="crown" className="size-4 text-status-success-icon" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-fit min-w-0 border-0 bg-transparent shadow-none" align="end">
              <CryptoWallet />
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  )
}

function CryptoBanner() {
  const cryptoLabel = useCryptoLabels()
  const [visible, setVisible] = React.useState(true)
  const [claimed, setClaimed] = React.useState(false)
  return visible ? (
    <div className="flex min-h-9 w-full items-center justify-center gap-2 border-b border-border px-3 py-1 text-xs">
      <Gift className="size-3.5 shrink-0 text-status-success-icon" />
      <span>{cryptoLabel(claimed ? 'bonusClaimed' : 'bonusOffer')}</span>
      <Button
        type="button"
        variant="ghost"
        size="2xs"
        disabled={claimed}
        className="h-6 px-1 text-xs text-status-success-text"
        onClick={() => setClaimed(true)}
      >
        {cryptoLabel('claimNow')}
        <ArrowUpRight className="size-3" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="2xs"
        className="ml-auto size-6 p-1 text-muted-foreground"
        aria-label={cryptoLabel('dismissBanner')}
        onClick={() => setVisible(false)}
      >
        <X className="size-3" />
      </Button>
    </div>
  ) : (
    <Button type="button" variant="ghost" size="2xs" onClick={() => setVisible(true)}>
      {cryptoLabel('showBanner')}
    </Button>
  )
}

function CryptoMobileBottom() {
  const cryptoLabel = useCryptoLabels()
  const [selected, setSelected] = React.useState('home')
  const [open, setOpen] = React.useState(false)
  return (
    <div className="w-97.5 max-w-full bg-background pt-9">
      <Button type="button" className={cn(greenButton, 'mb-4 w-full')} onClick={() => setOpen(true)}>
        {cryptoLabel('swapSendBuy')}
      </Button>
      <div className="grid h-16 grid-cols-4 border-t border-border">
        {[
          { key: 'home', Icon: House },
          { key: 'markets', Icon: SlidersHorizontal },
          { key: 'trade', Icon: ArrowDownUp },
          { key: 'rewards', Icon: Gift },
        ].map(({ key, Icon }) => (
          <Button
            type="button"
            variant="ghost"
            key={key}
            onClick={() => setSelected(key)}
            aria-pressed={selected === key}
            className={cn(
              'h-16 flex-col gap-1 rounded-none border-t px-1 font-mono text-xs uppercase',
              selected === key
                ? 'border-status-success-icon text-status-success-text'
                : 'border-transparent text-muted-foreground',
            )}
          >
            <Icon className="size-4" />
            {cryptoLabel(key)}
          </Button>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-94 border-0 p-0 [&>button]:hidden">
          <DialogTitle className="sr-only">{cryptoLabel('swapSendBuy')}</DialogTitle>
          <DialogDescription className="sr-only">{cryptoLabel('localSimulation')}</DialogDescription>
          <CryptoSwap />
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function CryptocurrencyDemo({
  part,
  state = 'default',
  kind,
  size = 28,
  onlyIcon = false,
  profile = false,
  step = 1,
}: CryptocurrencyDemoProps) {
  const cryptoLabel = useCryptoLabels()
  let content: React.ReactNode
  switch (part) {
    case 'status-icon': {
      const key =
        kind === 'pending'
          ? 'statusPending'
          : kind === 'warning'
            ? 'statusWarning'
            : kind === 'cancelled'
              ? 'statusCancelled'
              : 'statusSuccess'
      content = <img src={cryptoArtwork[key]} alt={cryptoLabel(kind ?? 'success')} className="size-3" />
      break
    }
    case 'token-icon':
      content = (
        <img
          src={cryptoArtwork[tokenBySymbol(kind ?? 'btc').symbol]}
          alt={tokenBySymbol(kind ?? 'btc').name}
          className="size-6 rounded-full"
        />
      )
      break
    case 'navigation-item':
      content = <CryptoNavigationItem state={state} size={size} />
      break
    case 'navigation-search':
      content = <CryptoNavigationSearch state={state} />
      break
    case 'navigation-wallet':
      content = <CryptoWalletTrigger state={state} />
      break
    case 'navigation-action':
      content = <CryptoAction kind={kind} state={state} />
      break
    case 'chart-item':
      content = <CryptoSegments itemOnly state={state} />
      break
    case 'swap-select':
      content = <CryptoTokenPicker appearance={kind} state={state} />
      break
    case 'chart-switch':
      content = <CryptoSegments initialValue={kind} />
      break
    case 'table-button':
      content = <CryptoTableButton kind={kind} state={state} />
      break
    case 'table-switch-item':
      content = <CryptoSegments type="table" itemOnly size={24} state={state} />
      break
    case 'table-tab':
      content = <CryptoTableTabs kind={kind} state={state} />
      break
    case 'table-filter':
      content = <CryptoFilter kind={kind} state={state} />
      break
    case 'table-switch':
      content = <CryptoSegments type="table" initialValue={kind} size={size} />
      break
    case 'swap-input':
      content = <CryptoSwapInput type={kind} state={state} available={state === 'error' ? 0 : 0.0095} />
      break
    case 'swap':
      content = <CryptoSwap step={step} />
      break
    case 'search-modal':
      content = <CryptoSearch state={state} />
      break
    case 'search-input':
      content = <CryptoSearch state={state} inputOnly />
      break
    case 'navigation':
      content = <CryptoNavigation profile={profile} />
      break
    case 'social-button':
      content = <CryptoSocialButton provider={kind} onlyIcon={onlyIcon} state={state} />
      break
    case 'menu-dropdown':
      content = <CryptoMenu />
      break
    case 'favorites-dropdown':
      content = <CryptoFavorites />
      break
    case 'profile-dropdown':
      content = <CryptoMenu profile />
      break
    case 'wallet-dropdown':
      content = <CryptoWallet />
      break
    case 'swap-token-dropdown':
      content = <CryptoStandaloneTokenList />
      break
    case 'notifications-dropdown':
      content = <CryptoNotifications />
      break
    case 'connect-wallet':
      content = <CryptoConnectWallet />
      break
    case 'banner':
      content = <CryptoBanner />
      break
    case 'filter-type':
    case 'filter-date':
    case 'filter-status':
    case 'filter-token':
      content = <CryptoFilter kind={part.slice(7)} standalone />
      break
    case 'mobile-navigation':
      content = <CryptoNavigation mobile />
      break
    case 'mobile-bottom-navigation':
      content = <CryptoMobileBottom />
      break
  }
  return (
    <div
      data-slot="crypto-demo"
      data-crypto-part={part}
      data-preview-state={state}
      className={cn('flex max-w-full text-foreground', part === 'navigation' || part === 'banner' ? 'w-full' : 'w-fit')}
    >
      {content}
    </div>
  )
}

function CryptoStandaloneTokenList() {
  const cryptoLabel = useCryptoLabels()
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState('')
  return (
    <CryptoPanel className="w-70 max-w-full">
      <SearchInput
        aria-label={cryptoLabel('searchTokens')}
        placeholder={cryptoLabel('searchTokens')}
        value={query}
        onChange={setQuery}
        className="h-10 rounded-none border-0 border-b shadow-none"
        inputClassName="text-compact"
      />
      <div className="h-68.5 overflow-auto">
        <CryptoTokenList
          query={query}
          limit={12}
          onSelect={(token) => setSelected(cryptoLabel('selectedToken', { token: tokenBySymbol(token).name }))}
        />
      </div>
      <CryptoNotice message={selected} />
    </CryptoPanel>
  )
}
