import { COIN_VALUES } from "./rules/movement-tables.mjs";
import { payCoins } from "./station.mjs";
import { dateText } from "./travel-days.mjs";
import { ad2eDialog } from "./dialogs.mjs";

/**
 * Training for level advancement (owner's request 1.0.60: an optional rule behind a world setting, off by default).
 * Source: Training (Optional Rule) (DMG), https://adnd2e.fandom.com/wiki/Training_(Optional_Rule)_(DMG) (revision 276321):
 *  - "The DM might choose to require characters to train before they increase in level."
 *  - The tutor "must be of the same class and higher level than the one the character is training for" (a 7th-level fighter
 *    training for 8th needs "a 9th-level or higher fighter").
 *  - A player character tutor "must make both a Wisdom check and a Charisma check"; "It is assumed that all NPC tutors have
 *    successfully passed these checks"; "the DM can dispense with the die rolls".
 *  - Cost: "There is no set amount ... an average of 100 gp per level per week is not uncommon."
 *  - Time: "Subtract the Wisdom score from 19. This is the minimum number of weeks"; then "an Intelligence or Wisdom check,
 *    whichever is higher"; a failure means "another week in training", each additional week giving "another +1".
 * Implementation choices: the cost default is 100 gp x the level trained for, per week (editable; 0 = free); the minimum
 * weeks are paid when training starts and one more week after each failed check; at least 1 week (a tutor with Wisdom 19+
 * would otherwise need none); a week is 7 days of game time; a player character tutor's two checks are rolled once and kept
 * on the tutor (flag `ad2e.teacher`), the GM can skip them; "the tutor must also know the appropriate things" (weapon
 * specialization, a spell, a skill) is shown as a reminder, not checked. Monsters do not train.
 */
export const TRAINING = { perLevelWeek: 100, wisdomBase: 19, minWeeks: 1, weekSeconds: 7 * 86400,
  url: "https://adnd2e.fandom.com/wiki/Training_(Optional_Rule)_(DMG)" };

/** Minimum weeks of training with a tutor of this Wisdom (pure). */
export function minWeeks(wisdom) {
  return Math.max(TRAINING.wisdomBase - (Number(wisdom) || 0), TRAINING.minWeeks);
}

/** Default weekly fee in gp for training to a level (pure). */
export function weeklyFee(level, perLevel = TRAINING.perLevelWeek) {
  return Math.max(Number(level) || 0, 0) * perLevel;
}

/** Target of the end-of-training check: the higher of Intelligence and Wisdom plus 1 per extra week (pure). */
export function checkTarget(int, wis, extraWeeks = 0) {
  return Math.max(Number(int) || 0, Number(wis) || 0) + (Number(extraWeeks) || 0);
}

/** Problems with a tutor (pure): [] when fit. `tutorLevel` = the tutor's level in the trainee's class (0 = not of the class). */
export function tutorIssues({ tutorLevel = 0, targetLevel = 1, teacher = null } = {}) {
  const out = [];
  if (!(tutorLevel > 0)) out.push("wrongClass");
  else if (tutorLevel <= targetLevel) out.push("tooLow");
  if (teacher && !(teacher.wis && teacher.cha)) out.push("notTeacher");
  return out;
}

/** Status of a character's training record at a world time (pure): "none" | "training" | "checkDue" | "done". */
export function trainingStatus(t, now) {
  if (!t || !t.level) return "none";
  if (t.done) return "done";
  return (Number(now) || 0) >= (Number(t.until) || 0) ? "checkDue" : "training";
}

/** Whether a record lets the class reach the level (pure). */
export function trainedFor(t, classId, level) {
  return !!t && !!t.done && t.level === level && (t.classId || "") === (classId || "");
}

/** A character's level in a class: main class, a multi-class entry or an earlier (dual) class; 0 when not of the class. */
export function classLevelOf(actor, id) {
  const sys = actor?.system;
  if (!sys || !id) return 0;
  const multi = sys.multi?.classes?.find(c => c.identifier === id);
  if (multi) return multi.level ?? 0;
  if (sys.classInfo?.classItem?.system?.identifier === id) return sys.level ?? 0;
  return (sys.dualClass?.previous ?? []).find(p => p.identifier === id)?.level ?? 0;
}

