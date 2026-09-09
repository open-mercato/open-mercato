import * as React from 'react'
import { Copy, Globe, Info, Link2, Send, User } from 'lucide-react'
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
import { Slider } from '@open-mercato/ui/primitives/slider'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { EmailInput } from '@open-mercato/ui/primitives/email-input'
import { PasswordInput } from '@open-mercato/ui/primitives/password-input'
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
import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { GalleryEntry } from '../types'

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
  const [value, setValue] = React.useState('open orders')
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
}: {
  allowCustom?: boolean
  swatches?: readonly string[]
}) {
  const [color, setColor] = React.useState('#6366F1')
  return (
    <ColorPicker
      value={color}
      onChange={setColor}
      allowCustom={allowCustom}
      swatches={swatches}
      aria-label="Pick color"
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

function DemoRichEditor({ variant }: { variant: 'minimal' | 'standard' }) {
  const [html, setHtml] = React.useState(
    '<p>Ship the <strong>Q3 release notes</strong> before Friday.</p>',
  )
  return (
    <div className="w-full max-w-xl">
      <RichEditor value={html} onChange={setHtml} variant={variant} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

const inputEntry: GalleryEntry = {
  id: 'input',
  title: 'Input',
  importPath: '@open-mercato/ui/primitives/input',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <div className="w-72">
          <Input placeholder="Product name" />
        </div>
      ),
      code: `import { Input } from '@open-mercato/ui/primitives/input'

<Input placeholder="Product name" />`,
    },
    {
      id: 'icon-slots',
      title: 'Icon slots',
      render: () => (
        <>
          <div className="w-56">
            <Input leftIcon={<User />} placeholder="Assignee" />
          </div>
          <div className="w-56">
            <Input rightIcon={<Info />} placeholder="SKU" />
          </div>
        </>
      ),
      code: `import { Info, User } from 'lucide-react'
import { Input } from '@open-mercato/ui/primitives/input'

<Input leftIcon={<User />} placeholder="Assignee" />
<Input rightIcon={<Info />} placeholder="SKU" />`,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      render: () => (
        <>
          <div className="w-44">
            <Input size="lg" placeholder="Large" />
          </div>
          <div className="w-44">
            <Input size="default" placeholder="Default" />
          </div>
          <div className="w-44">
            <Input size="sm" placeholder="Small" />
          </div>
        </>
      ),
      code: `import { Input } from '@open-mercato/ui/primitives/input'

<Input size="lg" placeholder="Large" />
<Input size="default" placeholder="Default" />
<Input size="sm" placeholder="Small" />`,
    },
    {
      id: 'states',
      title: 'States',
      render: () => (
        <>
          <div className="w-56">
            <Input aria-invalid defaultValue="not-a-number" />
          </div>
          <div className="w-56">
            <Input disabled placeholder="Disabled" />
          </div>
        </>
      ),
      code: `import { Input } from '@open-mercato/ui/primitives/input'

<Input aria-invalid defaultValue="not-a-number" />
<Input disabled placeholder="Disabled" />`,
    },
  ],
}

const textareaEntry: GalleryEntry = {
  id: 'textarea',
  title: 'Textarea',
  importPath: '@open-mercato/ui/primitives/textarea',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <div className="w-80">
          <Textarea placeholder="Internal note for the fulfillment team" />
        </div>
      ),
      code: `import { Textarea } from '@open-mercato/ui/primitives/textarea'

<Textarea placeholder="Internal note for the fulfillment team" />`,
    },
    {
      id: 'character-count',
      title: 'Character counter',
      render: () => (
        <div className="w-80">
          <Textarea
            showCount
            maxLength={200}
            defaultValue="Customer prefers delivery after 4 PM."
          />
        </div>
      ),
      code: `import { Textarea } from '@open-mercato/ui/primitives/textarea'

<Textarea showCount maxLength={200} defaultValue="Customer prefers delivery after 4 PM." />`,
    },
    {
      id: 'states',
      title: 'States',
      render: () => (
        <>
          <div className="w-72">
            <Textarea aria-invalid defaultValue="Too short" />
          </div>
          <div className="w-72">
            <Textarea disabled placeholder="Disabled" />
          </div>
        </>
      ),
      code: `import { Textarea } from '@open-mercato/ui/primitives/textarea'

<Textarea aria-invalid defaultValue="Too short" />
<Textarea disabled placeholder="Disabled" />`,
    },
  ],
}

