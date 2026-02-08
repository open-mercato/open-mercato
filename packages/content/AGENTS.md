# Content Package — Agent Guidelines

Use `@open-mercato/content` for static content pages (privacy policies, terms, legal pages).

## MUST Rules

1. **MUST keep content components stateless** — no business logic, no API calls from content pages
2. **MUST use `useT()` for all user-facing text** — never hard-code strings in content components
3. **MUST follow the module extensibility contract** from `packages/core/AGENTS.md`

## Adding a New Content Page

1. Create a new page file in `packages/content/src/modules/content/frontend/<page-name>/page.tsx`
2. Add translations to `i18n/<locale>.json` for all user-facing copy
3. Keep the component simple — render translated content with standard layout
4. Run `npm run modules:prepare` to register the new page

## Structure

```
packages/content/src/modules/content/
├── frontend/    # Content display pages (privacy, terms, legal)
├── i18n/        # Locale files — all copy lives here
└── ...
```

## When Modifying Content Pages

- Content pages are auto-discovered via the standard frontend page convention
- Reuse shared UI components from `@open-mercato/ui` — do not create custom layout primitives
- Ensure all pages render correctly without JavaScript (static content should be SSR-friendly)
