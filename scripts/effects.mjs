import { MODULE_ID } from "./settings.mjs";
import { RuleBook } from "./rules.mjs";
import { resolve, describeFormula, plainText, pickSentence, nameTheCaster, conditionClauses, NEXT_ROLL } from "./text.mjs";

/*
 * Effect attribution: which active effects, rules and sheet settings put a bonus or penalty into a roll,
 * where each one came from, the rule sentence behind it, how long it lasts, and timing problems.
 *
 * Stored explanation (item index 4, and advantage reasons), kept small:
 * { n: effect name, v?: value, o?: source text, s?: rule sentence, f?: formula in words, d?: duration,
 *   w?: warning codes, u?: effect uuid, ou?: origin uuid, ct?: effect creation time, c?: condition id,
 *   x1?: 1 when it applies to one roll only }
 * Warning codes: "once" applies to one roll only, "used" an earlier roll already used it, "expired" its duration ran out.
 * "early" (applied before the save that decides it) is worked out when the panel is drawn.
 */

/** Old effect keys that dnd5e 6 redirects to the new roll fields (ActiveEffect5e.SHIM_FIELDS). */
const LEGACY_KEYS = {
  "system.attributes.concentration.bonuses.save": "system.attributes.concentration.roll.bonus",
  "system.attributes.death.bonuses.save": "system.attributes.death.roll.bonus",
  "system.attributes.init.bonus": "system.attributes.init.roll.bonus",
  "system.bonuses.mwak.attack": "system.rolls.attack.mwak.bonus",
  "system.bonuses.msak.attack": "system.rolls.attack.msak.bonus",
  "system.bonuses.rwak.attack": "system.rolls.attack.rwak.bonus",
  "system.bonuses.rsak.attack": "system.rolls.attack.rsak.bonus",
  "system.bonuses.mwak.damage": "system.rolls.damage.mwak.bonus",
  "system.bonuses.msak.damage": "system.rolls.damage.msak.bonus",
  "system.bonuses.rwak.damage": "system.rolls.damage.rwak.bonus",
  "system.bonuses.rsak.damage": "system.rolls.damage.rsak.bonus",
  "system.bonuses.abilities.check": "system.rolls.ability.check.bonus",
  "system.bonuses.abilities.save": "system.rolls.ability.save.bonus",
  "system.bonuses.abilities.skill": "system.rolls.ability.skill.bonus"
};
const BONUS_SHIM = /^system\.(abilities|skills|tools)\.(\w+)\.bonuses\.(check|save)$/;

export function normalizeKey(key) {
  const k = String(key ?? "");
  const shim = globalThis.CONFIG?.ActiveEffect?.documentClass?.SHIM_FIELDS?.[k]?.key ?? LEGACY_KEYS[k];
  if (shim) return shim;
  const m = k.match(BONUS_SHIM);
  if (m) return `system.${m[1]}.${m[2]}.${m[1] === "abilities" ? `${m[3]}.` : ""}roll.bonus`;
  return k;
}

/** Roll fields dnd5e 6.0.6 reads a bonus from, per roll kind (see Actor5e#rollSavingThrow and friends). */
export function rollFields(kind, { abilityId: a, skill, tool } = {}, actionType) {
  const list = {
    save: [`abilities.${a}.save.roll`, "rolls.ability.save"],
    concentration: ["attributes.concentration.roll", `abilities.${a}.save.roll`, "rolls.ability.save"],
    death: ["attributes.death.roll", "rolls.ability.save"],
    check: [`abilities.${a}.check.roll`, "rolls.ability.check"],
    skill: [`abilities.${a}.check.roll`, "rolls.ability.check", "rolls.ability.skill", `skills.${skill}.roll`],
    tool: [`abilities.${a}.check.roll`, "rolls.ability.check", "rolls.ability.tool", `tools.${tool}.roll`],
    initiative: ["attributes.init.roll", `abilities.${a}.check.roll`, "rolls.ability.check"],
    attack: [`abilities.${a}.attack.roll`, "rolls.attack", actionType ? `rolls.attack.${actionType}` : null],
    damage: [actionType ? `rolls.damage.${actionType}` : null]
  }[kind] ?? [];
  return list.filter(p => p && !/\.(undefined|null)\./.test(p) && !/\.(undefined|null)$/.test(p));
}

function ruleCategories(kind) {
  if (kind === "damage") return ["damage:bonus", "healing:bonus"];
  if (kind === "attack") return ["attack:bonus", "d20:bonus"];
  if (["save", "concentration", "death"].includes(kind)) return ["save:bonus", "d20:bonus"];
  if (["check", "skill", "tool", "initiative"].includes(kind)) return ["check:bonus", "d20:bonus"];
  return [];
}

