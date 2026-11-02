import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import type { GalleryEntry } from '../types'
import { SocialButtonsDemo, CompactButtonMatrix, CompactButtonDisabledPreview, ButtonGroupMatrix, ButtonStatePreview, PrimaryButtonPreview, DisabledIconButtonPreview, ButtonButtonsDefaultSample, ButtonButtonsDestructiveSample, ButtonButtonsDestructiveOutlineSample, ButtonButtonsDestructiveSoftSample, ButtonButtonsDestructiveGhostSample, ButtonButtonsOutlineSample, ButtonButtonsSecondarySample, ButtonButtonsGhostSample, ButtonButtonsMutedSample, ButtonButtonsLinkSample, ButtonButtonsSizesSample, IconButtonButtonsVariantsSample, IconButtonButtonsSizesSample, IconButtonButtonsFullRadiusSample, LinkButtonButtonsAsAnchorSample, FancyButtonButtonsIntentsSample, FancyButtonButtonsSizesSample, ButtonGroupButtonsHorizontalSample, ButtonGroupButtonsVerticalSample } from '../demos/buttons'
import {
  compactButtonDefaultCode,
  compactButtonActiveCode,
  compactButtonDisabledCode,
  iconButtonVariantsCode,
  iconButtonSizesCode,
  iconButtonFullRadiusCode,
  iconButtonDisabledCode,
  linkButtonVariantsCode,
  linkButtonUnderlineCode,
  linkButtonAsAnchorCode,
  socialButtonFilledCode,
  socialButtonStrokeCode,
  socialButtonIconOnlyCode,
  fancyButtonIntentsCode,
  fancyButtonSizesCode,
  buttonGroupSizeQuantityMatrixCode,
  buttonGroupItemContentCode,
  buttonGroupHorizontalCode,
  buttonGroupVerticalCode,
} from './buttons-snippets'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

const buttonEntry: GalleryEntry = {
  id: 'button',
  title: 'Button',
  importPath: '@open-mercato/ui/primitives/button',
  figmaNodeId: '129:1422',
  usage: {
    do: [
      'One default (primary) Button per view; remaining actions step down to outline, ghost or muted.',
      'Destructive actions use the destructive family; -outline/-soft/-ghost lower the emphasis without losing the semantics.',
      'Default height is h-9; sm (h-8) in dense toolbars, 2xs only inside table rows.',
      'primary-filled represents the indigo CTA retained in overlay instance 472:831, using the darker status-info-solid role for readable white text in both themes. The current main Button set lists Neutral and Error only; this instance is not a new Code Connect axis.',
      'For a pending action, compose Spinner with disabled and aria-busy; Button has no loading prop.',
    ],
    dont: [
      'Never Button size="icon" for icon-only actions — use IconButton (correct sizing + aria-label contract).',
      'Never style a raw <button> or <Link> to look like a Button.',
      'The link variant is for navigation-like actions, not for mutations.',
    ],
  },
  descriptionKey: 'design_system.entries.button.description',
  variants: [
    {
      id: 'primary-filled',
      title: 'Primary Filled (overlay CTA)',
      render: () => <PrimaryButtonPreview />,
      code: `import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'

function PrimaryAction() {
  const t = useT()
  return <Button type="button" variant="primary-filled">{t('design_system.gallery.samples.primaryAction')}</Button>
}`,
    },
    {
      id: 'default',
      title: 'default',
      render: () => <ButtonButtonsDefaultSample />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button>Save changes</Button>`,
    },
    {
      id: 'destructive',
      title: 'destructive',
      render: () => <ButtonButtonsDestructiveSample />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="destructive">Delete</Button>`,
    },
    {
      id: 'destructive-outline',
      title: 'destructive-outline',
      render: () => <ButtonButtonsDestructiveOutlineSample />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="destructive-outline">Delete</Button>`,
    },
    {
      id: 'destructive-soft',
      title: 'destructive-soft',
      render: () => <ButtonButtonsDestructiveSoftSample />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="destructive-soft">Delete draft</Button>`,
    },
    {
      id: 'destructive-ghost',
      title: 'destructive-ghost',
      render: () => <ButtonButtonsDestructiveGhostSample />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="destructive-ghost">Remove</Button>`,
    },
    {
      id: 'outline',
      title: 'outline',
      render: () => <ButtonButtonsOutlineSample />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="outline">Cancel</Button>`,
    },
    {
      id: 'secondary',
      title: 'secondary',
      render: () => <ButtonButtonsSecondarySample />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="secondary">Duplicate</Button>`,
    },
    {
      id: 'ghost',
      title: 'ghost',
      render: () => <ButtonButtonsGhostSample />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="ghost">Dismiss</Button>`,
    },
    {
      id: 'muted',
      title: 'muted',
      render: () => <ButtonButtonsMutedSample />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="muted">Show more</Button>`,
    },
    {
      id: 'link',
      title: 'link',
      render: () => <ButtonButtonsLinkSample />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button variant="link">View details</Button>`,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      render: () => <ButtonButtonsSizesSample />,
      code: `import { Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'

<Button size="lg">Large</Button>
<Button size="default">Default</Button>
<Button size="sm">Small</Button>
<Button size="2xs">2X-Small</Button>
<Button size="icon" aria-label="Add"><Plus /></Button>`,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      render: () => <ButtonStatePreview />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button type="button" disabled>{t('design_system.gallery.samples.primaryAction')}</Button>`,
    },
    {
      id: 'loading',
      title: 'Loading (composed)',
      render: () => <ButtonStatePreview loading />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

<Button type="button" disabled aria-busy>
  <Spinner size="sm" className="motion-reduce:animate-none" />
  {t('design_system.gallery.samples.states.saving')}
</Button>`,
    },
  ],
}

