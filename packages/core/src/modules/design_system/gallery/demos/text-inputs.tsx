import * as React from 'react'
import { Calendar, Globe, Info, Send, Smile, User } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { EmailInput } from '@open-mercato/ui/primitives/email-input'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { PasswordInput } from '@open-mercato/ui/primitives/password-input'
import { WebsiteInput } from '@open-mercato/ui/primitives/website-input'
import { AmountInput, type AmountValue } from '@open-mercato/ui/primitives/amount-input'
import { CardInput } from '@open-mercato/ui/primitives/card-input'
import { ButtonInput } from '@open-mercato/ui/primitives/button-input'
import { CompactButton } from '@open-mercato/ui/primitives/compact-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { PhoneNumberField, type PhoneCountry } from '@open-mercato/ui/backend/inputs/PhoneNumberField'
import unitedStates from '../assets/menu-united-states.svg'
import europeanUnion from '../assets/input-european-union.svg'
import poland from '../assets/select-poland.png'

const inputKinds = ['basic', 'email', 'phone', 'card', 'website', 'amount', 'date', 'search', 'password', 'button', 'dropdown', 'emoji'] as const
type InputKind = typeof inputKinds[number]
type InputState = 'placeholder' | 'filled' | 'error' | 'disabled'
type InputSize = 32 | 36 | 40

function assetSource(asset: string | { src: string }) { return typeof asset === 'string' ? asset : asset.src }

