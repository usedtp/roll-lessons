import { RuleBook } from "./rules.mjs";
import { cfg, MODULE_ID } from "./settings.mjs";
import { isD20Kind } from "./breakdown.mjs";
import { logIssue } from "./log.mjs";

const t = key => game.i18n.localize(`ROLLLESSONS.${key}`);
const signed = n => (n >= 0 ? `+${n}` : `${n}`);

/**
 * Label and explanation for a row whose rule text is missing, instead of a bare "Not identified".
 * The cause is shown in the panel and recorded in the roll log.
 */
function missingRule(key, extra, message, kind) {
  const loaded = RuleBook.status.state === "ok";
  const reason = !loaded ? game.i18n.format("ROLLLESSONS.panel.rulesNotLoaded", { state: RuleBook.status.state, error: RuleBook.status.error ?? "" })
    : key ? game.i18n.format("ROLLLESSONS.panel.noRuleText", { key }) : t("panel.noKey");
  logIssue({ message: message?.id, kind, key, extra, reason, rules: { ...RuleBook.status } });
  return { label: extra ? `${extra}` : t("panel.unknown"), text: reason };
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(value, label, text, unknown) {
  const r = el("div", unknown ? "rl-row rl-unknown" : "rl-row");
  r.append(el("div", "rl-value", value));
  const body = el("div");
  body.append(el("div", "rl-label", label));
  if (text) body.append(el("div", "rl-text", text));
  r.append(body);
  return r;
}

function note(title, lines) {
  const n = el("div", "rl-note");
  n.append(el("div", "rl-note-title", title));
  const ul = el("ul");
  for (const line of lines) ul.append(el("li", "", line));
  n.append(ul);
  return n;
}

/** Placeholder values for rule text, expanded from the compact stored context. */
function expandCtx(c = {}) {
  return {
    ability: c.a ? (CONFIG.DND5E?.abilities?.[c.a]?.label ?? c.a) : undefined,
    score: c.s,
    mod: c.m !== undefined ? signed(c.m) : undefined,
    prof: c.p,
    level: c.l,
    cr: c.cr
  };
}

function flatTotal(roll) {
  const { OperatorTerm, NumericTerm } = foundry.dice.terms;
  let sign = 1;
  let sum = 0;
  for (const term of roll.terms) {
    if (term instanceof OperatorTerm) sign = term.operator === "-" ? -1 : 1;
    else if (term instanceof NumericTerm) { sum += sign * term.number; sign = 1; }
  }
  return sum;
}

function docFrom(uuid) {
  try { return uuid ? fromUuidSync(uuid) : null; } catch (err) { return null; }
}

function abilityLabel(id) {
  return CONFIG.DND5E?.abilities?.[id]?.label ?? id;
}

/** Plain text of an item description, with enricher links reduced to their labels. */
function plainText(html) {
  const s = String(html ?? "")
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@\w+\[([^\]]*)\]/g, "$1")
    .replace(/\[\[[^\]]*\]\](\{([^}]*)\})?/g, "$2")
    .replace(/<[^>]+>/g, " ");
  const div = document.createElement("div");
  div.innerHTML = s;
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Sentences from the item's own text that say what happens on a failed or successful save. */
function saveOutcomeText(item) {
  const text = plainText(item?.system?.description?.value);
  if (!text) return [];
  return text.split(/(?<=[.!?])\s+/)
    .filter(s => /saving throw|failed save|successful save|on a failure|on a success|succeed|fail|half as much/i.test(s))
    .slice(0, 3);
}

