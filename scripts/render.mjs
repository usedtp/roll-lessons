import { RuleBook } from "./rules.mjs";
import { cfg, MODULE_ID } from "./settings.mjs";
import { isD20Kind } from "./breakdown.mjs";

const t = key => game.i18n.localize(`ROLLLESSONS.${key}`);
const signed = n => (n >= 0 ? `+${n}` : `${n}`);

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

/** Builds the panel body. Called only when the panel is opened. */
function buildBody(roll, L) {
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
      body.append(row(signed(value), d?.title ?? extra ?? t("panel.unknown"), text, !d));
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
      const doubled = actual && actual !== asWritten ? ` (${t("panel.critDoubled")} ${actual})` : "";
      const flatNote = flat ? `, ${signed(flat)}` : "";
      const label = rolled === null
        ? `${d?.title ?? t("panel.unknown")} (${formula})`
        : `${d?.title ?? t("panel.unknown")}: ${formula}${doubled} ${t("panel.rolled")} ${faces}${flatNote}`;
      body.append(row(shown, label, text, !d));
    }
  }
  const critDamage = L.k === "damage" && (roll.isCritical || opts.isCritical);
  if (!critDamage) {
    const diff = flatTotal(roll) - sum;
    if (diff !== 0) body.append(row(signed(diff), t("panel.unknownSource"), "", true));
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

  if (typeof opts.target === "number") {
    const d = RuleBook.describe("target", { ...ctx, target: opts.target });
    body.append(note(t("panel.target"), [d?.text || String(opts.target)]));
  }

  const total = el("div", "rl-total");
  total.append(el("div", "rl-value", String(roll.total ?? "")));
  total.append(el("div", "rl-label", t("panel.total")));
  body.append(total);
  return body;
}

/** Lightweight shell: a closed <details> with a summary. The body is built on first open. */
function shell(roll, L, index) {
  const panel = el("details", "roll-lessons");
  panel.dataset.roll = String(index);
  panel.append(el("summary", "", t("panel.summary")));
  const fill = () => {
    if (panel.dataset.built) return;
    panel.dataset.built = "1";
    try { panel.append(buildBody(roll, L)); } catch (err) { console.error(`${MODULE_ID} | render failed`, err); }
  };
  if (cfg.expanded) { fill(); panel.open = true; }
  else panel.addEventListener("toggle", fill, { once: true });
  return panel;
}

export function injectPanels(message, html) {
  if (!cfg.enabled || !message.isRoll) return;
  if (cfg.visibility === "gm" && !game.user.isGM) return;
  if (!message.isContentVisible) return;
  const rolls = message.rolls;
  if (!rolls?.some(r => r.options?.rollLessons?.v === 2)) return;
  if (html.querySelector(".roll-lessons")) return;

  const anchors = html.querySelectorAll(".dice-roll");
  rolls.forEach((roll, i) => {
    const L = roll.options?.rollLessons;
    if (L?.v !== 2) return;
    const panel = shell(roll, L, i);
    const anchor = anchors[i];
    if (anchor) { anchor.after(panel); anchor.parentElement?.classList.add("rl-host"); }
    else (html.querySelector(".message-content") ?? html).append(panel);
  });
}
