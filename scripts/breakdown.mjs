import { RuleBook } from "./rules.mjs";
import { cfg, MODULE_ID } from "./settings.mjs";

/*
 * Stored format (roll.options.rollLessons), kept small because it is saved in every chat message:
 * { v: 2, k: kind, c: { a, s, m, p, l, cr }, i: [[ruleKey|null, value|formula, extra?], ...], r?: { a, d, o } }
 * Rule text is not stored. It is looked up at render time.
 */

const KIND_MAP = [
  ["initiativedialog", "initiative"],
  ["initiative", "initiative"],
  ["deathsave", "death"],
  ["concentration", "concentration"],
  ["savingthrow", "save"],
  ["skill", "skill"],
  ["tool", "tool"],
  ["attack", "attack"],
  ["damage", "damage"],
  ["hitdie", "hitDie"],
  ["abilitycheck", "check"],
  ["d20test", "d20"]
];

export function kindFromHookNames(names) {
  if (!names?.length) return "generic";
  const list = names.map(n => String(n).toLowerCase());
  for (const [name, kind] of KIND_MAP) if (list.includes(name)) return kind;
  return "generic";
}

const NON_D20 = new Set(["damage", "hitDie", "generic"]);
export const isD20Kind = k => !NON_D20.has(k);

const NUMERIC = /^[\d\s+\-*/().]+$/;
const HAS_DICE = /\d*d\d/i;

/** Number for flat parts, formula string for dice parts. Avoids building Roll objects where possible. */
function resolve(part, data) {
  if (/^[+-]?\d+$/.test(part)) return Number(part);
  let f;
  try { f = Roll.replaceFormulaData(part, data ?? {}, { missing: "0" }); } catch (err) { return part; }
  if (HAS_DICE.test(f)) return f;
  try {
    if (NUMERIC.test(f)) return Roll.safeEval(f);
    return new Roll(f).evaluateSync({ strict: false }).total;
  } catch (err) {
    return f;
  }
}

function formatCR(cr) {
  if (cr === undefined || cr === null || cr === "") return undefined;
  return { 0.125: "1/8", 0.25: "1/4", 0.5: "1/2" }[cr] ?? String(cr);
}

function context(config, rc) {
  const sub = config?.subject;
  const actor = sub?.documentName === "Actor" ? sub : (sub?.actor ?? null);
  const item = sub?.item ?? null;
  const abilityId = rc?.options?.ability ?? rc?.ability ?? config?.ability ?? (item ? sub?.ability : null) ?? null;
  const sys = actor?.system;
  const ab = abilityId ? sys?.abilities?.[abilityId] : null;
  const c = {};
  if (abilityId) c.a = abilityId;
  if (ab?.value !== undefined) c.s = ab.value;
  if (ab?.mod !== undefined) c.m = ab.mod;
  if (sys?.attributes?.prof !== undefined) c.p = sys.attributes.prof;
  if (sys?.details?.level) c.l = sys.details.level;
  if (item?.system?.identifier) c.id = item.system.identifier;
  const cr = formatCR(sys?.details?.cr);
  if (cr !== undefined) c.cr = cr;
  return { actor, item, abilityId, skill: config?.skill ?? rc?.skill, tool: config?.tool ?? rc?.tool, c };
}

function profMultiplier(x, kind) {
  const sys = x.actor?.system;
  if (!sys) return null;
  const prof = kind === "skill" ? sys.skills?.[x.skill]?.prof
    : kind === "tool" ? sys.tools?.[x.tool]?.prof
    : kind === "save" ? sys.abilities?.[x.abilityId]?.save?.prof
    : kind === "check" ? sys.abilities?.[x.abilityId]?.check?.prof
    : kind === "initiative" ? sys.attributes?.init?.prof
    : kind === "attack" ? x.item?.system?.prof
    : null;
  return typeof prof?.multiplier === "number" ? prof.multiplier : null;
}