function passes(r, data) {
  try {
    const cd = r.effect?.getRuleConditionData?.(data) ?? data;
    if (r.effect?.system?.conditions?.check?.(cd) === false) return false;
    if (r.conditions?.check?.(cd) === false) return false;
  } catch (err) { /* keep it */ }
  return true;
}

/**
 * Everything that adds to the bonus of this roll: effect changes on the roll fields, applied rules,
 * and a value typed on the character sheet itself.
 * @returns {{effect?: object, raw: string, value: number|string, sheet?: string}[]}
 */
export function contributors({ actor, item, kind, x = {}, data = {}, actionType }) {
  const out = [];
  if (!actor) return out;
  const fields = rollFields(kind, x, actionType).map(p => `system.${p}.bonus`);
  const touched = new Set();
  for (const effect of actor.appliedEffects ?? []) {
    for (const ch of effect.changes ?? []) {
      const key = normalizeKey(ch.key);
      if (!fields.includes(key)) continue;
      touched.add(key);
      const raw = String(ch.value ?? "").trim().replace(/^\+\s*/, "");
      if (!raw || /^0+$/.test(raw)) continue;
      out.push({ effect, raw, value: resolve(raw, data) });
    }
  }
  for (const src of [actor, item]) {
    const map = src?.appliedRules;
    if (typeof map?.get !== "function") continue;
    for (const cat of ruleCategories(kind)) {
      for (const r of map.get(cat) ?? []) {
        if (!passes(r, data)) continue;
        const raw = String(r.value ?? "").trim().replace(/^\+\s*/, "");
        if (!raw || /^0+$/.test(raw)) continue;
        out.push({ effect: r.effect, raw, value: resolve(raw, data) });
      }
    }
  }
  // A bonus typed on the sheet (the field's own value, before effects).
  const source = actor._source?.system;
  for (const f of fields) {
    if (touched.has(f)) continue;
    const raw = String(foundry.utils.getProperty(source ?? {}, f.slice(7)) ?? "").trim().replace(/^\+\s*/, "");
    if (raw && !/^0+$/.test(raw)) out.push({ raw, value: resolve(raw, data), sheet: f });
  }
  return out;
}

function docFrom(uuid) {
  if (!uuid) return null;
  try { return fromUuidSync(uuid, { strict: false }) ?? null; } catch (err) { return null; }
}

function sameActor(a, b) {
  if (!a || !b) return false;
  return a === b || (a.uuid && a.uuid === b.uuid) || (a.id && a.id === b.id && !a.isToken && !b.isToken);
}

/** Where an effect came from: the item and activity that made it, and their owner. */
export function effectOrigin(effect, actor) {
  const origin = docFrom(effect?.origin);
  let item = origin?.documentName === "Item" ? origin : (origin?.item ?? null);
  const activity = origin && origin.documentName !== "Item" && origin.item ? origin : null;
  if (!item && effect?.parent?.documentName === "Item") item = effect.parent;
  const owner = item?.actor ?? (origin?.documentName === "Actor" ? origin : null);
  const other = owner && !sameActor(owner, actor);
  let text;
  if (item && other) text = `${owner.name}'s ${item.name}`;
  else if (item && item.name !== effect?.name) text = item.name;
  else if (other) text = owner.name;
  return { item, activity, owner: other ? owner : null, text, uuid: activity?.uuid ?? item?.uuid ?? effect?.origin ?? undefined };
}

function conditionOf(effect) {
  for (const id of effect?.statuses ?? []) if (RuleBook.data[`condition.${id}`]) return id;
  return null;
}

const UNITS = { rounds: ["round", "rounds"], turns: ["turn", "turns"], seconds: ["second", "seconds"], minutes: ["minute", "minutes"], hours: ["hour", "hours"], days: ["day", "days"] };
const plural = (n, units) => `${n} ${(UNITS[units] ?? [units, units])[n === 1 ? 0 : 1]}`;

/** "Concentration, 9 rounds left", "1 round", "Until removed". */
export function durationText(effect, src = {}) {
  const parts = [];
  const props = src.item?.system?.properties;
  if (props?.has?.("concentration")) parts.push("Concentration");
  const d = effect?.duration ?? {};
  let units = d.units;
  let rem = typeof d.remaining === "number" && d.remaining > 0 ? d.remaining : null;
  let value = d.value;
  if (!units && d.rounds) { units = "rounds"; value = d.rounds; }
  else if (!units && d.seconds) { units = "seconds"; value = d.seconds; }
  const fmt = n => {
    if (units === "seconds" && n >= 60) return n % 60 === 0 ? plural(n / 60, "minutes") : plural(Math.round(n / 60), "minutes");
    return plural(Math.round(n * 10) / 10, units);
  };
  if (rem && units) parts.push(`${fmt(rem)} left`);
  else if (value && units && UNITS[units]) parts.push(fmt(value));
  return parts.join(", ") || null;
}

