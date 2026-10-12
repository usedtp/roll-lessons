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

function summarize(message) {
  const entries = [];
  message.rolls?.forEach((roll, i) => {
    const L = roll.options?.rollLessons;
    if (L?.v !== 2) return;
    const numeric = L.i.filter(it => typeof it[1] === "number").reduce((a, it) => a + it[1], 0);
    const dice = (roll.dice ?? []).reduce((a, d) => a + (d.total ?? 0), 0);
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
