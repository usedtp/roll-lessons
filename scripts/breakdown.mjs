import { RuleBook } from "./rules.mjs";
import { cfg, MODULE_ID } from "./settings.mjs";
import { expectedSources, findCombination } from "./phb.mjs";
import { resolve, HAS_DICE } from "./text.mjs";
import { contributors, explainContributors, explainReason, explainEffect, exLabel, rollFields, normalizeKey, effectOrigin } from "./effects.mjs";

/*
 * Stored format (roll.options.rollLessons), kept small because it is saved in every chat message:
 * { v: 2, k: kind, c: { a, s, m, p, l, cr, id }, i: [[ruleKey|null, value|formula, extra?, how?, explanations?], ...], r?: { a, d, o }, pp?: parts }
 * explanations: see effects.mjs. Advantage reasons are strings or explanations.
 * how: l = dnd5e label, r = known bonus field, a = Automated Conditions 5e, v = rule value match,
 *      c = combination of rule sources, s = sheet or effect search, x = unmatched
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

export { resolve };

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

/**
 * Rejoin roll parts that were split inside brackets. Automated Conditions 5e rebuilds damage parts with
 * formula.split("+"), which turns "(floor((@details.level + 1) / 6))d6" into two broken halves.
 * Parts are merged back, joined with " + ", until their brackets balance. Balanced input is returned as is.
 */
export function repairParts(parts) {
  if (!Array.isArray(parts) || parts.length < 2) return parts;
  const delta = s => {
    let d = 0;
    for (const ch of String(s)) {
      if ("([{".includes(ch)) d++;
      else if (")]}".includes(ch)) d--;
    }
    return d;
  };
  if (parts.every(p => delta(p) === 0)) return parts;
  const out = [];
  let buf = null;
  let depth = 0;
  for (const p of parts) {
    const text = String(p);
    if (buf === null) { buf = text; depth = delta(text); }
    else { buf += ` + ${text.replace(/^\+\s*/, "")}`; depth += delta(text); }
    if (depth <= 0) { out.push(buf); buf = null; depth = 0; }
  }
  if (buf !== null) out.push(buf);
  return out;
}

/** Dice whose count grows with character level, as cantrips do ("(floor((@details.level + 1) / 6))d6"). */
const LEVEL_SCALED = /@details\.level|@classes\.[\w-]+\.levels/;

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

/** Effects, rules and sheet settings behind a bonus, with an explanation for each. */
function bonusExplanations(x, kind, data, actionType) {
  const list = contributors({ actor: x.actor, item: x.item, kind, x, data, actionType });
  if (!list.length) return null;
  const skillLabel = x.skill ? (CONFIG.DND5E?.skills?.[x.skill]?.label ?? null) : null;
  return explainContributors(list, x.actor, { kind, skillLabel });
}

const isNegative = v => (typeof v === "number" ? v < 0 : /^-/.test(String(v).trim()));

/** Effects with a damage-related change whose value equals n. Used only to name loose numbers. */
function effectsWithValue(actor, n) {
  const names = [];
  for (const e of actor?.appliedEffects ?? []) {
    if ((e.changes ?? []).some(ch => !String(ch.key).endsWith(".mode") && !/\.hp\.|\.ac\./i.test(String(ch.key)) && String(ch.key).toLowerCase().includes("damage") && Number(ch.value) === n)) {
      names.push(sourceName(e, actor));
    }
  }
  return [...new Set(names)].join(", ");
}