/** Split a formula into top-level signed terms: "1d10 + @mod - 2" -> [[1,"1d10"],[1,"@mod"],[-1,"2"]]. */
function splitTerms(text) {
  const out = [];
  let depth = 0;
  let cur = "";
  let sign = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    // A hyphen between letters inside an @reference is part of the name (e.g. @scale.barbarian.rage-damage).
    const inRef = ch === "-" && /@[\w.-]*\w$/.test(cur) && /[A-Za-z]/.test(text[i + 1] ?? "");
    if (depth === 0 && (ch === "+" || ch === "-") && !inRef) {
      if (cur.trim()) { out.push([sign, cur.trim()]); cur = ""; sign = ch === "-" ? -1 : 1; }
      else if (ch === "-") sign = -sign;
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push([sign, cur.trim()]);
  return out;
}

/** "@scale.barbarian.rage-damage" -> "Barbarian: Rage Damage". */
function scaleLabel(ref, actor) {
  const m = String(ref).match(/@scale\.([\w-]+)\.([\w-]+)/);
  if (!m) return "";
  const [, cls, id] = m;
  let clsName = cls;
  let title = id;
  for (const item of actor?.items ?? []) {
    if (!["class", "subclass"].includes(item.type) || item.system?.identifier !== cls) continue;
    clsName = item.name;
    const advs = item.advancement?.byType?.ScaleValue ?? Object.values(item.system?.advancement ?? {});
    const adv = [...(advs ?? [])].find(a => (a.configuration?.identifier ?? a.identifier) === id);
    if (adv?.title) title = adv.title;
  }
  return `${clsName}: ${title}`;
}

function profKeys(x, kind) {
  const keys = [];
  if (kind === "attack") keys.push("prof.attack");
  const mult = profMultiplier(x, kind);
  if (mult === 2) keys.push("prof.expertise");
  else if (mult === 1) keys.push("prof.proficient");
  else if (mult === 0.5) keys.push("prof.half");
  keys.push("prof");
  return keys;
}

function effectNames(actor, test) {
  const names = [];
  for (const effect of actor?.appliedEffects ?? []) {
    if ((effect.changes ?? []).some(ch => typeof ch.key === "string" && test(ch.key))) names.push(sourceName(effect, actor));
  }
  return [...new Set(names)].join(", ");
}

/**
 * Raw (unlabelled) parts dnd5e adds to damage rolls, matched back to where they came from.
 * Built once per roll config, only for damage rolls.
 */
function rawSources(config, rc, x, kind) {
  const out = [];
  if (kind !== "damage") return out;
  const sub = config?.subject;
  let actionType;
  try { actionType = sub?.getActionType?.(rc?.options?.attackMode ?? config?.attackMode); } catch (err) { /* ignore */ }
  const sys = x.actor?.system;
  if (sys && actionType) {
    const fromRolls = foundry.utils.getProperty(sys, `rolls.damage.${actionType}.bonus`);
    const fromBonuses = foundry.utils.getProperty(sys, `bonuses.${actionType}.damage`);
    const names = effectNames(x.actor, k => k.startsWith(`system.rolls.damage.${actionType}.`)
      || k.startsWith("system.rolls.damage.bonus") || k === `system.bonuses.${actionType}.damage`);
    for (const raw of [fromRolls, fromBonuses]) {
      const r = String(raw ?? "").trim().replace(/^\+\s*/, "");
      if (!r || /^0+$/.test(r)) continue;
      const scale = scaleLabel(r, x.actor);
      const src = names && scale ? `${names} (${scale}, grows with level)` : (names || scale);
      out.push({ raw: r, key: "actorDamageBonus", src });
    }
  }
  const itemBonus = x.item?.system?.damage?.bonus;
  if (itemBonus) out.push({ raw: String(itemBonus).trim(), key: "itemDamageBonus", src: x.item.name });
  return out;
}

/** Names of the effects behind @ruleBonus for this roll, filtered by their conditions. */
function ruleBonusSources(x, kind, data) {
  const cats = kind === "damage" ? ["damage:bonus", "healing:bonus"]
    : kind === "attack" ? ["attack:bonus", "d20:bonus"]
    : kind === "save" ? ["save:bonus", "d20:bonus"]
    : ["check", "skill", "tool", "initiative"].includes(kind) ? ["check:bonus", "d20:bonus"] : [];
  const names = [];
  for (const src of [x.actor, x.item]) {
    const map = src?.appliedRules;
    if (typeof map?.get !== "function") continue;
    for (const key of cats) {
      for (const r of map.get(key) ?? []) {
        try {
          const cd = r.effect?.getRuleConditionData?.(data) ?? data;
          if (r.effect?.system?.conditions?.check?.(cd) === false) continue;
          if (r.conditions?.check?.(cd) === false) continue;
        } catch (err) { /* keep it */ }
        names.push(sourceName(r.effect, x.actor));
      }
    }
  }
  return [...new Set(names)].join(", ");
}

/** Effects with a damage-related change whose value equals n. Used only to name loose numbers. */
function effectsWithValue(actor, n) {
  const names = [];
  for (const e of actor?.appliedEffects ?? []) {
    if ((e.changes ?? []).some(ch => !String(ch.key).endsWith(".mode") && String(ch.key).toLowerCase().includes("damage") && Number(ch.value) === n)) {
      names.push(sourceName(e, actor));
    }
  }
  return [...new Set(names)].join(", ");
}

/** Search every known place a loose number can come from. Runs only for unlabelled numbers. */
function findSource(whole, x, config) {
  const sub = config?.subject;
  // 1. A damage part on the activity itself.
  const owner = x.item?.name ?? sub?.name;
  for (const p of sub?.damage?.parts ?? []) {
    const f = String(p?.formula ?? p?.custom?.formula ?? "").trim();
    if (f && f === whole) return ["activityPart", owner];
    if (p?.bonus && String(p.bonus).trim().replace(/^\+\s*/, "") === whole) return ["damageLineBonus", `${owner}: ${f}`];
  }
  const base = x.item?.system?.damage?.base;
  if (base?.bonus && String(base.bonus).trim().replace(/^\+\s*/, "") === whole) {
    return ["damageLineBonus", `${owner}: ${base.formula}`];
  }
  // 2. Any bonus field on the character sheet.
  const hits = [];
  const walk = (obj, path, depth) => {
    if (!obj || typeof obj !== "object" || depth > 5) return;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && v.trim() === whole) hits.push(`${path}.${k}`);
      else if (v && typeof v === "object" && !Array.isArray(v)) walk(v, `${path}.${k}`, depth + 1);
    }
  };
  const sys = x.actor?.system;
  if (sys) { walk(sys.bonuses, "system.bonuses", 0); walk(sys.rolls, "system.rolls", 0); }
  if (hits.length) {
    const names = effectNames(x.actor, k => hits.includes(k));
    return ["actorBonusField", names ? `${names} (${hits[0]})` : hits[0]];
  }
  // 3. Any active effect, on the character or the item, that writes this value.
  const effects = [...(x.actor?.appliedEffects ?? []), ...(x.item?.effects ?? [])];
  for (const e of effects) {
    const ch = (e.changes ?? []).find(c => {
      const k = String(c.key ?? "");
      return !k.endsWith(".mode") && /bonus|damage/i.test(k) && String(c.value).trim().replace(/^\+\s*/, "") === whole;
    });
    if (ch) return ["effectValue", `${sourceName(e, x.actor)} (${ch.key})`];
  }
  return null;
}

