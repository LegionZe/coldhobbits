/**
 * Ship actions (actor type "ship"; Of Ships and the Sea, owner's request 1.0.80): seaworthiness checks and their outcomes,
 * the foundering clock, repairs at sea and at a shipyard, speed increases, skeleton-crew effort and crew experience.
 * Rules in module/naval.mjs (pure); sources quoted there and in tools/build-naval-tables.py.
 * Shipwrecks (OSS) rev 172512: "A ship that fails its Seaworthiness check sinks after 1d10 hours"; "A roll of 20 on a
 * storm-induced Seaworthiness check indicates that the vessel in question has capsized"; grounding on a soft coast: refloat
 * "after 1d6 days of work" and "-3 penalty until properly repaired at a shipyard"; rocky coasts and reefs: "sink within 1d3
 * hours", a natural 20 "splinters and sinks immediately". Resolution Phase (OSS) rev 249023: patching "on a roll of 12 or
 * better on 1d20" (+3 with a Seamanship or Shipbuilding check; not in combat or with a skeleton crew), repairs at sea of
 * "1d6 points of hull damage and 1d12 points of crippling damage", Table 29 sinking times, Table 30 shipyard costs.
 * Implementation choices: the sinking clock is world time (`system.founderAt`), checked by the active GM on
 * updateWorldTime; a ship sinking at once still takes its Table 29 rounds; outcome texts are whispered to the GM and the
 * ship's owners.
 */
import { ad2eDialog } from "./dialogs.mjs";
import { boostSucceeds, checkPenalty, experienceFor, NAVAL, seaRepair, seaRepairDays, seaworthinessCheck, shipyardRepair } from "./naval.mjs";

const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
const HOUR = 3600;

async function roll(formula) {
  const r = await new Roll(formula).evaluate();
  return r;
}

/** Whisper targets: GMs and the ship's owners. */
function audience(actor) {
  return (game.users ?? []).filter(u => u.isGM || actor?.testUserPermission?.(u, "OWNER")).map(u => u.id);
}

async function card(actor, html, rolls = []) {
  return ChatMessage.implementation.create({ speaker: ChatMessage.getSpeaker({ actor }), content: html, rolls, whisper: audience(actor) });
}

/** Situations offered in the seaworthiness dialog (penalty, whether a failure grounds, rocky ground). */
export const SITUATIONS = {
  gale: { founder: true }, storm: { founder: true, storm: true }, choppy: { founder: true, choppy: true },
  hull: { founder: true, damage: true }, groundSoft: { ground: "soft" }, groundRocky: { ground: "rocky", rocky: true },
  shoals: { ground: "rocky", rocky: true, extra: -1 }, other: { founder: true }
};

/**
 * Seaworthiness check from the ship sheet or the voyage tool: the situation sets the outcome of a failure (founder,
 * capsize, ground on a soft or rocky bottom). Choppy seas: Small ships -1, Medium ships normal, larger ships need no check.
 */
