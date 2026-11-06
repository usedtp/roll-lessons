import { log } from "./diag.mjs";

/*
 * "Error" and "Unclear" buttons under every panel. The dialog lets the reader tick the lines the report is
 * about and add a comment. Sending, delivery to the GM and the offline queue are handled by usedtp Logger.
 */

const COMMENT_MAX = 500;

const loc = key => game.i18n.localize(`ROLLLESSONS.report.${key}`);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));

/** Text of a panel as the reader saw it: one line per row and note. */
export function panelText(panel) {
  const lines = [];
  for (const node of panel?.querySelectorAll?.(".rl-row, .rl-note, .rl-total") ?? []) {
    lines.push(node.textContent.replace(/\s+/g, " ").trim());
  }
  return lines.join("\n");
}

/** What a report carries: the roll it is about and the breakdown as shown. */
export function reportContext({ message, index, roll, L, text, rows = [] }) {
  return {
    messageId: message?.id,
    roll: index,
    kind: L?.k,
    formula: roll?.formula,
    total: roll?.total,
    rows,
    panel: String(text ?? "").slice(0, 4000),
    lessons: L
  };
}

/** Send a report through usedtp Logger and say what happened. */
export async function sendReport(category, ctx, { rows = [], comment = "" } = {}) {
  const outcome = await log().report(category === "unclear" ? "unclear" : "error", {
    comment: String(comment ?? "").trim().slice(0, COMMENT_MAX),
    context: reportContext({ ...ctx, text: panelText(ctx.panel), rows })
  });
  ui.notifications?.info(loc(["logged", "sent", "queued"].includes(outcome) ? outcome : "queued"));
  return outcome;
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
  await sendReport(category, ctx, { rows: result.rows, comment: result.comment });
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
      log().guard("report", () => openDialog(category, ctx));
    });
    bar.append(b);
  }
  return bar;
}
