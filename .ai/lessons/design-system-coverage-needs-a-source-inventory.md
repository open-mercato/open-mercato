---
title: "Design-system coverage needs a source inventory and visual checks"
modules: ["ui", "design_system"]
areas: ["backend-ui", "testing"]
topics: ["design-system", "ui-components", "visual-testing", "native-navigation", "realtime", "dev-runtime"]
---

# Design-system coverage needs a source inventory and visual checks

**Context:** A Storybook with hundreds of passing examples still omitted Figma component sets and states. A small AvatarStack clipped initials despite passing render tests. Some Figma color captions also differed from actual fills.

**Rule:** Start completeness claims from the full design-file page and component-set inventory. Record variant axes, counts, node IDs and measured properties. Keep source coverage, implementation coverage and visual verification separate: a matching name or passing render test proves neither complete coverage nor visual parity.

- Detect truncated tool output before treating an inventory as complete. Request smaller records when needed.
- Compare actual fills and typography properties, not only printed design captions.
- Validate the reported composition at its real size, with realistic text, in both themes. Include geometry checks for clipping and order defects.
- Show missing families and unverified variants. Do not present reference-only specimens as implemented production components.
- Keep the complete source inventory visible inside the product catalogue through names, counts and variant axes, without sending the reviewer to an external design file. Do not substitute whole-page screenshots for implemented components when the reviewer wants a usable component catalogue.
- A designer-facing DS entry point should explain foundations, components, patterns and usage through working examples. Keep the source audit as a secondary resource; inventory completeness is not the main browsing experience. Review a supplied presentation reference before adding more catalogue chrome.
- Use a single DS navigation: overview, guidelines and component families belong in the same sidebar, with one equivalent mobile selector. Do not add a parallel top menu. Foundation references show their sections together; viewport presets and component-variant controls do not help users compare color tokens.
- Family browsing must show real component specimens immediately. Remove the duplicate strip of component names and keep imports, code, variant counts and long usage explanations in the detail view. Use compact representative examples instead of full state matrices in overview cards.
- Match navigation labels to their scope: a general browse-components action must open the complete category index, while a specimen-specific action may deep-link to one component.
- Deep-link scrolling must keep the page heading and named return action visible below the application header. Foundations work as a continuous visual guide with a compact contextual sidebar and permanent exits to the overview and component index; avoid stacking the whole family directory beneath its section list.

- For comparison, show a component’s variants together when the reviewer requests it; do not replace comparison with a mandatory selector. Keep code collapsed and mount long listings on demand. Localizing chrome alone is insufficient: sample actions, statuses, captions and usage guidance must also follow the active locale.
- Classify every entry before applying shared catalogue chrome: compact control, full-width composition, or dedicated asset browser. Remove generic viewport controls, nested searches and arbitrary preview scrollbars. Check the actual content width inside the application shell at desktop and mobile sizes; viewport breakpoints alone can still squeeze a component between sidebars.
- Inspect computed widths when responsive specimens look wrong. A shared `max-width: 100%` child rule can override a specimen's mobile width constraint even though its `max-w-sm` class is present. Preserve the specimen's own maximum width and constrain overflow with `min-width: 0` in shared containers.
- Confirm the intended application entry point before building a separate explorer. For Open Mercato, the primary catalogue belongs in the existing Settings module; optional Storybook tooling consumes the same registry. Validate native routing independently from isolated component examples.

- Keep category navigation available inside component details. Show components indented beneath their category, with separate overview links and disclosure controls. Repeating the same icon for every item obscures hierarchy; use meaningful family icons and text-only children.
- A component-set audit is not a full product-screen audit. Inspect top-level frames separately: the HR page contains 77 application screen frames in addition to six reusable component sets. Record actual frame IDs and distinguish responsive duplicates from distinct screens; completing a calendar card does not complete the calendar page.
- Exclude Figma authoring banners and purchase links from the application catalogue. Original logos, portraits and embedded product media remain legitimate design assets inside implemented DOM layouts; they are different from whole-page screenshot substitutes.

- Classify top-level frames before reporting missing screen totals: annotations, dialogs, experiments and screenshot references are not interchangeable with application pages. Persist source contexts and translation bundles in the audit directory; temporary files may disappear between sessions.
- Verify package runtime builds as well as source tests. Direct locale JSON imports can pass source tests while failing in the application when build asset rules exclude those files.