export async function rollSeaworthiness(actor, { situation = null } = {}) {
  const s = actor.system;
  const choice = situation ? { situation, extra: 0 } : await ad2eDialog.prompt({
    window: { title: i18n("AD2E.Naval.CheckTitle", { name: actor.name }) }, rejectClose: false,
    content: `<p class="ad2e-note">${esc(i18n("AD2E.Naval.CheckHint", { rating: s.seaworthinessNow }))}</p>`
      + (s.spec?.seaworthinessStorm || s.spec?.seaworthinessReef ? `<p class="ad2e-note">${esc(i18n("AD2E.Naval.SituationRatings",
        { storm: s.seaworthinessIn("storm"), reef: s.seaworthinessIn("shoals"), other: s.seaworthinessIn("other") }))}</p>` : "")
      + `<div class="form-group"><label>${esc(i18n("AD2E.Naval.Situation.label"))}</label><select name="situation">`
      + Object.keys(SITUATIONS).map(k => `<option value="${k}">${esc(i18n(`AD2E.Naval.Situation.${k}`))}</option>`).join("") + `</select></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.Roll.Modifier"))}</label><input type="text" name="extra" value="0"></div>`,
    ok: { label: i18n("AD2E.Roll.Roll"), callback: (e, b) => ({ situation: b.form.elements.situation.value, extra: Number(b.form.elements.extra.value) || 0 }) }
  });
  if (!choice) return null;
  const sit = SITUATIONS[choice.situation] ?? SITUATIONS.other;
  if (sit.choppy && ["large", "veryLarge"].includes(s.sizeKey)) return card(actor, `<p>${esc(i18n("AD2E.Naval.NoCheckNeeded", { name: actor.name }))}</p>`);
  const extra = (choice.extra ?? 0) + (sit.extra ?? 0) + (sit.choppy && s.sizeKey === "small" ? -1 : 0);
  const penalty = checkPenalty({ wind: sit.storm ? "storm" : "", skeleton: s.crewState === "skeleton" && !s.skeletonPushed, jury: s.jury, extra });
  const r = await roll("1d20");
  const rating = s.seaworthinessIn?.(choice.situation) ?? s.seaworthinessNow;
  const res = seaworthinessCheck(r.total, rating, { penalty, storm: !!sit.storm, rocky: !!sit.rocky });
  const now = game.time?.worldTime ?? 0;
  const lines = [i18n("AD2E.Naval.CheckResult", { name: actor.name, roll: res.roll, target: res.target })];
  const update = {};
  const rolls = [r];
  if (!res.fail) lines.push(i18n("AD2E.Naval.CheckPassed"));
  else if (res.capsized || res.splintered) {
    update["system.sunk"] = true;
    update["system.founderAt"] = null;
    lines.push(i18n(res.capsized ? "AD2E.Naval.Capsized" : "AD2E.Naval.Splintered"));
  } else if (sit.ground === "soft") {
    const d = await roll(NAVAL.wreck.groundSoftDays);
    rolls.push(d);
    Object.assign(update, { "system.aground": "soft", "system.jury": true });
    lines.push(i18n("AD2E.Naval.GroundSoft", { days: d.total }));
  } else if (sit.ground === "rocky") {
    const h = await roll(NAVAL.wreck.rockyHours);
    rolls.push(h);
    Object.assign(update, { "system.aground": "rocky", "system.founderAt": now + h.total * HOUR });
    lines.push(i18n("AD2E.Naval.GroundRocky", { hours: h.total }));
  } else if (sit.damage && res.roll === 20) {
    const t = NAVAL.combat.sinking[s.sizeKey] ?? "1";
    const rounds = await roll(t);
    rolls.push(rounds);
    update["system.founderAt"] = now + rounds.total * (CONFIG.time?.roundTime || 60);
    lines.push(i18n("AD2E.Naval.SinksRounds", { n: rounds.total }));
  } else {
    const h = await roll(NAVAL.wreck.founderHours);
    rolls.push(h);
    const at = now + h.total * HOUR;
    update["system.founderAt"] = s.founderAt !== null && s.founderAt !== undefined ? Math.min(s.founderAt, at) : at;
    lines.push(i18n("AD2E.Naval.Founders", { hours: h.total }));
  }
  if (Object.keys(update).length) await actor.update(update);
  return card(actor, lines.map(l => `<p>${esc(l)}</p>`).join(""), rolls);
}

/** Patch a foundering ship (1d20 12+, +3 for a Seamanship or Shipbuilding check). */
export async function patchShip(actor) {
  const s = actor.system;
  if (s.founderAt === null || s.founderAt === undefined || s.sunk) return ui.notifications.info(i18n("AD2E.Naval.NotFoundering"));
  if (s.crewState !== "full") return ui.notifications.warn(i18n("AD2E.Naval.SkeletonCannot"));
  const skill = await ad2eDialog.confirm({ window: { title: i18n("AD2E.Naval.Patch") }, rejectClose: false,
    content: `<p>${esc(i18n("AD2E.Naval.PatchAsk"))}</p>` });
  if (skill === null) return null;
  const r = await roll("1d20");
  const total = r.total + (skill ? 3 : 0);
  const ok = total >= 12;
  if (ok) await actor.update({ "system.founderAt": null });
  return card(actor, `<p>${esc(i18n(ok ? "AD2E.Naval.Patched" : "AD2E.Naval.NotPatched", { name: actor.name, total }))}</p>`, [r]);
}

