import { CONSTRUCTION } from "./rules/construction-tables.mjs";

/**
 * Stronghold construction (DMGR2 The Castle Guide, Chapter 5; module/rules/construction-tables.mjs from
 * tools/build-construction-tables.py). The project is kept on the character (`system.followers.stronghold.project`).
 * Owner's rulings: the owner plans (site, modules, workers, helpers) on the Bio tab and the GM starts it (worker skill
 * and morale are the GM's); work accrues with world time and the finished castle ticks "Built"; the monthly events are
 * rolled automatically and whispered to the GM, their figures applied, with buttons for the choices and for problems
 * the GM resolves; costs are recorded only (no coins taken).
 * Implementation choices: the standard work force is the man/weeks / 52 rounded (at least one) and the base duration
 * man/weeks / workers; hired workers plus helpers against the standard give the time factor by the book's steps only
 * (4x 50%, 2x 75%, 1x, 75% double, 50% four times; between steps the lower step); the duration is rounded up to whole
 * weeks; work weeks a year (52 / WTM) are spread evenly, so each calendar week does WTM-scaled work; a month is four
 * weeks (the event at the start of each); a choice event (labour dispute, raid, call to arms, civil war, bad omens) waits
 * for the GM's button; a monster attack halts work and highwaymen, local unrest and troops sent away halve it until
 * resolved; a natural disaster loses all work (the "Averted" button restores it).
 */
export const CN = CONSTRUCTION;
export const SITE_KEYS = Object.keys(CN.site);
export const WEEK = 7 * 86400;
const MAX_WEEKS = 520;

const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const esc = v => foundry.utils.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");
const r2 = n => Math.round(n * 100) / 100;

export const DEFAULT_SITE = { climate: "moderate", geography: "rollingHills", cover: "scrub", resources: "nearAndGood",
  social: "agricultural", skill: "average", morale: "average" };

/**
 * Roll a simple formula ("2d4", "30 + 3d20") with `random()` (pure with an injected source). Roll#evaluateSync skips
 * dice terms ("non-deterministic terms are ignored" when not strict, Roll API), so the event figures are rolled here.
 */
export function simpleDice(formula, random = Math.random) {
  return String(formula).split("+").reduce((n, part) => {
    const m = part.trim().match(/^(\d*)d(\d+)$/i);
    if (!m) return n + (Number(part.trim()) || 0);
    let sum = 0;
    for (let i = 0; i < (Number(m[1]) || 1); i++) sum += Math.floor(random() * Number(m[2])) + 1;
    return n + sum;
  }, 0);
}

/** The project record with defaults (pure). */
export function projectOf(sys) {
  const p = sys?.followers?.stronghold?.project ?? {};
  return { tech: 8, modules: [], hired: null, helpers: [], status: "", plan: null, started: null, lastWeek: null, weeksPassed: 0,
    progress: 0, extraWeeks: 0, haltedUntil: null, problems: [], extraCost: 0, lost: 0, omensUntil: null, omensLevel: 0,
    savedProgress: null, log: [], ...p, site: { ...DEFAULT_SITE, ...(p.site ?? {}) } };
}

/** Production modifier: the seven site PMs multiplied, rounded to two places (pure). */
export function productionModifier(site) {
  const s = { ...DEFAULT_SITE, ...site };
  return r2(SITE_KEYS.reduce((n, k) => n * (CN.site[k].find(e => e.key === s[k])?.pm ?? 1), 1));
}

/** Modules' base gold and man/weeks with ornate / spartan styles; modules above the tech level listed (pure). */
export function baseTotals(modules, tech = 8) {
  let gold = 0, time = 0;
  const aboveTech = [];
  for (const m of modules ?? []) {
    const def = CN.modules.find(x => x.key === m.key);
    if (!def) continue;
    const n = Math.max(Number(m.count) || 0, 0);
    const f = CN.styles[m.style] ?? 1;
    gold += def.gold * n * f;
    time += def.time * n * f;
    if (def.tech > tech) aboveTech.push(def.label);
  }
  return { gold, time, aboveTech };
}

/** Cost and man/weeks: base + 10% overhead, times the PM (pure). */
export function projectCost(project) {
  const base = baseTotals(project.modules, project.tech);
  const pm = productionModifier(project.site);
  const over = 1 + CN.overhead;
  return { base, pm, overheadGold: Math.round(base.gold * over), overheadTime: Math.floor(base.time * over + 1e-6),
    gold: Math.floor(base.gold * over * pm + 1e-6), manWeeks: Math.floor(base.time * over * pm + 1e-6), aboveTech: base.aboveTech };
}

