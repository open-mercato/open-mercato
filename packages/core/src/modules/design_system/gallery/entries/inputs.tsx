import { MarketingControlDemo } from '../demos/marketing-controls'
import { marketingControlExampleCode } from '../demos/marketing-controls-code.generated'
import { FieldLabelExample, FormFieldLabelExample, HintTextExample } from '../demos/key-components'
import * as React from 'react'
import { Copy, Globe, Info, Link2, Send, User } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectTriggerLeading,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { CompactSelectTrigger } from '@open-mercato/ui/primitives/compact-select'
import { InlineSelectTrigger } from '@open-mercato/ui/primitives/inline-select'
import { InlineInput } from '@open-mercato/ui/primitives/inline-input'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Radio, RadioGroup } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Slider } from '@open-mercato/ui/primitives/slider'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { EmailInput } from '@open-mercato/ui/primitives/email-input'
import { PasswordInput } from '@open-mercato/ui/primitives/password-input'
import { PasswordStrength } from '@open-mercato/ui/primitives/password-strength'
import { WebsiteInput } from '@open-mercato/ui/primitives/website-input'
import { AmountInput, type AmountValue } from '@open-mercato/ui/primitives/amount-input'
import { CounterInput } from '@open-mercato/ui/primitives/counter-input'
import { DigitInput } from '@open-mercato/ui/primitives/digit-input'
import { CardInput } from '@open-mercato/ui/primitives/card-input'
import { ButtonInput } from '@open-mercato/ui/primitives/button-input'
import {
  ColorPicker,
  COLOR_PICKER_DEFAULT_SWATCHES,
} from '@open-mercato/ui/primitives/color-picker'
import { TagInput } from '@open-mercato/ui/primitives/tag-input'
import { RichEditor, RichEditorColorPalette, RICH_EDITOR_COLOR_PALETTE, type RichEditorToolbarDesign, type RichEditorVariant, type RichEditorColorKey } from '@open-mercato/ui/primitives/rich-editor'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'
import { FileUploadAreaDemo, FileUploadCardDemo, ImageUploadDemo } from '../demos/file-upload'
import { SelectionSourceCardsDemo, IntegrationSwitchDemo } from '../demos/selection-cards'
import { SelectSourceExample, SelectSourceMatrix, DropdownSourceExample } from '../demos/menus'
import { SourceTextInputMatrix, SourcePhoneExamples, SourceTextareaExamples } from '../demos/text-inputs'
import type { GalleryEntry } from '../types'
import { inputFieldCode, textareaFieldCode, phoneNumberFieldCode, selectFieldCode, dropdownCode, fieldLabelCode, fieldLabelInformationCode, fieldLabelActionCode, formFieldLabelCode, hintTextCode } from './inputs-snippets'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

// ---------------------------------------------------------------------------
// Demo wrappers — controlled primitives need local state to be interactive in
// the gallery. The `code` snippets show the essential consumer usage, not
// these wrappers.
// ---------------------------------------------------------------------------

function DemoSearchInput({ size }: { size?: 'sm' | 'default' | 'lg' }) {
  const t = useT()
  const [value, setValue] = React.useState(() => t('design_system.gallery.sampleCopy.openOrders'))
  return (
    <div className="w-72">
      <SearchInput value={value} onChange={setValue} size={size} />
    </div>
  )
}

function DemoAmountInput({ showCurrency }: { showCurrency?: boolean }) {
  const [value, setValue] = React.useState<AmountValue>({ amount: '1250.00', currency: 'EUR' })
  return (
    <div className="w-72">
      <AmountInput value={value} onChange={setValue} showCurrency={showCurrency} />
    </div>
  )
}

const selectionCardClasses = 'relative w-full max-w-90 gap-3.5 rounded-xl border border-border bg-background p-4 shadow-xs transition-colors hover:border-transparent hover:bg-muted hover:shadow-none has-[[data-state=checked]]:border-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus has-[:disabled]:border-border has-[:disabled]:bg-background has-[:disabled]:shadow-none [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-xl [&_button]:relative [&_button]:z-10'

function SelectionCardsPreview({ control, disabled = false }: { control: 'checkbox' | 'radio' | 'switch'; disabled?: boolean }) {
  const t = useT()
  const choices = [
    { value: 'immediate', label: t('design_system.gallery.samples.selection.immediate'), description: t('design_system.gallery.samples.selection.immediateDescription') },
    { value: 'weekly', label: t('design_system.gallery.samples.selection.weekly'), description: t('design_system.gallery.samples.selection.weeklyDescription') },
  ]
  const cards = choices.map((choice, index) => {
    const fieldProps = {
      label: choice.label,
      description: choice.description,
      sublabel: t('design_system.gallery.samples.selection.optional'),
      badge: <Badge variant={disabled ? 'outline' : 'info'} size="sm" className={disabled ? 'text-text-disabled' : undefined}>{t('design_system.gallery.samples.selection.new')}</Badge>,
      disabled,
      className: 'mt-0',
      containerClassName: selectionCardClasses,
    }
    if (control === 'radio') return <RadioField key={choice.value} value={choice.value} flip {...fieldProps} />
    if (control === 'switch') return <SwitchField key={choice.value} defaultChecked={index === 0} {...fieldProps} />
    return <CheckboxField key={choice.value} defaultChecked={index === 0} flip {...fieldProps} />
  })
  if (control === 'radio') {
    return <RadioGroup defaultValue="immediate" aria-label={t('design_system.gallery.samples.selection.preferences')} className="grid w-full gap-4 sm:grid-cols-2">{cards}</RadioGroup>
  }
  return <div className="grid w-full gap-4 sm:grid-cols-2">{cards}</div>
}

function FlippedRadioPreview() {
  const t = useT()
  return (
    <RadioGroup defaultValue="immediate" aria-label={t('design_system.gallery.samples.selection.preferences')} className="w-72">
      <RadioField value="immediate" flip label={t('design_system.gallery.samples.selection.immediate')} />
      <RadioField value="weekly" flip label={t('design_system.gallery.samples.selection.weekly')} />
    </RadioGroup>
  )
}

function ReadOnlyInputPreview() {
  const t = useT()
  return (
    <FormField
      className="w-full max-w-sm"
      label={t('design_system.gallery.samples.states.recordId')}
      description={t('design_system.gallery.samples.states.readOnlyHint')}
    >
      <Input readOnly value="OM-2026-0042" />
    </FormField>
  )
}

function ReadOnlyTextareaPreview() {
  const t = useT()
  return (
    <FormField
      className="w-full max-w-sm"
      label={t('design_system.gallery.samples.states.savedNote')}
      description={t('design_system.gallery.samples.states.readOnlyHint')}
    >
      <Textarea readOnly value={t('design_system.gallery.samples.states.noteValue')} />
    </FormField>
  )
}

function DisabledSearchInputPreview() {
  const t = useT()
  const [query, setQuery] = React.useState('OM-2026-0042')
  return (
    <FormField className="w-full max-w-sm" label={t('design_system.gallery.samples.states.search')} disabled>
      <SearchInput value={query} onChange={setQuery} />
    </FormField>
  )
}

function InvalidPasswordInputPreview() {
  const t = useT()
  return (
    <FormField
      className="w-full max-w-sm"
      label={t('design_system.gallery.samples.states.password')}
      error={t('design_system.gallery.samples.states.passwordError')}
    >
      <PasswordInput defaultValue="short" autoComplete="off" />
    </FormField>
  )
}

function DisabledAmountInputPreview() {
  const t = useT()
  const [value, setValue] = React.useState<AmountValue>({ amount: '1250.00', currency: 'EUR' })
  return (
    <FormField className="w-full max-w-sm" label={t('design_system.gallery.samples.states.amount')} disabled>
      <AmountInput value={value} onChange={setValue} />
    </FormField>
  )
}

function DemoCounterInput({
  initial = 2,
  step,
  precision,
  min,
  max,
}: {
  initial?: number
  step?: number
  precision?: number
  min?: number
  max?: number
}) {
  const [value, setValue] = React.useState<number | null>(initial)
  return (
    <div className="w-36">
      <CounterInput
        value={value}
        onChange={setValue}
        step={step}
        precision={precision}
        min={min}
        max={max}
      />
    </div>
  )
}

function DemoCardInput({ initial = '' }: { initial?: string }) {
  const [value, setValue] = React.useState(initial)
  return (
    <div className="w-80">
      <CardInput value={value} onChange={setValue} />
    </div>
  )
}

function DemoColorPicker({
  allowCustom,
  swatches,
  showOpacity = false,
}: {
  allowCustom?: boolean
  swatches?: readonly string[]
  showOpacity?: boolean
}) {
  const t = useT()
  const [color, setColor] = React.useState('#6366F1')
  const [opacity, setOpacity] = React.useState(75)
  return (
    <ColorPicker
      value={color}
      onChange={setColor}
      allowCustom={allowCustom}
      swatches={swatches}
      showOpacity={showOpacity}
      opacity={showOpacity ? opacity : 100}
      onOpacityChange={showOpacity ? setOpacity : undefined}
      aria-label={t('design_system.gallery.sampleCopy.pickColor')}
    />
  )
}

function DemoTagInput({
  initial = [],
  maxTags,
  placeholder,
}: {
  initial?: string[]
  maxTags?: number
  placeholder?: string
}) {
  const [tags, setTags] = React.useState<string[]>(initial)
  return (
    <div className="w-72">
      <TagInput value={tags} onChange={setTags} maxTags={maxTags} placeholder={placeholder} />
    </div>
  )
}

function DemoRichEditor({ variant = 'standard', toolbarDesign, disabled = false, counter = false }: { variant?: RichEditorVariant; toolbarDesign?: RichEditorToolbarDesign; disabled?: boolean; counter?: boolean }) {
  const t = useT()
  const [html, setHtml] = React.useState(() => '<p>' + t('design_system.gallery.samples.richEditor.initial') + '</p>')
  const [feedback, setFeedback] = React.useState('')
  const labels = {
    bold: t('design_system.gallery.samples.richEditor.labels.bold'),
    italic: t('design_system.gallery.samples.richEditor.labels.italic'),
    underline: t('design_system.gallery.samples.richEditor.labels.underline'),
    strikethrough: t('design_system.gallery.samples.richEditor.labels.strikethrough'),
    unorderedList: t('design_system.gallery.samples.richEditor.labels.unorderedList'),
    orderedList: t('design_system.gallery.samples.richEditor.labels.orderedList'),
    checklist: t('design_system.gallery.samples.richEditor.labels.checklist'),
    blockquote: t('design_system.gallery.samples.richEditor.labels.blockquote'),
    code: t('design_system.gallery.samples.richEditor.labels.code'),
    inlineCode: t('design_system.gallery.samples.richEditor.labels.inlineCode'),
    codeBlock: t('design_system.gallery.samples.richEditor.labels.codeBlock'),
    horizontalRule: t('design_system.gallery.samples.richEditor.labels.horizontalRule'),
    image: t('design_system.gallery.samples.richEditor.labels.image'),
    imageUrlPrompt: t('design_system.gallery.samples.richEditor.labels.imageUrlPrompt'),
    table: t('design_system.gallery.samples.richEditor.labels.table'),
    heading: t('design_system.gallery.samples.richEditor.labels.heading'),
    heading1: t('design_system.gallery.samples.richEditor.labels.heading1'),
    heading2: t('design_system.gallery.samples.richEditor.labels.heading2'),
    heading3: t('design_system.gallery.samples.richEditor.labels.heading3'),
    paragraph: t('design_system.gallery.samples.richEditor.labels.paragraph'),
    link: t('design_system.gallery.samples.richEditor.labels.link'),
    linkUrlPrompt: t('design_system.gallery.samples.richEditor.labels.linkUrlPrompt'),
    color: t('design_system.gallery.samples.richEditor.labels.color'),
    textColor: t('design_system.gallery.samples.richEditor.labels.textColor'),
    fontSize: t('design_system.gallery.samples.richEditor.labels.fontSize'),
    align: t('design_system.gallery.samples.richEditor.labels.align'),
    alignLeft: t('design_system.gallery.samples.richEditor.labels.alignLeft'),
    alignCenter: t('design_system.gallery.samples.richEditor.labels.alignCenter'),
    alignRight: t('design_system.gallery.samples.richEditor.labels.alignRight'),
    alignJustify: t('design_system.gallery.samples.richEditor.labels.alignJustify'),
    comment: t('design_system.gallery.samples.richEditor.labels.comment'),
    mention: t('design_system.gallery.samples.richEditor.labels.mention'),
    more: t('design_system.gallery.samples.richEditor.labels.more'),
    help: t('design_system.gallery.samples.richEditor.labels.help'),
    fullscreen: t('design_system.gallery.samples.richEditor.labels.fullscreen'),
    placeholder: t('design_system.gallery.samples.richEditor.labels.placeholder'),
    colors: Object.fromEntries(Object.keys(RICH_EDITOR_COLOR_PALETTE).map(key => [key, t(`design_system.gallery.samples.richEditor.colors.${key}`)])) as Record<RichEditorColorKey, string>,
  }
  return (
    <div className="flex min-w-0 w-full max-w-3xl flex-col gap-3">
      <RichEditor value={html} onChange={setHtml} variant={variant} toolbarDesign={toolbarDesign} disabled={disabled} maxLength={counter ? 100 : undefined} labels={labels}
        onComment={() => setFeedback(t('design_system.gallery.samples.richEditor.comment'))}
        onMention={() => setFeedback(t('design_system.gallery.samples.richEditor.mention'))} />
      {feedback && <output aria-live="polite" className="text-sm text-muted-foreground">{feedback}</output>}
    </div>
  )
}

function DemoRichEditorPalette() {
  const t = useT()
  const [value, setValue] = React.useState<RichEditorColorKey | null>('gray')
  const labels = Object.fromEntries(Object.keys(RICH_EDITOR_COLOR_PALETTE).map(key => [key, t(`design_system.gallery.samples.richEditor.colors.${key}`)])) as Record<RichEditorColorKey, string>
  return <div className="flex w-full max-w-sm flex-col gap-3"><RichEditorColorPalette value={value} onChange={setValue} labels={labels} />
    <output aria-live="polite" className="text-sm text-muted-foreground">{value ? labels[value] : ''}</output>
  </div>
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

const inputEntry: GalleryEntry = {
  id: 'input',
  title: 'Input',
  importPath: '@open-mercato/ui/primitives/input',
  figmaNodeId: '266:5251',
  usage: { do: ['Numeric sizes 32, 36 and 40 use the source 14/20 text, 20 px icons and asymmetric input padding. Named sizes preserve existing callers.', 'leading and trailing accept interactive controls; provide accessible labels and forward disabled to those controls. leftIcon/rightIcon remain decorative.', 'The source compositions cover all twelve Text Input types. Hover and focus are real browser states; the Date example uses the native date picker and locale formatting. Existing CardInput brand badges and phone parsing retain their runtime behavior.'] },
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => <InputInputsDefaultSample />,
      code: `import { Input } from '@open-mercato/ui/primitives/input'

<Input placeholder="Product name" />`,
    },
    {
      id: 'icon-slots',
      title: 'Icon slots',
      render: () => <InputInputsIconSlotsSample />,
      code: `import { Info, User } from 'lucide-react'
import { Input } from '@open-mercato/ui/primitives/input'

<Input leftIcon={<User />} placeholder="Assignee" />
<Input rightIcon={<Info />} placeholder="SKU" />`,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      render: () => <InputInputsSizesSample />,
      code: `import { Input } from '@open-mercato/ui/primitives/input'

<Input size="lg" placeholder="Large" />
<Input size="default" placeholder="Default" />
<Input size="sm" placeholder="Small" />`,
    },
    {
      id: 'states',
      title: 'States',
      render: () => <InputInputsStatesSample />,
      code: `import { Input } from '@open-mercato/ui/primitives/input'

<Input aria-invalid defaultValue="not-a-number" />
<Input disabled placeholder="Disabled" />`,
    },
    {
      id: 'read-only',
      title: 'Read-only',
      render: () => <ReadOnlyInputPreview />,
      code: `import { Input } from '@open-mercato/ui/primitives/input'
import { FormField } from '@open-mercato/ui/primitives/form-field'

<FormField label="Record ID" description="Read-only content stays focusable and can be selected and copied.">
  <Input readOnly value="OM-2026-0042" />
</FormField>`,
    },
    { id: 'source-32', title: 'Source / all twelve types / 32 px', render: () => <SourceTextInputMatrix size={32} />, code: inputFieldCode({ inputProps: ' size={32}' }) },
    { id: 'source-36', title: 'Source / all twelve types / 36 px', render: () => <SourceTextInputMatrix size={36} />, code: inputFieldCode({ inputProps: ' size={36}' }) },
    { id: 'source-40', title: 'Source / all twelve types / 40 px', render: () => <SourceTextInputMatrix size={40} />, code: inputFieldCode({ inputProps: ' size={40}' }) },
    { id: 'source-placeholder', title: 'Source / placeholder', render: () => <SourceTextInputMatrix state="placeholder" />, code: inputFieldCode() },
    { id: 'source-error', title: 'Source / error', render: () => <SourceTextInputMatrix state="error" />, code: inputFieldCode({ inputProps: ' aria-invalid', fieldProps: ' error="Enter your full name"' }) },
    { id: 'source-disabled', title: 'Source / disabled', render: () => <SourceTextInputMatrix state="disabled" />, code: inputFieldCode({ inputProps: ' disabled', fieldProps: ' disabled' }) },
  ],
}