/** One stored item per top-level term of a roll part. Item: [ruleKey|null, value|formula, extra?]. */
function itemsFor(part, rc, x, kind, state) {
  const whole = String(part).trim();

  // A raw part that matches a known bonus field keeps its source name.
  const match = state.raw.find(s => s.raw === whole.replace(/^\+\s*/, ""));
  if (match) {
    const key = RuleBook.pick([match.key, "flatBonus"]);
    return [match.src ? [key, resolve(whole, rc?.data), match.src] : [key, resolve(whole, rc?.data)]];
  }

  const terms = splitTerms(whole);
  const partHasDice = terms.some(([, term]) => HAS_DICE.test(term));
  const items = [];
  for (const [sign, term] of terms) {
    const m = term.match(/^@([\w.]+)$/);
    const path = m ? m[1].split(".") : null;
    let value = resolve(term, rc?.data);
    if (sign < 0) value = typeof value === "number" ? -value : `-${value}`;

    let keys;
    let extra = path?.[1];
    if (path?.[0] === "prof") keys = profKeys(x, kind);
    else if (path) {
      const healing = ["healing", "temphp"].includes(rc?.options?.type);
      keys = healing ? [path[0]] : [`${path[0]}.${kind}`, path[0]];
    }
    else if (HAS_DICE.test(term)) {
      if (kind === "damage") {
        const healing = ["healing", "temphp"].includes(rc?.options?.type);
        // dnd5e keeps the attack mode on the process config, not on each roll's options.
        const attackMode = rc?.options?.attackMode ?? state.config?.attackMode;
        const versatile = attackMode === "twoHanded" && x.item?.system?.isVersatile;
        keys = state.dice ? ["dmgExtra"] : healing ? ["healBase", "dmgBase"] : versatile ? ["dmgVersatile", "dmgBase"] : ["dmgBase"];
        state.dice = true;
      }
      else keys = ["diceBonus"];
    } else if (partHasDice && typeof value === "number") {
      // A number typed into a damage or bonus formula next to its dice.
      keys = value === x.c.m ? ["formulaFlat.mod", "formulaFlat"] : ["formulaFlat"];
      extra = whole;
    } else {
      const found = findSource(terms.length === 1 ? whole : term, x, state.config);
      const names = !found && typeof value === "number" ? effectsWithValue(x.actor, value) : "";
      if (found) { keys = [found[0]]; extra = found[1]; }
      else if (names) { keys = ["flatBonus.possible"]; extra = names; }
      else { keys = ["flatBonus"]; extra = whole; }
    }

    if (path?.[0] === "ruleBonus") extra = ruleBonusSources(x, kind, rc?.data ?? {}) || undefined;
    if (path?.[0] === "scale") extra = scaleLabel(term, x.actor);
    const key = RuleBook.pick(keys);
    if (!key) items.push([null, value, term]);
    else if (extra) items.push([key, value, extra]);
    else items.push([key, value]);
  }
  return items;
}

