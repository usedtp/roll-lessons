import { MODULE_ID, cfg } from "./settings.mjs";
import { isWriter, logReport } from "./log.mjs";

/*
 * "Error" and "Unclear" buttons under every panel. A report goes by socket to the active GM, whose browser
 * writes it to the roll log and shows a notice. With no GM online it waits in this browser's local storage
 * and is sent when a GM connects.
 */

export const CHANNEL = `module.${MODULE_ID}`;
const QUEUE_KEY = `${MODULE_ID}.pendingReports`;
const ACK_MS = 5000;
const COMMENT_MAX = 500;
const waiting = new Map();

const loc = key => game.i18n.localize(`ROLLLESSONS.report.${key}`);
const fmt = (key, data) => game.i18n.format(`ROLLLESSONS.report.${key}`, data);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));

/** Reports waiting for a GM. Local storage can be missing or blocked, so every access is guarded. */
export const storage = {
  load() {
    try { return JSON.parse(globalThis.localStorage?.getItem(QUEUE_KEY) ?? "[]") ?? []; } catch (err) { return []; }
  },
  save(list) {
    try {
      if (list.length) globalThis.localStorage?.setItem(QUEUE_KEY, JSON.stringify(list));
      else globalThis.localStorage?.removeItem(QUEUE_KEY);
    } catch (err) { /* storage blocked */ }
  }
};

/** Text of a panel as the reader saw it: one line per row and note. */
export function panelText(panel) {
  const lines = [];
  for (const node of panel?.querySelectorAll?.(".rl-row, .rl-note, .rl-total") ?? []) {
    lines.push(node.textContent.replace(/\s+/g, " ").trim());
  }
  return lines.join("\n");
}

export function buildReport({ category, message, index, roll, L, text, rows = [], comment }) {
  const note = String(comment ?? "").trim().slice(0, COMMENT_MAX);
  const report = {
    id: foundry.utils.randomID(),
    t: new Date().toISOString(),
    category: category === "unclear" ? "unclear" : "error",
    user: game.user?.name,
    userId: game.user?.id,
    message: message?.id,
    roll: index,
    speaker: message?.speaker?.alias,
    kind: L?.k,
    formula: roll?.formula,
    total: roll?.total,
    rows,
    panel: String(text ?? "").slice(0, 4000),
    lessons: L,
    versions: { foundry: game.version, dnd5e: game.system?.version, rollLessons: game.modules?.get(MODULE_ID)?.version }
  };
  if (note) report.comment = note;
  return report;
}

async function receive(report) {
  await logReport(report);
  if (game.user?.isGM) {
    ui.notifications?.info(fmt("received", { user: report.user ?? "?", category: loc(report.category === "unclear" ? "unclear" : "error") }));
  }
}

function emitWithAck(report) {
  return new Promise(res => {
    const timer = setTimeout(() => { waiting.delete(report.id); res(false); }, ACK_MS);
    waiting.set(report.id, () => { clearTimeout(timer); waiting.delete(report.id); res(true); });
    game.socket.emit(CHANNEL, { action: "report", report });
  });
}

function enqueueLocal(report) {
  const list = storage.load();
  if (!list.some(r => r.id === report.id)) list.push(report);
  storage.save(list);
}

/** @returns {Promise<"logged"|"sent"|"queued">} */
export async function sendReport(report) {
  if (isWriter()) { await receive(report); return "logged"; }
  if (!game.users?.activeGM) { enqueueLocal(report); return "queued"; }
  if (await emitWithAck(report)) return "sent";
  enqueueLocal(report);
  return "queued";
}

export function onSocket(data) {
  if (data?.action === "report") {
    if (!isWriter() || !data.report) return;
    receive(data.report)
      .then(() => game.socket.emit(CHANNEL, { action: "reportAck", id: data.report.id, to: data.report.userId }))
      .catch(err => console.error(`${MODULE_ID} | report not logged`, err));
  } else if (data?.action === "reportAck") {
    if (data.to === game.user?.id) waiting.get(data.id)?.();
  }
}

let resending = false;

/** Send reports saved while no GM was online. Runs at start-up and when a GM connects. */
export async function resendQueued() {
  if (resending) return 0;
  const list = storage.load();
  if (!list.length || (!isWriter() && !game.users?.activeGM)) return 0;
  resending = true;
  const left = [];
  try {
    for (const r of list) {
      if (isWriter()) await receive(r);
      else if (!(await emitWithAck(r))) left.push(r);
    }
  } finally {
    storage.save(left);
    resending = false;
  }
  const sent = list.length - left.length;
  if (sent) ui.notifications?.info(fmt("resent", { count: sent }));
  return sent;
}

async function openDialog(category, ctx) {
  const { DialogV2 } = foundry.applications.api;
  const lines = [...(ctx.panel?.querySelectorAll(".rl-row") ?? [])].map(r => {
    const v = r.querySelector(".rl-value")?.textContent.trim() ?? "";
    const label = r.querySelector(".rl-label")?.textContent.trim() ?? "";
    return `${v} ${label}`.trim();
  });
  const rowsHtml = lines.map((l, i) => `<label class="rl-report-row"><input type="checkbox" name="row${i}"> ${esc(l)}</label>`).join("");
  const content = `
    <p>${esc(loc(category === "unclear" ? "introUnclear" : "introError"))}</p>
    ${lines.length ? `<fieldset><legend>${esc(loc("rows"))}</legend>${rowsHtml}</fieldset>` : ""}
    <label for="rl-report-comment">${esc(loc("comment"))}</label>
    <textarea id="rl-report-comment" name="comment" rows="4" maxlength="${COMMENT_MAX}"></textarea>
    <p class="hint">${esc(loc("disclaimer"))}</p>`;
  const result = await DialogV2.prompt({
    window: { title: loc(category === "unclear" ? "titleUnclear" : "titleError") },
    classes: ["roll-lessons-report"],
    content,
    ok: {
      label: loc("send"),
      callback: (event, button) => {
        const form = button.form;
        const rows = lines.filter((l, i) => form.elements[`row${i}`]?.checked);
        return { rows, comment: form.elements.comment?.value ?? "" };
      }
    },
    rejectClose: false
  });
  if (!result) return;
  const report = buildReport({ category, ...ctx, text: panelText(ctx.panel), rows: result.rows, comment: result.comment });
  const outcome = await sendReport(report);
  ui.notifications?.info(loc(outcome));
}

/** The two buttons at the bottom of a panel. */
export function reportBar(ctx) {
  const bar = document.createElement("div");
  bar.className = "rl-report";
  const label = document.createElement("span");
  label.textContent = loc("prompt");
  bar.append(label);
  for (const category of ["error", "unclear"]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `rl-report-${category}`;
    b.textContent = loc(category);
    b.title = loc(category === "unclear" ? "hintUnclear" : "hintError");
    b.addEventListener("click", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      openDialog(category, ctx).catch(err => console.error(`${MODULE_ID} | report failed`, err));
    });
    bar.append(b);
  }
  return bar;
}

export function registerReports() {
  game.socket?.on(CHANNEL, onSocket);
  Hooks.on("userConnected", (user, connected) => {
    if (connected && user?.isGM) setTimeout(() => resendQueued(), 3000);
  });
  if (cfg.enabled) setTimeout(() => resendQueued(), 3000);
}
