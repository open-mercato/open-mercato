# Open Mercato Documentation Site

This directory contains the standalone documentation site powered by [Docusaurus 3](https://docusaurus.io/). It can be developed locally and hosted on any static-site provider.

## Getting started

From the monorepo root:

```bash
yarn docs:dev
```

Or from within this directory:

```bash
yarn install
yarn dev
```

The docs will be available at `http://localhost:3000`. Content lives under `docs/` and is authored in MDX (Markdown + React components).

## Useful commands

- `yarn dev` – start the local dev server with hot reload.
- `yarn build` – generate the static site into `build/`.
- `yarn serve` – preview the static build locally.
- `yarn clean` – delete generated artefacts.

## Deployment

Build the site with `yarn build` and serve the generated `build/` directory from your preferred static hosting provider or CDN.
