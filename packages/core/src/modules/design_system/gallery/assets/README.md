These local image fixtures were downloaded from the Open Mercato Figma design system (`qCq9z6q1if0mpoRstV5OEA`) for its component gallery on 2026-09-12.

| Fixture | Figma node | Content |
| --- | --- | --- |
| `avatar-photo.png` | `246:11135` | James Brown, photo |
| `avatar-memoji.png` | `246:11139` | James Brown, Memoji |
| `avatar-illustration.png` | `246:11141` | James Brown, illustration |

The gallery uses the production Avatar image API and its object-cover crop. These fixtures demonstrate content support; they do not claim exact parity with every Figma crop, persona, or size.

The `social-*-filled.svg` and `social-*-stroke.svg` fixtures are unmodified exports of the logo instances in Social Buttons set `180:4264`. The 14 exact logo-instance IDs are recorded in `docs/design-system/figma-audit/button-compositions.json`. The gallery uses masks for the monochrome Apple, GitHub, and X stroke logos so they follow the semantic foreground in both themes; other logos retain their original colors. These are local component examples, with no authentication requests.

Menu follow-up source assets (read-only SVG export, same Figma file):

- `menu-mastercard.svg`: `214:1327`, Select Provider, 32×24.
- `menu-apex.svg`: `254:5084`, Company Apex.
- `menu-spotify.svg`: `214:394`, Brand Spotify.
- `menu-united-states.svg`: `253:6415`, Country United States.

Menu demos also reuse the existing Poland/Google PNGs and Avatar illustration. No remote image requests are made by the previews.

- `input-european-union.svg`: exact read-only Figma SVG export of `253:6853`, used by the Amount Input source composition (`320:1532`).

## Finance widget artwork

The `finance-*` PNG/SVG files are original read-only Figma exports for the 32 finance widget compositions from component set `3963:7181`. Exact node IDs and export methods are recorded in `docs/design-system/figma-audit/finance-widgets-followup.json`. The exports retain source artwork and are bundled locally through `finance-widgets-artwork.ts`; no expiring asset URL is used at runtime.

## Cryptocurrency artwork

The 30 `crypto-*` PNG/SVG files are original read-only exports from the Cryptocurrency page (`6696:81120`). They include twelve coin marks, three wallet-provider logos, the source brand, Wei Chen profile photo and empty-search emoji, eight monochrome interface glyphs, and four 12px transaction status graphics. `cryptocurrency-artwork.ts` normalizes Vite and Next asset imports. Monochrome SVGs are used as masks with semantic foreground tokens; colored graphics retain their original bytes. Export node IDs are recorded in `docs/design-system/figma-audit/cryptocurrency-followup.json`.
