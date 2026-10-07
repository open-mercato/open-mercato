# Open Mercato Storybook

The primary user entry is **Settings → Developers → Design system** in Open Mercato (`/backend/design-system`). This folder contains optional developer tooling over the same production components and gallery registry. The application does not need a Storybook process or iframe.

Run from the repository root with Node 24 and the pinned Yarn version:

```sh
yarn install --immutable
yarn storybook
```

Open http://127.0.0.1:6006/?path=/story/design-system-components--gallery. Storybook runs locally without the application database. `yarn build-storybook` writes a static preview to `packages/ui/storybook-static`. Nothing is uploaded by these commands.

## Sources and regeneration

`yarn storybook:generate` reads the current `design_system/gallery` registry through the existing AST reader and generates one Overview and one story per variant. The catalogue, counts and deep links come from the same read. Edit the original entries, then regenerate; do not edit `.storybook/generated`.

Preview CSS is generated from `apps/mercato/src/app/globals.css`. Only the app's generated module scanning import and its workspace source directives are replaced with Storybook's source directories. Semantic values and component styles remain the application's values. `yarn storybook:check` detects generated drift. Neither generated previews nor static builds belong in Git.

Light/dark mode applies to the document root, including Radix portals. The typography toolbar compares the application font stack with locally bundled Inter from the Figma reference. Application styling is the default; selecting the Figma font does not change application code.

## Validation

```sh
yarn storybook:check
yarn build-storybook
yarn test:storybook
```

The browser smoke runner serves the static build on a temporary loopback port, checks the generated stories for rendering errors, then exercises catalogue search, component links and responsive layout. It writes screenshots and a report under `tmp/storybook-validation`. It requires Playwright Chromium (`yarn exec playwright install chromium` if not already installed).

The in-app gallery retains its existing unit tests, primitive coverage guards and inventory checks. A successful Storybook build proves neither Figma publication nor complete visual parity. See Coverage and gaps in Storybook for known differences and review priorities.