const textareaEntry: GalleryEntry = {
  id: 'textarea',
  title: 'Textarea',
  figmaNodeId: '435:5725',
  usage: { do: ['appearance=source adds the source 112 px minimum field, 12 px radius, 14/20 text and an interior character counter. The browser-native resize handle remains operable.', 'The default appearance and external counter retain their current layout. Set maxLength together with showCount and supply a visible field label.'] },
  importPath: '@open-mercato/ui/primitives/textarea',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => <TextareaInputsDefaultSample />,
      code: `import { Textarea } from '@open-mercato/ui/primitives/textarea'

<Textarea placeholder="Internal note for the fulfillment team" />`,
    },
    {
      id: 'character-count',
      title: 'Character counter',
      render: () => <TextareaInputsCharacterCountSample />,
      code: `import { Textarea } from '@open-mercato/ui/primitives/textarea'

<Textarea showCount maxLength={200} defaultValue="Customer prefers delivery after 4 PM." />`,
    },
    {
      id: 'states',
      title: 'States',
      render: () => <TextareaInputsStatesSample />,
      code: `import { Textarea } from '@open-mercato/ui/primitives/textarea'

<Textarea aria-invalid defaultValue="Too short" />
<Textarea disabled placeholder="Disabled" />`,
    },
    {
      id: 'read-only',
      title: 'Read-only',
      render: () => <ReadOnlyTextareaPreview />,
      code: `import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { FormField } from '@open-mercato/ui/primitives/form-field'

<FormField label="Saved note" description="Read-only content stays focusable and can be selected and copied.">
  <Textarea readOnly value="Customer requested delivery after 4 PM." />
</FormField>`,
    },
    { id: 'source-states', title: 'Source / default, filled, error and disabled', render: () => <SourceTextareaExamples />, code: textareaFieldCode },
  ],
}

const phoneNumberEntry: GalleryEntry = {
  id: 'phone-number-field',
  title: 'PhoneNumberField',
  importPath: '@open-mercato/ui/backend/inputs/PhoneNumberField',
  figmaNodeId: '313:10101',
  usage: { do: ['Numeric sizes 32/36/40 add source geometry while the existing automatic height remains the default.', 'Choose a country or edit the national number to update the local value. Validation and optional duplicate lookup retain their existing contracts.', 'countries translates and limits picker choices; countryLabel names the picker and renderCountryIcon can supply actual country assets.'] },
  variants: [
    { id: 'sizes', title: 'Source / 32, 36 and 40 px', render: () => <SourcePhoneExamples />, code: phoneNumberFieldCode() },
    { id: 'placeholder', title: 'Source / placeholder', render: () => <SourcePhoneExamples state="placeholder" />, code: phoneNumberFieldCode() },
    { id: 'validation', title: 'Source / validation', render: () => <SourcePhoneExamples state="error" />, code: phoneNumberFieldCode(' externalError="Enter a valid phone number"') },
    { id: 'disabled', title: 'Source / disabled', render: () => <SourcePhoneExamples state="disabled" />, code: phoneNumberFieldCode(' disabled') },
  ],
}

const selectEntry: GalleryEntry = {
  id: 'select',
  figmaNodeId: '270:1085',
  title: 'Select',
  importPath: '@open-mercato/ui/primitives/select',
  usage: { do: [
    'Six source leading types: Basic, Country, Avatar, Provider, Brand, and Company. The 32/36/40 numeric sizes use the measured source text, icons, padding and radii; named sizes retain their existing defaults.',
    'SelectItem leading keeps the visual outside Radix ItemText. The trigger renders its selected visual explicitly, so a selection never duplicates the icon.',
    'Use Dropdown for searchable choices. Select keeps Radix keyboard typeahead; search inputs must not be nested in a Select listbox.',
  ] },
  variants: [
    { id: 'default', title: 'Basic / 36 px', render: () => <div className="w-72 max-w-full"><SelectSourceExample kind="basic" /></div>, code: selectFieldCode() },
    { id: 'groups-leading', title: 'All six leading types / 36 px', render: () => <SelectSourceMatrix />, code: selectFieldCode({ leading: true }) },
    { id: 'sizes', title: 'All types / 32 px', render: () => <SelectSourceMatrix size={32} />, code: selectFieldCode({ size: 32, leading: true }) },
    { id: 'medium', title: 'All types / 40 px', render: () => <SelectSourceMatrix size={40} />, code: selectFieldCode({ size: 40, leading: true }) },
    { id: 'placeholder', title: 'All types / placeholders', render: () => <SelectSourceMatrix state="default" />, code: selectFieldCode({ leading: true, initialValue: '' }) },
    { id: 'states', title: 'All types / disabled', render: () => <SelectSourceMatrix state="disabled" />, code: selectFieldCode({ leading: true, selectProps: ' disabled', fieldProps: ' disabled' }) },
    { id: 'errors', title: 'All types / errors', render: () => <SelectSourceMatrix state="error" />, code: selectFieldCode({ leading: true, initialValue: '', fieldProps: ' error="Choose an office"' }) },
  ],
}

const dropdownEntry: GalleryEntry = {
  id: 'dropdown',
  figmaNodeId: '379:6629',
  title: 'Dropdown',
  importPath: '@open-mercato/ui/primitives/dropdown',
  descriptionKey: 'design_system.entries.dropdown.description',
  usage: { do: [
    'A searchable, keyboard-operated picker built from Popover and cmdk. All six leading types use source assets and production components at 36 or 56 px.',
    'Search, clear, choose with arrows and Enter, or dismiss with Escape. The selected value and footer action update local example state.',
    'The saved checked state is separate from the active keyboard option. Footer buttons remain outside listbox options. Source Misc Items 414:8031 supplies search, action and caption layouts.',
  ] },
  variants: [
    { id: 'small', title: 'All six types / 36 px', render: () => <DropdownSourceExample />, code: dropdownCode() },
    { id: 'large', title: 'All six types / 56 px', render: () => <DropdownSourceExample size={56} />, code: dropdownCode({ size: 56 }) },
    { id: 'empty', title: 'No results / clear to recover', render: () => <DropdownSourceExample empty />, code: dropdownCode({ initialQuery: 'zzzz' }) },
  ],
}

const compactSelectEntry: GalleryEntry = {
  id: 'compact-select',
  title: 'CompactSelectTrigger',
  importPath: '@open-mercato/ui/primitives/compact-select',
  variants: [
    {
      id: 'trigger-label',
      title: 'With trigger label',
      render: () => <CompactSelectInputsTriggerLabelSample />,
      code: `import {
  CompactSelectTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@open-mercato/ui/primitives/compact-select'

<Select defaultValue="newest">
  <CompactSelectTrigger triggerLabel="Sort:">
    <SelectValue />
  </CompactSelectTrigger>
  <SelectContent>
    <SelectItem value="newest">Newest</SelectItem>
    <SelectItem value="oldest">Oldest</SelectItem>
    <SelectItem value="value">Highest value</SelectItem>
  </SelectContent>
</Select>`,
    },
    {
      id: 'plain',
      title: 'Without label',
      render: () => <CompactSelectInputsPlainSample />,
      code: `import {
  CompactSelectTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@open-mercato/ui/primitives/compact-select'

<Select defaultValue="table">
  <CompactSelectTrigger>
    <SelectValue />
  </CompactSelectTrigger>
  <SelectContent>
    <SelectItem value="table">Table</SelectItem>
    <SelectItem value="board">Board</SelectItem>
  </SelectContent>
</Select>`,
    },
  ],
}

const inlineSelectEntry: GalleryEntry = {
  id: 'inline-select',
  title: 'InlineSelectTrigger',
  importPath: '@open-mercato/ui/primitives/inline-select',
  variants: [
    {
      id: 'default',
      title: 'default (border on hover)',
      render: () => <InlineSelectInputsDefaultSample />,
      code: `import {
  InlineSelectTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@open-mercato/ui/primitives/inline-select'

<Select defaultValue="high">
  <InlineSelectTrigger>
    <SelectValue />
  </InlineSelectTrigger>
  <SelectContent>
    <SelectItem value="low">Low</SelectItem>
    <SelectItem value="medium">Medium</SelectItem>
    <SelectItem value="high">High</SelectItem>
  </SelectContent>
</Select>`,
    },
    {
      id: 'invisible',
      title: 'Invisible until focus',
      render: () => <InlineSelectInputsInvisibleSample />,
      code: `import {
  InlineSelectTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@open-mercato/ui/primitives/inline-select'

<InlineSelectTrigger showBorderOnHover={false}>
  <SelectValue />
</InlineSelectTrigger>`,
    },
  ],
}

const inlineInputEntry: GalleryEntry = {
  id: 'inline-input',
  title: 'InlineInput',
  importPath: '@open-mercato/ui/primitives/inline-input',
  variants: [
    {
      id: 'default',
      title: 'default (border on hover)',
      render: () => <InlineInputInputsDefaultSample />,
      code: `import { InlineInput } from '@open-mercato/ui/primitives/inline-input'

<InlineInput defaultValue="Aurora desk lamp" aria-label="Product name" onBlur={save} />`,
    },
    {
      id: 'invisible',
      title: 'Invisible until focus',
      render: () => (
        <div className="w-56">
          <InlineInput
            showBorderOnHover={false}
            defaultValue="SKU-2041"
            aria-label="SKU"
          />
        </div>
      ),
      code: `import { InlineInput } from '@open-mercato/ui/primitives/inline-input'

<InlineInput showBorderOnHover={false} defaultValue="SKU-2041" aria-label="SKU" />`,
    },
  ],
}

const checkboxEntry: GalleryEntry = {
  id: 'checkbox',
  title: 'Checkbox',
  importPath: '@open-mercato/ui/primitives/checkbox',
  variants: [
    {
      id: 'states',
      title: 'States',
      render: () => <CheckboxInputsStatesSample />,
      code: `import { Checkbox } from '@open-mercato/ui/primitives/checkbox'

<Checkbox />
<Checkbox defaultChecked />
<Checkbox checked="indeterminate" />`,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      render: () => <CheckboxInputsSizesSample />,
      code: `import { Checkbox } from '@open-mercato/ui/primitives/checkbox'

<Checkbox size="sm" defaultChecked />
<Checkbox size="md" defaultChecked />`,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      render: () => <CheckboxInputsDisabledSample />,
      code: `import { Checkbox } from '@open-mercato/ui/primitives/checkbox'

<Checkbox disabled />
<Checkbox disabled defaultChecked />`,
    },
  ],
}

const checkboxFieldEntry: GalleryEntry = {
  id: 'checkbox-field',
  title: 'CheckboxField',
  importPath: '@open-mercato/ui/primitives/checkbox-field',
  figmaNodeId: '231:4897',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => <CheckboxFieldInputsDefaultSample />,
      code: `import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'

<CheckboxField label="Email notifications" defaultChecked />`,
    },
    {
      id: 'with-description',
      title: 'With sublabel + description',
      render: () => <CheckboxFieldInputsWithDescriptionSample />,
      code: `import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'

<CheckboxField
  label="Auto-archive"
  sublabel="(recommended)"
  description="Closed conversations move to the archive after 30 days."
/>`,
    },
    {
      id: 'flip',
      title: 'Flipped (checkbox right)',
      render: () => <CheckboxFieldInputsFlipSample />,
      code: `import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'

<CheckboxField flip label="Include shipping costs" defaultChecked />`,
    },
    {
      id: 'cards',
      title: 'Card / default, selected and hover',
      render: () => <SelectionCardsPreview control="checkbox" />,
      code: `import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Badge } from '@open-mercato/ui/primitives/badge'

const cardClassName = 'relative w-full max-w-90 gap-3.5 rounded-xl border border-border bg-background p-4 shadow-xs transition-colors hover:border-transparent hover:bg-muted hover:shadow-none has-[[data-state=checked]]:border-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus has-[:disabled]:border-border has-[:disabled]:bg-background has-[:disabled]:shadow-none [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-xl [&_button]:relative [&_button]:z-10'

<div className="grid w-full gap-4 sm:grid-cols-2">
  <CheckboxField flip defaultChecked
    label="Immediate updates"
    sublabel="(Optional)"
    description="Receive an update when an order changes."
    badge={<Badge variant="info" size="sm">New</Badge>}
    className="mt-0"
    containerClassName={cardClassName}
  />
  <CheckboxField flip
    label="Weekly summary"
    sublabel="(Optional)"
    description="Receive one summary every Monday."
    badge={<Badge variant="info" size="sm">New</Badge>}
    className="mt-0"
    containerClassName={cardClassName}
  />
</div>`,
    },
    {
      id: 'cards-disabled',
      title: 'Card / disabled',
      render: () => <SelectionCardsPreview control="checkbox" disabled />,
      code: `import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Badge } from '@open-mercato/ui/primitives/badge'

const cardClassName = 'relative w-full max-w-90 gap-3.5 rounded-xl border border-border bg-background p-4 shadow-xs transition-colors hover:border-transparent hover:bg-muted hover:shadow-none has-[[data-state=checked]]:border-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus has-[:disabled]:border-border has-[:disabled]:bg-background has-[:disabled]:shadow-none [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-xl [&_button]:relative [&_button]:z-10'

<div className="grid w-full gap-4 sm:grid-cols-2">
  <CheckboxField flip defaultChecked disabled
    label="Immediate updates"
    sublabel="(Optional)"
    description="Receive an update when an order changes."
    badge={<Badge variant="outline" size="sm" className="text-text-disabled">New</Badge>}
    className="mt-0"
    containerClassName={cardClassName}
  />
  <CheckboxField flip disabled
    label="Weekly summary"
    sublabel="(Optional)"
    description="Receive one summary every Monday."
    badge={<Badge variant="outline" size="sm" className="text-text-disabled">New</Badge>}
    className="mt-0"
    containerClassName={cardClassName}
  />
</div>`,
    },
    {
      id: 'source-cards-icon',
      title: 'icon cards / default, active, disabled and live hover',
      render: () => <SelectionSourceCardsDemo control="checkbox" kind="icon" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Badge } from '@open-mercato/ui/primitives/badge'

function SelectionCardExample({ imageUrl, disabled = false }: { imageUrl: string; disabled?: boolean }) {
  const [checked, setChecked] = React.useState(false)
  const label = 'Label'
  return (

    <div className={cn('relative flex w-90 max-w-full items-start gap-3.5 rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs transition-colors hover:bg-muted hover:shadow-none has-[[data-state=checked]]:ring-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-selection-card [&_button]:relative [&_button]:z-10', disabled && 'shadow-none hover:bg-background has-[[data-state=checked]]:ring-border')}>
      <img src={imageUrl} alt="" className="size-10 shrink-0 object-contain" />
      <CheckboxField flip checked={checked} onCheckedChange={value => setChecked(value === true)} disabled={disabled}
        label={label}
        sublabel="(Sublabel)"
        description="Insert the checkbox description here."
        badge={<Badge size={16} appearance={disabled ? 'stroke' : 'light'} tone={disabled ? 'neutral' : 'info'}>New</Badge>}
        className="mt-0 disabled:opacity-100 disabled:data-[state=checked]:bg-bg-disabled disabled:data-[state=checked]:border-border-disabled disabled:data-[state=checked]:text-background" containerClassName="min-w-0 flex-1 gap-3.5"
      />
    </div>

  )
}`,
    },
    {
      id: 'source-cards-avatar',
      title: 'avatar cards / default, active, disabled and live hover',
      render: () => <SelectionSourceCardsDemo control="checkbox" kind="avatar" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Avatar } from '@open-mercato/ui/primitives/avatar'

function SelectionCardExample({ imageUrl, disabled = false }: { imageUrl: string; disabled?: boolean }) {
  const [checked, setChecked] = React.useState(false)
  const label = 'Label'
  return (

    <div className={cn('relative flex w-90 max-w-full items-start gap-3.5 rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs transition-colors hover:bg-muted hover:shadow-none has-[[data-state=checked]]:ring-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-selection-card [&_button]:relative [&_button]:z-10', disabled && 'shadow-none hover:bg-background has-[[data-state=checked]]:ring-border')}>
      <Avatar label={label} size={40} src={imageUrl} aria-hidden="true" />
      <CheckboxField flip checked={checked} onCheckedChange={value => setChecked(value === true)} disabled={disabled}
        label={label}
        sublabel="(Sublabel)"
        description="Insert the checkbox description here."
        badge={<Badge size={16} appearance={disabled ? 'stroke' : 'light'} tone={disabled ? 'neutral' : 'info'}>New</Badge>}
        className="mt-0 disabled:opacity-100 disabled:data-[state=checked]:bg-bg-disabled disabled:data-[state=checked]:border-border-disabled disabled:data-[state=checked]:text-background" containerClassName="min-w-0 flex-1 gap-3.5"
      />
    </div>

  )
}`,
    },
    {
      id: 'source-cards-provider',
      title: 'provider cards / default, active, disabled and live hover',
      render: () => <SelectionSourceCardsDemo control="checkbox" kind="provider" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Badge } from '@open-mercato/ui/primitives/badge'

