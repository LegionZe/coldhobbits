/**
 * Dialogs and windows of this system that fit the screen (owner's request, 1.0.26): every DialogV2 the system opens goes
 * through `ad2eDialog` (resizable, class "ad2e-dialog"), and `registerWindowFit` keeps those dialogs and the system's other
 * windows within the browser window, with a scrolling content area, so their buttons stay reachable.
 * Foundry v14 API (https://foundryvtt.com/api/classes/foundry.applications.api.ApplicationV2.html): window configuration
 * `resizable`; `ApplicationV2#window.content` / `.header` (the frame's elements); `setPosition`; the "position" event.
 */
const MARGIN = 10;

/** A dialog configuration with the system's defaults added (pure). */
export function dialogConfig(config = {}) {
  return { ...config, classes: [...(config.classes ?? []), "ad2e-dialog"], window: { resizable: true, ...(config.window ?? {}) } };
}

const call = (method, config) => foundry.applications.api.DialogV2[method](dialogConfig(config));
export const ad2eDialog = {
  wait: config => call("wait", config),
  prompt: config => call("prompt", config),
  confirm: config => call("confirm", config)
};

/** Largest content height (px) for a window height (number or "auto"), header height and viewport height (pure). */
export function contentLimit(height, header, viewport) {
  const total = typeof height === "number" && height > 0 ? Math.min(height, viewport - 2 * MARGIN) : viewport - 2 * MARGIN;
  return Math.max(total - header, 60);
}

/** Should this window be fitted? The system's dialogs and its windows other than document sheets (which scroll per tab). */
export function fitsWindow(app, element) {
  const classes = element?.classList;
  if (!classes) return false;
  if (classes.contains("ad2e-dialog")) return true;
  const DocumentSheet = foundry.applications.api.DocumentSheetV2;
  return classes.contains("ad2e") && !(DocumentSheet && app instanceof DocumentSheet);
}

/** Cap the content area to the screen, let it scroll, and bring the window back on screen. */
export function fitWindow(app) {
  const content = app.window?.content;
  const element = app.element;
  if (!content || !element) return;
  const viewport = globalThis.innerHeight || 800;
  content.style.overflowY = "auto";
  content.style.maxHeight = `${contentLimit(app.position?.height, app.window.header?.offsetHeight ?? 0, viewport)}px`;
  const height = element.offsetHeight;
  const top = Number(app.position?.top);
  if (Number.isFinite(top) && height && (top < MARGIN || top + height > viewport - MARGIN)) {
    app.setPosition({ top: Math.max(MARGIN, Math.min(top, viewport - height - MARGIN)) });
  }
}

const watched = new WeakSet();

export function registerWindowFit() {
  Hooks.on("renderApplicationV2", (app, element) => {
    if (!fitsWindow(app, element)) return;
    fitWindow(app);
    // Resizing by the user: follow the new height.
    if (!watched.has(app) && typeof app.addEventListener === "function") {
      watched.add(app);
      app.addEventListener("position", () => {
        const content = app.window?.content;
        if (content) content.style.maxHeight = `${contentLimit(app.position?.height, app.window.header?.offsetHeight ?? 0, globalThis.innerHeight || 800)}px`;
      });
    }
  });
}