const compactButtonEntry: GalleryEntry = {
  id: 'compact-button',
  title: 'CompactButton',
  importPath: '@open-mercato/ui/primitives/compact-button',
  figmaNodeId: '189:3646',
  descriptionKey: 'design_system.entries.compactButton.description',
  usage: { do: [
    'Compact icon actions at 20 or 24 px with 18 or 20 px icons. Four appearances support 6 px and full-radius shapes.',
    'Each matrix exposes every size, appearance, and radius combination. Hover and press enabled buttons; active examples are controlled toggles and disabled examples use native disabled.',
    'Supply an accessible name and enough space around dense actions. Modifiable inherits foreground; its hover surface uses the existing 15% opacity scale rather than the source 16%.',
  ] },
  variants: [
    { id: 'default', title: 'All sizes, appearances, and radii', render: () => <CompactButtonMatrix />, code: compactButtonDefaultCode },
    { id: 'active', title: 'Active toggles', render: () => <CompactButtonMatrix initialPressed />, code: compactButtonActiveCode },
    { id: 'disabled', title: 'Disabled', render: () => <CompactButtonDisabledPreview />, code: compactButtonDisabledCode },
  ],
}

const iconButtonEntry: GalleryEntry = {
  id: 'icon-button',
  title: 'IconButton',
  importPath: '@open-mercato/ui/primitives/icon-button',
  usage: {
    do: [
      'Always pass aria-label — the icon is the only content.',
      'size="default" is h-8, one step smaller than Button; use size="lg" (h-9) to align inside a Button row.',
    ],
    dont: ['Never fake it with Button size="icon".'],
  },
  descriptionKey: 'design_system.entries.iconButton.description',
  variants: [
    {
      id: 'variants',
      title: 'Variants',
      render: () => <IconButtonButtonsVariantsSample />,
      code: iconButtonVariantsCode,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      render: () => <IconButtonButtonsSizesSample />,
      code: iconButtonSizesCode,
    },
    {
      id: 'full-radius',
      title: 'fullRadius',
      render: () => <IconButtonButtonsFullRadiusSample />,
      code: iconButtonFullRadiusCode,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      render: () => <DisabledIconButtonPreview />,
      code: iconButtonDisabledCode,
    },
  ],
}

