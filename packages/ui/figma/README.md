# Local Code Connect mappings

The local React connection files contain 32 snippets for 28 verified component sets in [DS — Open Mercato](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato). The September 2026 repair replaces all 16 placeholder connections and corrects the two previous page-level targets. It does not publish or register mappings in Figma.

| Connection | Component-set node |
| --- | --- |
| Button | `129:1422` |
| Input, EmailInput, SearchInput, PasswordInput, WebsiteInput | `266:5251` |
| Checkbox / CheckboxField | `227:2002` / `231:4897` |
| Radio | `515:4242` |
| Switch / SwitchField | `385:4086` / `385:4580` |
| SelectTrigger | `270:1085` |
| Badge / StatusBadge | `118:2324` / `171:5100` |
| Tag | `431:16147` |
| TabsTrigger | `3511:9832` |
| Alert | `169:2399` |
| DrawerHeader | `3187:2897` |
| Filter panel item / header / footer | `4379:1183` / `4379:2209` / `4415:863` |
| Empty-state illustrations: finance / HR | `3860:5822` / `3860:4495` |
| FieldLabel / HintText | `266:2814` / `266:5284` |
| ContentLabel / ContentCard | `2945:5539` / `2942:9503` |
| KeyIcon / PaymentIcon | `263:1850` / `2942:9995` |
| ChartLegend / ChartLegendDot | `2942:9934` / `2942:9880` |
| PromptArea | `191226:4236` |

Property names, variant values, text references, and instance slots were read from the actual source sets. The offline evidence is in [`code-connect-properties.json`](../../../docs/design-system/figma-audit/code-connect-properties.json). Button's property-definition getter currently reports an existing Figma component-set error; its axes were checked against actual child variants and its text reference.

The mappings describe supported production props and compositions. Their scope is deliberately specific:

- Button covers text buttons; swapped icons and icon-only variants are not connected here.
  The additive `primary-filled` runtime variant comes from the retained overlay CTA instance `472:831`. The current main set has no Primary axis, so that value is not invented in the connection.
- Inputs cover their main fields. Form labels, hints, strength indicators, and user-entered values remain application compositions; SearchInput includes working local value state.
- Select covers the Basic trigger. Option data and the Country, Avatar, Provider, Brand, and Company types require consumer content.
- Badge covers all ten source hues, four appearances and numeric 16/20 px sizes. The legacy named sizes remain supported.
- StatusBadge includes both appearances and all five semantic statuses. Tag covers Basic tags in Stroke and Gray with no dismiss action; custom assets and removal handlers belong to the consumer.
- CheckboxField and SwitchField map label placement, sublabels, and descriptions. Extra badge/link decorations remain compositions.
- Tabs maps the horizontal item, including its active state and optional leading icon. Counters and trailing icons are not fabricated.
- Drawer maps its header rather than claiming the entire page as one component. Body data, footer actions, and header counts require consumer composition.

The nine new connections use the exact source properties in [`key-components-code-connect-properties.json`](../../../docs/design-system/figma-audit/key-components-code-connect-properties.json) and [`ai-product-variants.json`](../../../docs/design-system/figma-audit/ai-product-variants.json):

- FieldLabel maps normal/disabled, required, optional text, information and the source link-button child. ContentLabel maps all five leading-content types, both sizes, badge and switch children. ContentCard maps all six types and provides working local dismissal.
- KeyIcon maps all 90 style/color/size combinations; PaymentIcon maps eight categories. ChartLegend maps all 12 colors/states and ChartLegendDot all 22 size/color combinations. Source Teal means the measured Sky-colored key-icon family; accessible runtime glyph colors retain the documented adaptations.
- Child and instance-swap mappings retain actual layer/property names. Their resolved snippets depend on the corresponding nested library connections. Local parse success does not prove that every child already has a published connection.
- PromptArea maps the empty desktop/mobile shell, with real controlled text and local draft submission. Its toolbar and attachment slots are consumer compositions. All 18 source prompt variants are implemented in the shared gallery, but the minimal connection deliberately scopes both attachment axes to Off.

Hover and focus are browser interactions, not artificial state props. Semantic tokens can differ from the source palette, and these connections do not imply pixel parity across every source variant.

Run `yarn ds:code-connect:check` locally. Inspect both the JSON and stderr: the CLI can exit successfully after omitting a file with a parser error. The repaired result was checked for 32 rows, 28 unique nodes, no placeholder nodes, and no parser errors; a scoped TypeScript check of the connections and their dependencies also passed.

Server validation remains unverified because `get_context_for_code_connect` was unavailable for the connected Figma seat/plan. The existing parser-based format is retained for this local repair. The CLI warns that parser-based integrations are no longer maintained; a future migration to template files is separate work. Publishing requires explicit user approval.
