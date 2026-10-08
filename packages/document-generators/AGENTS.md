# Document Generators — Agent Guidelines

Domain-neutral PDF/Markdown engine. Spec: `.ai/specs/2026-08-10-document-generators.md`; docs: `apps/docs/docs/framework/document-generators/`.

## Always

- Keep services, templates, i18n and widgets in the owning module; this package holds only engine code.
- Put declaration contracts and stateless helpers in `@open-mercato/shared/modules/document-generators`.
- `lib/` holds engine pieces; `utils/` holds stateless helpers.
- Load templates lazily with `import()`; reach React-PDF only via `providers/react-pdf`.
- Leave `fontFamily` off template pages; the barrel `Page` applies the font configured in `documentGeneratorsConfig` (`lib/module-config.ts`). Never bundle font files in this package.

## Ask First

- Before changing API routes, error codes or the history schema.

## Never

- Import Core or a business module, or add domain-named code here.
- Trust client resource identity; derive it in `resourceId()`.

## Validation Commands

```bash
yarn workspace @open-mercato/document-generators test
OM_INTEGRATION_MODULES=document_generators npx playwright test --config .ai/qa/tests/playwright.config.ts packages/document-generators
```