const linkButtonEntry: GalleryEntry = {
  id: 'link-button',
  title: 'LinkButton',
  importPath: '@open-mercato/ui/primitives/link-button',
  descriptionKey: 'design_system.entries.linkButton.description',
  variants: [
    {
      id: 'variants',
      title: 'Variants',
      render: () => (
        <>
          <LinkButton>primary</LinkButton>
          <LinkButton variant="gray">gray</LinkButton>
          <LinkButton variant="black">black</LinkButton>
          <LinkButton variant="error">error</LinkButton>
        </>
      ),
      code: linkButtonVariantsCode,
    },
    {
      id: 'underline',
      title: 'Underline',
      render: () => (
        <>
          <LinkButton underline="always">always</LinkButton>
          <LinkButton underline="hover">hover</LinkButton>
          <LinkButton underline="none">none</LinkButton>
        </>
      ),
      code: linkButtonUnderlineCode,
    },
    {
      id: 'as-anchor',
      title: 'As anchor (asChild)',
      render: () => <LinkButtonButtonsAsAnchorSample />,
      code: linkButtonAsAnchorCode,
    },
  ],
}

const socialButtonEntry: GalleryEntry = {
  id: 'social-button',
  title: 'SocialButton',
  importPath: '@open-mercato/ui/primitives/social-button',
  figmaNodeId: '180:4264',
  descriptionKey: 'design_system.entries.socialButton.description',
  usage: { do: [
    'All seven source providers appear in Filled and Stroke, with text or icon-only content. Buttons are 40 px high; icon-only buttons are 40 px square.',
    'Supply the logo as content and an accessible name for icon-only buttons. These local source assets do not invoke authentication.',
    'Stroke uses semantic foreground and border tokens; monochrome logos follow foreground in both themes. Native hover and keyboard focus expose the interaction states.',
  ] },
  variants: [
    { id: 'filled', title: 'Filled — all seven providers', render: () => <SocialButtonsDemo appearance="filled" />, code: socialButtonFilledCode },
    { id: 'stroke', title: 'Stroke — all seven providers', render: () => <SocialButtonsDemo appearance="stroke" />, code: socialButtonStrokeCode },
    { id: 'icon-only', title: 'Icon-only — both appearances', render: () => <div className="grid gap-4"><SocialButtonsDemo appearance="filled" iconOnly /><SocialButtonsDemo appearance="stroke" iconOnly /></div>, code: socialButtonIconOnlyCode },
  ],
}

const fancyButtonEntry: GalleryEntry = {
  id: 'fancy-button',
  title: 'FancyButton',
  importPath: '@open-mercato/ui/primitives/fancy-button',
  descriptionKey: 'design_system.entries.fancyButton.description',
  variants: [
    {
      id: 'intents',
      title: 'Intents',
      render: () => <FancyButtonButtonsIntentsSample />,
      code: fancyButtonIntentsCode,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      render: () => <FancyButtonButtonsSizesSample />,
      code: fancyButtonSizesCode,
    },
  ],
}

const buttonGroupEntry: GalleryEntry = {
  id: 'button-group',
  title: 'ButtonGroup',
  importPath: '@open-mercato/ui/primitives/button-group',
  descriptionKey: 'design_system.entries.buttonGroup.description',
  figmaNodeId: '493:8644',
  usage: { do: ['Numeric sizes coordinate child dimensions at 24, 32, or 36 px. Legacy size names keep their behavior.', 'The 15 source groups cover quantities two through six at all three sizes. Item examples include text, leading, trailing, both, and icon-only content.'] },
  variants: [
    { id: 'size-quantity-matrix', title: 'All 15 size and quantity combinations', render: () => <ButtonGroupMatrix />, code: buttonGroupSizeQuantityMatrixCode },
    { id: 'item-content', title: 'Text and icon item arrangements', render: () => <ButtonGroupMatrix content />, code: buttonGroupItemContentCode },
    {
      id: 'horizontal',
      title: 'Horizontal',
      render: () => <ButtonGroupButtonsHorizontalSample />,
      code: buttonGroupHorizontalCode,
    },
    {
      id: 'vertical',
      title: 'Vertical',
      render: () => <ButtonGroupButtonsVerticalSample />,
      code: buttonGroupVerticalCode,
    },
  ],
}

export const entries: GalleryEntry[] = [
  buttonEntry,
  compactButtonEntry,
  iconButtonEntry,
  linkButtonEntry,
  socialButtonEntry,
  fancyButtonEntry,
  buttonGroupEntry,
]

