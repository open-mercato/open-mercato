// Local Yarn plugin: neutralize the builtin `compat/typescript` patch.
//
// Yarn 4.12's bundled compat plugin rewrites every `typescript` dependency into
// `patch:...#optional!builtin<compat/typescript>`. That patch's diff targets
// `lib/_tsc.js`, a file the native (Go) TypeScript >= 7 package does not ship,
// so `yarn install` fails with ENOENT before the patch can be applied. The
// `optional!` flag only swallows hunk-apply errors, not the missing-file error,
// and the `resolutions` field cannot target a hook-generated descriptor.
//
// `reduceDependency` hooks run in sequence after the builtin one and may change
// a descriptor's range (not its ident). We detect the builtin typescript patch
// and unwrap it back to the plain npm descriptor, so native TypeScript installs
// untouched. Remove this once Yarn gates the compat patch on package layout.
module.exports = {
  name: `plugin-skip-ts-compat`,
  factory: (require) => {
    const { structUtils } = require(`@yarnpkg/core`)
    return {
      hooks: {
        reduceDependency: (dependency) => {
          if (structUtils.stringifyIdent(dependency) !== `typescript`) return dependency
          const range = dependency.range
          if (!range.startsWith(`patch:`) || !range.includes(`builtin<compat/typescript>`)) return dependency
          const { source } = structUtils.parseRange(range)
          if (!source) return dependency
          return structUtils.parseDescriptor(source, true)
        },
      },
    }
  },
}
