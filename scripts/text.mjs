/*
 * Formula and text helpers shared by the breakdown, the effect explanations and the tests.
 * No DOM use, so they run in Node.
 */

const NUMERIC = /^[\d\s+\-*/().]+$/;
export const HAS_DICE = /\d*d\d/i;

/**
 * Number for flat parts, formula string for dice parts.
 * Replaces @references until none are left, so a value that is itself a formula
 * (e.g. @ruleBonus = "(max(1,@abilities.wis.mod))") resolves fully.
 */
export function resolve(part, data) {
  const text = String(part ?? "").trim();
  if (/^[+-]?\d+$/.test(text)) return Number(text);
  let f = text;
  try {
    for (let i = 0; i < 6 && f.includes("@"); i++) {
      const next = Roll.replaceFormulaData(f, data ?? {}, { missing: "0" });
      if (next === f) break;
      f = next;
    }
  } catch (err) { return text; }
  if (HAS_DICE.test(f)) return f.replace(/\s+/g, " ").trim();
  try {
    if (NUMERIC.test(f)) return Roll.safeEval(f);
    return new Roll(f).evaluateSync({ strict: false }).total;
  } catch (err) {
    return f;
  }
}

const ABILITY_NAMES = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
const abilityName = id => globalThis.CONFIG?.DND5E?.abilities?.[id]?.label ?? ABILITY_NAMES[id] ?? id;

/**
 * Plain-language reading of a bonus formula that uses @references, or null when there is nothing to explain.
 * "(max(1,@abilities.wis.mod))" -> "Wisdom modifier, minimum +1".
 */
export function describeFormula(raw) {
  let s = String(raw ?? "").trim();
  if (!s.includes("@")) return null;
  s = s.replace(/@abilities\.(\w+)\.mod/g, (_, a) => `${abilityName(a)} modifier`)
    .replace(/@(?:attributes\.)?prof\b/g, "Proficiency Bonus")
    .replace(/@details\.level/g, "character level")
    .replace(/@classes\.([\w-]+)\.levels/g, (_, c) => `${c} level`)
    .replace(/@scale\.([\w-]+)\.([\w-]+)/g, (_, c, id) => `${c} ${id.replace(/-/g, " ")}`)
    .replace(/@mod\b/g, "ability modifier");
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(/\(\s*([^()]*)\s*\)/g, (m, inner) => (/^[^,]+$/.test(inner) && !/[+\-*/]/.test(inner) ? inner : m));
    s = s.replace(/max\(\s*(-?\d+)\s*,\s*([^()]+?)\s*\)/g, (_, n, e) => `${e}, minimum ${Number(n) >= 0 ? "+" : ""}${n}`)
      .replace(/max\(\s*([^(),]+?)\s*,\s*(-?\d+)\s*\)/g, (_, e, n) => `${e}, minimum ${Number(n) >= 0 ? "+" : ""}${n}`)
      .replace(/min\(\s*(-?\d+)\s*,\s*([^()]+?)\s*\)/g, (_, n, e) => `${e}, maximum ${Number(n) >= 0 ? "+" : ""}${n}`)
      .replace(/floor\(\s*([^()]+?)\s*\/\s*2\s*\)/g, (_, e) => `half of ${e}, rounded down`)
      .replace(/ceil\(\s*([^()]+?)\s*\/\s*2\s*\)/g, (_, e) => `half of ${e}, rounded up`);
    if (s === before) break;
  }
  return s.replace(/^\((.*)\)$/, "$1").replace(/\s+/g, " ").trim();
}

const ENTITIES = { amp: "&", nbsp: " ", quot: "\"", lt: "<", gt: ">", rsquo: "'", lsquo: "'", ldquo: "\"", rdquo: "\"", ndash: "-", mdash: "-", hellip: "...", "#39": "'" };

