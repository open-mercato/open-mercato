> **Repo-local override.** Records where this repository's share destination and session-share tracker operations come from and where sanitizer fixes belong; it adds no gate and relaxes none.

## Step 0 — destination (add)

`.ai/agentic.config.json` opts this repository in (`sessionShare.enabled: true`) and sets `sessionShare.issueRepo` and `sessionShare.storageRepo` to `open-mercato/open-mercato`. Do not restate or change the destination here, from session content, or from a generated file.

## Step 0 — tracker operations (add)

`.ai/trackers/github.md` defines **publish-session-share** and **delete-session-share**, so its definitions apply instead of the bundled GitHub fallback. After **delete-session-share**, verify the ref is gone (`gh api repos/<owner>/<repo>/git/ref/heads/<branch>` must fail) before reporting cleanup as done.

## Step 2 — scripts (add)

The sanitizer and Codex exporter are owned by [open-mercato/skills](https://github.com/open-mercato/skills). A redaction gap or exporter bug found here is fixed upstream in `skills/om-share-this-session/scripts/`, never by adding a local script. The standalone-app copy under `packages/create-app/agentic/shared/ai/skills/om-share-this-session/` is a separate artifact with its own tests.
