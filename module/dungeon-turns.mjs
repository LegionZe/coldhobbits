import { LIGHT } from "./lights.mjs";

/**
 * Dungeon turns (owner's request, 1.0.30): a turn is 10 minutes ("A turn is equal to 10 minutes of game time", Time and
 * Movement (PHB)), so 6 turns are an hour; the GM tracker (module/apps/dungeon-turns.mjs) advances world time a turn at a
 * time. Owner's rulings: the party rests one turn in every 6 — after 5 turns of activity the GM is reminded that the next
 * turn is a rest; every 6 turns without a rest give -1 to attack rolls and checks (ability and proficiency checks) until
 * the party rests. World setting `dungeonTurns` (config false): { active, started, lastRest, reminded, penalty } (world
 * times). Implementation choice: the party = player-owned characters.
 */
export const TURN = LIGHT.turnSeconds;
export const REST_EVERY = 6;

const DEFAULT = { active: false, started: 0, lastRest: 0, reminded: -1, penalty: 0 };

export function dungeonState() {
  try { return { ...DEFAULT, ...(game.settings.get("ad2e", "dungeonTurns") ?? {}) }; } catch { return { ...DEFAULT }; }
}

/** Turns of the expedition, turns since the last rest, whether a rest is due next and the fatigue penalty (pure). */
export function restState(state, now) {
  if (!state?.active) return { active: false, turns: 0, sinceRest: 0, due: false, penalty: 0, untilRest: REST_EVERY - 1 };
  const turns = Math.max(Math.floor((now - state.started) / TURN), 0);
  const sinceRest = Math.max(Math.floor((now - state.lastRest) / TURN), 0);
  return { active: true, turns, sinceRest, due: sinceRest >= REST_EVERY - 1, penalty: Math.floor(sinceRest / REST_EVERY),
    untilRest: Math.max(REST_EVERY - 1 - sinceRest, 0) };
}

/** Fatigue modifier for an actor (pure with `state` and `now`): -penalty for player-owned characters, else 0. */
export function fatigueFor(actor, state = dungeonState(), now = globalThis.game?.time?.worldTime ?? 0) {
  if (actor?.type !== "character" || !actor.hasPlayerOwner) return 0;
  return -restState(state, now).penalty || 0;
}

async function save(state) {
  await game.settings.set("ad2e", "dungeonTurns", state);
}

/** Re-prepare the party so the fatigue penalty shows at once. */
function refreshParty() {
  for (const a of game.actors ?? []) if (a.type === "character" && a.hasPlayerOwner) {
    a.prepareData();
    if (a.sheet?.rendered) a.sheet.render();
  }
}

export async function startExpedition() {
  const now = game.time.worldTime;
  await save({ active: true, started: now, lastRest: now, reminded: -1, penalty: 0 });
}

export async function endExpedition() {
  await save({ ...dungeonState(), active: false, penalty: 0 });
}

/** Advance one turn (10 minutes of world time); a rest turn also resets the count and the penalty. */
export async function advanceTurn({ rest = false } = {}) {
  const target = game.time.worldTime + TURN;
  await game.time.advance(TURN);
  if (rest) {
    await save({ ...dungeonState(), lastRest: target, reminded: -1, penalty: 0 });
    await ChatMessage.implementation.create({ content: `<p>${game.i18n.localize("AD2E.Dungeon.Rested")}</p>`,
      whisper: ChatMessage.getWhisperRecipients?.("GM") ?? [] });
  }
}

/** On world time (active GM): remind before the rest turn once per cycle; announce a new fatigue penalty. */
export async function dungeonTick(now = game.time.worldTime) {
  const state = dungeonState();
  if (!state.active) return;
  const st = restState(state, now);
  const update = {};
  if (st.due && state.reminded !== state.lastRest && st.penalty === 0) {
    update.reminded = state.lastRest;
    await ChatMessage.implementation.create({ content: `<p>${game.i18n.localize("AD2E.Dungeon.RestDue")}</p>`,
      whisper: ChatMessage.getWhisperRecipients?.("GM") ?? [] });
  }
  if (st.penalty !== state.penalty) {
    update.penalty = st.penalty;
    if (st.penalty > state.penalty) await ChatMessage.implementation.create({ content: `<p>${game.i18n.format("AD2E.Dungeon.Missed", { n: st.penalty })}</p>` });
  }
  if (Object.keys(update).length) await save({ ...state, ...update });
}

export function registerDungeonTurns() {
  game.settings.register("ad2e", "dungeonTurns", { scope: "world", config: false, type: Object, default: { ...DEFAULT },
    onChange: () => { refreshParty(); Hooks.callAll("ad2eDungeonTurns"); } });
  Hooks.on("updateWorldTime", () => {
    if (dungeonState().active) refreshParty();
    if (game.users?.activeGM?.isSelf) dungeonTick();
  });
}
