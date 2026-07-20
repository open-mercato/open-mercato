# Windows one-command setup — user manuals

> **Out of date — launcher replaced.** The `.bat` launchers these manuals describe were
> replaced by the cross-platform starter: `packages\starter\platform\start.cmd`
> (double-click) / `npx @open-mercato/starter`, with `doctor` as the read-only preflight.
> The manuals below still contain valid WSL2/proxy/hardware troubleshooting, but their
> run instructions need a rewrite pass before being handed to end users.

Printable manuals (run guide + troubleshooting + FAQ), originally written for the retired
Windows launchers:

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

Keep the manuals in sync with the starter (`packages/starter/` — CLI, steps, doctor, and
the `platform/` bootstraps) and the spec
`.ai/specs/2026-07-19-unified-starter-package.md`.
After editing the HTML sources, regenerate both PDFs.