/* ---------- Advantage and disadvantage sources (only scanned when the roll has one) ---------- */

function classify(type, v) {
  const t = String(type ?? "add").replace("dnd5e.", "");
  if (t === "add" || t === "override") return v === 1 ? "a" : v === -1 ? "d" : null;
  if (t === "downgrade") return v === -1 ? "d" : null;
  if (t === "upgrade") return v === 1 ? "a" : null;
  return null;
}

function sourceName(effect, actor) {
  const parent = effect?.parent && effect.parent !== actor && effect.parent.name !== effect.name ? ` (${effect.parent.name})` : "";
  return `${effect?.name ?? "?"}${parent}`;
}

function modePaths(x, kind) {
  const id = x.abilityId;
  switch (kind) {
    case "save": return [`abilities.${id}.save.roll`, "rolls.ability.save"];
    case "check": return [`abilities.${id}.check.roll`, "rolls.ability.check"];
    case "skill": return [`abilities.${id}.check.roll`, "rolls.ability.check", "rolls.ability.skill", `skills.${x.skill}.roll`];
    case "tool": return [`abilities.${id}.check.roll`, "rolls.ability.check", "rolls.ability.tool", `tools.${x.tool}.roll`];
    case "attack": return [`abilities.${id}.attack.roll`, "rolls.attack"];
    case "initiative": return ["attributes.init.roll"];
    case "death": return ["attributes.death.roll"];
    case "concentration": return ["attributes.concentration.roll"];
    default: return [];
  }
}

function collectEffects(x, kind, want, out) {
  const paths = modePaths(x, kind).filter(p => !p.includes("undefined") && !p.includes("null"));
  if (!paths.length) return;
  for (const effect of x.actor.appliedEffects ?? []) {
    for (const change of effect.changes ?? []) {
      const k = change.key;
      if (typeof k !== "string" || !k.endsWith(".mode") || !k.startsWith("system.")) continue;
      const p = k.slice(7);
      if (!paths.some(f => p.startsWith(`${f}.`))) continue;
      const side = classify(change.type, Number(change.value));
      if (side && want[side]) out[side].push(sourceName(effect, x.actor));
    }
  }
  if (want.a && (kind === "skill" || kind === "tool") && x.skill && x.tool) {
    const s = x.actor.system;
    if (s.skills?.[x.skill]?.prof?.hasProficiency && s.tools?.[x.tool]?.prof?.hasProficiency) {
      out.a.push("Proficient in both the skill and the tool");
    }
  }
}

