import { cfg, MODULE_ID } from "./settings.mjs";

/*
 * Roll log. One JSON file per day in Data/roll-lessons-logs/, written by the active GM's browser only.
 * Entries are queued and written every 30 seconds, capped at 500 per day.
 */

export const LOG_DIR = "roll-lessons-logs";
const FLUSH_MS = 30000;
const CAP = 500;
let queue = [];
let timer = null;
let dirReady = false;

const isWriter = () => game.user?.isGM && (game.users?.activeGM?.id ?? game.user.id) === game.user.id;
const today = () => new Date().toISOString().slice(0, 10);

/** Dice total with each die's sign: "1d20 + 3 - 1d4" counts the d4 as negative. */
export function signedDiceTotal(roll) {
  let sign = 1;
  let sum = 0;
  for (const term of roll?.terms ?? []) {
    if (typeof term.operator === "string") { sign = term.operator === "-" ? -1 : 1; continue; }
    if (term.faces !== undefined) sum += sign * (term.total ?? 0);
    sign = 1;
  }
  return sum;
}

function summarize(message) {
  const entries = [];
  message.rolls?.forEach((roll, i) => {
    const L = roll.options?.rollLessons;
    if (L?.v !== 2) return;
    const numeric = L.i.filter(it => typeof it[1] === "number").reduce((a, it) => a + it[1], 0);
    const dice = signedDiceTotal(roll);
    const items = L.i.map(([key, value, extra, how]) => ({ key, value, extra, how }));
    entries.push({
      t: new Date().toISOString(),
      message: message.id,
      roll: i,
      author: message.author?.name,
      speaker: message.speaker?.alias,
      flavor: message.flavor,
      kind: L.k,
      formula: roll.formula,
      total: roll.total,
      parts: L.pp,
      items,
      ac5eApplied: roll.options?.["automated-conditions-5e"]?.appliedParts ?? [],
      // Items not labelled by dnd5e: v/c = rule match, s = sheet search, x = unmatched.
      review: items.filter(it => ["v", "c", "s", "x"].includes(it.how)).map(it => `${it.how}:${it.key}=${it.value}`),
      unaccounted: (roll.isCritical || roll.options?.isCritical) ? null : (roll.total ?? 0) - dice - numeric,
      versions: { foundry: game.version, dnd5e: game.system.version, rollLessons: game.modules.get(MODULE_ID)?.version }
    });
  });
  return entries;
}

export function logMessage(message) {
  if (!cfg.rollLog || !isWriter()) return;
  try {
    const entries = summarize(message);
    if (!entries.length) return;
    queue.push(...entries);
    timer ??= setTimeout(flushLog, FLUSH_MS);
  } catch (err) {
    console.error(`${MODULE_ID} | log entry failed`, err);
  }
}

const seenIssues = new Set();

/**
 * A panel row that could not be explained. Always written to the console; added to the roll log when this
 * browser is the log writer (the active GM). One entry per message, key and reason.
 */
export function logIssue(issue) {
  const id = `${issue.message}|${issue.key}|${issue.reason}`;
  if (seenIssues.has(id)) return;
  seenIssues.add(id);
  const entry = {
    t: new Date().toISOString(),
    type: "panel-issue",
    ...issue,
    user: game.user?.name,
    browser: navigator.userAgent,
    versions: { foundry: game.version, dnd5e: game.system?.version, rollLessons: game.modules?.get(MODULE_ID)?.version }
  };
  console.warn(`${MODULE_ID} | panel issue`, entry);
  if (!cfg.rollLog || !isWriter()) return;
  queue.push(entry);
  timer ??= setTimeout(flushLog, FLUSH_MS);
}

export async function flushLog() {
  clearTimeout(timer);
  timer = null;
  if (!queue.length || !isWriter()) return 0;
  const pending = queue;
  queue = [];
  const FP = foundry.applications.apps.FilePicker.implementation ?? foundry.applications.apps.FilePicker;
  const name = `${today()}.json`;
  try {
    if (!dirReady) {
      try { await FP.createDirectory("data", LOG_DIR, {}); } catch (err) { /* already exists */ }
      dirReady = true;
    }
    let existing = [];
    try {
      const res = await fetch(foundry.utils.getRoute(`${LOG_DIR}/${name}`) + `?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) existing = await res.json();
    } catch (err) { existing = []; }
    const all = existing.concat(pending).slice(-CAP);
    const file = new File([JSON.stringify(all)], name, { type: "application/json" });
    await FP.upload("data", LOG_DIR, file, {}, { notify: false });
    return pending.length;
  } catch (err) {
    console.error(`${MODULE_ID} | log write failed`, err);
    queue = pending.concat(queue);
    return 0;
  }
}
