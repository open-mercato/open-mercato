# Docs app guidelines

## Always

- For a docs UI promise that says "every" or "all" page, add a regression test over the production build that asserts the stable UI marker on every generated documentation page. Do not validate it only on representative routes or optional Docusaurus theme components.
- Keep `apps/docs`'s test script running every `__tests__/*.test.mjs` file after the production build.

## Validation Commands

```bash
yarn workspace open-mercato-docs test
```