/** Save against a spell or ability: how the DC was built, the result, and what it means. */
function saveNotes(message, roll, body) {
  const dc = roll.options?.target;
  if (typeof dc !== "number") return false;
  const activity = docFrom(message?.system?.activity?.uuid);
  const lines = [];
  if (activity) {
    const caster = activity.actor;
    const item = activity.item;
    const calc = activity.save?.dc?.calculation;
    const abilityId = calc === "spellcasting" ? (item?.system?.ability || caster?.system?.attributes?.spellcasting) : (calc && caster?.system?.abilities?.[calc] ? calc : null);
    const m = abilityId ? caster?.system?.abilities?.[abilityId]?.mod : null;
    const p = caster?.system?.attributes?.prof;
    if (typeof m === "number" && typeof p === "number" && 8 + m + p === dc) {
      lines.push(game.i18n.format("ROLLLESSONS.panel.dcBuilt", { dc, caster: caster.name, ability: abilityLabel(abilityId), mod: signed(m), prof: signed(p) }));
    } else if (item) {
      lines.push(game.i18n.format("ROLLLESSONS.panel.dcSet", { dc, item: item.name }));
    }
    const ok = roll.isSuccess ?? roll.total >= dc;
    lines.push(game.i18n.format(ok ? "ROLLLESSONS.panel.saveSucceeded" : "ROLLLESSONS.panel.saveFailed", { total: roll.total, dc }));
    for (const s of saveOutcomeText(item)) lines.push(s);
    body.append(note(`${t("panel.saveAgainst")} ${item?.name ?? ""}`.trim(), lines));
    return true;
  }
  const ok = roll.isSuccess ?? roll.total >= dc;
  body.append(note(t("panel.target"), [game.i18n.format(ok ? "ROLLLESSONS.panel.saveSucceeded" : "ROLLLESSONS.panel.saveFailed", { total: roll.total, dc })]));
  return true;
}

function targetActor(t) {
  return docFrom(t?.actor) ?? docFrom(t?.token)?.actor ?? null;
}

/** Attack against each target's Armor Class. */
function attackNotes(message, roll, body) {
  const targets = message?.system?.targets ?? [];
  if (!targets.length) return false;
  const die = roll.dice?.[0];
  const natural = die?.total;
  const lines = targets.map(tg => {
    let ac = tg.ac;
    if (typeof ac !== "number" || ac >= 99) ac = targetActor(tg)?.system?.attributes?.ac?.value;
    if (natural === 20 || roll.isCritical) return game.i18n.format("ROLLLESSONS.panel.attackCrit", { name: tg.name });
    if (natural === 1 || roll.isFumble) return game.i18n.format("ROLLLESSONS.panel.attackFumble", { name: tg.name });
    if (typeof ac !== "number") return `${tg.name}: ${roll.total}`;
    return game.i18n.format(roll.total >= ac ? "ROLLLESSONS.panel.attackHit" : "ROLLLESSONS.panel.attackMiss", { name: tg.name, total: roll.total, ac });
  });
  body.append(note(t("panel.outcome"), lines));
  return true;
}

/** Resistance, Immunity and Vulnerability of each target to this damage. */
function defenseNotes(message, roll, body) {
  const type = roll.options?.type;
  if (!type || ["healing", "temphp"].includes(type)) return;
  const targets = message?.system?.targets ?? [];
  if (!targets.length) return;
  const props = new Set(roll.options?.properties ?? []);
  const typeLabel = CONFIG.DND5E?.damageTypes?.[type]?.label ?? type;
  const total = roll.total ?? 0;
  const lines = [];
  for (const tg of targets) {
    const actor = targetActor(tg);
    const traits = actor?.system?.traits;
    if (!traits) continue;
    const has = k => {
      const tr = traits[k];
      const values = new Set(tr?.value ?? []);
      if (!values.has(type)) return false;
      const bypass = [...(tr?.bypasses ?? [])].some(b => props.has(b));
      return !bypass;
    };
    const source = k => {
      const names = [];
      for (const e of actor.appliedEffects ?? []) {
        if ((e.changes ?? []).some(c => c.key === `system.traits.${k}.value` && String(c.value).split(/[,\s]+/).includes(type))) names.push(e.name);
      }
      return names.length ? names.join(", ") : actor.name;
    };
    let amount = total;
    const parts = [];
    if (has("di")) { amount = 0; parts.push(game.i18n.format("ROLLLESSONS.panel.immune", { type: typeLabel, source: source("di") })); }
    else {
      if (has("dr")) { amount = Math.floor(amount / 2); parts.push(game.i18n.format("ROLLLESSONS.panel.resist", { type: typeLabel, source: source("dr") })); }
      if (has("dv")) { amount = amount * 2; parts.push(game.i18n.format("ROLLLESSONS.panel.vulnerable", { type: typeLabel, source: source("dv") })); }
    }
    if (!parts.length) continue;
    lines.push(`${tg.name}: ${parts.join(" ")} ${game.i18n.format("ROLLLESSONS.panel.takes", { amount })}`);
  }
  if (!lines.length) return;
  const d = RuleBook.describe("defenses", {});
  if (cfg.detail === "beginner" && d?.text) lines.push(d.text);
  body.append(note(t("panel.defenses"), lines));
}

