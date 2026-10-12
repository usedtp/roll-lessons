import { MODULE_ID } from "./settings.mjs";

/**
 * Rule text from data/rules.json, merged with the world's custom JSON. Loaded once per client.
 * 1.4.0: loading starts at "setup", the request carries the module version so a browser never
 * reuses a copy cached from an older version, a failed request is retried once, and panels
 * wait for `RuleBook.ready` before building. `status` says what happened.
 */
export class RuleBook {
  static data = {};
  static status = { state: "pending", error: null, count: 0, url: null };
  static #ready = null;

  /** Resolves true when rules are loaded, false when loading failed. Starts a load if none ran yet. */
  static get ready() {
    return this.#ready ?? this.load();
  }

  static load() {
    this.#ready = this.#load();
    return this.#ready;
  }

  static async #fetchRules(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  static async #load() {
    const version = game.modules?.get(MODULE_ID)?.version ?? "0";
    const url = `${foundry.utils.getRoute(`modules/${MODULE_ID}/data/rules.json`)}?v=${encodeURIComponent(version)}`;
    this.status = { state: "loading", error: null, count: Object.keys(this.data).length, url };
    let base = null;
    let error = null;
    for (let attempt = 0; attempt < 2 && !base; attempt++) {
      try { base = await this.#fetchRules(url); } catch (err) {
        error = err;
        if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
      }
    }
    if (!base) {
      console.error(`${MODULE_ID} | could not load rules.json from ${url}`, error);
      this.status = { state: "failed", error: String(error?.message ?? error), count: 0, url };
      Hooks.callAll(`${MODULE_ID}.rulesLoaded`, this.status);
      return false;
    }
    let custom = {};
    let raw = "";
    try { raw = game.settings.get(MODULE_ID, "customRules"); } catch (err) { raw = ""; }
    if (raw?.trim()) {
      try { custom = JSON.parse(raw); } catch (err) {
        ui.notifications?.warn(game.i18n.localize("ROLLLESSONS.warn.customRules"));
      }
    }
    for (const [k, v] of Object.entries(custom)) base[k] = { ...base[k], ...v };
    this.data = base;
    this.status = { state: "ok", error: null, count: Object.keys(base).length, url };
    Hooks.callAll(`${MODULE_ID}.rulesLoaded`, this.status);
    return true;
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
