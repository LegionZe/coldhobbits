/**
 * Opaque windows for this system's applications. Foundry's dark theme gives application windows a background of
 * rgba(11, 10, 19, 0.9) and relies on a backdrop blur to hide what is behind; with the "performance-low" body class the
 * blur is off (backdrop-filter: none), so text from windows behind shows through (diagnosed on core 14.368). The window's
 * own computed background colour is kept and made fully opaque, so it follows the active theme.
 * Client setting "opaqueWindows" (default on) turns this off.
 */
export function opaqueBackground(color) {
  const m = String(color).match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : (m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]));
  if (alpha >= 1 || alpha === 0) return null; // already opaque, or no background of its own
  return `rgb(${m[1]}, ${m[2]}, ${m[3]})`;
}

export function registerOpaqueWindows() {
  game.settings.register("ad2e", "opaqueWindows", {
    name: "AD2E.Opaque.Setting", hint: "AD2E.Opaque.SettingHint", scope: "client", config: true, type: Boolean, default: true
  });
  Hooks.on("renderApplicationV2", (app, element) => {
    if (!element?.classList?.contains("ad2e")) return;
    let on = true;
    try { on = game.settings.get("ad2e", "opaqueWindows"); } catch { /* not registered */ }
    element.style.removeProperty("background-color");
    if (!on) return;
    const color = opaqueBackground(getComputedStyle(element).backgroundColor);
    if (color) element.style.backgroundColor = color;
  });
}