/** Builds the panel body. Called only when the panel is opened. */
function buildBody(roll, L, message) {
  const beginner = cfg.detail === "beginner";
  const isD20 = isD20Kind(L.k);
  const opts = roll.options ?? {};
  const ctx = expandCtx(L.c);
  const body = el("div", "rl-body");
  const dice = [...(roll.dice ?? [])];
  const mode = opts.advantageMode ?? 0;

  if (isD20 && dice.length) {
    const die = dice.shift();
    const res = die.results ?? [];
    const kept = res.filter(r => r.active && !r.discarded).map(r => r.result);
    const dropped = res.filter(r => r.discarded || !r.active).map(r => r.result);
    const base = RuleBook.describe(mode === 1 ? "advantage" : mode === -1 ? "disadvantage" : "d20", ctx);
    let detail = `${t("panel.kept")}: ${kept.join(", ")}`;
    if (dropped.length) detail += `. ${t("panel.dropped")}: ${dropped.join(", ")}`;
    if (beginner && base?.text) detail += `. ${base.text}`;
    body.append(row(String(die.total ?? kept[0] ?? "?"), `${t("panel.die")} (d${die.faces})`, detail));
    if (mode !== 0) {
      const names = (mode === 1 ? L.r?.a : L.r?.d) ?? [];
      const lines = names.length ? [...names] : [t("panel.noReason")];
      if (L.r?.o) lines.push(...L.r.o);
      body.append(note(`${mode === 1 ? t("panel.advantage") : t("panel.disadvantage")}: ${t("panel.reasons")}`, lines));
    }
  }

  let sum = 0;
  for (const [key, value, extra] of L.i) {
    const d = key ? RuleBook.describe(key, { ...ctx, status: extra, source: extra }) : null;
    if (d && extra && RuleBook.data[key]?.showSource) d.title = `${d.title}: ${extra}`;
    let text = beginner ? d?.text : "";
    if (key && RuleBook.data[key]?.showPart && extra) text = [text, `${t("panel.fromPart")}: ${extra}`].filter(Boolean).join(" ");
    if (typeof value === "number") {
      sum += value;
      if (d) body.append(row(signed(value), d.title, text, false));
      else {
        const m = missingRule(key, extra, message, L.k);
        body.append(row(signed(value), m.label, m.text, true));
      }
    } else {
      // Dice item: match it to the dice that were rolled for it.
      const formula = String(value).replace(/^-/, "");
      const neg = String(value).startsWith("-");
      const count = (formula.match(/\d*d\d+/gi) ?? []).length;
      const used = dice.splice(0, count);
      const rolled = used.length ? used.reduce((a, x) => a + (x.total ?? 0), 0) : null;
      // Flat numbers inside the same formula, e.g. the +1 in a situational "1d4 + 1".
      let flat = 0;
      try {
        const f = formula.replace(/\d*d\d+[a-z0-9<>=]*/gi, "0");
        if (/^[\d\s+\-*/().]+$/.test(f)) flat = Roll.safeEval(f) || 0;
      } catch (err) { flat = 0; }
      sum += (neg ? -1 : 1) * flat;
      // Dice results are shown without a plus sign so they never read as a modifier.
      const shown = rolled === null ? String(value) : `${neg ? "-" : ""}${rolled + flat}`;
      const faces = used.map(x => (x.results ?? []).filter(r => r.active !== false).map(r => r.result).join(", ")).join("; ");
      const actual = used.map(x => `${x.number}d${x.faces}`).join(" + ");
      const asWritten = (formula.match(/\d*d\d+/gi) ?? []).map(s => (/^d/i.test(s) ? `1${s}` : s)).join(" + ");
      // Level-scaled dice (cantrips) show the dice actually rolled, not the formula behind them.
      const actualOnly = key && RuleBook.data[key]?.showActualDice && actual;
      const crit = roll.isCritical || opts.isCritical;
      const doubled = actualOnly ? "" : (actual && actual !== asWritten ? ` (${t("panel.critDoubled")} ${actual})` : "");
      const written = actualOnly ? `${actual}${crit ? ` (${t("panel.critIncluded")})` : ""}` : formula;
      const flatNote = flat ? `, ${signed(flat)}` : "";
      let title = d?.title;
      if (!d) {
        const m = missingRule(key, extra, message, L.k);
        title = t("panel.unknown");
        text = m.text;
      }
      const label = rolled === null
        ? `${title} (${written})`
        : `${title}: ${written}${doubled} ${t("panel.rolled")} ${faces}${flatNote}`;
      body.append(row(shown, label, text, !d));
    }
  }
  const critDamage = L.k === "damage" && (roll.isCritical || opts.isCritical);
  if (!critDamage) {
    const diff = flatTotal(roll) - sum;
    if (diff !== 0) {
      const d = RuleBook.describe("addedAfterBuild", ctx);
      body.append(row(signed(diff), d?.title ?? t("panel.unknownSource"), beginner ? d?.text : "", false));
    }
  }

  const traits = [];
  const add = (key, extra) => {
    const d = RuleBook.describe(key, extra ? { ...ctx, ...extra } : ctx);
    if (d) traits.push(d.text ? `${d.title}: ${d.text}` : d.title);
  };
  if (isD20) {
    if (opts.halflingLucky) add("halflingLucky");
    if (opts.elvenAccuracy && mode === 1) add("elvenAccuracy");
    if (opts.reliableTalent) add("reliableTalent");
    if (L.k === "attack" && typeof opts.criticalSuccess === "number" && opts.criticalSuccess < 20) {
      add("criticalRange", { threshold: opts.criticalSuccess });
    }
  }
  if (Number.isFinite(opts.minimum)) add("minimum", { minimum: opts.minimum });
  if (Number.isFinite(opts.maximum)) add("maximum", { maximum: opts.maximum });
  if (traits.length) body.append(note(t("panel.traits"), traits));

  if ((L.k === "damage" || L.k === "attack") && (roll.isCritical || opts.isCritical)) {
    const d = RuleBook.describe(opts.critical?.powerfulCritical ? "critical.powerful" : "critical", ctx);
    if (d) body.append(note(t("panel.criticalHit"), [d.text]));
  }

  if (L.c?.rg !== undefined) {
    const d = RuleBook.describe("rageMissing", { ...ctx, rage: L.c.rg });
    if (d) body.append(note(d.title, [d.text]));
  }

  // Item-specific note, e.g. "item.magic-missile" in rules.json or the custom rule JSON.
  if (L.c?.id) {
    const d = RuleBook.describe(`item.${L.c.id}`, ctx);
    if (d) body.append(note(d.title, [d.text]));
  }

  if (L.k === "attack" && roll.isFumble) {
    const d = RuleBook.describe("naturalOne", ctx);
    if (d) body.append(note(d.title, [d.text]));
  }

  let outcomeShown = false;
  if (["save", "concentration", "death", "check", "skill", "tool"].includes(L.k)) outcomeShown = saveNotes(message, roll, body);
  if (L.k === "attack") outcomeShown = attackNotes(message, roll, body);
  if (L.k === "damage") defenseNotes(message, roll, body);
  if (!outcomeShown && typeof opts.target === "number" && L.k !== "attack") {
    const d = RuleBook.describe("target", { ...ctx, target: opts.target });
    body.append(note(t("panel.target"), [d?.text || String(opts.target)]));
  }

  const total = el("div", "rl-total");
  total.append(el("div", "rl-value", String(roll.total ?? "")));
  total.append(el("div", "rl-label", t("panel.total")));
  body.append(total);
  return body;
}