/** Plain text of an HTML description, with enricher links reduced to their labels. */
export function plainText(html) {
  return String(html ?? "")
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@\w+\[([^\]]*)\]/g, (_, inner) => inner.split(/[.#]/).pop())
    .replace(/\[\[[^\]]*\]\](\{([^}]*)\})?/g, "$2")
    .replace(/<\/(p|div|li|h\d)>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) : m))
    .replace(/[‘’]/g, "'")
    .replace(/\.\s*\./g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

export function sentences(text) {
  return String(text ?? "").split(/(?<=[.!?])\s+(?=["'(]?[A-Z0-9])/).map(s => s.trim()).filter(s => s.length > 2);
}

const KIND_WORDS = {
  save: /saving throws?|\bsaves?\b/i,
  concentration: /saving throws?|\bsaves?\b|concentration/i,
  death: /death sav/i,
  attack: /attack rolls?/i,
  damage: /damage/i,
  check: /ability checks?|\bchecks?\b/i,
  skill: /ability checks?|\bchecks?\b/i,
  tool: /ability checks?|\bchecks?\b|tool/i,
  initiative: /initiative/i
};

/** Words that say a roll is changed. */
const CHANGE_WORDS = /\b(bonus|penalty|subtract|add|adds|reduce[ds]?|increase[ds]?|minus|plus|advantage|disadvantage)\b/i;

/** A sentence that limits the effect to one roll: "the next saving throw it makes". */
export const NEXT_ROLL = /\bnext\s+(?:\w+\s+){0,2}?(saving throw|save|attack roll|attack|ability check|check|d20 test)\b/i;

/**
 * The sentence in `text` that explains how this effect changes this kind of roll.
 * @param {string} text            plain text (effect or item description)
 * @param {object} opts
 * @param {string} opts.kind       roll kind
 * @param {string} [opts.amount]   the effect's amount as written ("1d4", "2")
 * @param {string} [opts.extraWord] another word that marks a relevant sentence (a skill name)
 * @returns {string|null}
 */
export function pickSentence(text, { kind, amount, extraWord } = {}) {
  const list = sentences(text);
  if (!list.length) return null;
  const kw = KIND_WORDS[kind] ?? /roll/i;
  const amt = amount ? String(amount).replace(/^[+-]\s*/, "").trim() : "";
  const amtRe = amt && amt.length < 12 ? new RegExp(`(^|[^\\w])${amt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "i") : null;
  const extraRe = extraWord ? new RegExp(`\\b${extraWord}\\b`, "i") : null;
  let best = -1;
  let score = 0;
  list.forEach((s, i) => {
    let n = 0;
    if (kw.test(s) || extraRe?.test(s)) n += 2;
    if (amtRe?.test(s)) n += 2;
    if (CHANGE_WORDS.test(s)) n += 1;
    if (n > score && (kw.test(s) || extraRe?.test(s) || amtRe?.test(s))) { score = n; best = i; }
  });
  if (best < 0 || score < 3) return null;
  let out = trimClause(list[best], amtRe).replace(/^(In addition|Additionally|Also|Moreover),\s*/i, "");
  out = out.charAt(0).toUpperCase() + out.slice(1);
  const next = list[best + 1];
  if (next && /^(The|This|That) (bonus|penalty)\b/i.test(next)) out = `${out} ${next}`;
  return out;
}

/** A long sentence is cut back to the clause that holds the amount: "...or take 1d6 damage and subtract 1d4 from..." */
function trimClause(sentence, amtRe) {
  if (sentence.length <= 140 || !amtRe) return sentence;
  const cuts = [0];
  const re = /,\s+|\s+and\s+(?=[a-z]+\s)|;\s*/g;
  let m;
  while ((m = re.exec(sentence))) cuts.push(m.index + m[0].length);
  for (let i = cuts.length - 1; i >= 0; i--) {
    const piece = sentence.slice(cuts[i]);
    if (amtRe.test(piece)) {
      if (piece.length < 25 || i === 0) return sentence;
      return piece.charAt(0).toUpperCase() + piece.slice(1);
    }
  }
  return sentence;
}

/** Speak about the caster by name in text written from the caster's view: "your next turn" -> "Kara's next turn". */
export function nameTheCaster(sentence, owner) {
  if (!sentence || !owner) return sentence;
  return sentence.replace(/\b[Yy]our\b/g, `${owner}'s`).replace(/\byou\b/g, owner).replace(/\bYou\b/g, owner);
}

/**
 * Condition text cut down to the clauses that apply to this kind of roll made by the creature itself.
 * "Attack rolls against you have Advantage, and your attack rolls have Disadvantage." -> "Your attack rolls have Disadvantage."
 */
export function conditionClauses(text, kind) {
  const kw = KIND_WORDS[kind] ?? /roll/i;
  const out = [];
  for (const s of sentences(text)) {
    for (const piece of s.split(/,\s*and\s+|;\s*/)) {
      const c = piece.trim().replace(/[.]$/, "");
      if (!(kw.test(c) || /d20 test/i.test(c)) || /against you|the charmer has/i.test(c)) continue;
      out.push(`${c.charAt(0).toUpperCase()}${c.slice(1)}.`);
    }
  }
  return out.join(" ") || null;
}
