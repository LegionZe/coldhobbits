import { COIN_VALUES } from "./rules/movement-tables.mjs";
import { payCoins } from "./station.mjs";
import { dateText } from "./travel-days.mjs";

/**
 * Hireling wages (owner's request and rulings, 1.0.55): a hireling (monster role "hireling") in a character's henchmen list
 * (module/henchmen.mjs) is paid from that employer's coins every 30 days of world time (active GM, updateWorldTime),
 * with change (station.mjs `payCoins`). The wage is read from the hireling's `system.cost` (DMG Tables 64/65 wording,
 * e.g. "2 gp per week, 10 gp per month"): the monthly figure when given (owner's ruling), else a weekly one x 30/7, a daily
 * one x 30 or a yearly one / 12; a range ("200-600 gp per month") pays its lower figure (implementation choice: the GM
 * types the exact wage). When the coins are short the wage is owed (`system.wage.unpaid`, cp) and the GM is told, with a
 * morale check suggested (owner's ruling). Monster `system.wage` { due (world time of the next payment), unpaid }.
 */
export const MONTH_DAYS = 30;
export const MONTH = MONTH_DAYS * 86400;
export const MAX_PAYMENTS = 24;
const PER = { month: 1, week: MONTH_DAYS / 7, day: MONTH_DAYS, year: 1 / 12 };

/** A wage text as copper per 30 days (pure): { copper, unit, range } or null. */
export function parseWage(text) {
  const re = /(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(pp|gp|ep|sp|cp)\s*(?:per|\/|a|each)\s*(month|week|day|year)/gi;
  const found = [...String(text ?? "").matchAll(re)].map(m => ({ amount: Number(m[1]), range: !!m[2], coin: m[3].toLowerCase(), unit: m[4].toLowerCase() }));
  if (!found.length) return null;
  const pick = ["month", "week", "day", "year"].map(u => found.find(f => f.unit === u)).find(Boolean);
  return { copper: Math.round(pick.amount * COIN_VALUES[pick.coin] * PER[pick.unit]), unit: pick.unit, range: pick.range };
}

/** "2 gp 5 sp" from copper (pure). */
export function coinText(copper) {
  let c = Math.max(Math.round(Number(copper) || 0), 0);
  const parts = [];
  for (const d of ["gp", "sp", "cp"]) { const n = Math.floor(c / COIN_VALUES[d]); if (n) { parts.push(`${n} ${d}`); c -= n * COIN_VALUES[d]; } }
  return parts.join(" ") || "0 cp";
}

/**
 * The payments due by `now` (pure): { payments, due } where payments = the number of 30-day periods ended since `due`
 * (at most MAX_PAYMENTS) and `due` = the next due time after them. A null `due` starts the first period at `now`.
 */
export function paymentsDue(due, now) {
  if (due === null || due === undefined || !Number.isFinite(due)) return { payments: 0, due: now + MONTH, start: true };
  let n = 0;
  let next = due;
  while (next <= now && n < MAX_PAYMENTS) { n += 1; next += MONTH; }
  if (next <= now) next = now + MONTH;
  return { payments: n, due: next, start: false };
}

const resolve = uuid => { try { return foundry.utils.fromUuidSync?.(uuid, { strict: false }) ?? null; } catch { return null; } };
const i18n = (k, d) => d ? game.i18n.format(k, d) : game.i18n.localize(k);
const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");

/** The character employing a hireling (the first whose henchmen list holds it), or null. */
export function employerOf(hireling) {
  for (const a of game.actors ?? []) {
    if (a.type === "character" && (a.system?.henchmen?.actors ?? []).includes(hireling.uuid)) return a;
  }
  return null;
}

/** Hirelings with a wage in each character's henchmen list: [{ employer, hireling, wage }]. */
export function wagedHirelings() {
  const out = [];
  for (const employer of game.actors ?? []) {
    if (employer.type !== "character") continue;
    for (const uuid of employer.system?.henchmen?.actors ?? []) {
      const h = resolve(uuid);
      if (h?.type !== "monster" || h.system?.role !== "hireling") continue;
      const wage = parseWage(h.system?.cost);
      if (wage?.copper > 0) out.push({ employer, hireling: h, wage });
    }
  }
  return out;
}

/** Pay the wages due (active GM, on world time). One whisper per employer to the GM and the employer's owners. */
export async function processWages(now = game.time?.worldTime ?? 0) {
  const notes = new Map();
  for (const { employer, hireling, wage } of wagedHirelings()) {
    const plan = paymentsDue(hireling.system?.wage?.due, now);
    if (!plan.payments) {
      if (plan.start) await hireling.update({ "system.wage.due": plan.due });
      continue;
    }
    let unpaid = hireling.system?.wage?.unpaid ?? 0;
    const lines = notes.get(employer) ?? [];
    for (let i = 0; i < plan.payments; i++) {
      if (await payCoins(employer, wage.copper)) lines.push(i18n("AD2E.Wage.Paid", { name: employer.name, hireling: hireling.name, amount: coinText(wage.copper) }));
      else {
        unpaid += wage.copper;
        lines.push(i18n("AD2E.Wage.Unpaid", { name: employer.name, hireling: hireling.name, amount: coinText(wage.copper), owed: coinText(unpaid) }));
      }
    }
    if (wage.range) lines.push(i18n("AD2E.Wage.Range", { hireling: hireling.name, amount: coinText(wage.copper) }));
    notes.set(employer, lines);
    await hireling.update({ "system.wage.due": plan.due, "system.wage.unpaid": unpaid });
  }
  for (const [employer, lines] of notes) {
    if (!lines.length) continue;
    const whisper = game.users.filter(u => u.isGM || employer.testUserPermission?.(u, "OWNER")).map(u => u.id);
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: employer }), whisper,
      content: `<p><strong>${esc(i18n("AD2E.Wage.Title"))}</strong></p><ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` });
  }
}

/** Pay a hireling's arrears now from its employer (monster sheet button). */
export async function payArrears(hireling) {
  const owed = hireling.system?.wage?.unpaid ?? 0;
  const employer = employerOf(hireling);
  if (!owed || !employer) return false;
  if (!await payCoins(employer, owed)) {
    ui.notifications?.warn(i18n("AD2E.Wage.CannotPay", { name: employer.name, amount: coinText(owed) }));
    return false;
  }
  await hireling.update({ "system.wage.unpaid": 0 });
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: employer }),
    content: `<p>${esc(i18n("AD2E.Wage.ArrearsPaid", { name: employer.name, hireling: hireling.name, amount: coinText(owed) }))}</p>` });
  return true;
}

/** Monster sheet line: wage per month, next payment, arrears and employer (null when not a waged hireling). */
export function wageContext(hireling) {
  if (hireling?.system?.role !== "hireling") return null;
  const wage = parseWage(hireling.system?.cost);
  if (!wage) return null;
  const employer = employerOf(hireling);
  const due = hireling.system?.wage?.due;
  return { perMonth: coinText(wage.copper), range: wage.range, employer: employer?.name ?? "",
    due: employer && Number.isFinite(due) ? dateText(due) : "", unpaid: hireling.system?.wage?.unpaid ? coinText(hireling.system.wage.unpaid) : "" };
}

export function registerWages() {
  Hooks.on("updateWorldTime", () => {
    if (game.users?.activeGM?.isSelf) processWages();
  });
}