function SelectionCardExample({ imageUrl, disabled = false }: { imageUrl: string; disabled?: boolean }) {
  const [checked, setChecked] = React.useState(false)
  const label = 'Label'
  return (

    <div className={cn('relative flex w-90 max-w-full items-start gap-3.5 rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs transition-colors hover:bg-muted hover:shadow-none has-[[data-state=checked]]:ring-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-selection-card [&_button]:relative [&_button]:z-10', disabled && 'shadow-none hover:bg-background has-[[data-state=checked]]:ring-border')}>
      <img src={imageUrl} alt="" className="h-6 w-8 shrink-0 object-contain" />
      <CheckboxField flip checked={checked} onCheckedChange={value => setChecked(value === true)} disabled={disabled}
        label={label}
        sublabel="(Sublabel)"
        description="Insert the checkbox description here."
        badge={<Badge size={16} appearance={disabled ? 'stroke' : 'light'} tone={disabled ? 'neutral' : 'info'}>New</Badge>}
        className="mt-0 disabled:opacity-100 disabled:data-[state=checked]:bg-bg-disabled disabled:data-[state=checked]:border-border-disabled disabled:data-[state=checked]:text-background" containerClassName="min-w-0 flex-1 gap-3.5"
      />
    </div>

  )
}`,
    },
    {
      id: 'source-cards-brand',
      title: 'brand cards / default, active, disabled and live hover',
      render: () => <SelectionSourceCardsDemo control="checkbox" kind="brand" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Badge } from '@open-mercato/ui/primitives/badge'

function SelectionCardExample({ imageUrl, disabled = false }: { imageUrl: string; disabled?: boolean }) {
  const [checked, setChecked] = React.useState(false)
  const label = 'Label'
  return (

    <div className={cn('relative flex w-90 max-w-full items-start gap-3.5 rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs transition-colors hover:bg-muted hover:shadow-none has-[[data-state=checked]]:ring-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-selection-card [&_button]:relative [&_button]:z-10', disabled && 'shadow-none hover:bg-background has-[[data-state=checked]]:ring-border')}>
      <img src={imageUrl} alt="" className="size-10 shrink-0 object-contain" />
      <CheckboxField flip checked={checked} onCheckedChange={value => setChecked(value === true)} disabled={disabled}
        label={label}
        sublabel="(Sublabel)"
        description="Insert the checkbox description here."
        badge={<Badge size={16} appearance={disabled ? 'stroke' : 'light'} tone={disabled ? 'neutral' : 'info'}>New</Badge>}
        className="mt-0 disabled:opacity-100 disabled:data-[state=checked]:bg-bg-disabled disabled:data-[state=checked]:border-border-disabled disabled:data-[state=checked]:text-background" containerClassName="min-w-0 flex-1 gap-3.5"
      />
    </div>

  )
}`,
    },
    {
      id: 'source-cards-company',
      title: 'company cards / default, active, disabled and live hover',
      render: () => <SelectionSourceCardsDemo control="checkbox" kind="company" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Badge } from '@open-mercato/ui/primitives/badge'

function SelectionCardExample({ imageUrl, disabled = false }: { imageUrl: string; disabled?: boolean }) {
  const [checked, setChecked] = React.useState(false)
  const label = 'Label'
  return (

    <div className={cn('relative flex w-90 max-w-full items-start gap-3.5 rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs transition-colors hover:bg-muted hover:shadow-none has-[[data-state=checked]]:ring-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-selection-card [&_button]:relative [&_button]:z-10', disabled && 'shadow-none hover:bg-background has-[[data-state=checked]]:ring-border')}>
      <img src={imageUrl} alt="" className="size-10 shrink-0 object-contain" />
      <CheckboxField flip checked={checked} onCheckedChange={value => setChecked(value === true)} disabled={disabled}
        label={label}
        sublabel="(Sublabel)"
        description="Insert the checkbox description here."
        badge={<Badge size={16} appearance={disabled ? 'stroke' : 'light'} tone={disabled ? 'neutral' : 'info'}>New</Badge>}
        className="mt-0 disabled:opacity-100 disabled:data-[state=checked]:bg-bg-disabled disabled:data-[state=checked]:border-border-disabled disabled:data-[state=checked]:text-background" containerClassName="min-w-0 flex-1 gap-3.5"
      />
    </div>

  )
}`,
    },
  ],
}

const radioEntry: GalleryEntry = {
  id: 'radio',
  title: 'Radio',
  importPath: '@open-mercato/ui/primitives/radio',
  keywords: ['radiobutton', 'radio button', 'option group'],
  variants: [
    {
      id: 'group',
      title: 'RadioGroup',
      render: () => <RadioInputsGroupSample />,
      code: `import { Radio, RadioGroup } from '@open-mercato/ui/primitives/radio'

<RadioGroup defaultValue="card" aria-label="Payment method">
  <Radio value="card" aria-label="Card" />
  <Radio value="transfer" aria-label="Bank transfer" />
  <Radio value="cash" aria-label="Cash" />
</RadioGroup>`,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      render: () => <RadioInputsDisabledSample />,
      code: `import { Radio, RadioGroup } from '@open-mercato/ui/primitives/radio'

<RadioGroup defaultValue="a" disabled>
  <Radio value="a" />
  <Radio value="b" />
</RadioGroup>`,
    },
  ],
}

const radioFieldEntry: GalleryEntry = {
  keywords: ['radiobutton', 'radio button'],
  id: 'radio-field',
  title: 'RadioField',
  importPath: '@open-mercato/ui/primitives/radio-field',
  figmaNodeId: '515:4282',
  variants: [
    {
      id: 'flip',
      title: 'Flipped (radio right)',
      render: () => <FlippedRadioPreview />,
      code: `import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'

<RadioGroup defaultValue="immediate" aria-label="Notification preferences" className="w-72">
  <RadioField value="immediate" flip label="Immediate updates" />
  <RadioField value="weekly" flip label="Weekly summary" />
</RadioGroup>`,
    },
    {
      id: 'default',
      title: 'default',
      render: () => <RadioFieldInputsDefaultSample />,
      code: `import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'

<RadioGroup defaultValue="standard" aria-label="Shipping speed">
  <RadioField value="standard" label="Standard" />
  <RadioField value="express" label="Express" />
</RadioGroup>`,
    },
    {
      id: 'with-description',
      title: 'With description',
      render: () => <RadioFieldInputsWithDescriptionSample />,
      code: `import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'

<RadioGroup defaultValue="invoice" aria-label="Billing">
  <RadioField value="invoice" label="Invoice" description="Pay within 14 days of delivery." />
  <RadioField value="prepaid" label="Prepaid" description="Order ships after payment clears." />
</RadioGroup>`,
    },
    {
      id: 'cards',
      title: 'Card / default, selected and hover',
      render: () => <SelectionCardsPreview control="radio" />,
      code: `import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { Badge } from '@open-mercato/ui/primitives/badge'

const cardClassName = 'relative w-full max-w-90 gap-3.5 rounded-xl border border-border bg-background p-4 shadow-xs transition-colors hover:border-transparent hover:bg-muted hover:shadow-none has-[[data-state=checked]]:border-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus has-[:disabled]:border-border has-[:disabled]:bg-background has-[:disabled]:shadow-none [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-xl [&_button]:relative [&_button]:z-10'

<RadioGroup defaultValue="immediate" aria-label="Notification preferences" className="grid w-full gap-4 sm:grid-cols-2">
  <RadioField flip value="immediate"
    label="Immediate updates"
    sublabel="(Optional)"
    description="Receive an update when an order changes."
    badge={<Badge variant="info" size="sm">New</Badge>}
    className="mt-0"
    containerClassName={cardClassName}
  />
  <RadioField flip value="weekly"
    label="Weekly summary"
    sublabel="(Optional)"
    description="Receive one summary every Monday."
    badge={<Badge variant="info" size="sm">New</Badge>}
    className="mt-0"
    containerClassName={cardClassName}
  />
</RadioGroup>`,
    },
    {
      id: 'cards-disabled',
      title: 'Card / disabled',
      render: () => <SelectionCardsPreview control="radio" disabled />,
      code: `import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { Badge } from '@open-mercato/ui/primitives/badge'

const cardClassName = 'relative w-full max-w-90 gap-3.5 rounded-xl border border-border bg-background p-4 shadow-xs transition-colors hover:border-transparent hover:bg-muted hover:shadow-none has-[[data-state=checked]]:border-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus has-[:disabled]:border-border has-[:disabled]:bg-background has-[:disabled]:shadow-none [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-xl [&_button]:relative [&_button]:z-10'

<RadioGroup defaultValue="immediate" aria-label="Notification preferences" className="grid w-full gap-4 sm:grid-cols-2">
  <RadioField flip value="immediate" disabled
    label="Immediate updates"
    sublabel="(Optional)"
    description="Receive an update when an order changes."
    badge={<Badge variant="outline" size="sm" className="text-text-disabled">New</Badge>}
    className="mt-0"
    containerClassName={cardClassName}
  />
  <RadioField flip value="weekly" disabled
    label="Weekly summary"
    sublabel="(Optional)"
    description="Receive one summary every Monday."
    badge={<Badge variant="outline" size="sm" className="text-text-disabled">New</Badge>}
    className="mt-0"
    containerClassName={cardClassName}
  />
</RadioGroup>`,
    },
    {
      id: 'source-cards-icon',
      title: 'icon cards / default, active, disabled and live hover',
      render: () => <SelectionSourceCardsDemo control="radio" kind="icon" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'

function SelectionCardExample({ imageUrl, disabled = false }: { imageUrl: string; disabled?: boolean }) {
  const [value, setValue] = React.useState('selected')
  const label = 'Label'
  return (
    <RadioGroup value={value} onValueChange={setValue} aria-label={label}>
    <div className={cn('relative flex w-90 max-w-full items-start gap-3.5 rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs transition-colors hover:bg-muted hover:shadow-none has-[[data-state=checked]]:ring-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-selection-card [&_button]:relative [&_button]:z-10', disabled && 'shadow-none hover:bg-background has-[[data-state=checked]]:ring-border')}>
      <img src={imageUrl} alt="" className="size-10 shrink-0 object-contain" />
      <RadioField value="selected" flip disabled={disabled}
        label={label}
        sublabel="(Sublabel)"
        description="Insert the checkbox description here."
        badge={<Badge size={16} appearance={disabled ? 'stroke' : 'light'} tone={disabled ? 'neutral' : 'info'}>New</Badge>}
        className="mt-0 disabled:opacity-100 disabled:data-[state=checked]:bg-bg-disabled disabled:data-[state=checked]:border-border-disabled disabled:data-[state=checked]:text-background" containerClassName="min-w-0 flex-1 gap-3.5"
      />
    </div>
    </RadioGroup>
  )
}`,
    },
    {
      id: 'source-cards-avatar',
      title: 'avatar cards / default, active, disabled and live hover',
      render: () => <SelectionSourceCardsDemo control="radio" kind="avatar" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { Avatar } from '@open-mercato/ui/primitives/avatar'

function SelectionCardExample({ imageUrl, disabled = false }: { imageUrl: string; disabled?: boolean }) {
  const [value, setValue] = React.useState('selected')
  const label = 'Label'
  return (
    <RadioGroup value={value} onValueChange={setValue} aria-label={label}>
    <div className={cn('relative flex w-90 max-w-full items-start gap-3.5 rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs transition-colors hover:bg-muted hover:shadow-none has-[[data-state=checked]]:ring-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-selection-card [&_button]:relative [&_button]:z-10', disabled && 'shadow-none hover:bg-background has-[[data-state=checked]]:ring-border')}>
      <Avatar label={label} size={40} src={imageUrl} aria-hidden="true" />
      <RadioField value="selected" flip disabled={disabled}
        label={label}
        sublabel="(Sublabel)"
        description="Insert the checkbox description here."
        badge={<Badge size={16} appearance={disabled ? 'stroke' : 'light'} tone={disabled ? 'neutral' : 'info'}>New</Badge>}
        className="mt-0 disabled:opacity-100 disabled:data-[state=checked]:bg-bg-disabled disabled:data-[state=checked]:border-border-disabled disabled:data-[state=checked]:text-background" containerClassName="min-w-0 flex-1 gap-3.5"
      />
    </div>
    </RadioGroup>
  )
}`,
    },
    {
      id: 'source-cards-provider',
      title: 'provider cards / default, active, disabled and live hover',
      render: () => <SelectionSourceCardsDemo control="radio" kind="provider" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'

function SelectionCardExample({ imageUrl, disabled = false }: { imageUrl: string; disabled?: boolean }) {
  const [value, setValue] = React.useState('selected')
  const label = 'Label'
  return (
    <RadioGroup value={value} onValueChange={setValue} aria-label={label}>
    <div className={cn('relative flex w-90 max-w-full items-start gap-3.5 rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs transition-colors hover:bg-muted hover:shadow-none has-[[data-state=checked]]:ring-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-selection-card [&_button]:relative [&_button]:z-10', disabled && 'shadow-none hover:bg-background has-[[data-state=checked]]:ring-border')}>
      <img src={imageUrl} alt="" className="h-6 w-8 shrink-0 object-contain" />
      <RadioField value="selected" flip disabled={disabled}
        label={label}
        sublabel="(Sublabel)"
        description="Insert the checkbox description here."
        badge={<Badge size={16} appearance={disabled ? 'stroke' : 'light'} tone={disabled ? 'neutral' : 'info'}>New</Badge>}
        className="mt-0 disabled:opacity-100 disabled:data-[state=checked]:bg-bg-disabled disabled:data-[state=checked]:border-border-disabled disabled:data-[state=checked]:text-background" containerClassName="min-w-0 flex-1 gap-3.5"
      />
    </div>
    </RadioGroup>
  )
}`,
    },
    {
      id: 'source-cards-brand',
      title: 'brand cards / default, active, disabled and live hover',
      render: () => <SelectionSourceCardsDemo control="radio" kind="brand" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'

function SelectionCardExample({ imageUrl, disabled = false }: { imageUrl: string; disabled?: boolean }) {
  const [value, setValue] = React.useState('selected')
  const label = 'Label'
  return (
    <RadioGroup value={value} onValueChange={setValue} aria-label={label}>
    <div className={cn('relative flex w-90 max-w-full items-start gap-3.5 rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs transition-colors hover:bg-muted hover:shadow-none has-[[data-state=checked]]:ring-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-selection-card [&_button]:relative [&_button]:z-10', disabled && 'shadow-none hover:bg-background has-[[data-state=checked]]:ring-border')}>
      <img src={imageUrl} alt="" className="size-10 shrink-0 object-contain" />
      <RadioField value="selected" flip disabled={disabled}
        label={label}
        sublabel="(Sublabel)"
        description="Insert the checkbox description here."
        badge={<Badge size={16} appearance={disabled ? 'stroke' : 'light'} tone={disabled ? 'neutral' : 'info'}>New</Badge>}
        className="mt-0 disabled:opacity-100 disabled:data-[state=checked]:bg-bg-disabled disabled:data-[state=checked]:border-border-disabled disabled:data-[state=checked]:text-background" containerClassName="min-w-0 flex-1 gap-3.5"
      />
    </div>
    </RadioGroup>
  )
}`,
    },
    {
      id: 'source-cards-company',
      title: 'company cards / default, active, disabled and live hover',
      render: () => <SelectionSourceCardsDemo control="radio" kind="company" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'

function SelectionCardExample({ imageUrl, disabled = false }: { imageUrl: string; disabled?: boolean }) {
  const [value, setValue] = React.useState('selected')
  const label = 'Label'
  return (
    <RadioGroup value={value} onValueChange={setValue} aria-label={label}>
    <div className={cn('relative flex w-90 max-w-full items-start gap-3.5 rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs transition-colors hover:bg-muted hover:shadow-none has-[[data-state=checked]]:ring-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-selection-card [&_button]:relative [&_button]:z-10', disabled && 'shadow-none hover:bg-background has-[[data-state=checked]]:ring-border')}>
      <img src={imageUrl} alt="" className="size-10 shrink-0 object-contain" />
      <RadioField value="selected" flip disabled={disabled}
        label={label}
        sublabel="(Sublabel)"
        description="Insert the checkbox description here."
        badge={<Badge size={16} appearance={disabled ? 'stroke' : 'light'} tone={disabled ? 'neutral' : 'info'}>New</Badge>}
        className="mt-0 disabled:opacity-100 disabled:data-[state=checked]:bg-bg-disabled disabled:data-[state=checked]:border-border-disabled disabled:data-[state=checked]:text-background" containerClassName="min-w-0 flex-1 gap-3.5"
      />
    </div>
    </RadioGroup>
  )
}`,
    },
  ],
}

const switchEntry: GalleryEntry = {
  id: 'switch',
  title: 'Switch',
  importPath: '@open-mercato/ui/primitives/switch',
  variants: [
    {
      id: 'states',
      title: 'States',
      render: () => <SwitchInputsStatesSample />,
      code: `import { Switch } from '@open-mercato/ui/primitives/switch'

<Switch />
<Switch defaultChecked />`,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      render: () => <SwitchInputsDisabledSample />,
      code: `import { Switch } from '@open-mercato/ui/primitives/switch'

<Switch disabled />
<Switch disabled defaultChecked />`,
    },
  ],
}

