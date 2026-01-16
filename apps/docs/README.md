# Open Mercato Documentation Site

This directory contains the standalone documentation site powered by [Docusaurus 3](https://docusaurus.io/). It can be developed locally and hosted on any static-site provider.

## Getting started

```bash
cd docs
npm install
npm run dev
```

The docs will be available at `http://localhost:3000`. Content lives under `docs/` and is authored in MDX (Markdown + React components).

## Useful commands

- `npm run dev` – start the local dev server with hot reload.
- `npm run build` – generate the static site into `build/`.
- `npm run serve` – preview the static build locally.
- `npm run clean` – delete generated artefacts.

## Deployment

Build the site with `npm run build` and serve the generated `build/` directory from your preferred static hosting provider or CDN.
