# Document Generators Package — Agent Guidelines

Use `@open-mercato/document-generators` as a domain-independent rendering engine. See [the spec](../../.ai/specs/2026-08-10-document-generators.md).

## Always

- Keep domain services, templates, translations, widgets, and integration tests in their owning module.
- Keep `BaseDocumentService` and neutral declaration contracts in `@open-mercato/shared/modules/document-generators`.
- Keep renderers, registry, API/history, backend UI, generators, and `templates/shared/**` here.
- Keep backend-page-only components under that page's route directory; promote them to module-level `components/` only when multiple features reuse them.
- Colocate format-specific source/input types with their renderer; keep `TemplateRegistry` format-neutral.
- Require explicit `format` and renderer-owned `mimeType`; adding a format means adding its renderer and dispatch-map entry.
- Run `yarn generate` after changing discovery conventions or module `document-generators.ts` files.

## Ask First

- Ask before changing public imports, contracts, routes, history schema, widget spots, generator output, dependencies, or preview behavior.

## Never

- Never add domain-named directories, `resolve('Sales*')`, or `sales.*` resource kinds here.
- Never register domain templates internally or infer PDF when `format` is missing.
- Never move `@react-pdf/renderer` into Core or Shared; expose required primitives through `providers/react-pdf`.
- Never import Core or a business module from this package.

## Validation Commands

```bash
yarn generate
yarn workspace @open-mercato/document-generators test
yarn workspace @open-mercato/document-generators build
```
