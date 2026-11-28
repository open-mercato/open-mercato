# Storefront UI Package — Agent Guidelines

`packages/storefront-ui` is the storefront design system: tokens plus 24 generic primitives for `apps/storefront`. It is governed by `.ai/specs/2026-08-14-storefront-app.md` §3.2 and `.ai/specs/2026-10-30-storefront-ui-design-system.md`.

## Always

1. MUST import only `react`, `react-dom` and the fixed dependency list in `package.json` (clsx, tailwind-merge, class-variance-authority, the listed `@radix-ui/*`); `src/__tests__/guards/isolation.test.ts` fails otherwise.
2. MUST keep exactly the 24 value exports in `src/index.ts`; new needs become variants or compound sub-components (`Input.Stepper`, `RadioGroup variant="card"`), or app compositions.
3. MUST style with Tailwind utilities mapped in `src/theme.css`: `rounded-sf-*`, `h-sf-*`, `text-sf-*`, `bg-status-*`, semantic colours. No hardcoded Tailwind shades, no arbitrary values, no `dark:` overrides (`ds-rules.test.ts`).
4. MUST take every user-facing string as a prop (`labels`, `closeLabel`, `dismissLabel`); the package has no i18n.
5. MUST keep the keyboard and ARIA contracts: visible focus ring, 44 px targets at the default size, `aria-disabled` for `unavailable` options, `role="alert"` for error tone, Cmd/Ctrl+Enter plus Escape in Dialog and Sheet.
6. MUST add a story with every state and a jest test for every behaviour change; run `yarn workspace @open-mercato/storefront-ui test`, `yarn typecheck`, `yarn storefront-ui:budget`.

## Ask First

- Ask before adding a dependency, an export, or a token to the merchant surface; each is a spec amendment.
- Ask before moving commerce-specific components (product card, variant selector, checkout stepper) into this package.

## Never

- Never import `@open-mercato/ui`, `@open-mercato/shared`, `next/*` or Node built-ins.
- Never put status colours, control sizes or focus geometry on the merchant surface.
- Never use a toast as the only channel for an error that needs fixing.

## Validation Commands

```bash
yarn workspace @open-mercato/storefront-ui typecheck
yarn workspace @open-mercato/storefront-ui test
yarn workspace @open-mercato/storefront-ui build
yarn storefront-ui:budget
yarn build-storybook:storefront
```
