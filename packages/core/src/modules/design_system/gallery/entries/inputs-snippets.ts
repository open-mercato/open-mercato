// Copy-paste snippets for the Inputs family. The previews render full source matrices from
// ../demos; the snippet shows the smallest self-contained usage a developer can paste into a
// module: real imports, literal sample text, no gallery helpers, assets or translation keys.

const SPECIALISED_INPUTS_NOTE = `// Email, phone, card, website, amount, search and password have dedicated primitives:
// EmailInput, PhoneNumberField, CardInput, WebsiteInput, AmountInput, SearchInput, PasswordInput.`

export function inputFieldCode({ inputProps = '', fieldProps = '' }: { inputProps?: string; fieldProps?: string } = {}): string {
  return `import { User } from 'lucide-react'
import { Input } from '@open-mercato/ui/primitives/input'
import { FormField } from '@open-mercato/ui/primitives/form-field'

<FormField label="Full name" description="Shown on invoices"${fieldProps}>
  <Input${inputProps} leftIcon={<User />} placeholder="Alex Morgan" />
</FormField>

${SPECIALISED_INPUTS_NOTE}`
}

export const textareaFieldCode = `import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { FormField } from '@open-mercato/ui/primitives/form-field'

<FormField label="Note" description="Visible to your team">
  <Textarea appearance="source" showCount maxLength={200} placeholder="Add a note" />
</FormField>

// States: pass error="..." or disabled to FormField, and disabled to Textarea.`

export function phoneNumberFieldCode(extraProps = ''): string {
  return `import * as React from 'react'
import { PhoneNumberField, type PhoneCountry } from '@open-mercato/ui/backend/inputs/PhoneNumberField'

const countries: PhoneCountry[] = [
  { iso2: 'US', dialCode: '+1', label: 'United States', flag: '🇺🇸' },
  { iso2: 'PL', dialCode: '+48', label: 'Poland', flag: '🇵🇱' },
]

function PhoneExample() {
  const [phone, setPhone] = React.useState<string | undefined>()
  return (
    <PhoneNumberField size={36} ariaLabel="Phone number" countryLabel="Country"
      value={phone} onValueChange={setPhone} countries={countries}${extraProps} />
  )
}`
}

export function selectFieldCode({ size = 36, leading = false, selectProps = '', fieldProps = '', initialValue = 'warsaw' }: {
  size?: 32 | 36 | 40
  leading?: boolean
  selectProps?: string
  fieldProps?: string
  initialValue?: string
} = {}): string {
  const leadingImport = leading ? `import { Building2 } from 'lucide-react'\n` : ''
  const triggerImports = leading ? 'Select, SelectContent, SelectItem, SelectTrigger, SelectTriggerLeading, SelectValue' : 'Select, SelectContent, SelectItem, SelectTrigger, SelectValue'
  const triggerLeading = leading ? `\n          <SelectTriggerLeading><Building2 aria-hidden="true" className="size-5" /></SelectTriggerLeading>` : ''
  const itemLeading = leading ? ` leading={<Building2 aria-hidden="true" className="size-5" />}` : ''
  return `import * as React from 'react'
${leadingImport}import { FormField } from '@open-mercato/ui/primitives/form-field'
import { ${triggerImports} } from '@open-mercato/ui/primitives/select'

function SelectExample() {
  const [value, setValue] = React.useState('${initialValue}')
  return (
    <Select value={value} onValueChange={setValue}${selectProps}>
      <FormField label="Office" description="You can change it later"${fieldProps}>
        <SelectTrigger size={${size}}>${triggerLeading}
          <SelectValue placeholder="Choose an office" />
        </SelectTrigger>
      </FormField>
      <SelectContent>
        <SelectItem value="warsaw"${itemLeading}>Warsaw</SelectItem>
        <SelectItem value="berlin"${itemLeading}>Berlin</SelectItem>
        <SelectItem value="archive" disabled${itemLeading}>Archive</SelectItem>
      </SelectContent>
    </Select>
  )
}`
}

export function dropdownCode({ size = 36, initialQuery = '' }: { size?: 36 | 56; initialQuery?: string } = {}): string {
  const description = size === 56 ? ` description="12 members"` : ''
  return `import * as React from 'react'
import { Building2, Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dropdown, DropdownTrigger, DropdownContent, DropdownInput, DropdownList, DropdownEmpty, DropdownItem, DropdownFooter } from '@open-mercato/ui/primitives/dropdown'

const workspaces = ['Warsaw', 'Berlin', 'Lisbon']

function DropdownExample() {
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState('Warsaw')
  const [query, setQuery] = React.useState('${initialQuery}')
  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild><Button variant="outline">{value}</Button></DropdownTrigger>
      <DropdownContent className="w-96 max-w-full" aria-label="Choose a workspace" commandProps={{ label: 'Workspaces' }}>
        <DropdownInput value={query} onValueChange={setQuery} aria-label="Search workspaces" placeholder="Search workspaces" />
        <DropdownList>
          <DropdownEmpty>No workspaces match your search</DropdownEmpty>
          {workspaces.map((workspace) => (
            <DropdownItem key={workspace} value={workspace} size={${size}} checked={value === workspace}${description}
              leading={<Building2 aria-hidden="true" className="size-5" />}
              onSelect={() => { setValue(workspace); setOpen(false) }}>
              {workspace}
            </DropdownItem>
          ))}
        </DropdownList>
        <DropdownFooter>
          <Button variant="outline" size="sm" className="w-full"><Plus className="size-5" />Add workspace</Button>
        </DropdownFooter>
      </DropdownContent>
    </Dropdown>
  )
}`
}

export function fieldLabelCode(labelProps = '', imports = ''): string {
  return `import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { Input } from '@open-mercato/ui/primitives/input'
${imports}
<FieldLabel htmlFor="company-name"${labelProps}>Company name</FieldLabel>
<Input id="company-name" />`
}

export const fieldLabelInformationCode = fieldLabelCode(
  `\n  information={<SimpleTooltip content="Used on invoices and quotes"><CompactButton size={20} appearance="ghost" aria-label="More information"><KeyIconGlyph name="labelInformation" /></CompactButton></SimpleTooltip>}`,
  `import { CompactButton } from '@open-mercato/ui/primitives/compact-button'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { KeyIconGlyph } from '@open-mercato/ui/primitives/key-icon'
`,
)

export const fieldLabelActionCode = fieldLabelCode(
  `\n  action={<LinkButton type="button" size="sm" variant="gray" onClick={openHelp}>Help</LinkButton>}`,
  `import { LinkButton } from '@open-mercato/ui/primitives/link-button'
`,
)

export const formFieldLabelCode = `import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'

// FormField renders FieldLabel for you: sourceLabel switches to the source layout.
<FormField sourceLabel label="Company name" labelSublabel="(optional)" description="Used on invoices and quotes">
  <Input />
</FormField>`

export function hintTextCode({ state, icon = true }: { state?: 'error' | 'disabled'; icon?: boolean } = {}): string {
  const stateProp = state ? ` state="${state}"` : ''
  const iconImport = icon ? `import { KeyIconGlyph } from '@open-mercato/ui/primitives/key-icon'\n` : ''
  const leading = icon ? ` leading={<KeyIconGlyph name="information" />}` : ''
  return `import { HintText } from '@open-mercato/ui/primitives/hint-text'
${iconImport}
<HintText${stateProp}${leading}>Used on invoices and quotes</HintText>`
}
