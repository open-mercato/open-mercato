# Step 4 — Upgrade Strategy

When upgrading Open Mercato packages (`@open-mercato/*`), ejected modules don't update
automatically. You must manually merge upstream changes into your local copy.

## Upgrade workflow

1. **Check the changelog** for the new version — look for changes to the ejected module
2. **Compare your version** with the new version:
   ```bash
   # After updating packages
   diff -r src/modules/<module-id>/ node_modules/@open-mercato/core/dist/modules/<module-id>/
   ```
3. **Review each difference** — your customizations should be the only differences
4. **Merge upstream changes** — apply bug fixes and new features from upstream to your local copy
5. **Test thoroughly** — run `yarn typecheck`, `yarn test`, `yarn dev`

## Minimizing upgrade burden

- **Minimize changes** — only modify what's strictly necessary
- **Keep changes isolated** — prefer adding new files over modifying existing ones
- **Document everything** — update the customization log (Step 3)
- **Consider UMES first** — for new customizations, check if UMES can handle it even though the
  module is ejected

Treat ejected modules as owned code — you are responsible for updates and bug fixes. When in
doubt, extend rather than eject.