const switchFieldEntry: GalleryEntry = {
  id: 'switch-field',
  title: 'SwitchField',
  importPath: '@open-mercato/ui/primitives/switch-field',
  figmaNodeId: '385:4580',
  variants: [
    {
      id: 'default',
      title: 'default (switch right)',
      render: () => <SwitchFieldInputsDefaultSample />,
      code: `import { SwitchField } from '@open-mercato/ui/primitives/switch-field'

<SwitchField label="Two-factor authentication" defaultChecked />`,
    },
    {
      id: 'with-description',
      title: 'With description',
      render: () => <SwitchFieldInputsWithDescriptionSample />,
      code: `import { SwitchField } from '@open-mercato/ui/primitives/switch-field'

<SwitchField
  label="Low-stock alerts"
  description="Notify purchasing when stock drops below the reorder point."
/>`,
    },
    {
      id: 'flip',
      title: 'Flipped (switch left)',
      render: () => <SwitchFieldInputsFlipSample />,
      code: `import { SwitchField } from '@open-mercato/ui/primitives/switch-field'

<SwitchField flip label="Sync inventory nightly" defaultChecked />`,
    },
    {
      id: 'cards',
      title: 'Card / default, selected and hover',
      render: () => <SelectionCardsPreview control="switch" />,
      code: `import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Badge } from '@open-mercato/ui/primitives/badge'

const cardClassName = 'relative w-full max-w-90 gap-3.5 rounded-xl border border-border bg-background p-4 shadow-xs transition-colors hover:border-transparent hover:bg-muted hover:shadow-none has-[[data-state=checked]]:border-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus has-[:disabled]:border-border has-[:disabled]:bg-background has-[:disabled]:shadow-none [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-xl [&_button]:relative [&_button]:z-10'

<div className="grid w-full gap-4 sm:grid-cols-2">
  <SwitchField defaultChecked
    label="Immediate updates"
    sublabel="(Optional)"
    description="Receive an update when an order changes."
    badge={<Badge variant="info" size="sm">New</Badge>}
    className="mt-0"
    containerClassName={cardClassName}
  />
  <SwitchField
    label="Weekly summary"
    sublabel="(Optional)"
    description="Receive one summary every Monday."
    badge={<Badge variant="info" size="sm">New</Badge>}
    className="mt-0"
    containerClassName={cardClassName}
  />
</div>`,
    },
    {
      id: 'cards-disabled',
      title: 'Card / disabled',
      render: () => <SelectionCardsPreview control="switch" disabled />,
      code: `import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Badge } from '@open-mercato/ui/primitives/badge'

const cardClassName = 'relative w-full max-w-90 gap-3.5 rounded-xl border border-border bg-background p-4 shadow-xs transition-colors hover:border-transparent hover:bg-muted hover:shadow-none has-[[data-state=checked]]:border-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus has-[:disabled]:border-border has-[:disabled]:bg-background has-[:disabled]:shadow-none [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-xl [&_button]:relative [&_button]:z-10'

<div className="grid w-full gap-4 sm:grid-cols-2">
  <SwitchField defaultChecked disabled
    label="Immediate updates"
    sublabel="(Optional)"
    description="Receive an update when an order changes."
    badge={<Badge variant="outline" size="sm" className="text-text-disabled">New</Badge>}
    className="mt-0"
    containerClassName={cardClassName}
  />
  <SwitchField disabled
    label="Weekly summary"
    sublabel="(Optional)"
    description="Receive one summary every Monday."
    badge={<Badge variant="outline" size="sm" className="text-text-disabled">New</Badge>}
    className="mt-0"
    containerClassName={cardClassName}
  />
</div>`,
    },
    {
      id: 'source-cards-icon',
      title: 'icon cards / default, active, disabled and live hover',
      render: () => <SelectionSourceCardsDemo control="switch" kind="icon" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Badge } from '@open-mercato/ui/primitives/badge'

function SelectionCardExample({ imageUrl, disabled = false }: { imageUrl: string; disabled?: boolean }) {
  const [checked, setChecked] = React.useState(false)
  const label = 'Label'
  return (

    <div className={cn('relative flex w-90 max-w-full items-start gap-3.5 rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs transition-colors hover:bg-muted hover:shadow-none has-[[data-state=checked]]:ring-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-selection-card [&_button]:relative [&_button]:z-10', disabled && 'shadow-none hover:bg-background has-[[data-state=checked]]:ring-border')}>
      <img src={imageUrl} alt="" className="size-10 shrink-0 object-contain" />
      <SwitchField checked={checked} onCheckedChange={setChecked} disabled={disabled}
        label={label}
        sublabel="(Sublabel)"
        description="Insert the checkbox description here."
        badge={<Badge size={16} appearance={disabled ? 'stroke' : 'light'} tone={disabled ? 'neutral' : 'info'}>New</Badge>}
        className="mt-0" containerClassName="min-w-0 flex-1 gap-3.5"
      />
    </div>

  )
}`,
    },
    {
      id: 'source-cards-avatar',
      title: 'avatar cards / default, active, disabled and live hover',
      render: () => <SelectionSourceCardsDemo control="switch" kind="avatar" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Avatar } from '@open-mercato/ui/primitives/avatar'

function SelectionCardExample({ imageUrl, disabled = false }: { imageUrl: string; disabled?: boolean }) {
  const [checked, setChecked] = React.useState(false)
  const label = 'Label'
  return (

    <div className={cn('relative flex w-90 max-w-full items-start gap-3.5 rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs transition-colors hover:bg-muted hover:shadow-none has-[[data-state=checked]]:ring-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-selection-card [&_button]:relative [&_button]:z-10', disabled && 'shadow-none hover:bg-background has-[[data-state=checked]]:ring-border')}>
      <Avatar label={label} size={40} src={imageUrl} aria-hidden="true" />
      <SwitchField checked={checked} onCheckedChange={setChecked} disabled={disabled}
        label={label}
        sublabel="(Sublabel)"
        description="Insert the checkbox description here."
        badge={<Badge size={16} appearance={disabled ? 'stroke' : 'light'} tone={disabled ? 'neutral' : 'info'}>New</Badge>}
        className="mt-0" containerClassName="min-w-0 flex-1 gap-3.5"
      />
    </div>

  )
}`,
    },
    {
      id: 'source-cards-provider',
      title: 'provider cards / default, active, disabled and live hover',
      render: () => <SelectionSourceCardsDemo control="switch" kind="provider" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Badge } from '@open-mercato/ui/primitives/badge'

function SelectionCardExample({ imageUrl, disabled = false }: { imageUrl: string; disabled?: boolean }) {
  const [checked, setChecked] = React.useState(false)
  const label = 'Label'
  return (

    <div className={cn('relative flex w-90 max-w-full items-start gap-3.5 rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs transition-colors hover:bg-muted hover:shadow-none has-[[data-state=checked]]:ring-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-selection-card [&_button]:relative [&_button]:z-10', disabled && 'shadow-none hover:bg-background has-[[data-state=checked]]:ring-border')}>
      <img src={imageUrl} alt="" className="h-6 w-8 shrink-0 object-contain" />
      <SwitchField checked={checked} onCheckedChange={setChecked} disabled={disabled}
        label={label}
        sublabel="(Sublabel)"
        description="Insert the checkbox description here."
        badge={<Badge size={16} appearance={disabled ? 'stroke' : 'light'} tone={disabled ? 'neutral' : 'info'}>New</Badge>}
        className="mt-0" containerClassName="min-w-0 flex-1 gap-3.5"
      />
    </div>

  )
}`,
    },
    {
      id: 'source-cards-brand',
      title: 'brand cards / default, active, disabled and live hover',
      render: () => <SelectionSourceCardsDemo control="switch" kind="brand" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Badge } from '@open-mercato/ui/primitives/badge'

function SelectionCardExample({ imageUrl, disabled = false }: { imageUrl: string; disabled?: boolean }) {
  const [checked, setChecked] = React.useState(false)
  const label = 'Label'
  return (

    <div className={cn('relative flex w-90 max-w-full items-start gap-3.5 rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs transition-colors hover:bg-muted hover:shadow-none has-[[data-state=checked]]:ring-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-selection-card [&_button]:relative [&_button]:z-10', disabled && 'shadow-none hover:bg-background has-[[data-state=checked]]:ring-border')}>
      <img src={imageUrl} alt="" className="size-10 shrink-0 object-contain" />
      <SwitchField checked={checked} onCheckedChange={setChecked} disabled={disabled}
        label={label}
        sublabel="(Sublabel)"
        description="Insert the checkbox description here."
        badge={<Badge size={16} appearance={disabled ? 'stroke' : 'light'} tone={disabled ? 'neutral' : 'info'}>New</Badge>}
        className="mt-0" containerClassName="min-w-0 flex-1 gap-3.5"
      />
    </div>

  )
}`,
    },
    {
      id: 'source-cards-company',
      title: 'company cards / default, active, disabled and live hover',
      render: () => <SelectionSourceCardsDemo control="switch" kind="company" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Badge } from '@open-mercato/ui/primitives/badge'

function SelectionCardExample({ imageUrl, disabled = false }: { imageUrl: string; disabled?: boolean }) {
  const [checked, setChecked] = React.useState(false)
  const label = 'Label'
  return (

    <div className={cn('relative flex w-90 max-w-full items-start gap-3.5 rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs transition-colors hover:bg-muted hover:shadow-none has-[[data-state=checked]]:ring-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-selection-card [&_button]:relative [&_button]:z-10', disabled && 'shadow-none hover:bg-background has-[[data-state=checked]]:ring-border')}>
      <img src={imageUrl} alt="" className="size-10 shrink-0 object-contain" />
      <SwitchField checked={checked} onCheckedChange={setChecked} disabled={disabled}
        label={label}
        sublabel="(Sublabel)"
        description="Insert the checkbox description here."
        badge={<Badge size={16} appearance={disabled ? 'stroke' : 'light'} tone={disabled ? 'neutral' : 'info'}>New</Badge>}
        className="mt-0" containerClassName="min-w-0 flex-1 gap-3.5"
      />
    </div>

  )
}`,
    },
    {
      id: 'integration-horizontal-card',
      title: 'Integration / horizontal / card',
      render: () => <IntegrationSwitchDemo alignment="horizontal" appearance="card" />,
      code: `import * as React from 'react'
import { Settings } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@open-mercato/ui/primitives/dialog'

function IntegrationExample({ brandUrl, alignment, appearance }: { brandUrl: string; alignment: 'horizontal' | 'vertical'; appearance: 'card' | 'list' }) {
  const t = useT()
  const id = React.useId()
  const [checked, setChecked] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const horizontal = alignment === 'horizontal'
  const card = appearance === 'card'
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div data-slot="integration-switch" data-alignment={alignment} data-appearance={appearance} className={cn('relative flex max-w-full gap-3.5', horizontal ? 'w-154 flex-wrap items-center sm:flex-nowrap' : 'w-95 flex-col items-start', card && 'rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs')}>
        <img src={brandUrl} alt="" className={cn('shrink-0', card ? 'size-10' : 'size-12')} />
        <div className={cn('flex min-w-0 flex-col gap-1', horizontal && 'min-w-40 flex-1')}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span id={id} className={cn('font-medium text-foreground', card ? 'text-sm leading-5' : 'text-base leading-6')}>Microsoft Office 365</span>
            <Badge size={16} appearance="light" tone="info">New</Badge>
          </div>
          <p className={cn('text-muted-foreground', card ? 'text-xs leading-4' : 'text-sm leading-5')}>Seamless collaboration and document management.</p>
        </div>
        <Button asChild variant="outline" size="default" className={horizontal ? undefined : 'w-full'}><DialogTrigger><Settings aria-hidden="true" />Manage</DialogTrigger></Button>
        <Switch aria-labelledby={id} checked={checked} onCheckedChange={setChecked} className={horizontal ? undefined : card ? 'absolute top-5 right-5' : 'absolute top-3 right-3'} />
      </div>
        <DialogContent onKeyDownCapture={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setOpen(false) } }}>
          <DialogHeader><DialogTitle>Microsoft Office 365 settings</DialogTitle><DialogDescription>Seamless collaboration and document management.</DialogDescription></DialogHeader>
          <SwitchField label="Enable integration" checked={checked} onCheckedChange={setChecked} />
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t('common.close')}</Button></DialogFooter>
        </DialogContent>
    </Dialog>
  )
}

<IntegrationExample brandUrl={brandUrl} alignment="horizontal" appearance="card" />`,
    },
    {
      id: 'integration-horizontal-list',
      title: 'Integration / horizontal / list',
      render: () => <IntegrationSwitchDemo alignment="horizontal" appearance="list" />,
      code: `import * as React from 'react'
import { Settings } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@open-mercato/ui/primitives/dialog'

function IntegrationExample({ brandUrl, alignment, appearance }: { brandUrl: string; alignment: 'horizontal' | 'vertical'; appearance: 'card' | 'list' }) {
  const t = useT()
  const id = React.useId()
  const [checked, setChecked] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const horizontal = alignment === 'horizontal'
  const card = appearance === 'card'
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div data-slot="integration-switch" data-alignment={alignment} data-appearance={appearance} className={cn('relative flex max-w-full gap-3.5', horizontal ? 'w-154 flex-wrap items-center sm:flex-nowrap' : 'w-95 flex-col items-start', card && 'rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs')}>
        <img src={brandUrl} alt="" className={cn('shrink-0', card ? 'size-10' : 'size-12')} />
        <div className={cn('flex min-w-0 flex-col gap-1', horizontal && 'min-w-40 flex-1')}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span id={id} className={cn('font-medium text-foreground', card ? 'text-sm leading-5' : 'text-base leading-6')}>Microsoft Office 365</span>
            <Badge size={16} appearance="light" tone="info">New</Badge>
          </div>
          <p className={cn('text-muted-foreground', card ? 'text-xs leading-4' : 'text-sm leading-5')}>Seamless collaboration and document management.</p>
        </div>
        <Button asChild variant="outline" size="default" className={horizontal ? undefined : 'w-full'}><DialogTrigger><Settings aria-hidden="true" />Manage</DialogTrigger></Button>
        <Switch aria-labelledby={id} checked={checked} onCheckedChange={setChecked} className={horizontal ? undefined : card ? 'absolute top-5 right-5' : 'absolute top-3 right-3'} />
      </div>
        <DialogContent onKeyDownCapture={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setOpen(false) } }}>
          <DialogHeader><DialogTitle>Microsoft Office 365 settings</DialogTitle><DialogDescription>Seamless collaboration and document management.</DialogDescription></DialogHeader>
          <SwitchField label="Enable integration" checked={checked} onCheckedChange={setChecked} />
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t('common.close')}</Button></DialogFooter>
        </DialogContent>
    </Dialog>
  )
}

<IntegrationExample brandUrl={brandUrl} alignment="horizontal" appearance="list" />`,
    },
    {
      id: 'integration-vertical-card',
      title: 'Integration / vertical / card',
      render: () => <IntegrationSwitchDemo alignment="vertical" appearance="card" />,
      code: `import * as React from 'react'
import { Settings } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@open-mercato/ui/primitives/dialog'

function IntegrationExample({ brandUrl, alignment, appearance }: { brandUrl: string; alignment: 'horizontal' | 'vertical'; appearance: 'card' | 'list' }) {
  const t = useT()
  const id = React.useId()
  const [checked, setChecked] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const horizontal = alignment === 'horizontal'
  const card = appearance === 'card'
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div data-slot="integration-switch" data-alignment={alignment} data-appearance={appearance} className={cn('relative flex max-w-full gap-3.5', horizontal ? 'w-154 flex-wrap items-center sm:flex-nowrap' : 'w-95 flex-col items-start', card && 'rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs')}>
        <img src={brandUrl} alt="" className={cn('shrink-0', card ? 'size-10' : 'size-12')} />
        <div className={cn('flex min-w-0 flex-col gap-1', horizontal && 'min-w-40 flex-1')}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span id={id} className={cn('font-medium text-foreground', card ? 'text-sm leading-5' : 'text-base leading-6')}>Microsoft Office 365</span>
            <Badge size={16} appearance="light" tone="info">New</Badge>
          </div>
          <p className={cn('text-muted-foreground', card ? 'text-xs leading-4' : 'text-sm leading-5')}>Seamless collaboration and document management.</p>
        </div>
        <Button asChild variant="outline" size="default" className={horizontal ? undefined : 'w-full'}><DialogTrigger><Settings aria-hidden="true" />Manage</DialogTrigger></Button>
        <Switch aria-labelledby={id} checked={checked} onCheckedChange={setChecked} className={horizontal ? undefined : card ? 'absolute top-5 right-5' : 'absolute top-3 right-3'} />
      </div>
        <DialogContent onKeyDownCapture={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setOpen(false) } }}>
          <DialogHeader><DialogTitle>Microsoft Office 365 settings</DialogTitle><DialogDescription>Seamless collaboration and document management.</DialogDescription></DialogHeader>
          <SwitchField label="Enable integration" checked={checked} onCheckedChange={setChecked} />
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t('common.close')}</Button></DialogFooter>
        </DialogContent>
    </Dialog>
  )
}

<IntegrationExample brandUrl={brandUrl} alignment="vertical" appearance="card" />`,
    },
    {
      id: 'integration-vertical-list',
      title: 'Integration / vertical / list',
      render: () => <IntegrationSwitchDemo alignment="vertical" appearance="list" />,
      code: `import * as React from 'react'
import { Settings } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@open-mercato/ui/primitives/dialog'

