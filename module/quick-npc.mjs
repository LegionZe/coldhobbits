import { buildNpc, npcActorData, PURPOSE_KEYS } from "./npc-builder.mjs";
import { npcDocs, npcItems } from "./apps/npc-builder.mjs";

/**
 * Quick NPC (owner's request 1.0.66; GM manual tool "Quick NPC", game.ad2e.quickNpc(purpose)): one click rolls a random NPC
 * with the NPC builder's rules (module/npc-builder.mjs, every choice random) and whispers the GM a chat card with what
 * play needs at once: race, class and level, gender, age, alignment, ability scores, hit points, AC, THAC0, saving
 * throws, role, height and weight, personality and looks. Nothing is created until the GM presses "Create actor" on the
 * card (owner's choice: actor on demand); "Another" rolls a new card for the purpose picked beside it.
 * AC, THAC0 and saves are read from an unsaved actor built from the same data as the created one (`new
 * Actor.implementation(data)`: Foundry documents constructed without saving are prepared like saved ones), so they follow
 * the character sheet's rules (armour and shield worn from the class's basic gear, Dexterity, race and class); if that
 * fails they are left off the card. The card's flag `ad2e.quickNpc` keeps { purpose, data (the actor data), created
 * { name, uuid } }. Implementation choice: the default purpose is townsfolk.
 */
export const QUICK_DEFAULT = "townsfolk";
const SAVE_KEYS = ["par", "rsw", "pet", "br", "sp"];
const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** Strength as written: 18/xx for exceptional Strength (01-99, 00 for 100). */
export function strengthText(score, exceptional) {
  return exceptional && score === 18 ? `18/${String(exceptional % 100).padStart(2, "0")}` : String(score);
}

/** Feet and inches from inches ("5' 8\""), or "". */
export function heightText(inches) {
  return inches ? `${Math.floor(inches / 12)}' ${inches % 12}"` : "";
}

/**
 * The card's lines (pure): `spec` from buildNpc, `prepared` { ac, thac0, saves { key: n } } from the unsaved actor or
 * null, `t(key, data)` for labels.
 */
export function quickLines(spec, prepared, t) {
  const adj = k => spec.race?.system?.adjust?.[k] ?? 0;
  const abilities = ABILITY_KEYS.map(k => {
    const v = spec.abilities[k] + adj(k);
    return `${t(`AD2E.QuickNpc.Ability.${k}`)} ${k === "str" ? strengthText(v, spec.exceptional) : v}`;
  }).join(" · ");
  const cls = spec.cls?.name ?? t("AD2E.Npc.NoClass");
  const who = [`${spec.race?.name ?? ""} ${cls}`.trim() + `, ${t("AD2E.Npc.LevelN", { n: spec.level })}`,
    t(`AD2E.Gender.${spec.gender}`), spec.age ? t("AD2E.Npc.AgeN", { n: spec.age }) : null,
    t(CONFIG.AD2E?.alignments?.[spec.alignment] ?? spec.alignment)].filter(Boolean).join(" · ");
  const combat = [t("AD2E.QuickNpc.Hp", { n: spec.hp })];
  if (prepared) combat.push(t("AD2E.QuickNpc.Ac", { n: prepared.ac }), t("AD2E.QuickNpc.Thac0", { n: prepared.thac0 }));
  const saves = prepared?.saves ? SAVE_KEYS.map(k => `${t(`AD2E.QuickNpc.Save.${k}`)} ${prepared.saves[k]}`).join(" · ") : "";
  const body = [heightText(spec.height), spec.weight ? `${spec.weight} lb` : ""].filter(Boolean).join(", ");
  return {
    name: spec.name, who, abilities, combat: combat.join(" · "), saves,
    role: [spec.role, body].filter(Boolean).join(" · "),
    personality: `${spec.traits.general}, ${spec.traits.specific} — ${Object.values(spec.looks).join(", ")}`
  };
}

/** The card's HTML (pure). */
export function quickCardHtml(lines, t) {
  const p = (cls, text) => (text ? `<p${cls ? ` class="${cls}"` : ""}>${esc(text)}</p>` : "");
  return `<div class="ad2e-quick-npc"><h3>${esc(lines.name)}</h3>${p("", lines.who)}${p("", lines.abilities)}`
    + `${p("", lines.combat)}${lines.saves ? `<p title="${esc(t("AD2E.QuickNpc.SavesHint"))}">${esc(t("AD2E.QuickNpc.Saves"))}: ${esc(lines.saves)}</p>` : ""}`
    + `${p("", lines.role)}${p("ad2e-note", lines.personality)}</div>`;
}

