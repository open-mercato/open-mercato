# @open-mercato/document-generators

PDF and Markdown document generation for Open Mercato.

`@open-mercato/document-generators` provides the `document_generators` engine module: a template registry filled from every enabled module, server-side rendering, side-effect-free preview, generation that stores the file privately and records history, code-defined template versions, a draft watermark, per-template access control and retention that follows the source record. Any module can contribute templates through a `document-generators.ts` convention file without touching this package. Sales ships the order invoice and quote offer templates.

## Install

```bash
yarn mercato module add @open-mercato/document-generators
```

Enable the module in `src/modules.ts` (applications created with `create-mercato-app` already do), then apply migrations and regenerate:

```ts
{ id: 'document_generators', from: '@open-mercato/document-generators' }
```

```bash
yarn db:migrate
yarn generate
```

With Sales enabled, order and quote detail pages show a **Documents** tab with preview, download and history. The backend **Documents** section lists templates and the organization-wide history.

## Add templates from your module

Extend `BaseDocumentService` from `@open-mercato/shared/modules/document-generators`, register PDF or Markdown templates, export them from your module's `document-generators.ts` and run `yarn generate`. Declaring templates depends only on `@open-mercato/shared`; templates import this package's authoring toolkit and load lazily.

## Documentation

- [Overview](https://docs.open-mercato.dev/framework/document-generators/overview)
- [Getting started](https://docs.open-mercato.dev/framework/document-generators/getting-started)
- [Authoring templates](https://docs.open-mercato.dev/framework/document-generators/authoring)
- [API reference](https://docs.open-mercato.dev/framework/document-generators/api)
- [Contributing](https://docs.open-mercato.dev/framework/document-generators/contributing)

## License

MIT