function IntegrationExample({ brandUrl, alignment, appearance }: { brandUrl: string; alignment: 'horizontal' | 'vertical'; appearance: 'card' | 'list' }) {
  const t = useT()
  const id = React.useId()
  const [checked, setChecked] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const horizontal = alignment === 'horizontal'
  const card = appearance === 'card'
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div data-slot="integration-switch" data-alignment={alignment} data-appearance={appearance} className={cn('relative flex max-w-full gap-3.5', horizontal ? 'w-154 flex-wrap items-center sm:flex-nowrap' : 'w-95 flex-col items-start', card && 'rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs')}>
        <img src={brandUrl} alt="" className={cn('shrink-0', card ? 'size-10' : 'size-12')} />
        <div className={cn('flex min-w-0 flex-col gap-1', horizontal && 'min-w-40 flex-1')}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span id={id} className={cn('font-medium text-foreground', card ? 'text-sm leading-5' : 'text-base leading-6')}>Microsoft Office 365</span>
            <Badge size={16} appearance="light" tone="info">New</Badge>
          </div>
          <p className={cn('text-muted-foreground', card ? 'text-xs leading-4' : 'text-sm leading-5')}>Seamless collaboration and document management.</p>
        </div>
        <Button asChild variant="outline" size="default" className={horizontal ? undefined : 'w-full'}><DialogTrigger><Settings aria-hidden="true" />Manage</DialogTrigger></Button>
        <Switch aria-labelledby={id} checked={checked} onCheckedChange={setChecked} className={horizontal ? undefined : card ? 'absolute top-5 right-5' : 'absolute top-3 right-3'} />
      </div>
        <DialogContent onKeyDownCapture={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setOpen(false) } }}>
          <DialogHeader><DialogTitle>Microsoft Office 365 settings</DialogTitle><DialogDescription>Seamless collaboration and document management.</DialogDescription></DialogHeader>
          <SwitchField label="Enable integration" checked={checked} onCheckedChange={setChecked} />
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t('common.close')}</Button></DialogFooter>
        </DialogContent>
    </Dialog>
  )
}

<IntegrationExample brandUrl={brandUrl} alignment="vertical" appearance="list" />`,
    },
  ],
}

function SliderValueDemo({ initialValues }: { initialValues: number[] }) {
  const t = useT()
  const id = React.useId()
  const [values, setValues] = React.useState(initialValues)
  const range = values.length === 2
  return <div className="flex w-72 max-w-full flex-col gap-1">
    <div className="flex items-center justify-between gap-2 text-xs">
      <span id={id}>{t(range ? 'design_system.gallery.examples.controls.range' : 'design_system.gallery.examples.controls.value')}</span>
      <output className="text-muted-foreground">{values.join(' – ')}</output>
    </div>
    <Slider value={values} onValueChange={setValues} min={0} max={100} className="h-4" aria-labelledby={id}
      thumbLabels={range ? [t('design_system.gallery.examples.controls.lower'), t('design_system.gallery.examples.controls.upper')] : undefined} />
  </div>
}

const sliderEntry: GalleryEntry = {
  id: 'slider',
  figmaNodeId: '2617:1169',
  title: 'Slider',
  importPath: '@open-mercato/ui/primitives/slider',
  variants: [
    {
      id: 'single',
      title: 'Single value',
      render: () => <SliderInputsSingleSample />,
      code: `import { Slider } from '@open-mercato/ui/primitives/slider'

<Slider defaultValue={[40]} min={0} max={100} step={5} aria-label="Discount" />`,
    },
    {
      id: 'range',
      title: 'Range (two thumbs)',
      render: () => <SliderInputsRangeSample />,
      code: `import { Slider } from '@open-mercato/ui/primitives/slider'

<Slider defaultValue={[20, 60]} min={0} max={100} aria-label="Price range" />`,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      render: () => <SliderInputsDisabledSample />,
      code: `import { Slider } from '@open-mercato/ui/primitives/slider'

<Slider defaultValue={[45]} disabled />`,
    },
    {
      id: 'source-values',
      title: 'Source values · 0 / 25 / 50 / 75 / 100',
      render: () => <div className="flex w-full flex-wrap gap-6">{[0, 25, 50, 75, 100].map(value => <SliderValueDemo key={value} initialValues={[value]} />)}</div>,
      code: `import * as React from 'react'
import { Slider } from '@open-mercato/ui/primitives/slider'

function SliderValueDemo({ initialValues }: { initialValues: number[] }) {
  const id = React.useId()
  const [values, setValues] = React.useState(initialValues)
  const range = values.length === 2
  return <div className="flex w-72 max-w-full flex-col gap-1">
    <div className="flex items-center justify-between gap-2 text-xs">
      <span id={id}>{range ? 'Range' : 'Value'}</span>
      <output className="text-muted-foreground">{values.join(' – ')}</output>
    </div>
    <Slider value={values} onValueChange={setValues} min={0} max={100} className="h-4" aria-labelledby={id}
      thumbLabels={range ? ['Lower value', 'Upper value'] : undefined} />
  </div>
}

<div className="flex w-full flex-wrap gap-6">{[0, 25, 50, 75, 100].map(value => <SliderValueDemo key={value} initialValues={[value]} />)}</div>`,
    },
    {
      id: 'source-ranges',
      title: 'Source ranges · 11 pairs',
      render: () => <div className="flex w-full flex-wrap gap-6">{[[0, 0], [0, 25], [25, 50], [50, 75], [75, 100], [0, 50], [25, 75], [50, 100], [0, 75], [25, 100], [0, 100]].map(values => <SliderValueDemo key={values.join("-")} initialValues={values} />)}</div>,
      code: `import * as React from 'react'
import { Slider } from '@open-mercato/ui/primitives/slider'

function SliderValueDemo({ initialValues }: { initialValues: number[] }) {
  const id = React.useId()
  const [values, setValues] = React.useState(initialValues)
  const range = values.length === 2
  return <div className="flex w-72 max-w-full flex-col gap-1">
    <div className="flex items-center justify-between gap-2 text-xs">
      <span id={id}>{range ? 'Range' : 'Value'}</span>
      <output className="text-muted-foreground">{values.join(' – ')}</output>
    </div>
    <Slider value={values} onValueChange={setValues} min={0} max={100} className="h-4" aria-labelledby={id}
      thumbLabels={range ? ['Lower value', 'Upper value'] : undefined} />
  </div>
}

<div className="flex w-full flex-wrap gap-6">{[[0, 0], [0, 25], [25, 50], [50, 75], [75, 100], [0, 50], [25, 75], [50, 100], [0, 75], [25, 100], [0, 100]].map(values => <SliderValueDemo key={values.join("-")} initialValues={values} />)}</div>`,
    },
  ],
}

const formFieldEntry: GalleryEntry = {
  id: 'form-field',
  title: 'FormField',
  importPath: '@open-mercato/ui/primitives/form-field',
  variants: [
    {
      id: 'default',
      title: 'Label + description',
      render: () => <FormFieldInputsDefaultSample />,
      code: `import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'

<FormField label="Warehouse code" description="Short identifier used on labels.">
  <Input placeholder="WAW-01" />
</FormField>`,
    },
    {
      id: 'required',
      title: 'Required',
      render: () => <FormFieldInputsRequiredSample />,
      code: `import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'

<FormField label="Company name" required>
  <Input placeholder="Acme sp. z o.o." />
</FormField>`,
    },
    {
      id: 'error',
      title: 'Error',
      render: () => <FormFieldInputsErrorSample />,
      code: `import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'

<FormField label="VAT ID" error="VAT ID must have 10 digits.">
  <Input defaultValue="52601" />
</FormField>`,
    },
    {
      id: 'horizontal',
      title: 'Horizontal',
      render: () => <FormFieldInputsHorizontalSample />,
      code: `import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Switch } from '@open-mercato/ui/primitives/switch'

<FormField label="Enable webhooks" orientation="horizontal">
  <Switch defaultChecked />
</FormField>`,
    },
  ],
}

const searchInputEntry: GalleryEntry = {
  id: 'search-input',
  title: 'SearchInput',
  importPath: '@open-mercato/ui/primitives/search-input',
  variants: [
    {
      id: 'default',
      title: 'default (clearable)',
      render: () => <DemoSearchInput />,
      code: `import { SearchInput } from '@open-mercato/ui/primitives/search-input'

const [query, setQuery] = React.useState('')

<SearchInput value={query} onChange={setQuery} />`,
    },
    {
      id: 'small',
      title: 'Small',
      render: () => <DemoSearchInput size="sm" />,
      code: `import { SearchInput } from '@open-mercato/ui/primitives/search-input'

<SearchInput size="sm" value={query} onChange={setQuery} />`,
    },
    {
      id: 'disabled',
      title: 'Disabled (clear action hidden)',
      render: () => <DisabledSearchInputPreview />,
      code: `import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { FormField } from '@open-mercato/ui/primitives/form-field'

const [query, setQuery] = React.useState('OM-2026-0042')

<FormField label="Search orders" disabled>
  <SearchInput value={query} onChange={setQuery} />
</FormField>`,
    },
  ],
}

const emailInputEntry: GalleryEntry = {
  id: 'email-input',
  title: 'EmailInput',
  importPath: '@open-mercato/ui/primitives/email-input',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <div className="w-72">
          <EmailInput />
        </div>
      ),
      code: `import { EmailInput } from '@open-mercato/ui/primitives/email-input'

<EmailInput />`,
    },
    {
      id: 'no-icon',
      title: 'Without icon',
      render: () => (
        <div className="w-72">
          <EmailInput showIcon={false} />
        </div>
      ),
      code: `import { EmailInput } from '@open-mercato/ui/primitives/email-input'

<EmailInput showIcon={false} />`,
    },
    {
      id: 'invalid',
      title: 'Invalid',
      render: () => (
        <div className="w-72">
          <EmailInput aria-invalid defaultValue="not-an-email" />
        </div>
      ),
      code: `import { EmailInput } from '@open-mercato/ui/primitives/email-input'

<EmailInput aria-invalid defaultValue="not-an-email" />`,
    },
  ],
}

function PasswordStrengthDemo({ initialValue = '', interactive = false }: { initialValue?: string; interactive?: boolean }) {
  const t = useT()
  const [password, setPassword] = React.useState(initialValue)
  const requirements = [
    { id: 'uppercase', label: t('design_system.gallery.samples.passwordStrength.uppercase'), met: /[A-Z]/.test(password) },
    { id: 'number', label: t('design_system.gallery.samples.passwordStrength.number'), met: /[0-9]/.test(password) },
    { id: 'length', label: t('design_system.gallery.samples.passwordStrength.length'), met: password.length >= 8 },
  ]
  const met = requirements.filter(requirement => requirement.met).length
  const strength = password.length === 0 ? 'empty' : met === 3 ? 'strong' : met === 2 ? 'moderate' : 'weak'
  return (
    <div className="w-75 max-w-full">
      {interactive ? <PasswordInput value={password} onChange={event => setPassword(event.target.value)} aria-label={t('design_system.gallery.samples.passwordStrength.password')} /> : null}
      <PasswordStrength strength={strength} requirements={requirements} />
    </div>
  )
}

const passwordStrengthEntry: GalleryEntry = {
  id: 'password-strength',
  title: 'PasswordStrength',
  importPath: '@open-mercato/ui/primitives/password-strength',
  figmaNodeId: '327:8202',
  usage: {
    do: ['Supply the evaluated strength and requirements from the policy that owns the form.', 'The interactive example demonstrates the three rules shown in Figma; the visual primitive does not define authentication policy.'],
  },
  variants: [
    {
      id: 'empty',
      title: 'empty',
      render: () => <PasswordStrengthDemo initialValue="" />,
      code: `import { PasswordStrength } from '@open-mercato/ui/primitives/password-strength'


<PasswordStrength strength="empty" requirements={[
  { id: 'uppercase', label: 'At least 1 uppercase', met: false },
  { id: 'number', label: 'At least 1 number', met: false },
  { id: 'length', label: 'At least 8 characters', met: false },
]} />`,
    },
    {
      id: 'weak',
      title: 'weak',
      render: () => <PasswordStrengthDemo initialValue="A" />,
      code: `import { PasswordStrength } from '@open-mercato/ui/primitives/password-strength'


<PasswordStrength strength="weak" requirements={[
  { id: 'uppercase', label: 'At least 1 uppercase', met: true },
  { id: 'number', label: 'At least 1 number', met: false },
  { id: 'length', label: 'At least 8 characters', met: false },
]} />`,
    },
    {
      id: 'moderate',
      title: 'moderate',
      render: () => <PasswordStrengthDemo initialValue="A1" />,
      code: `import { PasswordStrength } from '@open-mercato/ui/primitives/password-strength'


<PasswordStrength strength="moderate" requirements={[
  { id: 'uppercase', label: 'At least 1 uppercase', met: true },
  { id: 'number', label: 'At least 1 number', met: true },
  { id: 'length', label: 'At least 8 characters', met: false },
]} />`,
    },
    {
      id: 'strong',
      title: 'strong',
      render: () => <PasswordStrengthDemo initialValue="A1234567" />,
      code: `import { PasswordStrength } from '@open-mercato/ui/primitives/password-strength'


<PasswordStrength strength="strong" requirements={[
  { id: 'uppercase', label: 'At least 1 uppercase', met: true },
  { id: 'number', label: 'At least 1 number', met: true },
  { id: 'length', label: 'At least 8 characters', met: true },
]} />`,
    },
    {
      id: 'interactive',
      title: 'interactive',
      render: () => <PasswordStrengthDemo interactive />,
      code: `import { PasswordStrength } from '@open-mercato/ui/primitives/password-strength'
import { PasswordInput } from '@open-mercato/ui/primitives/password-input'

const [password, setPassword] = React.useState('')
const requirements = [
  { id: 'uppercase', label: 'At least 1 uppercase', met: /[A-Z]/.test(password) },
  { id: 'number', label: 'At least 1 number', met: /[0-9]/.test(password) },
  { id: 'length', label: 'At least 8 characters', met: password.length >= 8 },
]
const met = requirements.filter(requirement => requirement.met).length
const strength = password.length === 0 ? 'empty' : met === 3 ? 'strong' : met === 2 ? 'moderate' : 'weak'

<div className="w-75 max-w-full">
  <PasswordInput value={password} onChange={event => setPassword(event.target.value)} aria-label="Password" />
  <PasswordStrength strength={strength} requirements={requirements} />
</div>`,
    },
  ],
}

const passwordInputEntry: GalleryEntry = {
  id: 'password-input',
  title: 'PasswordInput',
  importPath: '@open-mercato/ui/primitives/password-input',
  variants: [
    {
      id: 'default',
      title: 'default (reveal toggle)',
      render: () => (
        <div className="w-72">
          <PasswordInput defaultValue="correct-horse-battery" autoComplete="off" />
        </div>
      ),
      code: `import { PasswordInput } from '@open-mercato/ui/primitives/password-input'

<PasswordInput autoComplete="current-password" />`,
    },
    {
      id: 'no-lock',
      title: 'Without lock icon',
      render: () => (
        <div className="w-72">
          <PasswordInput showLockIcon={false} autoComplete="off" />
        </div>
      ),
      code: `import { PasswordInput } from '@open-mercato/ui/primitives/password-input'

<PasswordInput showLockIcon={false} />`,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      render: () => (
        <div className="w-72">
          <PasswordInput disabled autoComplete="off" />
        </div>
      ),
      code: `import { PasswordInput } from '@open-mercato/ui/primitives/password-input'

<PasswordInput disabled />`,
    },
    {
      id: 'invalid',
      title: 'Invalid (described error)',
      render: () => <InvalidPasswordInputPreview />,
      code: `import { PasswordInput } from '@open-mercato/ui/primitives/password-input'
import { FormField } from '@open-mercato/ui/primitives/form-field'

<FormField label="Password" error="Use at least 12 characters.">
  <PasswordInput defaultValue="short" autoComplete="off" />
</FormField>`,
    },
  ],
}

const websiteInputEntry: GalleryEntry = {
  id: 'website-input',
  title: 'WebsiteInput',
  importPath: '@open-mercato/ui/primitives/website-input',
  variants: [
    {
      id: 'default',
      title: 'default (https:// prefix)',
      render: () => (
        <div className="w-72">
          <WebsiteInput />
        </div>
      ),
      code: `import { WebsiteInput } from '@open-mercato/ui/primitives/website-input'

<WebsiteInput />`,
    },
    {
      id: 'custom-prefix',
      title: 'Custom prefix',
      render: () => (
        <div className="w-72">
          <WebsiteInput prefix="http://" />
        </div>
      ),
      code: `import { WebsiteInput } from '@open-mercato/ui/primitives/website-input'

<WebsiteInput prefix="http://" />`,
    },
    {
      id: 'no-prefix',
      title: 'Without prefix',
      render: () => (
        <div className="w-72">
          <WebsiteInput showPrefix={false} />
        </div>
      ),
      code: `import { WebsiteInput } from '@open-mercato/ui/primitives/website-input'

<WebsiteInput showPrefix={false} />`,
    },
  ],
}

const amountInputEntry: GalleryEntry = {
  id: 'amount-input',
  title: 'AmountInput',
  importPath: '@open-mercato/ui/primitives/amount-input',
  variants: [
    {
      id: 'default',
      title: 'default (currency picker)',
      render: () => <DemoAmountInput />,
      code: `import { AmountInput, type AmountValue } from '@open-mercato/ui/primitives/amount-input'

