# Save and Create App Templates

An app template is a GitHub repository with a complete standalone app at its root. Use [create-mercato-template](https://github.com/open-mercato/create-mercato-template#readme) to save this app as one, and `create-mercato-app --template` to create a new app from one. A template is code only: the committed files of one commit. The database, configuration made in the UI, uploads, `.env` files, Git history and registry credentials are never saved. Move anything the next app needs into code (seeds, setup scripts) and commit it first.

Save a reviewed snapshot from the app root:

```bash
npx create-mercato-template prepare --out ../my-template
```

It reads the committed `HEAD` offline, runs no app code and never changes the app. `--out` must be a new or empty directory outside the app. Uncommitted changes are listed but not exported unless `--include-uncommitted` is given. The result is `<out>/tree` and `<out>/report.json` with a `snapshotId`. An error finding (a secret, a symlink, a database dump, a missing `yarn.lock`) stops it: fix the source, commit, and run `prepare` again. Use `--allow-file <path>` or `--keep-env <KEY>` only when the user confirms that file or value may be shared. Show the user the report before publishing: errors, warnings, emptied env keys, the module list, uncommitted files and every image path, because images are not scanned and the user must inspect them.

Publish only after the user approves the repository name, the visibility and the reviewed `snapshotId`:

```bash
npx create-mercato-template publish --from ../my-template --repo your-name/my-template --private --expect <snapshotId>
```

It needs `gh auth login` and never reads or prints a token. Visibility is always explicit (`--public` or `--private`); never choose it for the user. `--expect` is required with `--json` and without a terminal. It pushes exactly the snapshot as one commit, marks the repository as a template and adds its topics. It never force-pushes. After a failed GitHub step, rerun the printed command with `--resume`. With `--json`, read the exit code: 0 done, 1 a check failed or publication was refused, 2 usage, 3 GitHub auth missing, 4 a GitHub step failed.

To list the template in the catalog:

```bash
npx create-mercato-template describe --from ../my-template
```

It prints the catalog YAML and the CONTRIBUTING link. Listing is a pull request the user opens in `open-mercato/modules`; neither tool opens it.

Create a new app from a template outside this app's directory:

```bash
npx create-mercato-app my-app --template your-name/my-template
npx create-mercato-app my-crm --template crm
```

`--template` takes a curator slug or `owner/repo`, optionally with `#ref`; a private repository needs `GITHUB_TOKEN`. Before the download it prints `owner/repo@<sha>` and whether that commit is verified, and it refuses a template on hold. The new app gets the app name in `package.json` (unless `--keep-name`), an `openMercatoTemplate` field with the repository, ref and commit, and no `mercato-template.json`. Then follow the printed next steps, which match the app's scripts: `yarn setup` when it has `setup` and `infra:up`; `docker compose up -d` then `yarn setup` when it has only `setup`; otherwise `yarn install`, `yarn initialize`, `yarn dev`. The declared env keys come first, with `cp .env.example .env`. Imports get no agentic setup; run `yarn mercato agentic:init` inside the new app when wanted.

If `npx create-mercato-template` is not available from npm yet, run it from GitHub: `npx --package github:open-mercato/create-mercato-template create-mercato-template --help`. Without process execution, report that capability gap instead of claiming a snapshot or a publication.