/** Men a character counts for: its level, plus a man per spell level castable a day (pure on system data). */
export function heroicMen(sys) {
  const level = Number(sys?.level) || 0;
  const spells = (sys?.spells?.levels ?? []).reduce((n, l) => n + (Number(l.slots) || 0) * (Number(l.level) || 0), 0);
  return level + spells;
}

/** Men a helper counts for (pure with the resolved document): characters by level and spells, items and monsters 5% or 1% of their XP. */
export function helperMen(helper, doc) {
  if (helper.kind === "other") return Math.max(Number(helper.men) || 0, 0);
  const W = CN.work;
  if (helper.kind === "character") return doc ? heroicMen(doc.system) : (Number(helper.men) || 0);
  const xp = helper.kind === "item" ? (doc?.system?.xpValue ?? 0) : (doc?.system?.xp ?? 0);
  const rate = helper.suit === "good" ? (helper.kind === "item" ? W.goodItem : W.goodMonster)
    : helper.suit === "some" ? (helper.kind === "item" ? W.someItem : W.someMonster) : 0;
  return Math.floor((Number(xp) || 0) * rate);
}

/** Time factor for an effective work force against the standard (pure); null below half. */
export function timeFactor(effective, standard) {
  const ratio = standard > 0 ? effective / standard : 1;
  const step = CN.work.steps.find(s => ratio >= s.ratio - 1e-9);
  return step ? step.time : null;
}

/** The work plan (pure): standard workers, duration in work weeks, extra hiring cost (negative = saving). */
export function workPlan(manWeeks, hired, helpers = 0) {
  const W = CN.work;
  const standard = Math.max(Math.round(manWeeks / W.weeksPerYear), 1);
  const h = hired === null || hired === undefined || hired === "" ? standard : Math.max(Math.floor(Number(hired) || 0), 0);
  const effective = h + helpers;
  const factor = timeFactor(effective, standard);
  const baseWeeks = manWeeks / standard;
  const weeks = factor === null ? null : Math.max(Math.ceil(baseWeeks * factor - 1e-6), 1);
  return { standard, hired: h, helpers, effective, factor, weeks, hireCost: weeks === null ? 0 : (h - standard) * weeks * W.wage };
}

/** Work weeks in a year: 52 / (climate PM x ground cover PM) (pure). */
export function workWeeksPerYear(site) {
  const s = { ...DEFAULT_SITE, ...site };
  const wtm = (CN.site.climate.find(e => e.key === s.climate)?.pm ?? 1) * (CN.site.cover.find(e => e.key === s.cover)?.pm ?? 1);
  return r2(CN.work.weeksPerYear / wtm);
}

/** The monthly event for a d100 roll (pure). */
export function eventFor(roll) {
  return CN.events.find(e => roll >= e.min && roll <= e.max)?.key ?? "none";
}

/** Speed this week (pure): 0 halted, 0.5 half speed, 1 normal. */
export function speedAt(p, t) {
  if ((p.haltedUntil ?? 0) > t || (p.problems ?? []).includes("monster")) return 0;
  return (p.problems ?? []).some(k => ["highwaymen", "unrest", "troops"].includes(k)) ? 0.5 : 1;
}

/** Remaining work weeks (pure). */
export function remainingWeeks(p) {
  return Math.max((p.plan?.weeks ?? 0) + (p.extraWeeks ?? 0) - (p.progress ?? 0), 0);
}

/**
 * Apply an event (pure; `dice(formula)` gives a number): { p (new project), text, choices [keys] } at world time `t`.
 * Choices wait for the GM's card buttons.
 */
