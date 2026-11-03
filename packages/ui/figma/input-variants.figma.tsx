import React from 'react'
import figma from '@figma/code-connect'
import { Input } from '../src/primitives/input'
import { EmailInput } from '../src/primitives/email-input'
import { SearchInput } from '../src/primitives/search-input'
import { PasswordInput } from '../src/primitives/password-input'
import { WebsiteInput } from '../src/primitives/website-input'

// The five existing connections share the actual Text Input set and its Type axis.
// These map the input control; labels/hints need FormField at the call site.
// Form data, focus/hover, custom asset slots and strength meter are not inferred from a design value.

figma.connect(Input, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=266-5251', {
  imports: ["import { Input } from '@open-mercato/ui/primitives/input'"],
  variant: { '🧩 Type': '📂 Basic' },
  props: {
    placeholder: figma.string('✏️ Edit Text'),
    disabled: figma.enum('📌 State', { Placeholder: false, Hover: false, Focus: false, Filled: false, Disabled: true, Error: false }),
    invalid: figma.enum('📌 State', { Placeholder: false, Hover: false, Focus: false, Filled: false, Disabled: false, Error: true }),
    size: figma.enum('📏 Size', { 'Medium (40)': 40, 'Small (36)': 36, 'X-Small (32)': 32 }),
    leftIcon: figma.boolean('⬅️ Left Icon', { true: figma.instance('⬅️ Pick Left'), false: undefined }),
    rightIcon: figma.boolean('➡️ Right Icon', { true: figma.instance('➡️ Pick Right'), false: undefined }),
  },
  example: ({ placeholder, disabled, size, invalid, leftIcon, rightIcon }) => <Input placeholder={placeholder} disabled={disabled} size={size} aria-invalid={invalid} leftIcon={leftIcon} rightIcon={rightIcon} />,
})

figma.connect(EmailInput, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=266-5251', {
  imports: ["import { EmailInput } from '@open-mercato/ui/primitives/email-input'"],
  variant: { '🧩 Type': '💌 Email' },
  props: {
    placeholder: figma.string('✏️ Edit Email'),
    disabled: figma.enum('📌 State', { Placeholder: false, Hover: false, Focus: false, Filled: false, Disabled: true, Error: false }),
    invalid: figma.enum('📌 State', { Placeholder: false, Hover: false, Focus: false, Filled: false, Disabled: false, Error: true }),
    size: figma.enum('📏 Size', { 'Medium (40)': 40, 'Small (36)': 36, 'X-Small (32)': 32 }),
    showIcon: figma.boolean('⬅️ Left Icon'),
  },
  example: ({ placeholder, disabled, size, invalid, showIcon }) => <EmailInput placeholder={placeholder} disabled={disabled} size={size} aria-invalid={invalid} showIcon={showIcon} />,
})

figma.connect(SearchInput, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=266-5251', {
  imports: ["import { SearchInput } from '@open-mercato/ui/primitives/search-input'", "import React from 'react'"],
  variant: { '🧩 Type': '🔍 Search' },
  props: {
    placeholder: figma.string('✏️ Edit Search'),
    disabled: figma.enum('📌 State', { Placeholder: false, Hover: false, Focus: false, Filled: false, Disabled: true, Error: false }),
    invalid: figma.enum('📌 State', { Placeholder: false, Hover: false, Focus: false, Filled: false, Disabled: false, Error: true }),
    size: figma.enum('📏 Size', { 'Medium (40)': 40, 'Small (36)': 36, 'X-Small (32)': 32 }),
  },
  example: ({ placeholder, disabled, size, invalid }) => {
    const [query, setQuery] = React.useState('')
    return <SearchInput placeholder={placeholder} disabled={disabled} size={size} aria-invalid={invalid} value={query} onChange={setQuery} />
  },
})

figma.connect(PasswordInput, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=266-5251', {
  imports: ["import { PasswordInput } from '@open-mercato/ui/primitives/password-input'"],
  variant: { '🧩 Type': '🔒 Password' },
  props: {
    placeholder: figma.string('✏️ Edit Password'),
    disabled: figma.enum('📌 State', { Placeholder: false, Hover: false, Focus: false, Filled: false, Disabled: true, Error: false }),
    invalid: figma.enum('📌 State', { Placeholder: false, Hover: false, Focus: false, Filled: false, Disabled: false, Error: true }),
    size: figma.enum('📏 Size', { 'Medium (40)': 40, 'Small (36)': 36, 'X-Small (32)': 32 }),
    showLockIcon: figma.boolean('⬅️ Left Icon'),
  },
  example: ({ placeholder, disabled, size, invalid, showLockIcon }) => <PasswordInput placeholder={placeholder} disabled={disabled} size={size} aria-invalid={invalid} showLockIcon={showLockIcon} />,
})

figma.connect(WebsiteInput, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=266-5251', {
  imports: ["import { WebsiteInput } from '@open-mercato/ui/primitives/website-input'"],
  variant: { '🧩 Type': '🌐 Website' },
  props: {
    placeholder: figma.string('✏️ Edit Website'),
    disabled: figma.enum('📌 State', { Placeholder: false, Hover: false, Focus: false, Filled: false, Disabled: true, Error: false }),
    invalid: figma.enum('📌 State', { Placeholder: false, Hover: false, Focus: false, Filled: false, Disabled: false, Error: true }),
    size: figma.enum('📏 Size', { 'Medium (40)': 40, 'Small (36)': 36, 'X-Small (32)': 32 }),
  },
  example: ({ placeholder, disabled, size, invalid }) => <WebsiteInput placeholder={placeholder} disabled={disabled} size={size} aria-invalid={invalid} />,
})
