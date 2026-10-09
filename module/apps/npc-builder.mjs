import { BUILDS, buildNpc, GENDERS, NPC, npcActorData, PURPOSE_KEYS, PURPOSES } from "../npc-builder.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const i18n = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** Find a compendium document of this system by identifier (Item packs) or by identifier/actor file name (Actor packs). */
async function packDoc(pack, identifier) {
  const p = game.packs.get(`ad2e.${pack}`);
  const index = await p?.getIndex({ fields: ["system.identifier"] });
  const entry = index?.find(e => e.system?.identifier === identifier);
  return entry ? p.getDocument(entry._id) : null;
}

/**
 * GM random NPC builder (module/npc-builder.mjs; Configure Settings, the GM manual, or game.ad2e.createNpc()): pick the
 * purpose and, if wanted, race, class, level formula, gender, Table 10 height/weight column, profession, troop type, title culture or sage field; "Roll"
 * shows the NPC, "Create" makes the character actor (in the world or an unlocked world compendium).
 */
export default class NpcBuilder extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ad2e-npc-builder",
    classes: ["ad2e", "creator"],
    window: { title: "AD2E.Npc.Title", icon: "fa-solid fa-user-plus", resizable: true },
    position: { width: 600, height: "auto" },
    actions: { roll: NpcBuilder.#onRoll, create: NpcBuilder.#onCreate }
  };

  static PARTS = { main: { template: "systems/ad2e/templates/apps/npc-builder.hbs" } };

  state = { purpose: "townsfolk", race: "", cls: "", level: "", gender: "", build: "", profession: "", soldier: "", culture: "", column: "", field: "", name: "", destination: "" };

  spec = null;

  #items = null;

  /** Races and classes from the system compendiums (loaded once). */
  async items() {
    if (!this.#items) {
      const load = async name => [...((await game.packs.get(`ad2e.${name}`)?.getDocuments()) ?? [])];
      this.#items = { races: await load("races"), classes: await load("classes") };
    }
    return this.#items;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const s = this.state;
    const { races, classes } = await this.items();
    const opt = (list, sel, label = x => x) => [{ key: "", label: i18n("AD2E.Npc.Random"), selected: !sel },
      ...list.map(x => ({ key: x.key ?? x, label: label(x), selected: (x.key ?? x) === sel }))];
    const cultures = Object.keys(NPC.titles);
    const packs = [...(game.packs ?? [])].filter(pk => pk.documentName === "Actor" && pk.metadata?.packageType === "world" && !pk.locked);
    const sp = this.spec;
    return {
      ...context, s, isTownsfolk: s.purpose === "townsfolk", isSoldier: s.purpose === "soldier", isOfficial: s.purpose === "official",
      isSage: s.purpose === "sage", levelDefault: PURPOSES[s.purpose]?.level ?? "0",
      purposes: PURPOSE_KEYS.map(k => ({ key: k, label: i18n(`AD2E.Npc.Purpose.${k}`), selected: k === s.purpose })),
      races: opt(races.map(r => ({ key: r.system.identifier, name: r.name })), s.race, r => r.name),
      classes: opt(classes.map(c => ({ key: c.system.identifier, name: c.name })), s.cls, c => c.name),
      genders: opt(GENDERS, s.gender, k => i18n(`AD2E.Npc.Gender.${k}`)),
      builds: [{ key: "", label: i18n("AD2E.Npc.BuildAuto"), selected: !s.build },
        ...BUILDS.map(k => ({ key: k, label: i18n(`AD2E.Npc.Build.${k}`), selected: k === s.build }))],
      professions: opt(NPC.professions.map(p => p.name), s.profession),
      soldiers: opt(NPC.soldiers.map(x => x.name), s.soldier),
      cultures: opt(cultures, s.culture, k => i18n(`AD2E.Npc.Culture.${k}`)),
      columns: opt(s.culture && NPC.titles[s.culture] ? Object.keys(NPC.titles[s.culture]) : [], s.column),
      fields: opt(NPC.sageFields.map(f => f.name), s.field),
      destinations: [{ key: "", label: i18n("AD2E.Creator.World"), selected: !s.destination },
        ...packs.map(pk => ({ key: pk.collection, label: pk.metadata.label, selected: s.destination === pk.collection }))],
      preview: sp ? {
        name: sp.name, race: sp.race?.name ?? "", cls: sp.cls?.name ?? i18n("AD2E.Npc.NoClass"), level: sp.level, hp: sp.hp, xp: sp.xp,
        gender: i18n(`AD2E.Npc.Gender.${sp.gender}`), build: i18n(`AD2E.Npc.Build.${sp.build}`), age: sp.age, alignment: game.i18n.localize(CONFIG.AD2E?.alignments?.[sp.alignment] ?? sp.alignment),
        abilities: Object.entries(sp.abilities).map(([k, v]) => ({ key: game.i18n.localize(`AD2E.Ability.${k}`), value: v + (sp.race?.system.adjust?.[k] ?? 0),
          exceptional: k === "str" && sp.exceptional ? `/${String(sp.exceptional % 100).padStart(2, "0")}` : "" })),
        role: sp.role, traits: `${sp.traits.general}, ${sp.traits.specific}`, looks: Object.values(sp.looks).join(", "),
        size: [sp.height ? `${Math.floor(sp.height / 12)}' ${sp.height % 12}"` : "", sp.weight ? `${sp.weight} lb` : ""].filter(Boolean).join(", ")
      } : null,
      urls: NPC.urls
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const input of this.element.querySelectorAll("[data-field]")) input.addEventListener("change", ev => {
      const t = ev.currentTarget;
      this.state[t.dataset.field] = t.value;
      if (t.dataset.field === "culture") this.state.column = "";
      if (t.dataset.field === "purpose") this.state.level = "";
      this.render();
    });
  }

  static async #onRoll() {
    const items = await this.items();
    this.spec = buildNpc(this.state, items);
    this.render();
  }

  static async #onCreate() {
    if (!this.spec) await NpcBuilder.#onRoll.call(this);
    const sp = this.spec;
    if (!sp) return null;
    const docs = { race: sp.race, cls: sp.cls, gear: [], prof: null, soldierItems: [] };
    const gearKey = sp.cls ? (sp.cls.system.group === "wizard" ? "wizard" : sp.cls.system.identifier) : null;
    for (const g of NPC.gear[gearKey] ?? []) { const d = await packDoc(g.pack, g.identifier); if (d) docs.gear.push(d); }
    if (sp.profession?.prof) docs.prof = await packDoc("proficiencies", sp.profession.prof);
    if (sp.soldier?.hireling) {
      const pack = game.packs.get("ad2e.hirelings");
      const index = await pack?.getIndex({ fields: ["system.identifier"] });
      const entry = index?.find(e => e.system?.identifier === sp.soldier.hireling);
      const actor = entry ? await pack.getDocument(entry._id) : null;
      docs.soldierItems = [...(actor?.items ?? [])];
    }
    const data = npcActorData({ ...sp, name: this.state.name || sp.name }, docs, i18n);
    const actor = await Actor.implementation.create(data, this.state.destination ? { pack: this.state.destination } : {});
    if (!actor) return null;
    ui.notifications.info(i18n("AD2E.Creator.Created", { name: actor.name }));
    actor.sheet?.render(true);
    this.spec = null;
    this.render();
    return actor;
  }
}