export function applyEvent(p0, key, t, dice) {
  const E = CN.eventRules;
  const p = foundry.utils?.deepClone ? foundry.utils.deepClone(p0) : structuredClone(p0);
  const halt = weeks => { p.haltedUntil = Math.max(p.haltedUntil ?? 0, t) + weeks * WEEK; };
  const add = k => { p.problems = [...new Set([...(p.problems ?? []), k])]; };
  let text = i18n(`AD2E.Castle.Event.${key}`);
  let choices = [];
  switch (key) {
    case "badWeather": halt(CN.monthWeeks); break;
    case "severeWeather": { halt(CN.monthWeeks); const w = dice(E.severeWeeks); p.extraWeeks += w; text += ` ${i18n("AD2E.Castle.WeeksAdded", { n: w })}`; break; }
    case "monster": { const n = dice(E.monsterLost); p.lost += n; p.extraCost += n * E.funeral; add("monster");
      text += ` ${i18n("AD2E.Castle.Lost", { n, gp: n * E.funeral })}`; choices = ["resolve"]; break; }
    case "highwaymen": add("highwaymen"); choices = ["resolve"]; break;
    case "unrest": { const w = dice(E.unrestWeeks); halt(w); add("unrest"); text += ` ${i18n("AD2E.Castle.Stopped", { n: w })}`; choices = ["resolve"]; break; }
    case "labor": choices = ["pay", "refuse"]; break;
    case "raid": choices = ["fought", "abstract"]; break;
    case "callToArms": case "civilWar": choices = ["gold", "troops", "refuse"]; break;
    case "royalVisit": { const w = dice(E.royalWeeks); halt(w); text += ` ${i18n("AD2E.Castle.Stopped", { n: w })}`; break; }
    case "omens": if ((p.omensUntil ?? 0) > t) { p.omensLevel = 2; p.omensUntil += dice(E.omensWeeks) * WEEK; } else choices = ["stop", "ignore"]; break;
    case "disaster": p.savedProgress = p.progress; p.progress = 0; choices = ["averted"]; break;
    default: break;
  }
  return { p, text, choices };
}

/**
 * The GM's choice on an event card (pure; `dice` as above): { p, text }.
 */
export function applyChoice(p0, key, choice, t, dice) {
  const E = CN.eventRules;
  const p = foundry.utils?.deepClone ? foundry.utils.deepClone(p0) : structuredClone(p0);
  const workers = p.plan?.effective ?? 0;
  const rest = Math.ceil(remainingWeeks(p));
  const halt = weeks => { p.haltedUntil = Math.max(p.haltedUntil ?? 0, t) + weeks * WEEK; };
  let text = "";
  if (choice === "resolve") { p.problems = (p.problems ?? []).filter(k => k !== key); text = i18n("AD2E.Castle.Resolved"); }
  else if (choice === "pay") { const gp = workers * rest * E.laborPay; p.extraCost += gp; text = i18n("AD2E.Castle.Paid", { gp }); }
  else if (choice === "refuse" && key === "labor") { const w = dice(E.laborWeeks); halt(w); text = i18n("AD2E.Castle.Stopped", { n: w }); }
  else if (choice === "refuse") text = i18n("AD2E.Castle.Refused");
  else if (choice === "fought") text = i18n("AD2E.Castle.Fought");
  else if (choice === "abstract") {
    const pct = Math.min(dice(E.raidPercent), 100);
    const n = Math.floor(workers * pct / 100);
    const gp = n * rest * CN.work.wage;
    p.lost += n; p.extraCost += gp;
    text = i18n("AD2E.Castle.RaidLoss", { pct, n, gp });
  } else if (choice === "gold") { const gp = Math.round((p.plan?.gold ?? 0) * E.callGold); p.extraCost += gp; text = i18n("AD2E.Castle.Paid", { gp }); }
  else if (choice === "troops") { const n = Math.floor(workers * E.callTroops); p.lost += n; p.problems = [...new Set([...(p.problems ?? []), "troops"])]; text = i18n("AD2E.Castle.Troops", { n }); }
  else if (choice === "stop") { const w = dice(E.omensWeeks); halt(w); text = i18n("AD2E.Castle.Stopped", { n: w }); }
  else if (choice === "ignore") { const w = dice(E.omensWeeks); p.omensUntil = t + w * WEEK; p.omensLevel = 1; text = i18n("AD2E.Castle.OmensIgnored", { n: w }); }
  else if (choice === "averted") { if (p.savedProgress !== null && p.savedProgress !== undefined) p.progress = Math.max(p.progress, p.savedProgress); p.savedProgress = null; text = i18n("AD2E.Castle.Averted"); }
  return { p, text };
}

/**
 * Advance a building project to world time `now` (pure apart from `rollD100`/`dice`): whole weeks since `lastWeek`;
 * an event at the start of each month (each week while ignored omens last, low rolls rerolled); work at the week's
 * speed times work weeks a year / 52. Returns { p, events [{ key, text, choices, at }], done }.
 */
