# E2E browser: no fontconfig configuration means no text rendering and no text input

Status: root-caused. Fix is an environment variable, outside this repository's code.

## Symptom, before the fix

Playwright drives the Chromium this environment provides, and the page comes up with a broken text stack:

- **No text is visible anywhere in the app.** Screenshots of the real Web UI show icon-only chrome and empty cards; Playwright reports every text node as hidden, which is why assertions had to fall back to `toHaveText`.
- **Typing inserts nothing, in any element.** `page.keyboard.type` and `locator.pressSequentially` dispatch a `keydown` that bubbles to `document` with `defaultPrevented === false`, and then **no `beforeinput` and no `input` event follow**. `locator.fill` and a raw CDP `Input.insertText` leave the value empty. A plain `<input>` injected into `document.body` and focused behaves identically, which is what proves this is not the app and not a plugin.
- Some navigations closed the page or killed the renderer.
- The pre-existing `generative-ui` browser suite failed in this environment, before this plugin existed, for the same reason.

## Root cause

The session has no font configuration: `/etc/fonts` does not exist, `FONTCONFIG_FILE` and `FONTCONFIG_PATH` are empty, and fonts exist only inside the Nix store. The browser says so itself:

```
Fontconfig error: Cannot load default config file: File not found
```

With zero registered fonts, Chromium renders every glyph as nothing and its text-insertion path does not produce input events either. Nothing about Paseo, React Native Web or this plugin is involved.

## Fix

Point the browser's process at a fontconfig file that lists the store font directories, then run the suite:

```xml
<!-- /tmp/fc/fonts.conf -->
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>/nix/store/71mxn2pyq807r32qsd2mdszkajhlb39q-dejavu-fonts-2.37/share/fonts</dir>
  <dir>/nix/store/1nnsca2xfhhz8xkadcpy4hv2kwffs0zy-dejavu-fonts-minimal-2.37/share/fonts</dir>
  <cachedir>/tmp/fc/cache</cachedir>
</fontconfig>
```

```sh
FONTCONFIG_FILE=/tmp/fc/fonts.conf pnpm test:e2e
```

## Evidence, both directions

- With `FONTCONFIG_FILE`: `e2e/secret-request.e2e.mjs` passes **6 of 6**, including the scenario that types into the card field, and `e2e/generative-ui.e2e.mjs` passes **every** scenario, including the ones that were red in this environment before this plugin existed.
- Without it: `a browser can deliver keyboard text to the card field` fails with the control probe it carries, reporting that both the card field and a plainly injected focused input kept `""`.

## Recommendation

Export `FONTCONFIG_FILE` (or install a fontconfig configuration through `devenv.nix`, which is a project configuration change for the owner to approve) so `pnpm test:e2e` works out of the box. Do not hard-code store paths in the harness: the path is host-specific.

Playwright's own bundled Chromium cannot launch on NixOS without `nix-ld` (`Could not start dynamically linked executable`), so the working combination here is the Nix-provided Chromium plus this font configuration.

## Related

- `plugins/secret-request/README.md` — the card's verification status.
- `design/plugin-secret-input-request/design.md` — the verification plan and the same finding.