const [value, setValue] = React.useState<AmountValue>({ amount: '', currency: 'EUR' })

<AmountInput value={value} onChange={setValue} />`,
    },
    {
      id: 'no-currency',
      title: 'Without currency picker',
      render: () => <DemoAmountInput showCurrency={false} />,
      code: `import { AmountInput } from '@open-mercato/ui/primitives/amount-input'

<AmountInput value={value} onChange={setValue} showCurrency={false} />`,
    },
    {
      id: 'disabled',
      title: 'Disabled (amount and currency)',
      render: () => <DisabledAmountInputPreview />,
      code: `import { AmountInput, type AmountValue } from '@open-mercato/ui/primitives/amount-input'
import { FormField } from '@open-mercato/ui/primitives/form-field'

const [value, setValue] = React.useState<AmountValue>({ amount: '1250.00', currency: 'EUR' })

<FormField label="Order total" disabled>
  <AmountInput value={value} onChange={setValue} />
</FormField>`,
    },
  ],
}

const counterInputEntry: GalleryEntry = {
  id: 'counter-input',
  title: 'CounterInput',
  importPath: '@open-mercato/ui/primitives/counter-input',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => <DemoCounterInput min={0} max={10} />,
      code: `import { CounterInput } from '@open-mercato/ui/primitives/counter-input'

const [qty, setQty] = React.useState<number | null>(2)

<CounterInput value={qty} onChange={setQty} min={0} max={10} />`,
    },
    {
      id: 'step-precision',
      title: 'Step + precision',
      render: () => <DemoCounterInput initial={2.5} step={0.5} precision={1} min={0} />,
      code: `import { CounterInput } from '@open-mercato/ui/primitives/counter-input'

<CounterInput value={weight} onChange={setWeight} step={0.5} precision={1} min={0} />`,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      render: () => (
        <div className="w-36">
          <CounterInput value={5} disabled />
        </div>
      ),
      code: `import { CounterInput } from '@open-mercato/ui/primitives/counter-input'

<CounterInput value={5} disabled />`,
    },
  ],
}

const digitInputEntry: GalleryEntry = {
  id: 'digit-input',
  title: 'DigitInput',
  importPath: '@open-mercato/ui/primitives/digit-input',
  variants: [
    {
      id: 'default',
      title: 'default (6 cells)',
      render: () => <DigitInputInputsDefaultSample />,
      code: `import { DigitInput } from '@open-mercato/ui/primitives/digit-input'

<DigitInput className="w-full gap-1 sm:w-auto sm:gap-2" cellClassName="min-w-0 w-8 flex-1 sm:w-14 sm:flex-none" onComplete={(code) => verify(code)} />`,
    },
    {
      id: 'masked',
      title: 'Masked (4 cells)',
      render: () => <DigitInput length={4} mask value="1234" aria-label="PIN" />,
      code: `import { DigitInput } from '@open-mercato/ui/primitives/digit-input'

<DigitInput length={4} mask aria-label="PIN" />`,
    },
    {
      id: 'states',
      title: 'States',
      render: () => <DigitInputInputsStatesSample />,
      code: `import { DigitInput } from '@open-mercato/ui/primitives/digit-input'

<DigitInput length={4} aria-invalid />
<DigitInput length={4} disabled />`,
    },
  ],
}

const cardInputEntry: GalleryEntry = {
  id: 'card-input',
  title: 'CardInput',
  importPath: '@open-mercato/ui/primitives/card-input',
  variants: [
    {
      id: 'default',
      title: 'default (empty)',
      render: () => <DemoCardInput />,
      code: `import { CardInput } from '@open-mercato/ui/primitives/card-input'

const [digits, setDigits] = React.useState('')

<CardInput value={digits} onChange={setDigits} />`,
    },
    {
      id: 'brand-detected',
      title: 'Brand detected',
      render: () => <DemoCardInput initial="4242424242424242" />,
      code: `import { CardInput } from '@open-mercato/ui/primitives/card-input'

<CardInput value={digits} onChange={setDigits} onBrandChange={setBrand} />`,
    },
  ],
}

const buttonInputEntry: GalleryEntry = {
  id: 'button-input',
  title: 'ButtonInput',
  importPath: '@open-mercato/ui/primitives/button-input',
  variants: [
    {
      id: 'copy-link',
      title: 'Copy link',
      render: () => <ButtonInputInputsCopyLinkSample />,
      code: `import { Copy, Link2 } from 'lucide-react'
import { ButtonInput } from '@open-mercato/ui/primitives/button-input'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

<ButtonInput
  readOnly
  defaultValue="https://app.example.com/i/8f2c"
  leftIcon={<Link2 />}
  trailingAction={
    <IconButton variant="ghost" aria-label="Copy link"><Copy /></IconButton>
  }
/>`,
    },
    {
      id: 'send',
      title: 'Send action',
      render: () => <ButtonInputInputsSendSample />,
      code: `import { Send } from 'lucide-react'
import { ButtonInput } from '@open-mercato/ui/primitives/button-input'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

<ButtonInput
  placeholder="Invite by email"
  trailingAction={
    <IconButton variant="ghost" aria-label="Send invite"><Send /></IconButton>
  }
/>`,
    },
  ],
}

const colorPickerEntry: GalleryEntry = {
  id: 'color-picker',
  title: 'ColorPicker',
  importPath: '@open-mercato/ui/primitives/color-picker',
  figmaNodeId: '4415:53671',
  variants: [
    {
      id: 'opacity',
      title: 'Opacity',
      render: () => <DemoColorPicker showOpacity />,
      code: `import { ColorPicker } from '@open-mercato/ui/primitives/color-picker'

const [color, setColor] = React.useState('#6366F1')
const [opacity, setOpacity] = React.useState(75)

<ColorPicker value={color} onChange={setColor} showOpacity opacity={opacity} onOpacityChange={setOpacity} />`,
    },
    {
      id: 'default',
      title: 'default',
      render: () => <DemoColorPicker />,
      code: `import { ColorPicker } from '@open-mercato/ui/primitives/color-picker'

const [color, setColor] = React.useState('#6366F1')

<ColorPicker value={color} onChange={setColor} />`,
    },
    {
      id: 'locked-palette',
      title: 'Locked palette',
      render: () => (
        <DemoColorPicker
          allowCustom={false}
          swatches={COLOR_PICKER_DEFAULT_SWATCHES.slice(0, 5)}
        />
      ),
      code: `import { ColorPicker, COLOR_PICKER_DEFAULT_SWATCHES } from '@open-mercato/ui/primitives/color-picker'

<ColorPicker
  value={color}
  onChange={setColor}
  swatches={COLOR_PICKER_DEFAULT_SWATCHES.slice(0, 5)}
  allowCustom={false}
/>`,
    },
  ],
}

const tagInputEntry: GalleryEntry = {
  id: 'tag-input',
  title: 'TagInput',
  importPath: '@open-mercato/ui/primitives/tag-input',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => <TagInputInputsDefaultSample />,
      code: `import { TagInput } from '@open-mercato/ui/primitives/tag-input'

const [tags, setTags] = React.useState<string[]>(['wholesale', 'priority', 'eu'])

<TagInput value={tags} onChange={setTags} placeholder="Add tag" />`,
    },
    {
      id: 'max-tags',
      title: 'Max tags reached',
      render: () => <TagInputInputsMaxTagsSample />,
      code: `import { TagInput } from '@open-mercato/ui/primitives/tag-input'

<TagInput value={tags} onChange={setTags} maxTags={3} />`,
    },
  ],
}

const richEditorEntry: GalleryEntry = {
  id: 'rich-editor',
  figmaNodeId: '166926:17605',
  title: 'RichEditor',
  importPath: '@open-mercato/ui/primitives/rich-editor',
  docsAnchor: '#richeditor',
  usage: { do: [
    'toolbarDesign opts into source layouts 01–04 with 28 px controls, 20 px icons and 6 px item radii. Existing full, standard, basic and minimal presets retain their defaults.',
    'Every source layout includes a working More menu. Hidden commands remain available in that menu when the toolbar narrows.',
    'The 12-color palette already includes the source Color11 (white) and Color12 (black). Color choice changes editable content; stored HTML still passes through the existing sanitizer.',
    'The character counter updates while typing. onChange retains its blur contract; consumers supply translated labels and their own comment and mention workflows.',
  ] },
  variants: [
    { id: 'minimal', title: 'Preset / minimal', render: () => <DemoRichEditor variant="minimal" />, code: `import * as React from 'react'
import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'

const [html, setHtml] = React.useState('<p>Editable text</p>')
<RichEditor value={html} onChange={setHtml} variant="minimal" />` },
    { id: 'standard', title: 'Preset / standard', render: () => <DemoRichEditor variant="standard" />, code: `import * as React from 'react'
import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'

const [html, setHtml] = React.useState('<p>Editable text</p>')
<RichEditor value={html} onChange={setHtml} variant="standard" />` },
    { id: 'basic', title: 'Preset / basic', render: () => <DemoRichEditor variant="basic" />, code: `import * as React from 'react'
import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'

const [html, setHtml] = React.useState('<p>Editable text</p>')
<RichEditor value={html} onChange={setHtml} variant="basic" />` },
    { id: 'full', title: 'Preset / full', render: () => <DemoRichEditor variant="full" />, code: `import * as React from 'react'
import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'

const [html, setHtml] = React.useState('<p>Editable text</p>')
<RichEditor value={html} onChange={setHtml} variant="full" />` },
    { id: 'source-01', title: 'Source layout 01', render: () => <DemoRichEditor toolbarDesign="01" />, code: `import * as React from 'react'
import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'

const [html, setHtml] = React.useState('<p>Editable text</p>')
<RichEditor value={html} onChange={setHtml} toolbarDesign="01" />` },
    { id: 'source-02', title: 'Source layout 02', render: () => <DemoRichEditor toolbarDesign="02" />, code: `import * as React from 'react'
import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'

const [html, setHtml] = React.useState('<p>Editable text</p>')
<RichEditor value={html} onChange={setHtml} toolbarDesign="02" />` },
    { id: 'source-03', title: 'Source layout 03', render: () => <DemoRichEditor toolbarDesign="03" />, code: `import * as React from 'react'
import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'

const [html, setHtml] = React.useState('<p>Editable text</p>')
<RichEditor value={html} onChange={setHtml} toolbarDesign="03" />` },
    { id: 'source-04', title: 'Source layout 04', render: () => <DemoRichEditor toolbarDesign="04" />, code: `import * as React from 'react'
import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'

const [html, setHtml] = React.useState('<p>Editable text</p>')
<RichEditor value={html} onChange={setHtml} toolbarDesign="04" />` },
    { id: 'disabled', title: 'Source layout / disabled', render: () => <DemoRichEditor toolbarDesign="01" disabled />, code: `import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'

<RichEditor value={html} onChange={setHtml} toolbarDesign="01" disabled />` },
    { id: 'counter', title: 'Live character counter', render: () => <DemoRichEditor toolbarDesign="03" counter />, code: `import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'

<RichEditor value={html} onChange={setHtml} toolbarDesign="03" maxLength={100} />` },
    { id: 'palette', title: 'All twelve source colors', render: () => <DemoRichEditorPalette />, code: `import * as React from 'react'
import { RichEditorColorPalette, type RichEditorColorKey } from '@open-mercato/ui/primitives/rich-editor'

const [color, setColor] = React.useState<RichEditorColorKey | null>('gray')
<RichEditorColorPalette value={color} onChange={setColor} />` },
  ],
}

const fileUploadAreaEntry: GalleryEntry = {
  id: 'file-upload',
  title: 'FileUploadArea',
  importPath: '@open-mercato/ui/primitives/file-upload',
  figmaNodeId: '450:9413',
  docsAnchor: '#fileuploadarea',
  usage: { do: ['Default and hover are live states of the same drop target. Select or drop files to exercise the local demo queue.', 'Pass onFilesSelected and handle transfer separately. Demo progress is simulated locally; files never leave the browser.', 'Keep custom accept/maxSizeBytes and the description consistent.'] },
  variants: [
    {
      id: 'default', title: 'default',
      render: () => <FileUploadAreaDemo />,
      code: `import { FileUploadArea } from '@open-mercato/ui/primitives/file-upload'

<FileUploadArea onFilesSelected={handleFiles} onFilesRejected={handleRejections} />`,
    },
    {
      id: 'drag-and-drop', title: 'drag-and-drop',
      render: () => <FileUploadAreaDemo />,
      code: `import { FileUploadArea } from '@open-mercato/ui/primitives/file-upload'

<FileUploadArea onFilesSelected={handleFiles} onFilesRejected={handleRejections} />`,
    },
    {
      id: 'disabled', title: 'disabled',
      render: () => <FileUploadAreaDemo disabled />,
      code: `import { FileUploadArea } from '@open-mercato/ui/primitives/file-upload'

<FileUploadArea disabled onFilesSelected={handleFiles} onFilesRejected={handleRejections} />`,
    },
  ],
}

const fileUploadCardEntry: GalleryEntry = {
  id: 'file-upload-card',
  title: 'FileUploadCard',
  importPath: '@open-mercato/ui/primitives/file-upload-card',
  figmaNodeId: '451:409',
  docsAnchor: '#fileuploadcard',
  usage: { do: ['Cancel/remove and retry are real callbacks. The error example retries using local simulated progress.', 'The caller owns transfer state, progress, and localized file-size text.'] },
  variants: [
    {
      id: 'uploading', title: 'uploading',
      render: () => <FileUploadCardDemo initialStatus="uploading" />,
      code: `import { FileUploadCard } from '@open-mercato/ui/primitives/file-upload-card'

<FileUploadCard fileName="my-cv.pdf" sizeLabel={sizeLabel} status="uploading" progress={progress} onRemove={removeFile} onRetry={retryFile} />`,
    },
    {
      id: 'success', title: 'success',
      render: () => <FileUploadCardDemo initialStatus="success" />,
      code: `import { FileUploadCard } from '@open-mercato/ui/primitives/file-upload-card'

<FileUploadCard fileName="my-cv.pdf" sizeLabel={sizeLabel} status="success" progress={progress} onRemove={removeFile} onRetry={retryFile} />`,
    },
    {
      id: 'error', title: 'error',
      render: () => <FileUploadCardDemo initialStatus="error" />,
      code: `import { FileUploadCard } from '@open-mercato/ui/primitives/file-upload-card'

<FileUploadCard fileName="my-cv.pdf" sizeLabel={sizeLabel} status="error" progress={progress} onRemove={removeFile} onRetry={retryFile} />`,
    },
  ],
}

const fileFormatIconEntry: GalleryEntry = {
  id: 'file-format-icon',
  title: 'FileFormatIcon',
  importPath: '@open-mercato/ui/primitives/file-format-icon',
  figmaNodeId: '450:17234',
  docsAnchor: '#fileformaticon',
  usage: { do: ['Both sizes and all nine category colors come from Figma. Teal is the source name of the light-blue category.', 'The original Figma paper/fold artwork is bundled locally. Category-label foregrounds meet 4.5:1 contrast.'] },
  variants: [
    {
      id: 'red-default', title: 'red / 40px',
      render: () => <FileFormatIcon format="PDF" tone="red" size="default" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="red" size="default" />`,
    },
    {
      id: 'orange-default', title: 'orange / 40px',
      render: () => <FileFormatIcon format="PDF" tone="orange" size="default" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="orange" size="default" />`,
    },
    {
      id: 'yellow-default', title: 'yellow / 40px',
      render: () => <FileFormatIcon format="PDF" tone="yellow" size="default" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="yellow" size="default" />`,
    },
    {
      id: 'green-default', title: 'green / 40px',
      render: () => <FileFormatIcon format="PDF" tone="green" size="default" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="green" size="default" />`,
    },
    {
      id: 'teal-default', title: 'teal / 40px',
      render: () => <FileFormatIcon format="PDF" tone="teal" size="default" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="teal" size="default" />`,
    },
    {
      id: 'blue-default', title: 'blue / 40px',
      render: () => <FileFormatIcon format="PDF" tone="blue" size="default" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="blue" size="default" />`,
    },
    {
      id: 'purple-default', title: 'purple / 40px',
      render: () => <FileFormatIcon format="PDF" tone="purple" size="default" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="purple" size="default" />`,
    },
    {
      id: 'pink-default', title: 'pink / 40px',
      render: () => <FileFormatIcon format="PDF" tone="pink" size="default" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="pink" size="default" />`,
    },
    {
      id: 'gray-default', title: 'gray / 40px',
      render: () => <FileFormatIcon format="PDF" tone="gray" size="default" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="gray" size="default" />`,
    },
    {
      id: 'red-sm', title: 'red / 32px',
      render: () => <FileFormatIcon format="PDF" tone="red" size="sm" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="red" size="sm" />`,
    },
    {
      id: 'orange-sm', title: 'orange / 32px',
      render: () => <FileFormatIcon format="PDF" tone="orange" size="sm" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="orange" size="sm" />`,
    },
    {
      id: 'yellow-sm', title: 'yellow / 32px',
      render: () => <FileFormatIcon format="PDF" tone="yellow" size="sm" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="yellow" size="sm" />`,
    },
    {
      id: 'green-sm', title: 'green / 32px',
      render: () => <FileFormatIcon format="PDF" tone="green" size="sm" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="green" size="sm" />`,
    },
    {
      id: 'teal-sm', title: 'teal / 32px',
      render: () => <FileFormatIcon format="PDF" tone="teal" size="sm" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="teal" size="sm" />`,
    },
    {
      id: 'blue-sm', title: 'blue / 32px',
      render: () => <FileFormatIcon format="PDF" tone="blue" size="sm" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="blue" size="sm" />`,
    },
    {
      id: 'purple-sm', title: 'purple / 32px',
      render: () => <FileFormatIcon format="PDF" tone="purple" size="sm" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="purple" size="sm" />`,
    },
    {
      id: 'pink-sm', title: 'pink / 32px',
      render: () => <FileFormatIcon format="PDF" tone="pink" size="sm" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="pink" size="sm" />`,
    },
    {
      id: 'gray-sm', title: 'gray / 32px',
      render: () => <FileFormatIcon format="PDF" tone="gray" size="sm" />,
      code: `import { FileFormatIcon } from '@open-mercato/ui/primitives/file-format-icon'

<FileFormatIcon format="PDF" tone="gray" size="sm" />`,
    },
  ],
}

