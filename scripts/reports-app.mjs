import { MODULE_ID } from "./settings.mjs";
import { readAllLogs, readReportStatus } from "./log.mjs";

/** GM window listing Error and Unclear reports from the roll log. Opened from the module settings. */
const { ApplicationV2 } = foundry.applications.api;

const loc = key => game.i18n.localize(`ROLLLESSONS.reports.${key}`);

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Scroll the chat log to a message and flash it. */
function showMessage(id) {
  try { ui.sidebar?.changeTab?.("chat", "primary"); } catch (err) { /* older layout */ }
  try { ui.chat?.activate?.(); } catch (err) { /* ignore */ }
  const node = document.querySelector(`#chat .chat-log [data-message-id="${id}"], .chat-log [data-message-id="${id}"]`);
  if (!node) return false;
  node.scrollIntoView({ block: "center", behavior: "smooth" });
  node.classList.add("rl-flash");
  setTimeout(() => node.classList.remove("rl-flash"), 2500);
  return true;
}

export function statusText(st) {
  if (!st) return loc("statusNew");
  const label = { fixed: loc("statusFixed"), reworded: loc("statusReworded"), wontfix: loc("statusWontfix") }[st.s] ?? st.s;
  return st.v && st.s !== "wontfix" ? `${label} in ${st.v}` : label;
}

export class ReportsApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "roll-lessons-reports",
    tag: "div",
    classes: ["roll-lessons-reports"],
    window: { title: "ROLLLESSONS.reports.title", resizable: true, icon: "fa-solid fa-flag" },
    position: { width: 760, height: 620 }
  };

  filter = "all";
  showFixed = false;
  reports = null;
  status = {};
  error = null;

  async load() {
    this.error = null;
    try {
      const entries = await readAllLogs({ onlyReports: true });
      const byId = new Map();
      for (const r of entries) byId.set(r.id ?? `${r.t}|${r.user}|${r.message}`, r);
      this.reports = [...byId.values()].sort((a, b) => String(b.t).localeCompare(String(a.t)));
      this.status = await readReportStatus();
    } catch (err) {
      this.error = String(err?.message ?? err);
      this.reports = [];
    }
  }

  async _prepareContext() {
    if (!this.reports) await this.load();
    return {};
  }

  async _renderHTML() {
    const root = el("div", "rl-reports");
    const bar = el("div", "rl-reports-bar");
    for (const f of ["all", "error", "unclear"]) {
      const b = el("button", this.filter === f ? "active" : "", loc(`filter_${f}`));
      b.type = "button";
      b.addEventListener("click", () => { this.filter = f; this.render(); });
      bar.append(b);
    }
    const fixed = el("label", "rl-reports-fixed");
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = this.showFixed;
    cb.addEventListener("change", () => { this.showFixed = cb.checked; this.render(); });
    fixed.append(cb, document.createTextNode(` ${loc("showFixed")}`));
    const refresh = el("button", "", loc("refresh"));
    refresh.type = "button";
    refresh.addEventListener("click", async () => { this.reports = null; await this.render(); });
    bar.append(fixed, refresh);
    root.append(bar);

    if (this.error) root.append(el("p", "rl-reports-error", this.error));
    const list = (this.reports ?? []).filter(r => (this.filter === "all" || r.category === this.filter)
      && (this.showFixed || !this.status[r.id]));
    if (!list.length) root.append(el("p", "rl-reports-empty", loc("empty")));
    for (const r of list) {
      const card = el("div", `rl-report-card rl-cat-${r.category}`);
      const head = el("div", "rl-report-head");
      head.append(el("strong", "", r.category === "unclear" ? loc("unclear") : loc("error")));
      head.append(el("span", "", ` ${new Date(r.t).toLocaleString()} · ${r.user ?? "?"}${r.speaker ? ` (${r.speaker})` : ""} · ${r.kind ?? ""} ${r.formula ?? ""} = ${r.total ?? ""}`));
      head.append(el("span", "rl-report-status", statusText(this.status[r.id])));
      card.append(head);
      if (r.rows?.length) {
        const ul = el("ul");
        for (const line of r.rows) ul.append(el("li", "", line));
        card.append(el("div", "rl-report-sub", loc("rowsMarked")), ul);
      }
      if (r.comment) card.append(el("blockquote", "", r.comment));
      if (r.panel) {
        const d = el("details");
        d.append(el("summary", "", loc("panel")));
        d.append(el("pre", "", r.panel));
        card.append(d);
      }
      const go = el("button", "", loc("show"));
      go.type = "button";
      const exists = !!game.messages?.get(r.message);
      go.disabled = !exists;
      if (!exists) go.title = loc("gone");
      go.addEventListener("click", () => { if (!showMessage(r.message)) ui.notifications.warn(loc("notInLog")); });
      card.append(go);
      root.append(card);
    }
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }
}

export function registerReportsMenu() {
  game.settings.registerMenu(MODULE_ID, "reportsMenu", {
    name: "ROLLLESSONS.reports.menuName",
    label: "ROLLLESSONS.reports.menuLabel",
    hint: "ROLLLESSONS.reports.menuHint",
    icon: "fa-solid fa-flag",
    type: ReportsApp,
    restricted: true
  });
}