/** Repairs at sea after an event (hull 1d6, crippling 1d12, not more than the event caused; not with a skeleton crew). */
export async function repairAtSea(actor) {
  const s = actor.system;
  if (s.crewState !== "full") return ui.notifications.warn(i18n("AD2E.Naval.SkeletonCannot"));
  const lostHull = s.hullMax - s.hullNow;
  const lostCrip = s.cripplingMax - s.cripplingNow;
  const f = await ad2eDialog.prompt({
    window: { title: i18n("AD2E.Naval.RepairAtSea") }, rejectClose: false,
    content: `<p class="ad2e-note">${esc(i18n("AD2E.Naval.RepairHint"))}</p>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.Naval.EventHull"))}</label><input type="number" name="hull" min="0" value="${lostHull}"></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.Naval.EventCrippling"))}</label><input type="number" name="crip" min="0" value="${lostCrip}"></div>`,
    ok: { label: i18n("AD2E.Roll.Roll"), callback: (e, b) => ({ hull: Math.min(Number(b.form.elements.hull.value) || 0, lostHull),
      crip: Math.min(Number(b.form.elements.crip.value) || 0, lostCrip) }) }
  });
  if (!f) return null;
  const rolls = [];
  let hull = 0, crip = 0, hullDays = 0, cripDays = 0;
  if (f.hull > 0) {
    const a = await roll("1d6"); const d = await roll("1d4"); rolls.push(a, d);
    hull = seaRepair({ hullRoll: a.total, cripplingRoll: 0, hullLost: f.hull, cripplingLost: 0 }).hull;
    hullDays = seaRepairDays(s.sizeKey, d.total);
  }
  if (f.crip > 0) {
    const a = await roll("1d12"); const d = await roll("1d4"); rolls.push(a, d);
    crip = seaRepair({ hullRoll: 0, cripplingRoll: a.total, hullLost: 0, cripplingLost: f.crip }).crippling;
    cripDays = d.total;
  }
  const update = { "system.hull.value": Math.min(s.hullNow + hull, s.hullMax), "system.crippling.value": Math.min(s.cripplingNow + crip, s.cripplingMax) };
  // "Once the ship regains even one hull point from repairs, it stops leaking."
  if (hull > 0) update["system.founderAt"] = null;
  await actor.update(update);
  return card(actor, `<p>${esc(i18n("AD2E.Naval.Repaired", { name: actor.name, hull, hullDays, crip, cripDays }))}</p>`, rolls);
}

/** Shipyard repair (GM): Table 30 cost and time; restores hull and crippling points and removes jury rigging. */
export async function shipyardRepairShip(actor) {
  if (!game.user?.isGM) return null;
  const s = actor.system;
  const points = (s.hullMax - s.hullNow) + (s.cripplingMax - s.cripplingNow);
  const r = shipyardRepair(s.sizeKey, points);
  const ok = await ad2eDialog.confirm({ window: { title: i18n("AD2E.Naval.Shipyard") }, rejectClose: false,
    content: `<p>${esc(i18n("AD2E.Naval.ShipyardAsk", { points, cost: r.cost, days: r.days }))}</p>` });
  if (!ok) return null;
  await actor.update({ "system.hull.value": s.hullMax, "system.crippling.value": s.cripplingMax, "system.jury": false, "system.aground": "",
    "system.founderAt": null });
  return card(actor, `<p>${esc(i18n("AD2E.Naval.ShipyardDone", { name: actor.name, cost: r.cost, days: r.days }))}</p>`);
}