const imageUploadEntry: GalleryEntry = {
  id: 'image-upload',
  title: 'ImageUpload',
  importPath: '@open-mercato/ui/primitives/image-upload',
  figmaNodeId: '452:653',
  docsAnchor: '#imageupload',
  usage: { do: ['Figma calls the layout with text above actions Vertical; both source layouts place the avatar to the left.', 'New selections must decode as PNG/JPEG and meet the configured minimum dimensions (400×400 by default). The caller owns the preview URL and transfer.', 'Existing uploaded illustrations are exact source fixtures. Change and Remove update only local browser state.'] },
  variants: [
    {
      id: 'avatar-vertical-empty', title: 'avatar / vertical / empty',
      render: () => <ImageUploadDemo kind="avatar" alignment="vertical" uploaded={false} />,
      code: `import { ImageUpload } from '@open-mercato/ui/primitives/image-upload'

<ImageUpload kind="avatar" alignment="vertical" src={previewUrl} alt={imageLabel} onChange={handleImageChange} />`,
    },
    {
      id: 'avatar-vertical-uploaded', title: 'avatar / vertical / uploaded',
      render: () => <ImageUploadDemo kind="avatar" alignment="vertical" uploaded={true} />,
      code: `import { ImageUpload } from '@open-mercato/ui/primitives/image-upload'

<ImageUpload kind="avatar" alignment="vertical" src={previewUrl} alt={imageLabel} onChange={handleImageChange} />`,
    },
    {
      id: 'avatar-horizontal-empty', title: 'avatar / horizontal / empty',
      render: () => <ImageUploadDemo kind="avatar" alignment="horizontal" uploaded={false} />,
      code: `import { ImageUpload } from '@open-mercato/ui/primitives/image-upload'

<ImageUpload kind="avatar" alignment="horizontal" src={previewUrl} alt={imageLabel} onChange={handleImageChange} />`,
    },
    {
      id: 'avatar-horizontal-uploaded', title: 'avatar / horizontal / uploaded',
      render: () => <ImageUploadDemo kind="avatar" alignment="horizontal" uploaded={true} />,
      code: `import { ImageUpload } from '@open-mercato/ui/primitives/image-upload'

<ImageUpload kind="avatar" alignment="horizontal" src={previewUrl} alt={imageLabel} onChange={handleImageChange} />`,
    },
    {
      id: 'company-vertical-empty', title: 'company / vertical / empty',
      render: () => <ImageUploadDemo kind="company" alignment="vertical" uploaded={false} />,
      code: `import { ImageUpload } from '@open-mercato/ui/primitives/image-upload'

<ImageUpload kind="company" alignment="vertical" src={previewUrl} alt={imageLabel} onChange={handleImageChange} />`,
    },
    {
      id: 'company-vertical-uploaded', title: 'company / vertical / uploaded',
      render: () => <ImageUploadDemo kind="company" alignment="vertical" uploaded={true} />,
      code: `import { ImageUpload } from '@open-mercato/ui/primitives/image-upload'

<ImageUpload kind="company" alignment="vertical" src={previewUrl} alt={imageLabel} onChange={handleImageChange} />`,
    },
    {
      id: 'company-horizontal-empty', title: 'company / horizontal / empty',
      render: () => <ImageUploadDemo kind="company" alignment="horizontal" uploaded={false} />,
      code: `import { ImageUpload } from '@open-mercato/ui/primitives/image-upload'

<ImageUpload kind="company" alignment="horizontal" src={previewUrl} alt={imageLabel} onChange={handleImageChange} />`,
    },
    {
      id: 'company-horizontal-uploaded', title: 'company / horizontal / uploaded',
      render: () => <ImageUploadDemo kind="company" alignment="horizontal" uploaded={true} />,
      code: `import { ImageUpload } from '@open-mercato/ui/primitives/image-upload'

<ImageUpload kind="company" alignment="horizontal" src={previewUrl} alt={imageLabel} onChange={handleImageChange} />`,
    },
    {
      id: 'disabled', title: 'disabled',
      render: () => <ImageUploadDemo kind="avatar" alignment="vertical" uploaded disabled />,
      code: `import { ImageUpload } from '@open-mercato/ui/primitives/image-upload'

<ImageUpload disabled src={previewUrl} onChange={handleImageChange} />`,
    },
  ],
}

const labelEntry: GalleryEntry = {
  id: 'label', title: 'FieldLabel',
  importPath: '@open-mercato/ui/primitives/label',
  figmaNodeId: '266:2814',
  descriptionKey: 'design_system.entries.label.description',
  variants: [
    { id: 'normal', title: 'normal', render: () => <FieldLabelExample />, code: fieldLabelCode(' sublabel="(optional)"') },
    { id: 'disabled', title: 'disabled', render: () => <FieldLabelExample disabled />, code: fieldLabelCode(' disabled') },
    { id: 'required', title: 'required', render: () => <FieldLabelExample kind="required" />, code: fieldLabelCode(' required') },
    { id: 'optional', title: 'optional', render: () => <FieldLabelExample kind="optional" />, code: fieldLabelCode(' sublabel="(optional)"') },
    { id: 'information', title: 'information', render: () => <FieldLabelExample kind="information" />, code: fieldLabelInformationCode },
    { id: 'action', title: 'action', render: () => <FieldLabelExample kind="action" />, code: fieldLabelActionCode },
    { id: 'form-field', title: 'form-field', render: () => <FormFieldLabelExample />, code: formFieldLabelCode },
  ],
}

const hint_textEntry: GalleryEntry = {
  id: 'hint-text', title: 'HintText',
  importPath: '@open-mercato/ui/primitives/hint-text',
  figmaNodeId: '266:5284',
  descriptionKey: 'design_system.entries.hint-text.description',
  variants: [
    { id: 'default', title: 'default', render: () => <HintTextExample />, code: hintTextCode() },
    { id: 'error', title: 'error', render: () => <HintTextExample state="error" />, code: hintTextCode({ state: 'error' }) },
    { id: 'disabled', title: 'disabled', render: () => <HintTextExample state="disabled" />, code: hintTextCode({ state: 'disabled' }) },
    { id: 'text-only', title: 'text-only', render: () => <HintTextExample icon={false} />, code: hintTextCode({ icon: false }) },
  ],
}

const marketingControlsEntry: GalleryEntry = {
  id: 'marketing-controls',
  title: 'Marketing Controls',
  importPath: '@open-mercato/ui/primitives/input',
  figmaNodeId: '6696:81119',
  variants: [
    { id: 'product-image-1', title: 'product-image-1', render: () => <MarketingControlDemo kind="product-image" product={0} />, code: marketingControlExampleCode('<MarketingControlDemo kind="product-image" product={0} />') },
    { id: 'product-image-2', title: 'product-image-2', render: () => <MarketingControlDemo kind="product-image" product={1} />, code: marketingControlExampleCode('<MarketingControlDemo kind="product-image" product={1} />') },
    { id: 'product-image-3', title: 'product-image-3', render: () => <MarketingControlDemo kind="product-image" product={2} />, code: marketingControlExampleCode('<MarketingControlDemo kind="product-image" product={2} />') },
    { id: 'product-image-4', title: 'product-image-4', render: () => <MarketingControlDemo kind="product-image" product={3} />, code: marketingControlExampleCode('<MarketingControlDemo kind="product-image" product={3} />') },
    { id: 'product-image-5', title: 'product-image-5', render: () => <MarketingControlDemo kind="product-image" product={4} />, code: marketingControlExampleCode('<MarketingControlDemo kind="product-image" product={4} />') },
    { id: 'product-image-6', title: 'product-image-6', render: () => <MarketingControlDemo kind="product-image" product={5} />, code: marketingControlExampleCode('<MarketingControlDemo kind="product-image" product={5} />') },
    { id: 'product-image-7', title: 'product-image-7', render: () => <MarketingControlDemo kind="product-image" product={6} />, code: marketingControlExampleCode('<MarketingControlDemo kind="product-image" product={6} />') },
    { id: 'product-image-8', title: 'product-image-8', render: () => <MarketingControlDemo kind="product-image" product={7} />, code: marketingControlExampleCode('<MarketingControlDemo kind="product-image" product={7} />') },
    { id: 'product-image-9', title: 'product-image-9', render: () => <MarketingControlDemo kind="product-image" product={8} />, code: marketingControlExampleCode('<MarketingControlDemo kind="product-image" product={8} />') },
    { id: 'product-image-10', title: 'product-image-10', render: () => <MarketingControlDemo kind="product-image" product={9} />, code: marketingControlExampleCode('<MarketingControlDemo kind="product-image" product={9} />') },
    { id: 'step-item-default', title: 'step-item-default', render: () => <MarketingControlDemo kind="step-item" state="default" />, code: marketingControlExampleCode('<MarketingControlDemo kind="step-item" state="default" />') },
    { id: 'step-item-active', title: 'step-item-active', render: () => <MarketingControlDemo kind="step-item" state="active" />, code: marketingControlExampleCode('<MarketingControlDemo kind="step-item" state="active" />') },
    { id: 'step-item-complete', title: 'step-item-complete', render: () => <MarketingControlDemo kind="step-item" state="complete" />, code: marketingControlExampleCode('<MarketingControlDemo kind="step-item" state="complete" />') },
    { id: 'select-default', title: 'select-default', render: () => <MarketingControlDemo kind="select" state="default" />, code: marketingControlExampleCode('<MarketingControlDemo kind="select" state="default" />') },
    { id: 'select-hover', title: 'select-hover', render: () => <MarketingControlDemo kind="select" state="hover" />, code: marketingControlExampleCode('<MarketingControlDemo kind="select" state="hover" />') },
    { id: 'select-active', title: 'select-active', render: () => <MarketingControlDemo kind="select" state="active" />, code: marketingControlExampleCode('<MarketingControlDemo kind="select" state="active" />') },
    { id: 'select-filled', title: 'select-filled', render: () => <MarketingControlDemo kind="select" state="filled" />, code: marketingControlExampleCode('<MarketingControlDemo kind="select" state="filled" />') },
    { id: 'input-default-medium', title: 'input-default-medium', render: () => <MarketingControlDemo kind="input" state="default" size="medium" />, code: marketingControlExampleCode('<MarketingControlDemo kind="input" state="default" size="medium" />') },
    { id: 'input-hover-medium', title: 'input-hover-medium', render: () => <MarketingControlDemo kind="input" state="hover" size="medium" />, code: marketingControlExampleCode('<MarketingControlDemo kind="input" state="hover" size="medium" />') },
    { id: 'input-active-medium', title: 'input-active-medium', render: () => <MarketingControlDemo kind="input" state="active" size="medium" />, code: marketingControlExampleCode('<MarketingControlDemo kind="input" state="active" size="medium" />') },
    { id: 'input-filled-medium', title: 'input-filled-medium', render: () => <MarketingControlDemo kind="input" state="filled" size="medium" />, code: marketingControlExampleCode('<MarketingControlDemo kind="input" state="filled" size="medium" />') },
    { id: 'input-default-large', title: 'input-default-large', render: () => <MarketingControlDemo kind="input" state="default" size="large" />, code: marketingControlExampleCode('<MarketingControlDemo kind="input" state="default" size="large" />') },
    { id: 'input-hover-large', title: 'input-hover-large', render: () => <MarketingControlDemo kind="input" state="hover" size="large" />, code: marketingControlExampleCode('<MarketingControlDemo kind="input" state="hover" size="large" />') },
    { id: 'input-active-large', title: 'input-active-large', render: () => <MarketingControlDemo kind="input" state="active" size="large" />, code: marketingControlExampleCode('<MarketingControlDemo kind="input" state="active" size="large" />') },
    { id: 'input-filled-large', title: 'input-filled-large', render: () => <MarketingControlDemo kind="input" state="filled" size="large" />, code: marketingControlExampleCode('<MarketingControlDemo kind="input" state="filled" size="large" />') },
    { id: 'textarea-default', title: 'textarea-default', render: () => <MarketingControlDemo kind="textarea" state="default" />, code: marketingControlExampleCode('<MarketingControlDemo kind="textarea" state="default" />') },
    { id: 'textarea-hover', title: 'textarea-hover', render: () => <MarketingControlDemo kind="textarea" state="hover" />, code: marketingControlExampleCode('<MarketingControlDemo kind="textarea" state="hover" />') },
    { id: 'textarea-active', title: 'textarea-active', render: () => <MarketingControlDemo kind="textarea" state="active" />, code: marketingControlExampleCode('<MarketingControlDemo kind="textarea" state="active" />') },
    { id: 'textarea-filled', title: 'textarea-filled', render: () => <MarketingControlDemo kind="textarea" state="filled" />, code: marketingControlExampleCode('<MarketingControlDemo kind="textarea" state="filled" />') },
    { id: 'amount-default', title: 'amount-default', render: () => <MarketingControlDemo kind="amount" state="default" />, code: marketingControlExampleCode('<MarketingControlDemo kind="amount" state="default" />') },
    { id: 'amount-hover', title: 'amount-hover', render: () => <MarketingControlDemo kind="amount" state="hover" />, code: marketingControlExampleCode('<MarketingControlDemo kind="amount" state="hover" />') },
    { id: 'amount-active', title: 'amount-active', render: () => <MarketingControlDemo kind="amount" state="active" />, code: marketingControlExampleCode('<MarketingControlDemo kind="amount" state="active" />') },
    { id: 'amount-filled', title: 'amount-filled', render: () => <MarketingControlDemo kind="amount" state="filled" />, code: marketingControlExampleCode('<MarketingControlDemo kind="amount" state="filled" />') },
    { id: 'tab-menu-default', title: 'tab-menu-default', render: () => <MarketingControlDemo kind="tab-menu" state="default" />, code: marketingControlExampleCode('<MarketingControlDemo kind="tab-menu" state="default" />') },
    { id: 'tab-menu-hover', title: 'tab-menu-hover', render: () => <MarketingControlDemo kind="tab-menu" state="hover" />, code: marketingControlExampleCode('<MarketingControlDemo kind="tab-menu" state="hover" />') },
    { id: 'tab-menu-active', title: 'tab-menu-active', render: () => <MarketingControlDemo kind="tab-menu" state="active" />, code: marketingControlExampleCode('<MarketingControlDemo kind="tab-menu" state="active" />') },
    { id: 'inline-input-placeholder', title: 'inline-input-placeholder', render: () => <MarketingControlDemo kind="inline-input" state="placeholder" />, code: marketingControlExampleCode('<MarketingControlDemo kind="inline-input" state="placeholder" />') },
    { id: 'inline-input-hover', title: 'inline-input-hover', render: () => <MarketingControlDemo kind="inline-input" state="hover" />, code: marketingControlExampleCode('<MarketingControlDemo kind="inline-input" state="hover" />') },
    { id: 'inline-input-focus', title: 'inline-input-focus', render: () => <MarketingControlDemo kind="inline-input" state="focus" />, code: marketingControlExampleCode('<MarketingControlDemo kind="inline-input" state="focus" />') },
    { id: 'inline-input-filled', title: 'inline-input-filled', render: () => <MarketingControlDemo kind="inline-input" state="filled" />, code: marketingControlExampleCode('<MarketingControlDemo kind="inline-input" state="filled" />') },
    { id: 'inline-input-disabled', title: 'inline-input-disabled', render: () => <MarketingControlDemo kind="inline-input" state="disabled" />, code: marketingControlExampleCode('<MarketingControlDemo kind="inline-input" state="disabled" />') },
    { id: 'inline-select-placeholder', title: 'inline-select-placeholder', render: () => <MarketingControlDemo kind="inline-select" state="placeholder" />, code: marketingControlExampleCode('<MarketingControlDemo kind="inline-select" state="placeholder" />') },
    { id: 'inline-select-hover', title: 'inline-select-hover', render: () => <MarketingControlDemo kind="inline-select" state="hover" />, code: marketingControlExampleCode('<MarketingControlDemo kind="inline-select" state="hover" />') },
    { id: 'inline-select-focus', title: 'inline-select-focus', render: () => <MarketingControlDemo kind="inline-select" state="focus" />, code: marketingControlExampleCode('<MarketingControlDemo kind="inline-select" state="focus" />') },
    { id: 'inline-select-filled', title: 'inline-select-filled', render: () => <MarketingControlDemo kind="inline-select" state="filled" />, code: marketingControlExampleCode('<MarketingControlDemo kind="inline-select" state="filled" />') },
    { id: 'inline-select-disabled', title: 'inline-select-disabled', render: () => <MarketingControlDemo kind="inline-select" state="disabled" />, code: marketingControlExampleCode('<MarketingControlDemo kind="inline-select" state="disabled" />') },
    { id: 'chart-tooltip-right', title: 'chart-tooltip-right', render: () => <MarketingControlDemo kind="chart-tooltip" side="right" />, code: marketingControlExampleCode('<MarketingControlDemo kind="chart-tooltip" side="right" />') },
    { id: 'chart-tooltip-left', title: 'chart-tooltip-left', render: () => <MarketingControlDemo kind="chart-tooltip" side="left" />, code: marketingControlExampleCode('<MarketingControlDemo kind="chart-tooltip" side="left" />') },
    { id: 'chart-tooltip-bottom', title: 'chart-tooltip-bottom', render: () => <MarketingControlDemo kind="chart-tooltip" side="bottom" />, code: marketingControlExampleCode('<MarketingControlDemo kind="chart-tooltip" side="bottom" />') },
    { id: 'chart-tooltip-top', title: 'chart-tooltip-top', render: () => <MarketingControlDemo kind="chart-tooltip" side="top" />, code: marketingControlExampleCode('<MarketingControlDemo kind="chart-tooltip" side="top" />') },
    { id: 'selected-button-default', title: 'selected-button-default', render: () => <MarketingControlDemo kind="selected-button" state="default" />, code: marketingControlExampleCode('<MarketingControlDemo kind="selected-button" state="default" />') },
    { id: 'selected-button-hover', title: 'selected-button-hover', render: () => <MarketingControlDemo kind="selected-button" state="hover" />, code: marketingControlExampleCode('<MarketingControlDemo kind="selected-button" state="hover" />') },
    { id: 'selected-button-selected', title: 'selected-button-selected', render: () => <MarketingControlDemo kind="selected-button" state="selected" />, code: marketingControlExampleCode('<MarketingControlDemo kind="selected-button" state="selected" />') },
    { id: 'selected-button-disabled', title: 'selected-button-disabled', render: () => <MarketingControlDemo kind="selected-button" state="disabled" />, code: marketingControlExampleCode('<MarketingControlDemo kind="selected-button" state="disabled" />') },
  ],
}