/** The class a character trains in next: { id, name, level (the level trained for) }, multi-class by id (pure). */
export function trainingTarget(actor, classId = null) {
  const sys = actor?.system;
  if (sys?.multi) {
    const c = sys.multi.classes.find(x => x.identifier === classId) ?? sys.multi.classes[0];
    return c ? { id: c.identifier, name: c.name, level: c.level + 1 } : null;
  }
  const item = sys?.classInfo?.classItem;
  return item ? { id: item.system.identifier, name: item.name, level: (sys.level ?? 0) + 1 } : null;
}

/* -------------------------------------------- */
/*  Foundry side                                */
/* -------------------------------------------- */

const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const esc = v => foundry.utils?.escapeHTML?.(String(v ?? "")) ?? String(v ?? "");

export function trainingOn() {
  try { return !!game.settings.get("ad2e", "levelTraining"); } catch { return false; }
}

export function registerTraining() {
  game.settings.register("ad2e", "levelTraining", {
    name: "AD2E.Training.Setting", hint: "AD2E.Training.SettingHint",
    scope: "world", config: true, type: Boolean, default: false
  });
}

/** Characters in the world who could tutor for this class and level: [{ actor, level }]. */
function worldTutors(trainee, target) {
  return (game.actors?.filter?.(a => a.type === "character" && a !== trainee) ?? [])
    .map(actor => ({ actor, level: classLevelOf(actor, target.id) }))
    .filter(r => r.level > target.level)
    .sort((a, b) => b.level - a.level || a.actor.name.localeCompare(b.actor.name));
}

/** A player character tutor's Wisdom and Charisma checks, rolled once and kept on the tutor. */
async function teacherChecks(tutor) {
  const kept = tutor.getFlag?.("ad2e", "teacher");
  if (kept) return kept;
  const out = {};
  const rolls = [];
  for (const key of ["wis", "cha"]) {
    const roll = await new Roll("1d20").evaluate();
    rolls.push(roll);
    out[key] = roll.total <= (tutor.system.abilities?.[key]?.total ?? 0);
  }
  await tutor.setFlag?.("ad2e", "teacher", out);
  const result = out.wis && out.cha ? "Teacher" : (out.wis || out.cha ? "NotQuite" : "NoAptitude");
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: tutor }), rolls,
    content: `<p>${esc(i18n("AD2E.Training.TeacherChecks", { name: tutor.name, wis: rolls[0].total, wisScore: tutor.system.abilities?.wis?.total ?? 0,
      cha: rolls[1].total, chaScore: tutor.system.abilities?.cha?.total ?? 0 }))} ${esc(i18n(`AD2E.Training.Result.${result}`))}</p>` });
  return out;
}

