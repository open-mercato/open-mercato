# module search fixtures

Generated from the test fixture of the Open Mercato Modules catalog (8 real entries and 3 core modules, data read on
2026-10-23), with the catalog's own emitter and MCP handlers and the site set to `https://modules.openmercato.com`.

- `modules-index.json`: the published `/modules.json`.
- `built-in.json`: the published `/built-in.json`.
- `catalog-parity.json`: what the catalog's `search_modules` and `get_module` tools (contract `tools@1`) answer for
  the golden queries of the catalog spec (Appendix B) plus filter cases, on the same data. `module-search.test.ts`
  checks that `yarn mercato module search|info` produces the same ranking, cards and lookups.

The data predates the catalog's move of partner modules to `community`, so `@fastwhitecat/integration-ksef-direct` is
`3rd-party` here while the live catalog lists it as `community`; the tests keep it to cover the third-party label.

Do not edit by hand. Regenerate from the catalog repository when its ranking or published schema changes.
