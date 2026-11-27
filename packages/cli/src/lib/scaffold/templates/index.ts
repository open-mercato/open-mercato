/**
 * Executable template source of truth for `mercato module scaffold --with-ui`
 * (spec: .ai/specs/2026-07-05-ds-module-ui-scaffold.md §Template source of truth).
 *
 * Templates are embedded as TypeScript string constants (not loose `.tpl`
 * assets) because `packages/cli/build.mjs` bundles `src/**\/*.ts` only — this
 * way the templates ship inside the published `@open-mercato/cli` dist with no
 * extra copy step, and standalone apps get byte-identical templates versioned
 * with the CLI. Interpolation is `{{placeholder}}` substitution only — no
 * template engine (see `renderTemplate` in `../index.ts`).
 *
 * These templates are pinned by `__tests__/scaffold-golden.test.ts` (golden
 * files) and `__tests__/scaffold-ds-contract.test.ts` (DS lint + guardian
 * checklist): a template edit can never ship invisibly.
 */
export { listPageTemplate } from './list-page'
export { createPageTemplate } from './create-page'
export { detailPageTemplate } from './detail-page'
export { listMetaTemplate, createMetaTemplate, detailMetaTemplate } from './metas'
export { formConfigTemplate } from './form-config'
export {
  validatorsTemplate,
  statusMapTemplate,
  aclTemplate,
  setupTemplate,
  moduleIndexTemplate,
} from './module-files'