export const entries: GalleryEntry[] = [
  marketingControlsEntry,
  labelEntry,
  hint_textEntry,
  fileUploadAreaEntry,
  fileUploadCardEntry,
  fileFormatIconEntry,
  imageUploadEntry,
  inputEntry,
  textareaEntry,
  phoneNumberEntry,
  selectEntry,
  dropdownEntry,
  compactSelectEntry,
  inlineSelectEntry,
  inlineInputEntry,
  checkboxEntry,
  checkboxFieldEntry,
  radioEntry,
  radioFieldEntry,
  switchEntry,
  switchFieldEntry,
  sliderEntry,
  formFieldEntry,
  searchInputEntry,
  emailInputEntry,
  passwordInputEntry,
  passwordStrengthEntry,
  websiteInputEntry,
  amountInputEntry,
  counterInputEntry,
  digitInputEntry,
  cardInputEntry,
  buttonInputEntry,
  colorPickerEntry,
  tagInputEntry,
  richEditorEntry,
]

function InputInputsDefaultSample() {
  const t = useT()
  return (<div className="w-72">
          <Input placeholder={t('design_system.gallery.samples.marketing.productName')} />
        </div>)
}

function InputInputsIconSlotsSample() {
  const t = useT()
  return (<>
          <div className="w-56">
            <Input leftIcon={<User />} placeholder={t('design_system.gallery.sampleCopy.assignee')} />
          </div>
          <div className="w-56">
            <Input rightIcon={<Info />} placeholder="SKU" />
          </div>
        </>)
}

function InputInputsSizesSample() {
  const t = useT()
  return (<>
          <div className="w-44">
            <Input size="lg" placeholder={t('design_system.gallery.sampleCopy.large')} />
          </div>
          <div className="w-44">
            <Input size="default" placeholder={t('design_system.gallery.examples.aiProduct.default')} />
          </div>
          <div className="w-44">
            <Input size="sm" placeholder={t('design_system.gallery.sampleCopy.small')} />
          </div>
        </>)
}

function InputInputsStatesSample() {
  const t = useT()
  return (<>
          <div className="w-56">
            <Input aria-invalid defaultValue="not-a-number" />
          </div>
          <div className="w-56">
            <Input disabled placeholder={t('design_system.gallery.examples.keyComponents.disabled')} />
          </div>
        </>)
}

function TextareaInputsDefaultSample() {
  const t = useT()
  return (<div className="w-80">
          <Textarea placeholder={t('design_system.gallery.sampleCopy.internalNoteForTheFulfillmentTeam')} />
        </div>)
}

function TextareaInputsStatesSample() {
  const t = useT()
  return (<>
          <div className="w-72">
            <Textarea aria-invalid defaultValue={t('design_system.gallery.sampleCopy.tooShort')} />
          </div>
          <div className="w-72">
            <Textarea disabled placeholder={t('design_system.gallery.examples.keyComponents.disabled')} />
          </div>
        </>)
}

function CompactSelectInputsTriggerLabelSample() {
  const t = useT()
  return (<div className="w-44">
          <Select defaultValue="newest">
            <CompactSelectTrigger triggerLabel="Sort:">
              <SelectValue />
            </CompactSelectTrigger>
            <SelectContent>
              <SelectItem value="newest">{t('design_system.gallery.sampleCopy.newest')}</SelectItem>
              <SelectItem value="oldest">{t('design_system.gallery.sampleCopy.oldest')}</SelectItem>
              <SelectItem value="value">{t('design_system.gallery.sampleCopy.highestValue')}</SelectItem>
            </SelectContent>
          </Select>
        </div>)
}

function CompactSelectInputsPlainSample() {
  const t = useT()
  return (<div className="w-36">
          <Select defaultValue="table">
            <CompactSelectTrigger>
              <SelectValue />
            </CompactSelectTrigger>
            <SelectContent>
              <SelectItem value="table">{t('design_system.gallery.samples.richEditor.labels.table')}</SelectItem>
              <SelectItem value="board">{t('design_system.gallery.sampleCopy.board')}</SelectItem>
            </SelectContent>
          </Select>
        </div>)
}

function InlineSelectInputsDefaultSample() {
  const t = useT()
  return (<div className="w-40">
          <Select defaultValue="high">
            <InlineSelectTrigger>
              <SelectValue />
            </InlineSelectTrigger>
            <SelectContent>
              <SelectItem value="low">{t('design_system.gallery.samples.finance.low')}</SelectItem>
              <SelectItem value="medium">{t('design_system.gallery.examples.aiProduct.medium')}</SelectItem>
              <SelectItem value="high">{t('design_system.gallery.samples.finance.high')}</SelectItem>
            </SelectContent>
          </Select>
        </div>)
}

function InlineSelectInputsInvisibleSample() {
  const t = useT()
  return (<div className="w-40">
          <Select defaultValue="draft">
            <InlineSelectTrigger showBorderOnHover={false}>
              <SelectValue />
            </InlineSelectTrigger>
            <SelectContent>
              <SelectItem value="draft">{t('design_system.gallery.sampleCopy.draft')}</SelectItem>
              <SelectItem value="published">{t('design_system.gallery.sampleCopy.published')}</SelectItem>
            </SelectContent>
          </Select>
        </div>)
}

function InlineInputInputsDefaultSample() {
  const t = useT()
  return (<div className="w-56">
          <InlineInput defaultValue={t('design_system.gallery.sampleCopy.auroraDeskLamp')} aria-label={t('design_system.gallery.samples.marketing.productName')} />
        </div>)
}

function CheckboxInputsStatesSample() {
  const t = useT()
  return (<>
          <Checkbox aria-label={t('design_system.gallery.sampleCopy.unchecked')} />
          <Checkbox defaultChecked aria-label={t('design_system.gallery.sampleCopy.checked')} />
          <Checkbox checked="indeterminate" aria-label={t('design_system.gallery.sampleCopy.indeterminate')} />
        </>)
}

function CheckboxInputsSizesSample() {
  const t = useT()
  return (<>
          <Checkbox size="sm" defaultChecked aria-label={t('design_system.gallery.sampleCopy.small')} />
          <Checkbox size="md" defaultChecked aria-label={t('design_system.gallery.examples.aiProduct.medium')} />
        </>)
}

function CheckboxInputsDisabledSample() {
  const t = useT()
  return (<>
          <Checkbox disabled aria-label={t('design_system.gallery.examples.keyComponents.disabled')} />
          <Checkbox disabled defaultChecked aria-label={t('design_system.gallery.sampleCopy.disabledChecked')} />
        </>)
}

function CheckboxFieldInputsDefaultSample() {
  const t = useT()
  return (<CheckboxField label={t('design_system.gallery.sampleCopy.emailNotifications')} defaultChecked />)
}

function CheckboxFieldInputsWithDescriptionSample() {
  const t = useT()
  return (<div className="w-80">
          <CheckboxField
            label={t('design_system.gallery.sampleCopy.autoarchive')}
            sublabel="(recommended)"
            description={t('design_system.gallery.sampleCopy.closedConversationsMoveToTheArchiveAfter30Days')}
          />
        </div>)
}

function CheckboxFieldInputsFlipSample() {
  const t = useT()
  return (<div className="w-72">
          <CheckboxField flip label={t('design_system.gallery.sampleCopy.includeShippingCosts')} defaultChecked />
        </div>)
}

function RadioInputsGroupSample() {
  const t = useT()
  return (<RadioGroup defaultValue="card" className="flex-row gap-3" aria-label={t('design_system.gallery.samples.menu.kind.provider')}>
          <Radio value="card" aria-label={t('design_system.gallery.sampleCopy.card')} />
          <Radio value="transfer" aria-label={t('design_system.gallery.sampleCopy.bankTransfer')} />
          <Radio value="cash" aria-label={t('design_system.gallery.sampleCopy.cash')} />
        </RadioGroup>)
}

function RadioInputsDisabledSample() {
  const t = useT()
  return (<RadioGroup defaultValue="a" disabled className="flex-row gap-3" aria-label={t('design_system.gallery.sampleCopy.disabledGroup')}>
          <Radio value="a" aria-label={t('design_system.gallery.sampleCopy.selectedDisabled')} />
          <Radio value="b" aria-label={t('design_system.gallery.sampleCopy.unselectedDisabled')} />
        </RadioGroup>)
}

function RadioFieldInputsDefaultSample() {
  const t = useT()
  return (<RadioGroup defaultValue="standard" aria-label={t('design_system.gallery.sampleCopy.shippingSpeed')}>
          <RadioField value="standard" label={t('design_system.gallery.sampleCopy.standard')} />
          <RadioField value="express" label={t('design_system.gallery.sampleCopy.express')} />
        </RadioGroup>)
}

function RadioFieldInputsWithDescriptionSample() {
  const t = useT()
  return (<div className="w-80">
          <RadioGroup defaultValue="invoice" aria-label={t('design_system.gallery.samples.marketing.billing')}>
            <RadioField
              value="invoice"
              label={t('design_system.gallery.sampleCopy.invoice')}
              description={t('design_system.gallery.sampleCopy.payWithin14DaysOfDelivery')}
            />
            <RadioField
              value="prepaid"
              label={t('design_system.gallery.sampleCopy.prepaid')}
              description={t('design_system.gallery.sampleCopy.orderShipsAfterPaymentClears')}
            />
          </RadioGroup>
        </div>)
}

function SwitchInputsStatesSample() {
  const t = useT()
  return (<>
          <Switch aria-label={t('design_system.gallery.sampleCopy.off')} />
          <Switch defaultChecked aria-label={t('design_system.gallery.sampleCopy.on')} />
        </>)
}

function SwitchInputsDisabledSample() {
  const t = useT()
  return (<>
          <Switch disabled aria-label={t('design_system.gallery.sampleCopy.disabledOff')} />
          <Switch disabled defaultChecked aria-label={t('design_system.gallery.sampleCopy.disabledOn')} />
        </>)
}

function SwitchFieldInputsDefaultSample() {
  const t = useT()
  return (<div className="w-72">
          <SwitchField label={t('design_system.gallery.sampleCopy.twofactorAuthentication')} defaultChecked />
        </div>)
}

function SwitchFieldInputsWithDescriptionSample() {
  const t = useT()
  return (<div className="w-80">
          <SwitchField
            label={t('design_system.gallery.sampleCopy.lowstockAlerts')}
            description={t('design_system.gallery.sampleCopy.notifyPurchasingWhenStockDropsBelowTheReorderPoint')}
          />
        </div>)
}

function SwitchFieldInputsFlipSample() {
  const t = useT()
  return (<div className="w-72">
          <SwitchField flip label={t('design_system.gallery.sampleCopy.syncInventoryNightly')} defaultChecked />
        </div>)
}

function SliderInputsSingleSample() {
  const t = useT()
  return (<div className="w-72">
          <Slider defaultValue={[40]} min={0} max={100} step={5} aria-label={t('design_system.gallery.sampleCopy.discount')} />
        </div>)
}

function SliderInputsRangeSample() {
  const t = useT()
  return (<div className="w-72">
          <Slider defaultValue={[20, 60]} min={0} max={100} aria-label={t('design_system.gallery.sampleCopy.priceRange')} />
        </div>)
}

function SliderInputsDisabledSample() {
  const t = useT()
  return (<div className="w-72">
          <Slider defaultValue={[45]} disabled aria-label={t('design_system.gallery.sampleCopy.disabledSlider')} />
        </div>)
}

function FormFieldInputsDefaultSample() {
  const t = useT()
  return (<div className="w-72">
          <FormField label={t('design_system.gallery.sampleCopy.warehouseCode')} description={t('design_system.gallery.sampleCopy.shortIdentifierUsedOnLabels')}>
            <Input placeholder="WAW-01" />
          </FormField>
        </div>)
}

function FormFieldInputsRequiredSample() {
  const t = useT()
  return (<div className="w-72">
          <FormField label={t('design_system.gallery.sampleCopy.companyName')} required>
            <Input placeholder="Acme sp. z o.o." />
          </FormField>
        </div>)
}

function FormFieldInputsHorizontalSample() {
  const t = useT()
  return (<div className="w-72">
          <FormField label={t('design_system.gallery.sampleCopy.enableWebhooks')} orientation="horizontal">
            <Switch defaultChecked />
          </FormField>
        </div>)
}

function DigitInputInputsDefaultSample() {
  const t = useT()
  return (<DigitInput aria-label={t('design_system.gallery.examples.aiProduct.verification')} className="w-full gap-1 sm:w-auto sm:gap-2" cellClassName="min-w-0 w-8 flex-1 sm:w-14 sm:flex-none" />)
}

function DigitInputInputsStatesSample() {
  const t = useT()
  return (<div className="flex flex-col gap-3">
          <DigitInput length={4} value="4921" aria-invalid aria-label={t('design_system.gallery.sampleCopy.invalidCode')} />
          <DigitInput length={4} disabled aria-label={t('design_system.gallery.sampleCopy.disabledCode')} />
        </div>)
}

function ButtonInputInputsCopyLinkSample() {
  const t = useT()
  return (<div className="w-80">
          <ButtonInput
            readOnly
            defaultValue="https://app.example.com/i/8f2c"
            leftIcon={<Link2 />}
            trailingAction={
              <IconButton variant="ghost" aria-label={t('design_system.gallery.sampleCopy.copyLink')}>
                <Copy />
              </IconButton>
            }
          />
        </div>)
}

function ButtonInputInputsSendSample() {
  const t = useT()
  return (<div className="w-80">
          <ButtonInput
            placeholder={t('design_system.gallery.sampleCopy.inviteByEmail')}
            trailingAction={
              <IconButton variant="ghost" aria-label={t('design_system.gallery.sampleCopy.sendInvite')}>
                <Send />
              </IconButton>
            }
          />
        </div>)
}

function TagInputInputsDefaultSample() {
  const t = useT()
  return (<DemoTagInput initial={['wholesale', 'priority', 'eu']} placeholder={t('design_system.gallery.sampleCopy.addTag')} />)
}

function TagInputInputsMaxTagsSample() {
  const t = useT()
  return (<DemoTagInput initial={['red', 'green', 'blue']} maxTags={3} placeholder={t('design_system.gallery.sampleCopy.addTag')} />)
}

function TextareaInputsCharacterCountSample() {
  const t = useT()
  return (<div className="w-80">
          <Textarea
            showCount
            maxLength={200}
            defaultValue={t('design_system.gallery.sampleCopy.customerPrefersDeliveryAfter4PM')}
          />
        </div>)
}

function FormFieldInputsErrorSample() {
  const t = useT()
  return (<div className="w-72">
          <FormField label={t('design_system.gallery.sampleCopy.vatID')} error={t('design_system.gallery.sampleCopy.vatIDMustHave10Digits')}>
            <Input defaultValue="52601" />
          </FormField>
        </div>)
}