/**
 * Explanation for one effect's part in this roll.
 * @param {object} effect   ActiveEffect (or null for a sheet setting)
 * @param {object} actor    the creature making the roll
 * @param {object} ctx      { kind, value, raw, skillLabel }
 */
export function explainEffect(effect, actor, ctx = {}) {
  const ex = { n: effect?.name ?? "?" };
  if (ctx.value !== undefined) ex.v = ctx.value;
  if (effect?.uuid) ex.u = effect.uuid;
  const src = effectOrigin(effect, actor);
  if (src.text) ex.o = src.text;
  if (src.uuid) {
    ex.ou = src.uuid;
    const ct = effect?._stats?.createdTime;
    if (ct) ex.ct = ct;
  }
  const cond = conditionOf(effect);
  if (cond) ex.c = cond;

  const amount = ctx.raw && !String(ctx.raw).includes("@") ? String(ctx.raw) : (typeof ctx.value === "number" ? String(Math.abs(ctx.value)) : String(ctx.value ?? ""));
  const opts = { kind: ctx.kind, amount, extraWord: ctx.skillLabel };
  // A condition's own rule text (2024 Player's Handbook) comes first; then the effect, then the item it came from.
  let s = cond ? conditionClauses(RuleBook.data[`condition.${cond}`]?.text, ctx.kind) : null;
  let fromItem = false;
  if (!s) s = pickSentence(plainText(effect?.description), opts);
  if (!s && src.item) { s = pickSentence(plainText(src.item.system?.description?.value), opts); fromItem = !!s; }
  if (s && fromItem && src.owner) s = nameTheCaster(s, src.owner.name);
  if (s) ex.s = s;
  const f = ctx.raw ? describeFormula(ctx.raw) : null;
  if (f) ex.f = f;
  const d = durationText(effect, src);
  if (d) ex.d = d;

  const w = [];
  const allText = `${s ?? ""} ${plainText(effect?.description)}`;
  if (NEXT_ROLL.test(allText)) {
    ex.x1 = 1;
    w.push(effect?.flags?.[MODULE_ID]?.usedBy ? "used" : "once");
  }
  if (effect?.duration?.expired === true) w.push("expired");
  if (w.length) ex.w = w;
  return ex;
}

/** Explanation for a bonus typed on the character sheet. */
function explainSheet(c, actor) {
  const field = c.sheet.replace(/^system\./, "").replace(/\.bonus$/, "");
  const ex = { n: `${actor?.name ?? "Character"} sheet bonus`, v: c.value, s: `Set in the sheet's bonus field (${field}), not by an effect.` };
  const f = describeFormula(c.raw);
  if (f) ex.f = f;
  return ex;
}

/** Explanations for every contributor of a bonus. */
export function explainContributors(list, actor, ctx) {
  return list.map(c => (c.effect ? explainEffect(c.effect, actor, { ...ctx, value: c.value, raw: c.raw }) : explainSheet(c, actor)));
}

/** "Slivered, from Kara's Mind Sliver" */
export function exLabel(ex) {
  return ex.o ? `${ex.n}, from ${ex.o}` : ex.n;
}

/** Explanation for an advantage or disadvantage source. */
export function explainReason(effect, actor, kind) {
  const ex = explainEffect(effect, actor, { kind });
  delete ex.v;
  return ex;
}

/**
 * "yes" when the effect was made by the same casting whose save this roll is (it was applied before the save
 * that decides whether it applies), "maybe" when it came from the same spell but the casting time is unknown.
 */
export function appliedEarly(ex, { activity, item, castAt } = {}) {
  if (!ex?.ou) return false;
  const same = (activity && ex.ou === activity) || (item && (ex.ou === item || ex.ou.startsWith(`${item}.`)));
  if (!same) return false;
  // An effect made before this casting came from an earlier one and rightly applies to this save.
  if (castAt && ex.ct) return ex.ct >= castAt ? "yes" : false;
  return "maybe";
}

/** Every explanation stored on a roll: modifier rows and advantage reasons. */
export function allExplanations(L) {
  const out = [];
  for (const it of L?.i ?? []) for (const ex of it[4] ?? []) out.push(ex);
  for (const k of ["a", "d", "o"]) for (const r of L?.r?.[k] ?? []) if (r && typeof r === "object") out.push(r);
  return out;
}

/**
 * Run by the log writer (the active GM) when a roll message is created: effects that apply to one roll
 * only are marked as used, so a later roll that still finds them can say so.
 */
export async function markUsed(message, isWriter) {
  if (!isWriter?.()) return;
  for (const roll of message?.rolls ?? []) {
    for (const ex of allExplanations(roll.options?.rollLessons)) {
      if (!ex.x1 || !ex.u) continue;
      const effect = docFrom(ex.u);
      if (!effect || effect.flags?.[MODULE_ID]?.usedBy) continue;
      try { await effect.setFlag(MODULE_ID, "usedBy", message.id); } catch (err) { /* no permission or deleted */ }
    }
  }
}
