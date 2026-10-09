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

The dry run needs no npm or GitHub login and builds a real archive under `.mercato/module-publish/`. Inspect the archive and install it in a fresh receiving app with `yarn mercato module add /absolute/path/to/package.tgz --allow-third-party`. Validate generation and the module's runtime paths there before publishing. Imports from app-generated entity registries must be replaced in the module source with module-owned typed field literals, stable `module:entity` identifiers, or supported package exports; generated files are evidence, never edit them to fix packaging.

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

