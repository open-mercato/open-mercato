# Windows one-command setup — user manuals

Printable manuals (run guide + troubleshooting + FAQ) for the Windows launchers —
`starters/docker/windows/start-windows.bat` (auto-detect), `start-windows-rancher.bat` /
`start-windows-docker.bat` (pinned runtime), and the read-only preflight
`check-windows.bat`:

| Language | Source | PDF |
|----------|--------|-----|
| English | [`windows-setup-manual-en.html`](windows-setup-manual-en.html) | [`open-mercato-windows-setup-manual-en.pdf`](open-mercato-windows-setup-manual-en.pdf) |
| Polski | [`windows-setup-manual-pl.html`](windows-setup-manual-pl.html) | [`open-mercato-windows-setup-manual-pl.pdf`](open-mercato-windows-setup-manual-pl.pdf) |

The HTML files are the editable sources (self-contained, print-styled for A4).
Regenerate a PDF with headless Chrome:

```
chrome --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=open-mercato-windows-setup-manual-en.pdf windows-setup-manual-en.html
```

Keep the manuals in sync with `starters/docker/windows/start-dev.ps1` (all launcher
`.bat` entry points, `preflight-windows.ps1`) and the spec
`.ai/specs/2026-07-07-windows-one-command-agentic-dev-environment.md`.
After editing the HTML sources, regenerate both PDFs.
