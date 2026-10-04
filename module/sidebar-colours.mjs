/**
 * Colour-coded sidebar tabs (client setting "sidebarTabColours", default on): the Combat, Scenes, Actors, Items, Journal
 * and Compendium tab icons get Okabe-Ito colours (Okabe & Ito 2008, "Color Universal Design"; Wong 2011, Nature Methods
 * 8:441), and the open one a coloured underline. Other tabs are unchanged. Markup diagnosed on core 14.368:
 * `menu > li > button.ui-control[data-action="tab"][data-group="primary"][data-tab="combat"]`, the icon is the
 * button's own Font Awesome glyph, the open tab has `.active` / aria-pressed="true". The CSS (styles/ad2e.css) applies
 * under the body class `ad2e-tab-colours`.
 */
export const TAB_COLOURS = {
  combat: "#D55E00",     // vermillion
  actors: "#E69F00",     // orange
  scenes: "#009E73",     // bluish green
  items: "#56B4E9",      // sky blue
  journal: "#F0E442",    // yellow
  compendium: "#CC79A7"  // reddish purple
};

function apply(on) {
  document.body?.classList.toggle("ad2e-tab-colours", !!on);
}

export function registerSidebarColours() {
  game.settings.register("ad2e", "sidebarTabColours", {
    name: "AD2E.TabColours.Setting", hint: "AD2E.TabColours.SettingHint", scope: "client", config: true, type: Boolean,
    default: true, onChange: apply
  });
  Hooks.once("ready", () => {
    let on = true;
    try { on = game.settings.get("ad2e", "sidebarTabColours"); } catch { /* not registered */ }
    apply(on);
  });
}
