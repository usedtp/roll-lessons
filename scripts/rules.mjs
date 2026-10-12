import { MODULE_ID } from "./settings.mjs";

/** Rule text from data/rules.json, merged with the world's custom JSON. Loaded once per client. */
export class RuleBook {
  static data = {};

  static async load() {
    let base = {};
    try {
      const res = await fetch(foundry.utils.getRoute(`modules/${MODULE_ID}/data/rules.json`));
      base = await res.json();
    } catch (err) {
      console.error(`${MODULE_ID} | could not load rules.json`, err);
    }
    let custom = {};
    const raw = game.settings.get(MODULE_ID, "customRules");
    if (raw?.trim()) {
      try { custom = JSON.parse(raw); } catch (err) {
        ui.notifications?.warn(game.i18n.localize("ROLLLESSONS.warn.customRules"));
      }
    }
    for (const [k, v] of Object.entries(custom)) base[k] = { ...base[k], ...v };
    this.data = base;
  }

  /** First key in the list that has an entry, or null. */
  static pick(keys) {
    for (const k of keys) if (k in this.data) return k;
    return null;
  }

  /**
   * Replace {name} placeholders. A sentence with an unresolved placeholder is dropped.
   */
  static fill(template, ctx) {
    if (!template) return "";
    if (!template.includes("{")) return template;
    const out = [];
    for (const s of template.split(/(?<=[.!?])\s+/)) {
      let missing = false;
      const filled = s.replace(/\{(\w+)\}/g, (_, n) => {
        const v = ctx[n];
        if (v === undefined || v === null || v === "") { missing = true; return ""; }
        return v;
      });
      if (!missing) out.push(filled);
    }
    return out.join(" ");
  }

  /** {title, text} for one key, or null. */
  static describe(key, ctx = {}) {
    const e = key && this.data[key];
    if (!e) return null;
    const title = this.fill(e.title, ctx) || e.titleFallback || String(e.title ?? key).replace(/\s*\{\w+\}\s*/g, " ").trim();
    return { title, text: this.fill(e.text, ctx) };
  }
}