export function advanceProject(p0, now, { rollD100, dice }) {
  let p = foundry.utils?.deepClone ? foundry.utils.deepClone(p0) : structuredClone(p0);
  const events = [];
  if (p.status !== "building" || p.lastWeek === null) return { p, events, done: false };
  const weeks = Math.min(Math.floor((now - p.lastWeek) / WEEK), MAX_WEEKS);
  const rate = (p.plan?.workWeeks ?? CN.work.weeksPerYear) / CN.work.weeksPerYear;
  for (let i = 0; i < weeks; i++) {
    const t = p.lastWeek;
    const omens = (p.omensUntil ?? 0) > t;
    if (p.weeksPassed % CN.monthWeeks === 0 || omens) {
      let roll = rollD100();
      const floor = omens ? CN.eventRules.omensReroll[(p.omensLevel ?? 1) - 1] ?? 20 : 0;
      for (let k = 0; roll <= floor && k < 50; k++) roll = rollD100();
      const key = eventFor(roll);
      if (key !== "none") {
        const r = applyEvent(p, key, t, dice);
        p = r.p;
        events.push({ key, text: r.text, choices: r.choices, at: t, roll });
        p.log = [...(p.log ?? []), { at: t, key, text: r.text }].slice(-30);
      }
    }
    p.progress = r2(p.progress + speedAt(p, t) * rate);
    p.weeksPassed += 1;
    p.lastWeek = t + WEEK;
    if (p.progress >= (p.plan?.weeks ?? 0) + (p.extraWeeks ?? 0)) {
      p.status = "done";
      return { p, events, done: true };
    }
  }
  return { p, events, done: false };
}

/** The plan frozen at the start (needs the helpers' documents resolved): costs, workers, weeks, work weeks a year. */
export function planFor(project, helperDocs = []) {
  const cost = projectCost(project);
  const helpers = project.helpers.reduce((n, h, i) => n + helperMen(h, helperDocs[i]), 0);
  const work = workPlan(cost.manWeeks, project.hired, helpers);
  const workWeeks = workWeeksPerYear(project.site);
  return { ...cost, ...work, workWeeks, gold: cost.gold, totalCost: cost.gold + work.hireCost,
    calendarWeeks: work.weeks === null ? null : Math.ceil(work.weeks * CN.work.weeksPerYear / workWeeks) };
}