/** Body shown when the rule text could not be loaded in this browser. Reopening the panel retries. */
function rulesFailedBody() {
  const body = el("div", "rl-body rl-failed");
  const s = RuleBook.status;
  body.append(row("!", t("panel.rulesFailedTitle"), game.i18n.format("ROLLLESSONS.panel.rulesFailedText", { error: s.error ?? s.state, url: s.url ?? "" }), true));
  return body;
}

/**
 * Lightweight shell: a closed <details> with a summary. The body is built on first open, and only once
 * the rule text is loaded (RuleBook.ready). A panel opened before that waits; if loading failed it shows
 * why and retries on the next open or when the rules finish loading.
 */
function shell(roll, L, index, message) {
  const panel = el("details", "roll-lessons");
  panel.dataset.roll = String(index);
  panel.append(el("summary", "", t("panel.summary")));
  const fill = async () => {
    if (panel.dataset.built || panel.dataset.building) return;
    panel.dataset.building = "1";
    if (RuleBook.status.state === "failed") RuleBook.load();
    await RuleBook.ready;
    delete panel.dataset.building;
    panel.querySelector(":scope > .rl-body")?.remove();
    if (RuleBook.status.state !== "ok") {
      panel.dataset.failed = "1";
      panel.append(rulesFailedBody());
      panel.addEventListener("toggle", () => { if (panel.open) fill(); }, { once: true });
      return;
    }
    delete panel.dataset.failed;
    panel.dataset.built = "1";
    try { panel.append(buildBody(roll, L, message)); } catch (err) { console.error(`${MODULE_ID} | render failed`, err); }
  };
  panel._rlFill = fill;
  if (cfg.expanded) { panel.open = true; fill(); }
  else panel.addEventListener("toggle", fill, { once: true });
  return panel;
}