/** Search every known place a loose number can come from. Runs only for unlabelled numbers. */
function findSource(whole, x, config, kind) {
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
      if (k.endsWith(".mode") || /\.hp\.|\.ac\./i.test(k)) return false;
      const fits = kind === "damage" ? /damage/i.test(k) : kind === "attack" ? /attack|\.(mwak|rwak|msak|rsak)\./i.test(k) : /bonus/i.test(k);
      return fits && String(c.value).trim().replace(/^\+\s*/, "") === whole;
    });
    if (ch) return ["effectValue", `${sourceName(e, x.actor)} (${ch.key})`, e, String(ch.value)];
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
    const ex = match.key === "actorDamageBonus" ? bonusExplanations(x, kind, rc?.data ?? {}, state.actionType) : null;
    const item = [key, resolve(whole, rc?.data), (ex ? ex.map(exLabel).join("; ") : match.src) || undefined, "r"];
    if (ex) item.push(ex);
    return [item];
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
      if (kind === "damage" && LEVEL_SCALED.test(term)) {
        keys = ["cantripUpgrade", "dmgExtra", "dmgBase"];
        extra = whole;
        state.dice = true;
      }
      else if (kind === "damage") {
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
      // Resolved after all parts are read: see resolveLoose.
      items.push(["__loose", value, terms.length === 1 ? whole : term]);
      continue;
    }

    let ex = null;
    if (path?.[0] === "ruleBonus") {
      ex = bonusExplanations(x, kind, rc?.data ?? {}, state.actionType);
      extra = ex ? ex.map(exLabel).join("; ") : undefined;
      if (isNegative(value)) keys = ["rulePenalty", ...keys];
    }
    if (path?.[0] === "scale") extra = scaleLabel(term, x.actor);
    const key = RuleBook.pick(keys);
    if (!key) items.push(["__loose", value, term]);
    else items.push(ex ? [key, value, extra || undefined, "l", ex] : [key, value, extra || undefined, "l"]);
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
      if (side && want[side]) out[side].push(explainReason(effect, x.actor, kind));
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
    const ex = explainReason(r.effect, x.actor, kind);
    const v = String(r.value ?? r).trim();
    if (want.a && ["1", "+1", "=1", "=+1"].includes(v)) out.a.push(ex);
    else if (want.d && ["-1", "=-1"].includes(v)) out.d.push(ex);
    else if (v === ">=0") out.o.push(`${exLabel(ex)}: cannot have disadvantage`);
    else if (v === "<=0") out.o.push(`${exLabel(ex)}: cannot have advantage`);
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
  for (const k of ["a", "d", "o"]) {
    const seen = new Set();
    const list = out[k].filter(e => {
      const id = typeof e === "string" ? e : `${e.n}|${e.o ?? ""}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (list.length) r[k] = list;
  }
  return Object.keys(r).length ? r : null;
}

/* ---------- Entry points ---------- */

/**
 * Some flows rebuild a roll config with its @references already turned into numbers
 * (seen with the damage dialog in this world). Put the labelled part back wherever it
 * still produces the same value, so every number keeps its source.
 */
export function restoreParts(labelled, parts, data) {
  if (!labelled?.length || !parts?.length) return parts;
  return parts.map((p, i) => {
    const original = labelled[i];
    if (original === undefined || original === p || !String(original).includes("@")) return p;
    const a = resolve(String(original).trim(), data);
    const b = resolve(String(p).replace(/^\+\s*/, "").trim(), data);
    return a === b ? original : p;
  });
}

/** Modifier items. Called when each roll config is final (dnd5e.postBuildRollConfig). */
export function buildLessons(config, rc, kind) {
  const x = context(config, rc);
  const lessons = { v: 2, k: kind, c: x.c, i: [] };
  let actionType;
  try { actionType = config?.subject?.getActionType?.(rc?.options?.attackMode ?? config?.attackMode); } catch (err) { /* none */ }
  const state = { raw: rawSources(config, rc, x, kind), config, actionType };
  const parts = repairParts(rc?.parts ?? []);
  for (const p of parts) if (p) lessons.i.push(...itemsFor(p, rc, x, kind, state));
  resolveLoose(lessons, state, rc, x, kind, config);
  // A +0 row teaches nothing, except for an ability modifier or proficiency.
  lessons.i = lessons.i.filter(([key, value]) => value !== 0 || /^(mod|prof)/.test(key ?? ""));
  noProfRow(lessons, x, kind);
  lessons.pp = parts.map(String);
  if (kind === "damage") rageCheck(config, rc, x, lessons);
  if (kind === "attack" || kind === "damage") abilityReason(config, rc, x, lessons, kind);
  try {
    const off = inactiveEffects(x, kind, state.actionType, rc?.data ?? {});
    if (off) lessons.off = off;
  } catch (err) { /* never block a roll */ }
  if (cfg.debug) {
    console.log(`${MODULE_ID} | breakdown`, { kind, hookNames: config?.hookNames, parts: rc?.parts, data: rc?.data, lessons });
  }
  return lessons;
}

/** Labels Automated Conditions 5e lists as bonuses in its chat tooltip. */
function ac5eLabels(record) {
  const html = String(record?.chatTooltip ?? "");
  const text = html.replace(/<[^>]+>/g, "\n");
  const names = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:Bonus|Target Grants Bonus|Target grants bonus)\s*:\s*(.+)$/i);
    if (m) names.push(...m[1].split(",").map(s => s.trim()).filter(Boolean));
  }
  return names.join(", ");
}

/**
 * Account for every number dnd5e passed without a label, in this order:
 * Automated Conditions 5e's record, one rule source, a combination of rule sources,
 * then every bonus setting and effect on the character and item.
 */
function resolveLoose(lessons, state, rc, x, kind, config) {
  const ac5e = rc?.options?.["automated-conditions-5e"];
  const applied = (ac5e?.appliedParts ?? []).map(p => String(p).trim().replace(/^\+\s*/, ""));
  const sources = expectedSources({ config, rc, x, kind, effectNames });
  const used = new Set();
  // Sources already shown with a dnd5e label are not available again.
  for (const [key, value, , how] of lessons.i) {
    if (how !== "l" && how !== "r") continue;
    const i = sources.findIndex((s, j) => !used.has(j) && s.v === value && (s.key === key || s.key.split(".")[0] === String(key).split(".")[0]));
    if (i >= 0) used.add(i);
  }
  const out = [];
  for (const item of lessons.i) {
    if (item[0] !== "__loose") { out.push(item); continue; }
    const [, value, text] = item;
    const plain = String(text).trim().replace(/^\+\s*/, "");
    if (applied.includes(plain)) { out.push(["ac5eBonus", value, ac5eLabels(ac5e) || undefined, "a"]); continue; }
    if (typeof value === "number") {
      const one = sources.findIndex((s, j) => !used.has(j) && s.v === value);
      if (one >= 0) {
        used.add(one);
        const s = sources[one];
        out.push([RuleBook.pick([s.key, s.key.split(".")[0]]) ?? s.key, value, s.extra || undefined, "v"]);
        continue;
      }
      const combo = findCombination(sources, value, used);
      if (combo) {
        for (const j of combo) {
          used.add(j);
          const s = sources[j];
          out.push([RuleBook.pick([s.key, s.key.split(".")[0]]) ?? s.key, s.v, s.extra || undefined, "c"]);
        }
        continue;
      }
    }
    const found = findSource(plain, x, config, kind);
    if (found) {
      const it = [found[0], value, found[1], "s"];
      if (found[2]) it.push([explainEffect(found[2], x.actor, { kind, value, raw: found[3] })]);
      out.push(it);
      continue;
    }
    const names = typeof value === "number" ? effectsWithValue(x.actor, value) : "";
    if (names) { out.push(["flatBonus.possible", value, names, "s"]); continue; }
    out.push(["notFromRules", value, plain, "x"]);
  }
  lessons.i = out;
}

/** "+0, not proficient" row for saves and checks, naming the proficiencies the creature does have. */
function noProfRow(lessons, x, kind) {
  if (!["save", "check", "skill", "tool", "concentration"].includes(kind)) return;
  if (lessons.i.some(([k]) => /^prof/.test(k ?? ""))) return;
  const sys = x.actor?.system;
  if (!sys) return;
  const label = id => CONFIG.DND5E?.abilities?.[id]?.label ?? id;
  let extra;
  if (kind === "save" || kind === "concentration") {
    extra = `not proficient in ${label(x.abilityId ?? "con")} saving throws`;
  } else if (kind === "skill") {
    extra = `not proficient in ${CONFIG.DND5E?.skills?.[x.skill]?.label ?? x.skill}`;
  } else if (kind === "tool") {
    extra = "not proficient with this tool";
  } else {
    extra = "plain ability checks add no proficiency";
  }
  lessons.i.push([RuleBook.pick([`prof.none.${kind}`, "prof.none"]) ?? "prof.none", 0, extra, "l"]);
}

/* ---------- Which ability an attack uses, and why (2024 PHB, Attack Roll Abilities) ---------- */

const ABILITY_CHANGE = /attack\.ability$/;

/** An enchantment on the weapon that changes the attack's ability, such as True Strike. */
function abilityEnchantment(item) {
  return [...(item?.effects ?? [])].find(e => e.type === "enchantment" && !e.disabled && e.active !== false
    && (e.changes ?? []).some(c => ABILITY_CHANGE.test(String(c.key)))) ?? null;
}

/**
 * Records why the attack uses its ability (c.ab), explains an enchantment that swapped it, and adds a
 * warning row when dnd5e added no ability modifier to an attack at all.
 */
function abilityReason(config, rc, x, lessons, kind) {
  const sub = config?.subject;
  const item = x.item;
  const ench = abilityEnchantment(item);
  const set = sub?.attack?.ability;
  let code = null;
  if (ench) code = "effect";
  else if (set && set !== "none") code = set === "spellcasting" ? "spell" : "set";
  else if (item?.type === "spell" || sub?.attack?.type?.classification === "spell") code = "spell";
  else if (item?.type === "weapon") {
    const ranged = ["simpleR", "martialR"].includes(item.system?.type?.value);
    const mode = rc?.options?.attackMode ?? config?.attackMode;
    if (item.system?.properties?.has?.("fin")) code = "finesse";
    else if (ranged) code = "ranged";
    else if (mode === "thrown") code = "thrown";
    else code = "melee";
  }
  if (code) lessons.c.ab = code;
  const modItem = lessons.i.find(i => /^mod\./.test(i[0] ?? "") || i[0] === "mod");
  if (ench && modItem) {
    while (modItem.length < 4) modItem.push(undefined);
    modItem[3] ??= "l";
    modItem[4] = [...(modItem[4] ?? []), explainEffect(ench, x.actor, { kind: "abilitySwap" })];
  }
  if (modItem || kind !== "attack" || sub?.attack?.flat) return;
  const abl = x.actor?.system?.abilities ?? {};
  let want = null;
  if (code === "effect" || code === "spell") want = x.actor?.system?.attributes?.spellcasting || null;
  else if (code === "finesse") want = (abl.dex?.mod ?? 0) > (abl.str?.mod ?? 0) ? "dex" : "str";
  else if (code === "ranged") want = "dex";
  else if (code === "melee" || code === "thrown") want = "str";
  const label = want ? (CONFIG.DND5E?.abilities?.[want]?.label ?? want) : null;
  const mod = want ? abl[want]?.mod : undefined;
  const extra = label ? `expected ${label}${typeof mod === "number" ? ` ${mod >= 0 ? "+" : ""}${mod}` : ""}` : undefined;
  lessons.i.unshift(["mod.missing", 0, extra, "l"]);
}

/**
 * Effects on the creature that would change this roll but are turned off (disabled, expired or suppressed),
 * so the panel can say why a bonus the player expects (such as Rage Damage) is missing.
 */
function inactiveEffects(x, kind, actionType, data) {
  const actor = x.actor;
  if (!actor) return null;
  const fields = rollFields(kind, x, actionType);
  if (!fields.length) return null;
  const bonus = fields.map(p => `system.${p}.bonus`);
  const modes = fields.map(p => `system.${p}.mode`);
  const list = typeof actor.allApplicableEffects === "function" ? [...actor.allApplicableEffects()] : [...(actor.effects ?? [])];
  const out = [];
  for (const e of list) {
    if (e.active !== false && !e.disabled && !e.isSuppressed) continue;
    let b;
    let m;
    for (const ch of e.changes ?? []) {
      const key = normalizeKey(ch.key);
      if (bonus.includes(key) && b === undefined) b = resolve(String(ch.value ?? "").replace(/^\+\s*/, ""), data);
      else if (modes.includes(key) && !m) { const v = Number(ch.value); if (v === 1 || v === -1) m = v; }
    }
    if (b === undefined && !m) continue;
    const off = { n: e.name, why: e.duration?.expired ? "expired" : e.isSuppressed && !e.disabled ? "suppressed" : "off" };
    if (e.uuid) off.u = e.uuid;
    const o = effectOrigin(e, actor).text;
    if (o) off.o = o;
    if (b !== undefined) off.b = b;
    if (m) off.m = m;
    out.push(off);
  }
  return out.length ? out : null;
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
