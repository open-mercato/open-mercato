import React from 'react'
import figma from '@figma/code-connect'
import { Input } from '../src/primitives/input'
import { EmailInput } from '../src/primitives/email-input'
import { SearchInput } from '../src/primitives/search-input'
import { PasswordInput } from '../src/primitives/password-input'
import { WebsiteInput } from '../src/primitives/website-input'

// TODO(figma): resolve the real node id in the DS file before ds:code-connect:publish.
figma.connect(Input, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=0-1', {
  imports: ["import { Input } from '@open-mercato/ui/primitives/input'"],
  variant: { Type: 'Text' },
  props: {
    placeholder: figma.string('Placeholder'),
    disabled: figma.boolean('Disabled'),
  },
  example: ({ placeholder, disabled }) => <Input placeholder={placeholder} disabled={disabled} />,
})

figma.connect(EmailInput, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=0-1', {
  imports: ["import { EmailInput } from '@open-mercato/ui/primitives/email-input'"],
  variant: { Type: 'Email' },
  props: {
    placeholder: figma.string('Placeholder'),
    disabled: figma.boolean('Disabled'),
  },
  example: ({ placeholder, disabled }) => <EmailInput placeholder={placeholder} disabled={disabled} />,
})

figma.connect(SearchInput, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=0-1', {
  imports: ["import { SearchInput } from '@open-mercato/ui/primitives/search-input'"],
  variant: { Type: 'Search' },
  props: {
    placeholder: figma.string('Placeholder'),
    disabled: figma.boolean('Disabled'),
  },
  example: ({ placeholder, disabled }) => <SearchInput placeholder={placeholder} disabled={disabled} />,
})

figma.connect(PasswordInput, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=0-1', {
  imports: ["import { PasswordInput } from '@open-mercato/ui/primitives/password-input'"],
  variant: { Type: 'Password' },
  props: {
    placeholder: figma.string('Placeholder'),
    disabled: figma.boolean('Disabled'),
  },
  example: ({ placeholder, disabled }) => <PasswordInput placeholder={placeholder} disabled={disabled} />,
})

figma.connect(WebsiteInput, 'https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/Design-System?node-id=0-1', {
  imports: ["import { WebsiteInput } from '@open-mercato/ui/primitives/website-input'"],
  variant: { Type: 'Website' },
  props: {
    placeholder: figma.string('Placeholder'),
    disabled: figma.boolean('Disabled'),
  },
  example: ({ placeholder, disabled }) => <WebsiteInput placeholder={placeholder} disabled={disabled} />,
})
