# Content Package — Agent Guidelines

`@open-mercato/content` provides static content management (privacy policies, terms, legal pages).

## Structure

```
packages/content/src/modules/content/
├── frontend/    # Content display pages (privacy, terms, legal)
└── ...
```

## Patterns

- Content pages are auto-discovered via the standard frontend page convention
- Follow the module extensibility contract from `packages/core/AGENTS.md`
- Keep content display components simple and reusable
- i18n: all user-facing copy in locale files