/** AC (front), THAC0 and saves of actor data, from an unsaved actor; null on failure. */
export function preparedNumbers(data) {
  try {
    const copy = foundry.utils.deepClone(data);
    // Embedded items are keyed by id; the creation data has none (the server assigns them), so give the copy's items ids.
    for (const item of copy.items ?? []) item._id ??= foundry.utils.randomID();
    const actor = new Actor.implementation(copy);
    const sys = actor.system;
    const saves = Object.fromEntries(SAVE_KEYS.map(k => [k, sys.saves?.[k]?.value]));
    const ac = sys.armor?.front;
    if (!Number.isFinite(ac) || !Number.isFinite(sys.thac0?.value) || SAVE_KEYS.some(k => !Number.isFinite(saves[k]))) return null;
    return { ac, thac0: sys.thac0.value, saves };
  } catch (err) {
    console.warn("ad2e | quick NPC: could not prepare the numbers", err);
    return null;
  }
}

/** Roll a quick NPC and whisper the card to the GMs. */
export async function quickNpc(purpose = QUICK_DEFAULT) {
  if (!game.user?.isGM) { ui.notifications?.warn(i18n("AD2E.QuickNpc.GmOnly")); return null; }
  purpose = PURPOSE_KEYS.includes(purpose) ? purpose : QUICK_DEFAULT;
  const spec = buildNpc({ purpose }, await npcItems());
  const data = npcActorData(spec, await npcDocs(spec), i18n);
  const lines = quickLines(spec, preparedNumbers(data), i18n);
  return ChatMessage.implementation.create({
    content: quickCardHtml(lines, i18n),
    whisper: ChatMessage.getWhisperRecipients?.("GM")?.map(u => u.id) ?? [],
    speaker: { alias: i18n("AD2E.QuickNpc.Title") },
    flags: { ad2e: { quickNpc: { purpose, data, created: null } } }
  });
}

/** Buttons on a quick NPC card (GM only; AD2EChatMessage#renderHTML). */
export function quickNpcButtons(message, html) {
  const flag = message?.getFlag?.("ad2e", "quickNpc");
  if (!flag || !game.user?.isGM || !html?.querySelector) return;
  const box = document.createElement("div");
  box.className = "ad2e-damage-buttons ad2e-quick-npc-buttons";
  const created = flag.created
    ? `<span class="ad2e-note">${esc(i18n("AD2E.QuickNpc.Created", { name: flag.created.name }))}</span>`
    : `<button type="button" data-quick="create"><i class="fa-solid fa-user-plus"></i> ${esc(i18n("AD2E.QuickNpc.Create"))}</button>`;
  const options = PURPOSE_KEYS.map(k => `<option value="${k}"${k === flag.purpose ? " selected" : ""}>${esc(i18n(`AD2E.Npc.Purpose.${k}`))}</option>`).join("");
  box.innerHTML = `${created}<select data-quick="purpose" aria-label="${esc(i18n("AD2E.Npc.PurposeLabel"))}">${options}</select>`
    + `<button type="button" data-quick="another"><i class="fa-solid fa-dice"></i> ${esc(i18n("AD2E.QuickNpc.Another"))}</button>`;
  const stop = ev => { ev.preventDefault(); ev.stopPropagation(); };
  box.querySelector("[data-quick='create']")?.addEventListener("click", async ev => {
    stop(ev);
    ev.currentTarget.disabled = true;
    const actor = await Actor.implementation.create(flag.data);
    if (!actor) { ev.currentTarget.disabled = false; return; }
    await message.setFlag("ad2e", "quickNpc.created", { name: actor.name, uuid: actor.uuid });
    ui.notifications?.info(i18n("AD2E.Creator.Created", { name: actor.name }));
    actor.sheet?.render(true);
  });
  box.querySelector("[data-quick='another']").addEventListener("click", ev => {
    stop(ev);
    return quickNpc(box.querySelector("[data-quick='purpose']").value);
  });
  (html.querySelector(".message-content") ?? html).append(box);
}