/** Start training (Character tab): choose the class (multi-class), the tutor and the fee; pays the minimum weeks. */
export async function startTraining(actor, classId = null) {
  if (actor?.type !== "character") return null;
  let target = trainingTarget(actor, classId);
  if (actor.system.multi && !classId) {
    const id = await ad2eDialog.wait({ window: { title: `${actor.name}: ${i18n("AD2E.Training.Start")}` },
      content: `<p>${esc(i18n("AD2E.Multi.WhichClass"))}</p>`,
      buttons: actor.system.multi.classes.map((c, n) => ({ action: c.identifier, label: `${c.name} ${c.level} → ${c.level + 1}`, default: n === 0 })),
      rejectClose: false });
    if (!id) return null;
    target = trainingTarget(actor, id);
  }
  if (!target) { ui.notifications?.warn(i18n("AD2E.Training.NoClass")); return null; }
  const tutors = worldTutors(actor, target);
  const field = (label, html, hint = "") => `<div class="form-group"><label${hint ? ` data-tooltip="${esc(hint)}"` : ""}>${esc(label)}</label>${html}</div>`;
  const gm = !!game.user?.isGM;
  const content = `<p class="ad2e-note">${esc(i18n("AD2E.Training.Hint", { cls: target.name, level: target.level, need: target.level + 1 }))}</p>`
    + field(i18n("AD2E.Training.Tutor"), `<select name="tutor">${tutors.map(r => `<option value="${r.actor.uuid}">${esc(r.actor.name)} (${esc(target.name)} ${r.level})</option>`).join("")}`
      + `<option value="">${esc(i18n("AD2E.Training.OtherTutor"))}</option></select>`)
    + field(i18n("AD2E.Training.OtherName"), `<input type="text" name="otherName" placeholder="${esc(i18n("AD2E.Training.OtherTutor"))}">`)
    + field(i18n("AD2E.Training.OtherLevel"), `<input type="number" name="otherLevel" value="${target.level + 1}" min="1">`)
    + field(i18n("AD2E.Training.OtherWis"), `<input type="number" name="otherWis" value="12" min="1" max="25">`)
    + field(i18n("AD2E.Training.Fee"), `<input type="number" name="fee" value="${weeklyFee(target.level)}" min="0" step="1">`, i18n("AD2E.Training.FeeHint"))
    + (gm ? field(i18n("AD2E.Training.SkipChecks"), `<input type="checkbox" name="skip">`, i18n("AD2E.Training.SkipChecksHint")) : "")
    + `<p class="ad2e-note">${esc(i18n("AD2E.Training.KnowReminder"))}</p>`;
  const input = await ad2eDialog.prompt({
    window: { title: `${actor.name}: ${i18n("AD2E.Training.Start")}` }, content,
    ok: { label: i18n("AD2E.Training.Start"), callback: (event, button) => {
      const el = button.form.elements;
      return { tutor: el.tutor.value, otherName: String(el.otherName.value ?? "").trim(), otherLevel: Number(el.otherLevel.value) || 0,
        otherWis: Number(el.otherWis.value) || 0, fee: Math.max(Number(el.fee.value) || 0, 0), skip: !!el.skip?.checked };
    } },
    rejectClose: false
  });
  if (!input) return null;
  const tutorActor = input.tutor ? (foundry.utils.fromUuidSync ?? globalThis.fromUuidSync)?.(input.tutor) : null;
  const tutor = tutorActor
    ? { name: tutorActor.name, uuid: tutorActor.uuid, level: classLevelOf(tutorActor, target.id), wis: tutorActor.system.abilities?.wis?.total ?? 0 }
    : { name: input.otherName || i18n("AD2E.Training.OtherTutor"), uuid: "", level: input.otherLevel, wis: input.otherWis };
  // "It is assumed that all NPC tutors have successfully passed these checks": only player characters roll them.
  const teacher = tutorActor?.hasPlayerOwner && !input.skip ? await teacherChecks(tutorActor) : null;
  const issues = tutorIssues({ tutorLevel: tutor.level, targetLevel: target.level, teacher });
  if (issues.length) {
    ui.notifications?.warn(issues.map(k => i18n(`AD2E.Training.Issue.${k}`, { name: tutor.name, need: target.level + 1, cls: target.name })).join(" "));
    return null;
  }
  const weeks = minWeeks(tutor.wis);
  const paid = input.fee * weeks;
  if (paid > 0 && !(await payCoins(actor, paid * COIN_VALUES.gp))) {
    ui.notifications?.warn(i18n("AD2E.Training.CannotPay", { name: actor.name, gp: paid }));
    return null;
  }
  const now = game.time?.worldTime ?? 0;
  const record = { classId: actor.system.multi ? target.id : "", className: target.name, level: target.level, tutor: tutor.name,
    tutorUuid: tutor.uuid, tutorWis: tutor.wis, fee: input.fee, weeks, started: now, until: now + weeks * TRAINING.weekSeconds,
    extra: 0, paid, done: false };
  await actor.update({ "system.training": record });
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${esc(i18n("AD2E.Training.Started", { name: actor.name, cls: target.name, level: target.level, tutor: tutor.name,
      weeks, date: dateText(record.until), gp: paid }))}</p>` });
  return record;
}

/** The end-of-training check (Intelligence or Wisdom, whichever is higher, +1 per extra week). */
export async function trainingCheck(actor) {
  const t = actor?.system?.training;
  const now = game.time?.worldTime ?? 0;
  const status = trainingStatus(t, now);
  if (status === "training") { ui.notifications?.warn(i18n("AD2E.Training.NotYet", { date: dateText(t.until) })); return null; }
  if (status !== "checkDue") return null;
  const ab = actor.system.abilities;
  const target = checkTarget(ab.int?.total, ab.wis?.total, t.extra);
  const roll = await new Roll("1d20").evaluate();
  const ok = roll.total <= target;
  const speaker = ChatMessage.getSpeaker({ actor });
  if (ok) {
    await actor.update({ "system.training.done": true });
    return roll.toMessage({ speaker, flavor: esc(i18n("AD2E.Training.CheckOk", { roll: roll.total, target, cls: t.className, level: t.level })) });
  }
  // A failure: another week (and its fee), with +1 to the next check.
  const fee = Number(t.fee) || 0;
  let note = "";
  if (fee > 0 && !(await payCoins(actor, fee * COIN_VALUES.gp))) note = ` ${i18n("AD2E.Training.Unpaid", { gp: fee })}`;
  await actor.update({ "system.training.extra": (t.extra ?? 0) + 1, "system.training.until": Math.max(now, t.until) + TRAINING.weekSeconds,
    "system.training.paid": (t.paid ?? 0) + (note ? 0 : fee) });
  return roll.toMessage({ speaker, flavor: esc(i18n("AD2E.Training.CheckFail", { roll: roll.total, target,
    date: dateText(Math.max(now, t.until) + TRAINING.weekSeconds), n: (t.extra ?? 0) + 1 }) + note) });
}

/** Stop training (nothing is refunded: "The exact cost must be worked out between player character and tutor"). */
export async function cancelTraining(actor) {
  return actor?.update({ "system.training": { level: 0, done: false } });
}

/**
 * Level Up gate (AD2EActor#levelUp): true when the level may be taken. With the setting on, the class must have finished
 * training for that level; a GM may confirm a level up without it.
 */
export async function trainingAllows(actor, classId, level) {
  if (!trainingOn() || actor?.type !== "character") return true;
  const id = actor.system.multi ? classId : "";
  if (trainedFor(actor.system.training, id, level)) return true;
  if (game.user?.isGM) {
    return !!(await ad2eDialog.confirm({ window: { title: `${actor.name}: ${i18n("AD2E.HP.LevelUp")}` },
      content: `<p>${esc(i18n("AD2E.Training.GmOverride", { level }))}</p>`, rejectClose: false }));
  }
  ui.notifications?.warn(i18n("AD2E.Training.Required", { level }));
  return false;
}

/** After a level up: a finished record for that level is used up. */
export function trainingUsedUpdate(actor, classId, level) {
  return trainedFor(actor?.system?.training, actor?.system?.multi ? classId : "", level) ? { "system.training": { level: 0, done: false } } : {};
}

/** Character tab panel (null when the setting is off). */
export function trainingContext(actor) {
  if (!trainingOn() || actor?.type !== "character") return null;
  const t = actor.system.training;
  const now = game.time?.worldTime ?? 0;
  const status = trainingStatus(t, now);
  const target = trainingTarget(actor);
  const ab = actor.system.abilities;
  return {
    status, url: TRAINING.url,
    text: status === "none" ? i18n("AD2E.Training.None", { cls: target?.name ?? "—", level: target?.level ?? "—" })
      : i18n(`AD2E.Training.Status.${status}`, { cls: t.className, level: t.level, tutor: t.tutor, date: dateText(t.until),
        target: checkTarget(ab?.int?.total, ab?.wis?.total, t.extra), gp: t.paid ?? 0 }),
    canStart: status === "none", canCheck: status === "checkDue", canCancel: status === "training" || status === "checkDue"
  };
}
