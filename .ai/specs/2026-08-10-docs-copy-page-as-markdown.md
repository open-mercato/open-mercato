# Copy Documentation Page as Markdown

## TLDR

Add a ghost IconButton to every doc page (MDX under `docs/`) that copies the page's raw markdown source to the clipboard. A custom remark plugin injects the raw `.mdx` content at build time; a swizzled `DocItem/Layout` renders the button top-right of the content area. Feedback is a checkmark icon swap for ~2 seconds. Target branch: `develop`.

## Problem Statement

Developers and AI agents frequently need raw markdown from the docs — to paste into prompts, reference in issues, or feed to tools. Today the only path is clicking "Edit this page" → GitHub → copy raw. A one-click copy button eliminates that friction, matching the UX of Claude Code's documentation site.

## Proposed Solution

Three small pieces, all inside `apps/docs/`:

1. **Remark plugin** (`plugins/remark-raw-source.ts`) — reads the raw file content during MDX compilation and injects it as `frontMatter.raw_source`. Zero runtime cost; the string travels through Docusaurus's existing frontmatter pipeline.
2. **CopyPageButton component** (`src/components/CopyPageButton.tsx`) — reads `raw_source` from `useDoc().frontMatter`, calls `navigator.clipboard.writeText()`, swaps the Copy icon to a Check icon for 2 seconds.
3. **Swizzled DocItem/Layout** (`src/theme/DocItem/Layout/index.tsx`) — wraps the default layout to position the button top-right of the doc content area.

No external dependencies. No `@open-mercato/ui` usage (docs app is self-contained Docusaurus; adding the design-system package as a dependency would be out of scope).

### Alternatives considered

| Approach | Rejected because |
|---|---|
| Runtime fetch from GitHub raw URL | Needs network, rate-limited for unauthenticated users, fails offline |
| DOM-to-markdown conversion | Lossy — loses frontmatter, custom MDX components, exact formatting |
| Docusaurus content plugin (`contentLoaded`) | Heavier API surface; remark plugin is simpler and native to the MDX pipeline |

## Architecture

```
MDX file
  ↓ (remark plugin reads file.value)
frontMatter.raw_source = raw string
  ↓ (Docusaurus build)
useDoc().frontMatter.raw_source available at runtime
  ↓
CopyPageButton reads it, copies to clipboard on click
  ↓
Swizzled DocItem/Layout positions the button
```

No new packages. No cross-package dependencies. Entirely scoped to `apps/docs/`.

## Data Model

None — no database, no API, no persistent state. The raw source string is injected at build time into the page's JavaScript bundle.

### Bundle size impact

Each doc page's bundle grows by the size of its raw MDX source. For a typical 5 KB doc, this is negligible. The `docs/` folder currently has ~50-80 files — total overhead is roughly 250-400 KB across all pages (code-split, so only the visited page's source loads).

## UI/UX

### Button placement

Top-right corner of the doc content area, vertically aligned with the page title (`h1`). Positioned via absolute positioning within the content wrapper.

### Visual spec

- **Idle state**: Ghost-style button, `Copy` icon (from `lucide-react`, already a Docusaurus dependency via Prism), muted foreground color, 28px hit target
- **Hover**: Subtle background highlight (Docusaurus theme hover token)
- **Clicked → success**: Icon swaps to `Check`, color shifts to green/success for 2 seconds, then reverts
- **Tooltip**: `aria-label="Copy page as Markdown"` — optionally a native `title` attribute for hover tooltip
- **Dark mode**: Inherits Docusaurus theme tokens automatically

### Accessibility

- `aria-label="Copy page as Markdown"`
- `type="button"` explicit
- Keyboard-accessible (native button)
- Success state announced via `aria-live="polite"` visually-hidden text

## Edge Cases & Failure Scenarios

| Scenario | Behavior |
|---|---|
| `navigator.clipboard` unavailable (old browser, non-HTTPS) | Button hidden via feature detection (`navigator.clipboard?.writeText`) |
| `raw_source` missing from frontmatter (custom page, not a doc) | Button not rendered — component guards on `raw_source` existence |
| Very large MDX file (>50 KB) | Still works; clipboard API handles large strings; bundle impact is acceptable since it's code-split |
| User clicks rapidly | Debounce not needed — clipboard write is idempotent; icon timer resets on each click |

## Risks & Impact Review

- **Blast radius**: Minimal — entirely within `apps/docs/`, no shared packages touched
- **Bundle size**: Marginal per-page increase (~size of raw MDX source), code-split
- **Breaking changes**: None — additive only
- **Rollback**: Remove the remark plugin from config and delete the swizzled theme component

## Phasing

Single phase — the feature is small enough to ship in one PR.

## Implementation Plan

### Phase 1: Copy Page Button (single PR against `develop`)

**Step 1 — Remark plugin**
Create `apps/docs/plugins/remark-raw-source.ts`:
```typescript
import type { Plugin } from 'unified';

const remarkRawSource: Plugin = () => {
  return (_tree, file) => {
    (file.data.frontMatter as Record<string, unknown>) ??= {};
    (file.data.frontMatter as Record<string, unknown>).raw_source = file.value;
  };
};

export default remarkRawSource;
```
Register in `docusaurus.config.ts` under the docs preset's `remarkPlugins`.

**Step 2 — CopyPageButton component**
Create `apps/docs/src/components/CopyPageButton.tsx`:
- Uses `useDoc()` from `@docusaurus/plugin-content-docs/client` to read `frontMatter.raw_source`
- `navigator.clipboard.writeText(rawSource)` on click
- `useState` to toggle icon between `Copy` and `Check`
- `setTimeout` 2s to revert icon
- Guard: return `null` if `raw_source` is falsy or clipboard API unavailable
- Style: ghost button using Docusaurus CSS variables (no external UI lib)

**Step 3 — Swizzle DocItem/Layout**
Create `apps/docs/src/theme/DocItem/Layout/index.tsx`:
- Wrap the default `@theme-original/DocItem/Layout`
- Position `CopyPageButton` absolute top-right of the content container
- Minimal CSS in a co-located `.module.css` file

**Step 4 — Verify**
- `yarn build` in `apps/docs` to confirm build succeeds
- Manual verification: open a doc page, click the copy button, paste into an editor, confirm raw MDX source is copied
- Check dark mode renders correctly
- Check pages without `raw_source` (custom pages) don't show the button
