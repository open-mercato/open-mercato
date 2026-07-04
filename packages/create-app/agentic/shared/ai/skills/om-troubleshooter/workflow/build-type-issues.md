# Build & Type Issues

## `yarn build` fails

**Checklist**:

1. **Run `yarn typecheck` first** — isolates type errors from build errors
2. **Run `yarn generate` first** — regenerates type-dependent files
3. **Check import paths** — use `@open-mercato/<package>/...` for framework imports
4. **Check for circular imports** — module A importing from module B importing from module A

## Type errors after adding a module

**Checklist**:

1. **Run `yarn generate`** — updates generated type files
2. **Check entity imports** — use correct relative or package paths
3. **Check zod schema matches entity** — types derived from zod must align

## "Module not found" in imports

**Checklist**:

1. **Is the package installed?** Check `package.json` dependencies
2. **Is the import path correct?** Framework packages use `@open-mercato/<package>/...`
3. **Is the package built?** Run `yarn install` to link workspace packages
