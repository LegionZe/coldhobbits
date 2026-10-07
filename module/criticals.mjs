import { CRITICALS } from "./rules/critical-tables.mjs";
import { createSaveRequest } from "./save-requests.mjs";

/**
 * Critical hits (Combat & Tactics, chapter 6; module/rules/critical-tables.mjs from tools/build-critical-tables.py).
 * World setting `criticalHits` (owner's ruling): "off", "system1" (double damage dice) or "system2" (also location and
 * severity on the nine charts, a save vs. death against the specific injury; the chart's effect is linked, not copied).
 * Both sides: monsters score and suffer criticals like characters ("if monsters have to suffer critical hits, so do
 * player characters"). Trigger: a natural 18+ that hits by 5 or more. Extra dice: +1 set (double), +2 with System II
 * severity 13+ (triple); already doubled damage adds them (the lance: 2d6 charge + critical = 3d6).
 * Implementation choices: a monster's natural attacks count as weapons of its own size; a weapon of several types uses
 * the first type listed (or the Table 52 type used); a monster's target type is its `bodyType` ("" = monster).
 */
export const CRIT = CRITICALS;

export function criticalMode() {
  try { return game.settings.get("ad2e", "criticalHits") ?? "off"; } catch { return "off"; }
}

/** A natural 18+ that hits by 5 or more (pure). */
export function isCritical(natural, total, needed) {
  return Number.isFinite(natural) && natural >= CRIT.natural && total >= needed + CRIT.margin;
}

const step = size => {
  const i = CRIT.sizes.indexOf(String(size ?? "").trim().charAt(0).toUpperCase());
  return i < 0 ? 2 : i;
};

/** Severity key and dice: weapon size against target size (pure). */
export function severityFor(weaponSize, targetSize) {
  const d = step(weaponSize) - step(targetSize);
  const key = d >= 2 ? "twoLarger" : d === 1 ? "larger" : d === 0 ? "equal" : "smaller";
  return { key, formula: CRIT.severity[key] };
}

/** Location die: low attacks (target two sizes larger) d6, high attacks (attacker two sizes larger) 1d6+4, else d10 (pure). */
export function locationFormula(attackerSize, targetSize) {
  const d = step(attackerSize) - step(targetSize);
  return d <= -2 ? CRIT.location.low : d >= 2 ? CRIT.location.high : CRIT.location.normal;
}

/** Chart key from a weapon type text and target kind (pure); null when the weapon has no type. */
export function chartKey(typeText, kind = "monster") {
  const t = String(typeText ?? "").toUpperCase().match(/[BPS]/)?.[0];
  return t ? `${t}-${["humanoid", "animal", "monster"].includes(kind) ? kind : "monster"}` : null;
}

/** The location of a d10 roll on a chart (pure). */
export function locationAt(key, roll) {
  return CRIT.charts[key]?.locations.find(l => roll >= l.min && roll <= l.max)?.label ?? "";
}

/** Characters are humanoids; monsters use their body type (default: monster). */
export function targetKind(actor) {
  if (actor?.type === "character") return "humanoid";
  return actor?.system?.bodyType || "monster";
}

/** Size for critical severity of a weapon item (arrows and bolts M, heavy crossbow bolts L), or the attacker's size. */
export function weaponCritSize(item, attackerSize = "M") {
  const w = item?.system?.weapon;
  if (!w) return attackerSize;
  if (item.system.identifier === "heavy-crossbow") return "L";
  if (["bow", "crossbow"].includes(w.family)) return "M";
  return w.size || attackerSize;
}

/** Dice in a formula multiplied (pure): "2d4+1", 3 -> "(2d4 * 3)+1". */
export function multiplyDice(formula, n) {
  if (n === 1) return String(formula);
  return String(formula).replace(/(\d*)d(\d+)/g, (m) => `(${m} * ${n})`);
}

/**
 * Roll a critical (System II rolls location and severity): { mode, extra, chart, location, severity, sevKey, triple, url }.
 * `calledLocation`: the location aimed at with a called shot (no location roll).
 */
export async function rollCritical({ typeText, attackerSize = "M", weaponSize = "M", target = null, calledLocation = "" }) {
  const mode = criticalMode();
  const crit = { mode, extra: 1 };
  if (mode !== "system2") return crit;
  const key = chartKey(typeText, targetKind(target));
  if (!key) return { ...crit, noChart: true };
  const targetSize = target ? sizeOfActor(target) : "M";
  const sev = severityFor(weaponSize, targetSize);
  const sevRoll = await new Roll(sev.formula).evaluate();
  let location = calledLocation;
  let locRoll = null;
  if (!location) {
    locRoll = await new Roll(locationFormula(attackerSize, targetSize)).evaluate();
    location = locationAt(key, locRoll.total);
  }
  const triple = sevRoll.total >= CRIT.tripleAt;
  return { mode, extra: triple ? 2 : 1, chart: key, chartTitle: CRIT.charts[key].title, url: CRIT.charts[key].url, location,
    locationRoll: locRoll?.total ?? null, severity: sevRoll.total, sevKey: sev.key, triple, rolls: [locRoll, sevRoll].filter(Boolean) };
}

/** A creature's size letter (characters: race size; monsters: the first letter of their size). */
export function sizeOfActor(actor) {
  if (actor?.type === "character") return actor.system?.sizeCategory ?? "M";
  return String(actor?.system?.size ?? "M").trim().charAt(0).toUpperCase() || "M";
}

const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** Short chat text for the attack line. */
export function criticalText(crit) {
  if (!crit) return "";
  return i18n(crit.triple ? "AD2E.Critical.Triple" : "AD2E.Critical.Double");
}

/**
 * System II: post the location and severity with the chart link, and a save vs. death request for the target (the
 * specific injury only on a failed save; the extra damage dice apply either way).
 */
export async function postCriticalCard(attacker, crit, targets) {
  if (crit?.mode !== "system2" || !crit.chart) return null;
  const speaker = ChatMessage.getSpeaker({ actor: attacker });
  const content = `<p>${esc(i18n("AD2E.Critical.Card", { chart: crit.chartTitle, location: crit.location, severity: crit.severity,
    sev: i18n(`AD2E.Critical.Severity.${crit.sevKey}`) }))}${crit.locationRoll !== null ? ` <span class="ad2e-note">(${esc(i18n("AD2E.Critical.LocationRoll", { n: crit.locationRoll }))})</span>` : ""}</p>`
    + (crit.triple ? `<p class="ad2e-unmet">${esc(i18n("AD2E.Critical.TripleNote"))}</p>` : "")
    + `<p><a href="${esc(crit.url)}" target="_blank" rel="noopener"><i class="fa-solid fa-book-open"></i> ${esc(i18n("AD2E.Critical.ChartLink"))}</a></p>`
    + `<p class="ad2e-note">${esc(i18n("AD2E.Critical.SaveHint"))}</p>`;
  return createSaveRequest({ speaker, key: "par", kind: "critical", title: i18n("AD2E.Critical.Title"), content,
    targets: (targets ?? []).slice(0, 1), rolls: crit.rolls ?? [], data: { chart: crit.chart, location: crit.location, severity: crit.severity } });
}

export function registerCriticals() {
  game.settings.register("ad2e", "criticalHits", {
    name: "AD2E.Critical.Setting", hint: "AD2E.Critical.SettingHint", scope: "world", config: true, type: String,
    choices: { off: "AD2E.Critical.Mode.off", system1: "AD2E.Critical.Mode.system1", system2: "AD2E.Critical.Mode.system2" }, default: "off"
  });
}