- Theme-invariant light brand gradients need a theme-invariant dark foreground. Filled destructive controls must use the solid surface/foreground pair, not the bright destructive text token. Measure the worst gradient stop and hover treatment; white sheen overlays can invalidate an otherwise readable red pair.

- Third-party calendars need real-size checks after overriding their vendor CSS: pair event surfaces and foregrounds with semantic tokens, soften grid lines, verify header/event clipping, and keep full-day closures out of the timed grid. Locale changes must also update fixture week boundaries; translating labels alone can leave the visible week empty. Verify the initial time scroll after a fresh mount, not only after hot style updates.

- Give color one clear job within a composition. Schedule cards use status for their semantic color, not a competing kind palette; make the labeled badge the main signal, keep large backgrounds subtly tinted and titles in the normal foreground. Never rely on color alone to convey status. Typography documentation should prioritize a small role hierarchy and when-to-use guidance before the exhaustive token scale.

- Swatch cards with optional captions must align their contents to the top. Button primitives commonly center flex content by default, which offsets shorter cards inside stretched grid rows; use explicit top alignment and non-shrinking color samples.

- A designer-facing palette tool needs a complete decision loop: generate shades, assign semantic roles, inspect realistic compositions and states in both themes, compare exact contrast pairs, and export usable tokens. A base-color picker plus a single button/form is only a demo, even when its contrast math is correct.

- Padding classes alone do not prove visible padding: fixed source widths plus translated labels can push flex content outside a control. Prefer intrinsic widths for text actions, reserve space for non-shrinking icons, and measure icon/text bounds against the rendered padding box in the actual application. Check related controls and narrow stages before declaring a spacing correction complete.

- Do not label a deterministic reset as generation: when a preview already derives colors automatically, a generate action is a silent no-op. Show automatic/manual state, explain the relationship briefly, and expose a restoration action only when an override exists. Verify both the unchanged initial state and visible restoration after editing.

- For reusable empty-state artwork, follow the supplied illustration reference and intended audience before inferring a brand treatment. Universal monochrome retro line art must not become branded 3D objects; verify the actual asset on both light and dark surfaces.

- A palette specimen must not stretch a tiny dataset into a full-width admin page. Keep selection tint localized, pair a compact list with a focused detail panel, remove repeated selected/status prose, and verify real container widths. Color role swaps must preserve all three exact seeds and enter manual mode rather than regenerate their companions.

- Give theme customization one canonical destination. Read-only foundation documentation must not embed a second independent editor; link to the named studio and explain the difference between reference tokens and a draft/apply workflow.

- Never run clearDist package builds repeatedly while the user reviews a live Next.js preview. Removing thousands of runtime files invalidates the module graph and can produce missing-module errors, reconnect storms and multi-gigabyte recompilations. Stop the preview before a required full build, then restart once; use incremental writes for further edits and leave a quiet, stable preview for review.

- Place palette-role swap controls directly beside the seed fields they affect; avoid a detached toolbar that forces users to map controls back to their colors.

- Palette swaps should support direct manipulation: immediate left/right neighbor swaps and dragging between roles. A chooser popover adds an unwanted decision step for this studio.

- Keep studio apply/reset actions compact in the header. Avoid floating explanatory action panels that obscure the component preview; put secondary explanations in tooltips.

- Gallery examples should default to the visual specimen with Preview/Code tabs. Do not put repeated collapsible code panels under every variant; keep copying available without opening code.

- When removing gallery disclosure UI, audit the whole module: token export, usage guidance, source inventory, shadows and typography reference, not only code snippets. Preserve accordion interactions only inside actual component demonstrations.

- Use masonry columns for catalogue previews of unequal heights so short controls do not reserve the height of adjacent calendars. Preserve full-width specimens and one-column mobile presentation.

- A live catalogue opened in several tabs can exhaust the HTTP/1.1 per-origin connection pool when every tab owns a permanent SSE stream. Deliver heartbeat data that reaches `EventSource.onmessage`, and release the stream while a tab is hidden; reconnect and refresh through the existing bridge signal when it becomes visible.
