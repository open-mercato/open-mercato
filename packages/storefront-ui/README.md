# @open-mercato/storefront-ui

Design tokens and accessible primitives for Open Mercato storefronts. The package shares token names with the admin design system so one merchant `theme.css` brands both surfaces, and shares nothing else: zero imports from `@open-mercato/*`, a fixed dependency list, 24 exports, a 45 kB gzip budget on its own code. Spec: [`.ai/specs/2026-10-30-storefront-ui-design-system.md`](../../.ai/specs/2026-10-30-storefront-ui-design-system.md).

## Install

```ts
// app/layout.tsx
import '@open-mercato/storefront-ui/tokens.css'
import './theme.css' // merchant overrides, optional
```

```css
/* app/globals.css */
@import "tailwindcss";
@import "@open-mercato/storefront-ui/theme.css";
@source "../../node_modules/@open-mercato/storefront-ui/src";
```

```tsx
import { Button, Dialog, RadioGroup } from '@open-mercato/storefront-ui'
```

## Theming

Set density on `<html>`:

```html
<html data-sf-density="default" class="">
```

Override identity tokens in `theme.css` after `tokens.css`: `--primary`, `--primary-foreground`, `--primary-hover`, `--ring`, `--accent`, `--sf-surface`, `--sf-sale`, `--font-sans`, `--font-display`, `--sf-label-case`, `--sf-image-ratio-product`. The status palette, control sizes, focus ring, disabled construction and overlay geometry are system contracts; do not override them.

## Storybook

```sh
yarn storybook:storefront          # http://127.0.0.1:6007
yarn build-storybook:storefront    # packages/storefront-ui/storybook-static
```

The Brand toolbar switches four merchant presets, Density steps the control size, Theme applies dark mode on the document root so portals follow.

## Guards

```sh
yarn workspace @open-mercato/storefront-ui test   # exports, dependencies, isolation, tokens, DS rules
yarn storefront-ui:budget                          # own code ≤ 45 kB gzip, imports within the fixed list
```

## What is not here

Commerce components (product card, variant selector, filters, checkout stepper, price block, tier table, cart line, order card) live in `apps/storefront` and are composed from these primitives; Storybook shows them as patterns.
