# Open Mercato empty-state artwork

Four images generated on 2026-09-16 for the local Open Mercato design-system catalogue, replacing its Align UI illustration presentation.

| File | Illustration kind | Usage |
| --- | --- | --- |
| records.png | mercato-records | No records yet |
| search.png | mercato-search | No matching search results |
| files.png | mercato-files | No uploaded files |
| messages.png | mercato-messages | No messages |

Art direction: flat monochrome line illustrations inspired by 1990s desktop windows, terminals, floppy disks and chat interfaces. Strong black contours, white interiors and sparse pixel details; no 3D, gradients or brand-specific colors. No embedded prose. Originals have transparent alpha backgrounds and are retained without image edits.

Render through `EmptyStateIllustration` inside `EmptyState`, with a translated title and useful next-step description. Artwork is decorative; its default alt text is empty. The Mercato collection inverts in dark mode to preserve readable contours. It remains monochrome across custom brand palettes; legacy illustration colors are unchanged.

The package uses the same self-contained data URI strategy as its existing illustration collection. Rebuild the derived registry after replacing an image:

```sh
node scripts/generate-mercato-empty-artwork.mjs
node scripts/generate-mercato-empty-artwork.mjs --check
```

Keep the previous illustration keys available for existing consumers. The catalogue presents the new Open Mercato collection.
