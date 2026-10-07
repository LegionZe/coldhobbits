/**
 * Saving throw requests in chat (owner's ruling: a Save button for each target's owner and a GM button that rolls every
 * save left). A request message carries `flags.ad2e.saveRequest` { key (save category), kind ("poison" | "spell" | ...),
 * title, targets [{ uuid, name }], results { <index>: { success, roll } }, data }. The save roll (AD2EActor#rollSave with
 * `request`) carries `flags.ad2e.save.request` / `target`; the active GM records it on the request and runs the handler
 * registered for the request's kind (module/poison.mjs: the poison's effect).
 */
const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const resolve = uuid => (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(uuid, { strict: false }) ?? null;

const HANDLERS = new Map();

/** Run `fn(actor, request, index, success, message)` on the active GM's client when a save of this kind is recorded. */
export function registerSaveHandler(kind, fn) {
  HANDLERS.set(kind, fn);
}

export function saveRequestOf(message) {
  return message?.getFlag?.("ad2e", "saveRequest") ?? null;
}

/** The actor behind a target reference (a token UUID or an actor UUID). */
export function targetActor(target) {
  const doc = target?.uuid ? resolve(target.uuid) : null;
  return doc?.actor ?? (doc?.documentName === "Actor" ? doc : null);
}

/** Targets grouped by recorded result: { saved, failed, open } (lists of { uuid, name, index }). Pure. */
export function groupResults(request) {
  const out = { saved: [], failed: [], open: [] };
  (request?.targets ?? []).forEach((t, index) => {
    const r = request.results?.[index];
    (r ? (r.success ? out.saved : out.failed) : out.open).push({ ...t, index });
  });
  return out;
}

/** Post a save request for `targets` ([{ uuid, name }]). */
export async function createSaveRequest({ speaker, key = "sp", kind = "", title = "", content = "", targets = [], data = {}, rolls = [], flags = {} }) {
  return ChatMessage.create({
    speaker, rolls, content: `${title ? `<p><strong>${esc(title)}</strong></p>` : ""}${content}`
      + (targets.length ? "" : `<p class="ad2e-note">${esc(i18n("AD2E.SaveRequest.NoTargets"))}</p>`),
    flags: { ad2e: { ...flags, saveRequest: { key, kind, title, targets, results: {}, data } } }
  });
}

/** Roll one target's save (the owner's dialog, or `quick` without one). */
async function rollFor(message, request, index, quick) {
  const actor = targetActor(request.targets[index]);
  if (!actor?.rollSave) return;
  if (!actor.isOwner) {
    ui.notifications.warn(i18n("AD2E.Health.NotOwner", { name: actor.name }));
    return;
  }
  return actor.rollSave(request.key, { request: message.id, target: index, poison: request.kind === "poison", quick });
}

/** Rows with results or Save buttons under a request message; a GM "roll all" button. From AD2EChatMessage#renderHTML. */
export function saveRequestButtons(message, html) {
  const request = saveRequestOf(message);
  if (!request || !html?.querySelector || !request.targets?.length) return;
  const box = document.createElement("div");
  box.className = "ad2e-save-request";
  const save = i18n(`AD2E.Save.${request.key}`);
  let open = 0;
  box.innerHTML = `<ul>${request.targets.map((t, i) => {
    const r = request.results?.[i];
    if (r) return `<li>${esc(t.name)}: ${esc(save)} ${r.roll ?? ""} — ${esc(i18n(r.success ? "AD2E.Roll.Success" : "AD2E.Roll.Failure"))}</li>`;
    open += 1;
    const actor = targetActor(t);
    return `<li>${esc(t.name)}: ${actor?.isOwner ? `<button type="button" data-ad2e-save="${i}"><i class="fa-solid fa-shield-halved"></i> ${esc(save)}</button>`
      : esc(i18n("AD2E.SaveRequest.Waiting"))}</li>`;
  }).join("")}</ul>`
    + (game.user?.isGM && open > 1 ? `<button type="button" data-ad2e-save-all><i class="fa-solid fa-dice-d20"></i> ${esc(i18n("AD2E.SaveRequest.RollAll"))}</button>` : "");
  for (const b of box.querySelectorAll("button[data-ad2e-save]")) {
    b.addEventListener("click", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      rollFor(message, saveRequestOf(message), Number(b.dataset.ad2eSave), false);
    });
  }
  box.querySelector("button[data-ad2e-save-all]")?.addEventListener("click", async ev => {
    ev.preventDefault();
    ev.stopPropagation();
    const req = saveRequestOf(message);
    for (const t of groupResults(req).open) await rollFor(message, req, t.index, true);
  });
  (html.querySelector(".message-content") ?? html).append(box);
}

/** Record a save roll on its request (active GM) and run the kind's handler once per target. */
async function recordSave(saveMessage) {
  const save = saveMessage.getFlag("ad2e", "save");
  if (!save?.request || save.target === null || save.target === undefined) return;
  const message = game.messages.get(save.request);
  const request = saveRequestOf(message);
  if (!request || request.results?.[save.target]) return;
  await message.update({ [`flags.ad2e.saveRequest.results.${save.target}`]: { success: !!save.success, roll: save.roll ?? null } });
  const actor = targetActor(request.targets[save.target]);
  const handler = HANDLERS.get(request.kind);
  if (actor && handler) await handler(actor, request, save.target, !!save.success, message);
}

export function registerSaveRequests() {
  Hooks.on("createChatMessage", message => {
    if (game.user?.isActiveGM && message.getFlag?.("ad2e", "save")?.request) recordSave(message);
  });
}