const resolveSync = u => (u ? ((foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(u, { strict: false }) ?? null) : null);

/** Bio tab context for the construction section. */
export function constructionContext(actor) {
  const p = projectOf(actor.system);
  const isGM = !!game.user?.isGM;
  const docs = p.helpers.map(h => resolveSync(h.uuid));
  const plan = p.status ? p.plan : planFor(p, docs);
  const opt = (list, sel, label) => list.map(k => ({ key: k.key ?? k, label: label(k), selected: (k.key ?? k) === sel }));
  const editable = !p.status && actor.isOwner;
  return {
    p, plan, isGM, editable, building: p.status === "building", done: p.status === "done",
    site: SITE_KEYS.map(k => ({ key: k, label: i18n(`AD2E.Castle.Site.${k}`), gmOnly: ["skill", "morale"].includes(k),
      disabled: !editable || (["skill", "morale"].includes(k) && !isGM),
      options: opt(CN.site[k], p.site[k], e => `${e.label} (${e.pm.toFixed(2)})`) })),
    techs: opt(CN.tech.map(t => ({ key: String(t.level), label: t.label })), String(p.tech), t => `${t.key}: ${t.label}`),
    moduleOptions: CN.modules.map(m => ({ key: m.key, label: `${m.label} (TL ${m.tech}, ${m.time} mw, ${m.gold} gp)` })),
    modules: p.modules.map((m, i) => ({ ...m, index: i, label: CN.modules.find(x => x.key === m.key)?.label ?? m.key,
      styles: opt(Object.keys(CN.styles), m.style || "normal", s => i18n(`AD2E.Castle.Style.${s}`)) })),
    helpers: p.helpers.map((h, i) => ({ ...h, index: i, men: helperMen(h, docs[i]), showSuit: h.kind === "item" || h.kind === "monster",
      suits: opt(["good", "some", "none"], h.suit || "good", s => i18n(`AD2E.Castle.Suit.${s}`)) })),
    items: (actor.items?.filter?.(i => i.type === "magic") ?? []).map(i => ({ id: i.id, name: i.name })),
    progressPct: plan?.weeks ? Math.min(Math.round((p.progress / (plan.weeks + (p.extraWeeks ?? 0))) * 100), 100) : 0,
    remaining: r2(remainingWeeks(p)), problems: (p.problems ?? []).map(k => ({ key: k, label: i18n(`AD2E.Castle.Problem.${k}`) })),
    halted: (p.haltedUntil ?? 0) > (game.time?.worldTime ?? 0), log: [...(p.log ?? [])].reverse().slice(0, 8),
    urls: CN.urls
  };
}

const gmWhisper = () => ChatMessage.getWhisperRecipients?.("GM")?.map(u => u.id) ?? [];

/** GM: start the project (the plan is frozen). */
export async function startConstruction(actor) {
  if (!game.user?.isGM) return null;
  const p = projectOf(actor.system);
  const docs = await Promise.all(p.helpers.map(h => (h.uuid ? fromUuid(h.uuid) : null)));
  const plan = planFor(p, docs);
  if (!plan.weeks || !p.modules.length) return ui.notifications.warn(i18n(plan.weeks === null ? "AD2E.Castle.TooFew" : "AD2E.Castle.NoModules"));
  const now = game.time.worldTime;
  await actor.update({ "system.followers.stronghold.project": { ...p, status: "building", plan, started: now, lastWeek: now, weeksPassed: 0,
    progress: 0, log: [{ at: now, key: "start", text: i18n("AD2E.Castle.StartedLog", { gold: plan.totalCost, weeks: plan.weeks }) }] } });
  return ChatMessage.create({ whisper: gmWhisper(), content: `<p><strong>${esc(i18n("AD2E.Castle.Started", { name: actor.name }))}</strong> `
    + `${esc(i18n("AD2E.Castle.PlanLine", { gold: plan.totalCost, weeks: plan.weeks, calendar: plan.calendarWeeks, workers: plan.effective }))}</p>` });
}

/** GM: abandon or reset the project (back to planning). */
export async function stopConstruction(actor) {
  if (!game.user?.isGM) return null;
  const p = projectOf(actor.system);
  return actor.update({ "system.followers.stronghold.project": { ...p, status: "", plan: null, started: null, lastWeek: null, weeksPassed: 0,
    progress: 0, extraWeeks: 0, haltedUntil: null, problems: [], extraCost: 0, lost: 0, omensUntil: null, omensLevel: 0, savedProgress: null } });
}

/** Active GM: advance every building project to the current world time; post event and completion cards. */
export async function processConstruction(now = game.time.worldTime) {
  for (const actor of game.actors?.filter?.(a => a.type === "character") ?? []) {
    const p = projectOf(actor.system);
    if (p.status !== "building") continue;
    const r = advanceProject(p, now, {
      rollD100: () => simpleDice("1d100"),
      dice: f => simpleDice(f)
    });
    if (r.p.lastWeek === p.lastWeek && !r.events.length) continue;
    const update = { "system.followers.stronghold.project": r.p };
    if (r.done) update["system.followers.stronghold.built"] = true;
    await actor.update(update);
    for (const e of r.events) {
      await ChatMessage.create({ whisper: gmWhisper(), content: `<p><strong>${esc(i18n("AD2E.Castle.EventCard", { name: actor.name, roll: e.roll }))}</strong> ${esc(e.text)}</p>`,
        flags: { ad2e: { construction: { actor: actor.uuid, key: e.key, at: e.at, choices: e.choices, chosen: null } } } });
    }
    if (r.done) await ChatMessage.create({ whisper: gmWhisper(), content: `<p><strong>${esc(i18n("AD2E.Castle.Done", { name: actor.name, castle: actor.system.followers?.stronghold?.name || i18n("AD2E.Followers.Stronghold") }))}</strong></p>` });
  }
}

/** GM card buttons for an event's choices. */
export function constructionButtons(message, html) {
  const c = message?.getFlag?.("ad2e", "construction");
  if (!c?.choices?.length || !game.user?.isGM || !html?.querySelector) return;
  const box = document.createElement("div");
  box.className = "ad2e-damage-buttons";
  if (c.chosen) box.innerHTML = `<span class="ad2e-note">${esc(c.chosen)}</span>`;
  else {
    box.innerHTML = c.choices.map(k => `<button type="button" data-choice="${k}">${esc(i18n(`AD2E.Castle.Choice.${k}`))}</button>`).join("");
    for (const b of box.querySelectorAll("button")) b.addEventListener("click", async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const actor = await fromUuid(c.actor);
      if (!actor) return;
      const now = game.time.worldTime;
      const r = applyChoice(projectOf(actor.system), c.key, ev.currentTarget.dataset.choice, now, f => simpleDice(f));
      r.p.log = [...(r.p.log ?? []), { at: now, key: c.key, text: r.text }].slice(-30);
      await actor.update({ "system.followers.stronghold.project": r.p });
      await message.setFlag("ad2e", "construction", { ...c, chosen: r.text });
    });
  }
  (html.querySelector(".message-content") ?? html).append(box);
}

export function registerConstruction() {
  Hooks.on("updateWorldTime", async (worldTime, delta) => {
    if (!game.users?.activeGM?.isSelf || !(delta > 0)) return;
    await processConstruction(worldTime);
  });
}
