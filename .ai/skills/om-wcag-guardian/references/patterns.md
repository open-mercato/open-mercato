# Risk patterns and normative anchors

Read the rows matching the changed behavior. The app spec owns the full applicability matrix; this file is review guidance, not a substitute for all 55 A/AA criteria.

| Changed behavior | Review the actual contract | Evidence to seek |
|---|---|---|
| Form fields / custom fields | Name, label association, group, instructions, help/error IDs, invalid state, preserved values | Browser role/name, invalid submit, reader error navigation; source alone insufficient for spoken feedback |
| Table / filter / pagination | Header relationships, sort state, row action keyboard alternative, selected state, focus after changes | Keyboard path + browser semantics + reader table exploration |
| Dialog / drawer / mobile menu | Correct modal intent, name, initial focus, background, dismissal, restored focus, deleted trigger | Keyboard lifecycle, document/portal, AT evaluation; nonmodal popover should not trap focus |
| Theme / CSS / gradient / icons | Actual composited foreground/background pairs in light/dark/states, information without color | Numeric contrast with real tokens/styles and visual context; do not blanket-exempt read-only/hints |
| Auth / MFA / OTP | Password manager/paste, accessible errors, helpers or alternatives to cognitive tasks | Complete flow, security preserved; unavailable external provider remains unverified |
| DnD / slider / calendar / canvas | Keyboard and independent non-drag single-pointer route to equivalent outcome | Both modes; keyboard drag alone does not establish SC 2.5.7 |
| Async / flash / progress / chat | Appropriate status announcements, persistent access to critical content, no focus theft or flooding | Browser assertions + actual reader evidence; no inference of speech from aria-live alone |
| Responsive / long locale | Zoom, reflow, text spacing, active target visibility and sizes | Actual browser geometry and interaction; long/KO text, mobile keyboards, overlays |
| Charts / media / documents | Equivalent information and interactions, appropriate media alternatives and generated/downloaded output | Host and all steps, not only canvas/thumbnail label |

Specific traps:

- [SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): 24×24 CSS px or a valid exception, including spacing geometry. 44×44 is not unconditional AA. Measure hit target, not just icon artwork.
- [SC 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html): an independent single-pointer non-drag alternative, alongside keyboard requirements.
- [SC 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html): author content must not entirely obscure the focused component. Full visibility can be a project enhancement; AAA focus appearance is not AA.
- [SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): ordinary text 4.5:1; sufficiently large text 3:1, with actual defined exceptions. Do not round a near-threshold ratio upward.
- [SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html): determine which non-text information is needed to identify controls/states, then compare adjacent colors.
- [SC 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) and [1.4.12](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html): test lost content/functions, not a mandatory default font size or spacing design. Necessary 2D content does not exempt the surrounding page.
- [SC 3.3.8](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html): assess support/alternatives across authentication steps. Do not remove MFA to pass.
- SC 4.1.1 was removed from WCAG 2.2. HTML/duplicate-ID failures can still break other criteria; explain the actual consequence.
- Native semantics and APG can guide implementations. Missing skip link, missing aria-label with a visible label, or a native checkbox do not independently prove a WCAG failure; assess equivalent semantics and operation.

Use [WCAG 2.2](https://www.w3.org/TR/WCAG22/) as normative authority and [ARIA APG](https://www.w3.org/WAI/ARIA/apg/) for relevant widget guidance. Additional product requirements (reduced motion, full-focus visibility, forced colors) retain their own labels.