/** Speed increase (rowing sprint, sailing, daily push): 1d20 12+, +3 with a Seamanship check (daily push: the check at -2). */
export async function speedBoost(actor) {
  const s = actor.system;
  if (s.crewState !== "full") return ui.notifications.warn(i18n("AD2E.Naval.SkeletonNoBoost"));
  const kinds = s.prop === "oar" ? ["row", "push"] : s.prop === "sail" ? ["sail", "push"] : ["row", "sail", "push"];
  const f = await ad2eDialog.prompt({
    window: { title: i18n("AD2E.Naval.Boost") }, rejectClose: false,
    content: `<div class="form-group"><label>${esc(i18n("AD2E.Naval.BoostKind"))}</label><select name="kind">`
      + kinds.map(k => `<option value="${k}">${esc(i18n(`AD2E.Naval.BoostKinds.${k}`))}</option>`).join("") + `</select></div>`
      + `<div class="form-group"><label>${esc(i18n("AD2E.Naval.SeamanshipPassed"))}</label><input type="checkbox" name="skill"></div>`,
    ok: { label: i18n("AD2E.Roll.Roll"), callback: (e, b) => ({ kind: b.form.elements.kind.value, skill: b.form.elements.skill.checked }) }
  });
  if (!f) return null;
  const r = await roll("1d20");
  const ok = boostSucceeds(r.total, f.skill);
  return card(actor, `<p>${esc(i18n(ok ? `AD2E.Naval.BoostOk.${f.kind}` : "AD2E.Naval.BoostFail", { name: actor.name, roll: r.total + (f.skill ? 3 : 0) }))}</p>`, [r]);
}

/** Skeleton crew effort (non-combat): a morale check (2d10 at or under the rating) keeps full speed and seaworthiness today; -1 morale either way. */
export async function skeletonEffort(actor) {
  const s = actor.system;
  if (s.crewState !== "skeleton") return ui.notifications.info(i18n("AD2E.Naval.NotSkeleton"));
  const r = await roll("2d10");
  const ok = r.total <= s.moraleRating;
  await actor.update({ "system.skeletonPushed": ok, "system.morale.tired": s.morale.tired + NAVAL.travel.skeleton.moraleCost });
  return card(actor, `<p>${esc(i18n(ok ? "AD2E.Naval.EffortOk" : "AD2E.Naval.EffortFail", { name: actor.name, roll: r.total, rating: s.moraleRating }))}</p>`, [r]);
}

/** Crew experience at random (Table 12: 3d4, +2 traders and pirates, +3 privateers and warships). */
export async function rollCrewExperience(actor) {
  const f = await ad2eDialog.prompt({
    window: { title: i18n("AD2E.Naval.RollExperience") }, rejectClose: false,
    content: `<div class="form-group"><label>${esc(i18n("AD2E.Naval.ShipRole"))}</label><select name="bonus">`
      + [0, 2, 3].map(b => `<option value="${b}">${esc(i18n(`AD2E.Naval.ShipRoles.r${b}`))}</option>`).join("") + `</select></div>`,
    ok: { label: i18n("AD2E.Roll.Roll"), callback: (e, b) => Number(b.form.elements.bonus.value) || 0 }
  });
  if (f === null || f === undefined) return null;
  const r = await roll(`3d4 + ${f}`);
  const exp = experienceFor(r.total);
  await actor.update({ "system.experience": exp });
  return card(actor, `<p>${esc(i18n("AD2E.Naval.ExperienceRolled", { name: actor.name, roll: r.total, exp: i18n(`AD2E.Naval.Experience.${exp}`) }))}</p>`, [r]);
}

/** Ships whose sinking clock has run out (pure over a list; world time `now`). */
export function shipsSinking(actors, now) {
  return [...(actors ?? [])].filter(a => a?.type === "ship" && !a.system?.sunk && a.system?.founderAt !== null
    && a.system?.founderAt !== undefined && now >= a.system.founderAt);
}

/** The sinking clock (active GM, updateWorldTime). Called in init. */
export function registerShips() {
  Hooks.on("updateWorldTime", async now => {
    if (!game.user?.isActiveGM) return;
    for (const a of shipsSinking(game.actors ?? [], now)) {
      await a.update({ "system.sunk": true, "system.founderAt": null });
      await card(a, `<p><strong>${esc(i18n("AD2E.Naval.Sank", { name: a.name }))}</strong> ${esc(i18n("AD2E.Naval.SankNote"))}</p>`);
    }
  });
}
