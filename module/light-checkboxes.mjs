/**
 * Lighter tick boxes in the system's windows on the dark theme (owner's request, 1.0.35; client setting
 * "lightCheckboxes", default on). Diagnosed on core 14.369 (owner's report): core draws a tick box as the input's
 * `::before` Font Awesome glyph coloured by `--checkbox-background-color`, which `body.theme-dark input[type="checkbox"]`
 * sets to `var(--color-cool-4)` (rgb(48, 40, 49)), dark on the dark window; a ticked box draws its `::after` glyph in
 * `--checkbox-checked-color` (orange). The CSS (styles/ad2e.css) sets `--checkbox-background-color` on the inputs of
 * `.ad2e` sheets and `.ad2e-dialog` dialogs under the body class `ad2e-light-checkboxes`, only on the dark theme.
 */
function apply(on) {
  document.body?.classList.toggle("ad2e-light-checkboxes", !!on);
}

export function registerLightCheckboxes() {
  game.settings.register("ad2e", "lightCheckboxes", {
    name: "AD2E.LightCheckboxes.Setting", hint: "AD2E.LightCheckboxes.SettingHint", scope: "client", config: true, type: Boolean,
    default: true, onChange: apply
  });
  Hooks.once("ready", () => {
    let on = true;
    try { on = game.settings.get("ad2e", "lightCheckboxes"); } catch { /* not registered */ }
    apply(on);
  });
}
