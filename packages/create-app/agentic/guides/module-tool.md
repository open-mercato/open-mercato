# Create and Publish App Modules

Use [create-mercato-module](https://github.com/open-mercato/create-mercato-module#readme) inside an existing `create-mercato-app` application, including a Cloud sandbox. It validates the app before changing files. Run from the app root; do not create another app or modify the sandbox image.

For a new module, start with:

```bash
npx create-mercato-module init visits
```

This creates `src/modules/visits`, registers `{ id: 'visits', from: '@app' }`, and runs generation. Implement the feature using `om-module-scaffold` and the relevant contracts; the starter is not a completed business feature. For an existing module, skip `init` and keep its current source.

Preview a package before remote publication:

```bash
npx create-mercato-module publish visits --package @your-scope/mercato-visits --dry-run
```

The dry run needs no npm or GitHub login and builds a real archive under `.mercato/module-publish/`. Inspect the archive and install it in a fresh receiving app with `yarn mercato module add @your-scope/mercato-visits@file:/absolute/path/to/package.tgz --allow-third-party`. Validate generation and the module's runtime paths there before publishing. Imports from app-generated entity registries must be replaced in the module source with module-owned typed field literals, stable `module:entity` identifiers, or supported package exports; generated files are evidence, never edit them to fix packaging.

Once the user authorizes publication to the selected npm package and optional dedicated GitHub repository:

```bash
npx create-mercato-module publish visits
```

Provide `--package` and `--repo owner/repository` on the first publication, or select them interactively. The tool remembers non-secret preferences in `.mercato/module-tool.json`; use `--configure` to revise them. Publication copies one module into its package/repository; app source remains in `src/modules/visits`, and the app's Git origin stays unchanged. The tool checks npm authentication and, when GitHub work is selected, `gh auth status` before packaging or remote work. Use `npm login`, or environment `NPM_TOKEN`/`NODE_AUTH_TOKEN` with `--auth token`; never put tokens in committed files or command arguments. Existing npm account policy may still require interactive 2FA. For `--auth trusted`, configure the exact repository/workflow/environment as a trusted publisher on npm and run its supported OIDC CI workflow; generating a workflow does not configure npm trust or authorize a local OIDC publication.

To develop in the dedicated repository while continuing to run this app, after publication use:

```bash
npx create-mercato-module link visits
```

The tool checks GitHub login, clones under `.mercato`, backs up the original module source, and replaces the app module folder with a link to the checkout's module source. Keep editing and testing through this app. Use the checkout's normal Git branch/commit/PR workflow for review; `publish` does not create a PR. The link is local: a fresh clone of the app must restore or link the module again. Without `link`, keep development in the original app and rerun `publish` to export changes. Do not manually replace app source with compiled npm output or edit `node_modules`.


## Receiving app: installation, aliases, and replacement

Before planning installation or provider replacement, read the exact installed CLI contracts: [installation and enablement](../../node_modules/@open-mercato/cli/src/lib/module-install.ts), [module identity and generation preflight](../../node_modules/@open-mercato/cli/src/lib/module-identity.ts), and [safe ejection](../../node_modules/@open-mercato/cli/src/lib/eject.ts). These files are read-only evidence. If the installed release does not ship one, report that limitation instead of guessing its behavior.

An alias selects a dependency binding, while the runtime module ID remains the module directory name. Install an alias with Yarn and enable that binding with `yarn mercato module enable <binding> --module <module_id> --allow-third-party`. The canonical package name comes from its manifest; an alias cannot make two providers with the same runtime module ID coexist. Keep one enabled entry per ID in `src/modules.ts`, including conditional registrations. A single package-backed registration with a local overlay remains supported; preserve its source when removing duplicate entries, then regenerate. Do not edit generated registries.

npm and GitHub are distinct installation origins. A package's repository field does not establish a GitHub origin for an npm installation. Versions and refs select artifacts; origin-qualified requirements compare canonical sources rather than version constraints. Optional `locator` and `packageName` fields retain provenance for aliases, linked source, or ejected modules. Existing entries need no bulk metadata migration, and missing provenance must not be invented from a folder name.

`module add` inspects the selected artifact before changing the dependency binding: npm packing suppresses lifecycle scripts and pins the resolved version, local file artifacts are inspected directly, and GitHub refs are pinned to commits. Every enabled consumer must retain its source and module layout during a same-source update. Use this order for an explicit provider replacement:

1. Disable all entries consuming the binding in `src/modules.ts`, including conditional registrations. Preserve local source and data, and resolve any occupied destination before adding another provider.
2. Resolve or reconfigure origin-qualified dependants and manually authored imports while the old provider is still installed.
3. Run `yarn mercato generate` and `yarn build` successfully before changing the dependency binding. Stop and fix failures while the old package remains available.
4. Replace the dependency through Yarn and enable the intended provider.
5. Run `yarn mercato generate` and `yarn build` again, then run tests covering the replacement.

An explicitly empty enabled-module list stays disabled. Disabling discovery does not remove dependencies, local source, data, or manual imports. The CLI does not rename runtime IDs, rewrite arbitrary imports, or migrate provider data.

Ejection retains available source provenance when one entry changes to `@app`, validates configuration before copying, and refuses to overwrite an occupied destination. Use the supported command after the normal ejection approval; preserve and review any existing local source. If installation finishes but enablement fails, the package may remain installed: review `src/modules.ts` and restore the intended binding and lockfile through Yarn. If registration finished but generation failed, fix the error and rerun `yarn mercato generate`; do not report completed enablement with stale artifacts.