const selectEntry: GalleryEntry = {
  id: 'select',
  title: 'Select',
  importPath: '@open-mercato/ui/primitives/select',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <div className="w-56">
          <Select defaultValue="pln">
            <SelectTrigger>
              <SelectValue placeholder="Choose currency" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="eur">Euro (EUR)</SelectItem>
              <SelectItem value="pln">Polish Złoty (PLN)</SelectItem>
              <SelectItem value="usd">US Dollar (USD)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ),
      code: `import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'

<Select defaultValue="pln">
  <SelectTrigger>
    <SelectValue placeholder="Choose currency" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="eur">Euro (EUR)</SelectItem>
    <SelectItem value="pln">Polish Złoty (PLN)</SelectItem>
    <SelectItem value="usd">US Dollar (USD)</SelectItem>
  </SelectContent>
</Select>`,
    },
    {
      id: 'groups-leading',
      title: 'Groups + leading slot',
      render: () => (
        <div className="w-56">
          <Select>
            <SelectTrigger>
              <SelectTriggerLeading>
                <Globe />
              </SelectTriggerLeading>
              <SelectValue placeholder="Sales channel" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Online</SelectLabel>
                <SelectItem value="webstore">Webstore</SelectItem>
                <SelectItem value="marketplace">Marketplace</SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Offline</SelectLabel>
                <SelectItem value="retail">Retail store</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      ),
      code: `import { Globe } from 'lucide-react'
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

<Select>
  <SelectTrigger>
    <SelectTriggerLeading><Globe /></SelectTriggerLeading>
    <SelectValue placeholder="Sales channel" />
  </SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectLabel>Online</SelectLabel>
      <SelectItem value="webstore">Webstore</SelectItem>
      <SelectItem value="marketplace">Marketplace</SelectItem>
    </SelectGroup>
    <SelectSeparator />
    <SelectGroup>
      <SelectLabel>Offline</SelectLabel>
      <SelectItem value="retail">Retail store</SelectItem>
    </SelectGroup>
  </SelectContent>
</Select>`,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      render: () => (
        <>
          {(['lg', 'default', 'sm', 'xs'] as const).map((size) => (
            <div key={size} className="w-40">
              <Select defaultValue="active">
                <SelectTrigger size={size}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </>
      ),
      code: `import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'

<SelectTrigger size="lg" />
<SelectTrigger size="default" />
<SelectTrigger size="sm" />
<SelectTrigger size="xs" />`,
    },
    {
      id: 'states',
      title: 'States',
      render: () => (
        <>
          <div className="w-48">
            <Select>
              <SelectTrigger aria-invalid="true">
                <SelectValue placeholder="Required" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a">Option A</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-48">
            <Select>
              <SelectTrigger disabled>
                <SelectValue placeholder="Disabled" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a">Option A</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      ),
      code: `import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'

<SelectTrigger aria-invalid="true"><SelectValue placeholder="Required" /></SelectTrigger>
<SelectTrigger disabled><SelectValue placeholder="Disabled" /></SelectTrigger>`,
    },
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
      render: () => (
        <div className="w-44">
          <Select defaultValue="newest">
            <CompactSelectTrigger triggerLabel="Sort:">
              <SelectValue />
            </CompactSelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
              <SelectItem value="value">Highest value</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ),
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
      render: () => (
        <div className="w-36">
          <Select defaultValue="table">
            <CompactSelectTrigger>
              <SelectValue />
            </CompactSelectTrigger>
            <SelectContent>
              <SelectItem value="table">Table</SelectItem>
              <SelectItem value="board">Board</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ),
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
      render: () => (
        <div className="w-40">
          <Select defaultValue="high">
            <InlineSelectTrigger>
              <SelectValue />
            </InlineSelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ),
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
      render: () => (
        <div className="w-40">
          <Select defaultValue="draft">
            <InlineSelectTrigger showBorderOnHover={false}>
              <SelectValue />
            </InlineSelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ),
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
      render: () => (
        <div className="w-56">
          <InlineInput defaultValue="Aurora desk lamp" aria-label="Product name" />
        </div>
      ),
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
      render: () => (
        <>
          <Checkbox aria-label="Unchecked" />
          <Checkbox defaultChecked aria-label="Checked" />
          <Checkbox checked="indeterminate" aria-label="Indeterminate" />
        </>
      ),
      code: `import { Checkbox } from '@open-mercato/ui/primitives/checkbox'

<Checkbox />
<Checkbox defaultChecked />
<Checkbox checked="indeterminate" />`,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      render: () => (
        <>
          <Checkbox size="sm" defaultChecked aria-label="Small" />
          <Checkbox size="md" defaultChecked aria-label="Medium" />
        </>
      ),
      code: `import { Checkbox } from '@open-mercato/ui/primitives/checkbox'

<Checkbox size="sm" defaultChecked />
<Checkbox size="md" defaultChecked />`,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      render: () => (
        <>
          <Checkbox disabled aria-label="Disabled" />
          <Checkbox disabled defaultChecked aria-label="Disabled checked" />
        </>
      ),
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
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <CheckboxField label="Email notifications" defaultChecked />
      ),
      code: `import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'

<CheckboxField label="Email notifications" defaultChecked />`,
    },
    {
      id: 'with-description',
      title: 'With sublabel + description',
      render: () => (
        <div className="w-80">
          <CheckboxField
            label="Auto-archive"
            sublabel="(recommended)"
            description="Closed conversations move to the archive after 30 days."
          />
        </div>
      ),
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
      render: () => (
        <div className="w-72">
          <CheckboxField flip label="Include shipping costs" defaultChecked />
        </div>
      ),
      code: `import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'

<CheckboxField flip label="Include shipping costs" defaultChecked />`,
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
      render: () => (
        <RadioGroup defaultValue="card" className="flex-row gap-3" aria-label="Payment method">
          <Radio value="card" aria-label="Card" />
          <Radio value="transfer" aria-label="Bank transfer" />
          <Radio value="cash" aria-label="Cash" />
        </RadioGroup>
      ),
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
      render: () => (
        <RadioGroup defaultValue="a" disabled className="flex-row gap-3" aria-label="Disabled group">
          <Radio value="a" aria-label="Selected disabled" />
          <Radio value="b" aria-label="Unselected disabled" />
        </RadioGroup>
      ),
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
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <RadioGroup defaultValue="standard" aria-label="Shipping speed">
          <RadioField value="standard" label="Standard" />
          <RadioField value="express" label="Express" />
        </RadioGroup>
      ),
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
      render: () => (
        <div className="w-80">
          <RadioGroup defaultValue="invoice" aria-label="Billing">
            <RadioField
              value="invoice"
              label="Invoice"
              description="Pay within 14 days of delivery."
            />
            <RadioField
              value="prepaid"
              label="Prepaid"
              description="Order ships after payment clears."
            />
          </RadioGroup>
        </div>
      ),
      code: `import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'

<RadioGroup defaultValue="invoice" aria-label="Billing">
  <RadioField value="invoice" label="Invoice" description="Pay within 14 days of delivery." />
  <RadioField value="prepaid" label="Prepaid" description="Order ships after payment clears." />
</RadioGroup>`,
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
      render: () => (
        <>
          <Switch aria-label="Off" />
          <Switch defaultChecked aria-label="On" />
        </>
      ),
      code: `import { Switch } from '@open-mercato/ui/primitives/switch'

<Switch />
<Switch defaultChecked />`,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      render: () => (
        <>
          <Switch disabled aria-label="Disabled off" />
          <Switch disabled defaultChecked aria-label="Disabled on" />
        </>
      ),
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
  variants: [
    {
      id: 'default',
      title: 'default (switch right)',
      render: () => (
        <div className="w-72">
          <SwitchField label="Two-factor authentication" defaultChecked />
        </div>
      ),
      code: `import { SwitchField } from '@open-mercato/ui/primitives/switch-field'

<SwitchField label="Two-factor authentication" defaultChecked />`,
    },
    {
      id: 'with-description',
      title: 'With description',
      render: () => (
        <div className="w-80">
          <SwitchField
            label="Low-stock alerts"
            description="Notify purchasing when stock drops below the reorder point."
          />
        </div>
      ),
      code: `import { SwitchField } from '@open-mercato/ui/primitives/switch-field'

<SwitchField
  label="Low-stock alerts"
  description="Notify purchasing when stock drops below the reorder point."
/>`,
    },
    {
      id: 'flip',
      title: 'Flipped (switch left)',
      render: () => (
        <div className="w-72">
          <SwitchField flip label="Sync inventory nightly" defaultChecked />
        </div>
      ),
      code: `import { SwitchField } from '@open-mercato/ui/primitives/switch-field'

<SwitchField flip label="Sync inventory nightly" defaultChecked />`,
    },
  ],
}

const sliderEntry: GalleryEntry = {
  id: 'slider',
  title: 'Slider',
  importPath: '@open-mercato/ui/primitives/slider',
  variants: [
    {
      id: 'single',
      title: 'Single value',
      render: () => (
        <div className="w-72">
          <Slider defaultValue={[40]} min={0} max={100} step={5} aria-label="Discount" />
        </div>
      ),
      code: `import { Slider } from '@open-mercato/ui/primitives/slider'

<Slider defaultValue={[40]} min={0} max={100} step={5} aria-label="Discount" />`,
    },
    {
      id: 'range',
      title: 'Range (two thumbs)',
      render: () => (
        <div className="w-72">
          <Slider defaultValue={[20, 60]} min={0} max={100} aria-label="Price range" />
        </div>
      ),
      code: `import { Slider } from '@open-mercato/ui/primitives/slider'

<Slider defaultValue={[20, 60]} min={0} max={100} aria-label="Price range" />`,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      render: () => (
        <div className="w-72">
          <Slider defaultValue={[45]} disabled aria-label="Disabled slider" />
        </div>
      ),
      code: `import { Slider } from '@open-mercato/ui/primitives/slider'

<Slider defaultValue={[45]} disabled />`,
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
      render: () => (
        <div className="w-72">
          <FormField label="Warehouse code" description="Short identifier used on labels.">
            <Input placeholder="WAW-01" />
          </FormField>
        </div>
      ),
      code: `import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'

<FormField label="Warehouse code" description="Short identifier used on labels.">
  <Input placeholder="WAW-01" />
</FormField>`,
    },
    {
      id: 'required',
      title: 'Required',
      render: () => (
        <div className="w-72">
          <FormField label="Company name" required>
            <Input placeholder="Acme sp. z o.o." />
          </FormField>
        </div>
      ),
      code: `import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'

<FormField label="Company name" required>
  <Input placeholder="Acme sp. z o.o." />
</FormField>`,
    },
    {
      id: 'error',
      title: 'Error',
      render: () => (
        <div className="w-72">
          <FormField label="VAT ID" error="VAT ID must have 10 digits.">
            <Input defaultValue="52601" />
          </FormField>
        </div>
      ),
      code: `import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'

<FormField label="VAT ID" error="VAT ID must have 10 digits.">
  <Input defaultValue="52601" />
</FormField>`,
    },
    {
      id: 'horizontal',
      title: 'Horizontal',
      render: () => (
        <div className="w-72">
          <FormField label="Enable webhooks" orientation="horizontal">
            <Switch defaultChecked />
          </FormField>
        </div>
      ),
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
      render: () => <DigitInput aria-label="Verification code" />,
      code: `import { DigitInput } from '@open-mercato/ui/primitives/digit-input'

<DigitInput onComplete={(code) => verify(code)} />`,
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
      render: () => (
        <div className="flex flex-col gap-3">
          <DigitInput length={4} value="4921" aria-invalid aria-label="Invalid code" />
          <DigitInput length={4} disabled aria-label="Disabled code" />
        </div>
      ),
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
      render: () => (
        <div className="w-80">
          <ButtonInput
            readOnly
            defaultValue="https://app.example.com/i/8f2c"
            leftIcon={<Link2 />}
            trailingAction={
              <IconButton variant="ghost" aria-label="Copy link">
                <Copy />
              </IconButton>
            }
          />
        </div>
      ),
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
      render: () => (
        <div className="w-80">
          <ButtonInput
            placeholder="Invite by email"
            trailingAction={
              <IconButton variant="ghost" aria-label="Send invite">
                <Send />
              </IconButton>
            }
          />
        </div>
      ),
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
  variants: [
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
      render: () => (
        <DemoTagInput initial={['wholesale', 'priority', 'eu']} placeholder="Add tag" />
      ),
      code: `import { TagInput } from '@open-mercato/ui/primitives/tag-input'

const [tags, setTags] = React.useState<string[]>(['wholesale', 'priority', 'eu'])

<TagInput value={tags} onChange={setTags} placeholder="Add tag" />`,
    },
    {
      id: 'max-tags',
      title: 'Max tags reached',
      render: () => (
        <DemoTagInput initial={['red', 'green', 'blue']} maxTags={3} placeholder="Add tag" />
      ),
      code: `import { TagInput } from '@open-mercato/ui/primitives/tag-input'

<TagInput value={tags} onChange={setTags} maxTags={3} />`,
    },
  ],
}

const richEditorEntry: GalleryEntry = {
  id: 'rich-editor',
  title: 'RichEditor',
  importPath: '@open-mercato/ui/primitives/rich-editor',
  variants: [
    {
      id: 'minimal',
      title: 'minimal',
      render: () => <DemoRichEditor variant="minimal" />,
      code: `import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'

const [html, setHtml] = React.useState('')

<RichEditor value={html} onChange={setHtml} variant="minimal" />`,
    },
    {
      id: 'standard',
      title: 'standard',
      render: () => <DemoRichEditor variant="standard" />,
      code: `import { RichEditor } from '@open-mercato/ui/primitives/rich-editor'

<RichEditor value={html} onChange={setHtml} variant="standard" />`,
    },
  ],
}

export const entries: GalleryEntry[] = [
  inputEntry,
  textareaEntry,
  selectEntry,
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