function collectRules(x, kind, want, out) {
  const category = kind === "attack" ? "attack" : kind === "save" ? "save"
    : (kind === "check" || kind === "skill" || kind === "tool" || kind === "initiative") ? "check" : null;
  if (!category) return;
  const keys = [`${category}:advantage`, "d20:advantage"];

  // Gather candidates first; only build roll data if any exist.
  const found = [];
  for (const src of [x.actor, x.item]) {
    const map = src?.appliedRules;
    if (typeof map?.get !== "function") continue;
    for (const key of keys) {
      const list = map.get(key);
      if (list?.length) found.push(...list);
    }
  }
  if (!found.length) return;

  let rd;
  try {
    rd = x.actor.getRollData({ roll: true });
    rd.roll = Object.assign(rd.roll ?? {}, { ability: x.abilityId, type: kind });
  } catch (err) { return; }

  for (const r of found) {
    try {
      const cd = r.effect?.getRuleConditionData?.(rd) ?? rd;
      if (r.effect?.system?.conditions?.check?.(cd) === false) continue;
      if (r.conditions?.check?.(cd) === false) continue;
    } catch (err) { continue; }
    const name = sourceName(r.effect, x.actor);
    const v = String(r.value ?? r).trim();
    if (want.a && ["1", "+1", "=1", "=+1"].includes(v)) out.a.push(name);
    else if (want.d && ["-1", "=-1"].includes(v)) out.d.push(name);
    else if (v === ">=0") out.o.push(`${name}: cannot have disadvantage`);
    else if (v === "<=0") out.o.push(`${name}: cannot have advantage`);
  }
}

function collectReasons(x, kind, mode) {
  if (!x.actor || !isD20Kind(kind)) return null;
  // Normal rolls show no reason box, so skip the scan entirely.
  if (mode === 0) return null;
  const want = { a: mode !== -1, d: mode !== 1 };
  const out = { a: [], d: [], o: [] };
  try { collectEffects(x, kind, want, out); } catch (err) { /* ignore */ }
  try { collectRules(x, kind, want, out); } catch (err) { /* ignore */ }
  const r = {};
  for (const k of ["a", "d", "o"]) if (out[k].length) r[k] = [...new Set(out[k])];
  return Object.keys(r).length ? r : null;
}

/* ---------- Entry points ---------- */

/** Modifier items. Called when each roll config is final (dnd5e.postBuildRollConfig). */
export function buildLessons(config, rc, kind) {
  const x = context(config, rc);
  const lessons = { v: 2, k: kind, c: x.c, i: [] };
  const state = { raw: rawSources(config, rc, x, kind), config };
  for (const p of rc?.parts ?? []) if (p) lessons.i.push(...itemsFor(p, rc, x, kind, state));
  // A +0 row teaches nothing, except for an ability modifier or proficiency.
  lessons.i = lessons.i.filter(([key, value]) => value !== 0 || /^(mod|prof)/.test(key ?? ""));
  if (kind === "damage") rageCheck(config, rc, x, lessons);
  if (cfg.debug) {
    console.log(`${MODULE_ID} | breakdown`, { kind, hookNames: config?.hookNames, parts: rc?.parts, data: rc?.data, lessons });
  }
  return lessons;
}

/**
 * 2024 PHB: Rage Damage applies to any attack using Strength, thrown weapons included.
 * dnd5e only adds it to melee weapon attacks. Flag the gap so the panel can say so.
 */
function rageCheck(config, rc, x, lessons) {
  if (x.abilityId !== "str" || lessons.i.some(([k]) => k === "actorDamageBonus")) return;
  const rage = [...(x.actor?.appliedEffects ?? [])].find(e => /^rage$/i.test(e.name));
  if (!rage) return;
  let actionType;
  try { actionType = config?.subject?.getActionType?.(rc?.options?.attackMode ?? config?.attackMode); } catch (err) { return; }
  if (!actionType || actionType === "mwak" || !["rwak", "mwak"].includes(actionType)) return;
  const raw = foundry.utils.getProperty(x.actor.system, "bonuses.mwak.damage") || foundry.utils.getProperty(x.actor.system, "rolls.damage.mwak.bonus");
  const value = raw ? resolve(String(raw).replace(/^\+\s*/, ""), rc?.data) : undefined;
  lessons.c.rg = typeof value === "number" ? value : 1;
}

/** Advantage reasons. Called once the roll exists and its advantage mode is final. */
export function addReasons(lessons, config, rc, roll) {
  const x = context(config, { ...rc, options: roll?.options ?? rc?.options });
  const r = collectReasons(x, lessons.k, roll?.options?.advantageMode);
  if (r) lessons.r = r;
  else delete lessons.r;
  return lessons;
}