/** Rule text finished loading: rebuild any panel that showed the failure notice. */
export function onRulesLoaded(status) {
  if (status?.state !== "ok") return;
  for (const panel of document.querySelectorAll(".roll-lessons[data-failed]")) panel._rlFill?.();
}

/**
 * A damage roll that can only ever total 0: every die has a count of 0 and there is no flat number.
 * Example: True Strike's extra Radiant dice, (floor((level + 1) / 6))d6, below character level 5.
 */
export function isEmptyRoll(roll) {
  const isDamage = roll?.constructor?.name === "DamageRoll" || roll?.options?.rollLessons?.k === "damage";
  if (!isDamage) return false;
  const dice = roll.dice ?? [];
  if (!dice.length || !dice.every(d => (d.number ?? 0) === 0)) return false;
  const flat = (roll.terms ?? []).some(t => t.faces === undefined && typeof t.number === "number" && t.number !== 0);
  return !flat && (roll.total ?? 0) === 0;
}

/** Hide the empty lines dnd5e draws for zero-dice damage rolls (no dice, value 0). */
function hideEmptyParts(html) {
  for (const part of html.querySelectorAll(".roll-breakdown .tooltip-part, .dice-tooltip .tooltip-part")) {
    const noDice = !part.querySelector(".dice-rolls li");
    const value = part.querySelector(".total .value")?.textContent?.trim();
    if (noDice && value === "0") part.classList.add("rl-hidden-zero");
  }
}

function visible(message) {
  return message?.isContentVisible !== false;
}

/** Saves and other results that dnd5e folds into the spell or ability card as summary lines. */
function injectSummaries(html) {
  for (const line of html.querySelectorAll(".card-summary[data-message-id]")) {
    if (line.nextElementSibling?.classList?.contains("roll-lessons")) continue;
    const linked = game.messages?.get(line.dataset.messageId);
    if (!linked || !visible(linked)) continue;
    linked.rolls?.forEach((roll, i) => {
      const L = roll.options?.rollLessons;
      if (L?.v !== 2) return;
      const panel = shell(roll, L, i, linked);
      panel.classList.add("rl-summary");
      line.after(panel);
    });
  }
}

export function injectPanels(message, html) {
  if (!cfg.enabled) return;
  if (cfg.visibility === "gm" && !game.user.isGM) return;
  if (!visible(message)) return;
  try { injectSummaries(html); } catch (err) { console.error(`${MODULE_ID} | summary panels failed`, err); }
  if (!message.isRoll) return;
  const rolls = message.rolls;
  if (!rolls?.some(r => r.options?.rollLessons?.v === 2)) return;
  if (html.querySelector(".roll-lessons:not(.rl-summary)")) return;

  const anchors = html.querySelectorAll(".dice-roll");
  const empty = cfg.hideZeroDamage ? rolls.map(isEmptyRoll) : rolls.map(() => false);
  if (empty.some(Boolean)) hideEmptyParts(html);
  rolls.forEach((roll, i) => {
    const L = roll.options?.rollLessons;
    if (L?.v !== 2 || empty[i]) return;
    const panel = shell(roll, L, i, message);
    const anchor = anchors[i];
    if (anchor) { anchor.after(panel); anchor.parentElement?.classList.add("rl-host"); }
    else (html.querySelector(".message-content") ?? html).append(panel);
  });
}
