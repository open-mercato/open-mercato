# @open-mercato/document-generators


A framework for generating and previewing PDF documents from any Open Mercato module. It provides the rendering infrastructure, a global template registry, a preview/download UI, and an extension API — any module can register its own templates without touching this package.

---

## Requirements

| Dependency | Version |
|------------|---------|
| Open Mercato | `^0.6.2` |
| `react` | `^19.0.0` |

---

## Screenshots

**Template registry — admin page**

![Available templates admin page](https://docs.open-mercato.dev/screenshots/document-generators/screen-1.png)

**PDF tab on an Order detail page**

![PDF tab on order detail](https://docs.open-mercato.dev/screenshots/document-generators/screen-2.png)

**PDF tab on a Quote detail page**

![PDF tab on quote detail](https://docs.open-mercato.dev/screenshots/document-generators/screen-4.png)

**Document preview dialog**

![Document preview dialog](https://docs.open-mercato.dev/screenshots/document-generators/screen-3.png)

---

## Quick start

```bash
yarn mercato module add @open-mercato/document-generators
```

After installation, navigate to any sales order or quote detail page — a **PDF** tab appears automatically. Clicking a template card opens a full-screen preview; clicking **Download PDF** streams the file.

To register your own templates from another module, create a `document-generators.ts` convention file at the root of your module. See [Usage & Integration](https://docs.open-mercato.dev/framework/modules/document-generators/usage) for the full walkthrough.

> **Shortcut**: use the `scaffold-pdf-templates` Claude Code skill to generate all required files automatically.

---

## Documentation

- [Overview](https://docs.open-mercato.dev/framework/modules/document-generators)
- [Installation](https://docs.open-mercato.dev/framework/modules/document-generators/installation)
- [Usage & Integration](https://docs.open-mercato.dev/framework/modules/document-generators/usage)
- [Examples](https://docs.open-mercato.dev/framework/modules/document-generators/examples)
- [API Reference](https://docs.open-mercato.dev/framework/modules/document-generators/api)
- [Service Conventions](https://docs.open-mercato.dev/framework/modules/document-generators/service-conventions)
- [Contributing](https://docs.open-mercato.dev/framework/modules/document-generators/contributing)

---

## License

MIT