export function SourceTextInput({ kind, size = 36, state = 'filled' }: { kind: InputKind; size?: InputSize; state?: InputState }) {
  const t = useT()
  const id = React.useId()
  const isPlaceholder = state === 'placeholder'
  const disabled = state === 'disabled'
  const [text, setText] = React.useState(isPlaceholder ? '' : kind === 'basic' || kind === 'dropdown' ? 'Alex Morgan' : kind === 'email' ? 'alex@example.com' : kind === 'website' ? 'openmercato.com' : kind === 'password' ? 'LocalExample2026!' : kind === 'emoji' ? '🙂' : kind === 'date' ? '2026-09-18' : t('design_system.gallery.samples.textInput.sample'))
  const [phone, setPhone] = React.useState<string | undefined>(isPlaceholder ? undefined : '+1 212 555 1234')
  const [amount, setAmount] = React.useState<AmountValue>({ amount: isPlaceholder ? '' : '1250.00', currency: 'EUR' })
  const [card, setCard] = React.useState(isPlaceholder ? '' : '4242424242424242')
  const [permission, setPermission] = React.useState('view')
  const [emojiOpen, setEmojiOpen] = React.useState(false)
  const [feedback, setFeedback] = React.useState('')
  const dateRef = React.useRef<HTMLInputElement>(null)
  const label = t(`design_system.gallery.samples.textInput.${kind}`)
  const error = state === 'error' ? t('design_system.gallery.samples.textInput.error') : undefined
  const hint = t('design_system.gallery.samples.textInput.hint')
  const common = { id, size, disabled, 'aria-label': label, 'aria-invalid': !!error, 'aria-describedby': `${id}-${error ? 'error' : 'desc'}`, placeholder: t('design_system.gallery.samples.textInput.placeholder') }
  const countries: PhoneCountry[] = [
    { iso2: 'US', dialCode: '+1', label: t('design_system.gallery.samples.textInput.us'), flag: '🇺🇸' },
    { iso2: 'PL', dialCode: '+48', label: t('design_system.gallery.samples.textInput.pl'), flag: '🇵🇱' },
  ]
  let control: React.ReactNode
  if (kind === 'phone') {
    control = <PhoneNumberField id={id} size={size} ariaLabel={label} ariaDescribedBy={`${id}-desc`} countryLabel={t('design_system.gallery.samples.textInput.country')} value={phone} onValueChange={setPhone} countries={countries} disabled={disabled} externalError={error} renderCountryIcon={country => <img src={assetSource(country.iso2 === 'PL' ? poland : unitedStates)} alt="" className="size-5 object-contain" />} />
  } else if (kind === 'email') {
    control = <EmailInput {...common} value={text} onChange={event => setText(event.target.value)} />
  } else if (kind === 'website') {
    control = <WebsiteInput {...common} value={text} onChange={event => setText(event.target.value)} />
  } else if (kind === 'amount') {
    control = <AmountInput {...common} value={amount} onChange={setAmount} currencies={[{ code: 'USD', symbol: '$', label: 'USD' }, { code: 'EUR', symbol: '€', label: 'EUR' }]} renderCurrencyIcon={currency => <img src={assetSource(currency.code === 'EUR' ? europeanUnion : unitedStates)} alt="" className="size-5 object-contain" />} />
  } else if (kind === 'card') {
    control = <CardInput {...common} value={card} onChange={setCard} />
  } else if (kind === 'search') {
    control = <SearchInput {...common} value={text} onChange={setText} />
  } else if (kind === 'password') {
    control = <PasswordInput {...common} value={text} onChange={event => setText(event.target.value)} />
  } else if (kind === 'button') {
    control = <ButtonInput {...common} value={text} onChange={event => setText(event.target.value)} leftIcon={<User />} trailingAction={<CompactButton size={24} appearance="ghost" disabled={disabled} aria-label={t('design_system.gallery.samples.textInput.send')} onClick={() => setFeedback(t('design_system.gallery.samples.textInput.sent'))}><Send className="size-5" /></CompactButton>} />
  } else if (kind === 'dropdown') {
    control = <Input {...common} value={text} onChange={event => setText(event.target.value)} leftIcon={<User />} trailing={<Select value={permission} onValueChange={setPermission} disabled={disabled}><SelectTrigger size={32} aria-label={t('design_system.gallery.samples.textInput.permission')} className="h-5 w-auto gap-1 border-0 rounded-none bg-transparent p-0 text-muted-foreground shadow-none"><Globe className="size-5" aria-hidden="true" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="view">{t('design_system.gallery.samples.textInput.view')}</SelectItem><SelectItem value="edit">{t('design_system.gallery.samples.textInput.edit')}</SelectItem></SelectContent></Select>} />
  } else if (kind === 'emoji') {
    control = <Input {...common} value={text} onChange={event => setText(event.target.value)} leading={<Popover open={emojiOpen} onOpenChange={setEmojiOpen}><PopoverTrigger asChild><CompactButton size={20} appearance="ghost" disabled={disabled} aria-label={t('design_system.gallery.samples.textInput.chooseEmoji')}><Smile className="size-5" /></CompactButton></PopoverTrigger><PopoverContent className="flex w-fit gap-2 p-2">{['🙂', '🎉', '🚀', '❤️'].map(emoji => <CompactButton key={emoji} size={24} appearance="ghost" aria-label={emoji} onClick={() => { setText(current => `${current}${emoji}`); setEmojiOpen(false) }}>{emoji}</CompactButton>)}</PopoverContent></Popover>} />
  } else if (kind === 'date') {
    control = <Input {...common} ref={dateRef} type="date" value={text} onChange={event => setText(event.target.value)} inputClassName="[&::-webkit-calendar-picker-indicator]:hidden" leading={<CompactButton size={20} appearance="ghost" disabled={disabled} aria-label={t('design_system.gallery.samples.textInput.chooseDate')} onClick={() => { dateRef.current?.focus(); dateRef.current?.showPicker?.() }}><Calendar className="size-5" /></CompactButton>} />
  } else {
    control = <Input {...common} value={text} onChange={event => setText(event.target.value)} leftIcon={<User />} rightIcon={state === 'error' ? <Info /> : undefined} />
  }
  return <div className="min-w-0" data-input-kind={kind} data-input-size={size}><FormField id={id} label={label} description={hint} error={kind === 'phone' ? undefined : error} disabled={disabled}>{control}</FormField>{feedback ? <output className="mt-2 block text-xs text-muted-foreground" aria-live="polite">{feedback}</output> : null}{kind === 'phone' && phone ? <output className="mt-2 block text-xs text-muted-foreground" aria-live="polite">{phone}</output> : null}</div>
}

export function SourceTextInputMatrix({ size = 36, state = 'filled' }: { size?: InputSize; state?: InputState }) {
  return <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">{inputKinds.map(kind => <SourceTextInput key={`${kind}-${size}-${state}`} kind={kind} size={size} state={state} />)}</div>
}

export function SourcePhoneExamples({ state = 'filled' }: { state?: InputState }) {
  return <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-3">{([32, 36, 40] as const).map(size => <SourceTextInput key={`${size}-${state}`} kind="phone" size={size} state={state} />)}</div>
}

export function SourceTextareaExamples() {
  const t = useT()
  return <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-2">{(['placeholder', 'filled', 'error', 'disabled'] as const).map(state => <FormField key={state} label={t('design_system.gallery.samples.textInput.note')} description={t('design_system.gallery.samples.textInput.hint')} disabled={state === 'disabled'} error={state === 'error' ? t('design_system.gallery.samples.textInput.error') : undefined}><Textarea appearance="source" showCount maxLength={200} placeholder={t('design_system.gallery.samples.textInput.placeholder')} defaultValue={state === 'placeholder' ? '' : t('design_system.gallery.samples.textInput.noteValue')} /></FormField>)}</div>
}
