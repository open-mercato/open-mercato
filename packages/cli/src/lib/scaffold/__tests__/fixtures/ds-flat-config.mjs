// DS contract-test config: reuse the repo's DS flat config (eslint.ds.config.mjs)
// verbatim — same parser, plugin, and rule set — but retarget the `files` globs
// at the temp directory the scaffold test writes into (the repo config scopes
// itself to packages/**, which a temp dir can never match). Consumed by
// ../scaffold-ds-contract.test.ts via `eslint --no-config-lookup --config`.
import baseConfig from '../../../../../../../eslint.ds.config.mjs'

export default baseConfig.map((entry) => ({
  ...entry,
  files: ['**/*.ts', '**/*.tsx'],
  ignores: [],
}))
