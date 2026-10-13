import { cfg, MODULE_ID } from "./settings.mjs";

/*
 * Roll log in Data/roll-lessons-logs/, written by the active GM's browser only.
 * 1.5.0: each write is a new batch file, roll-lessons-logs/YYYY-MM-DD/HHMMSS-<n>-<id>.json (UTC),
 * so nothing is re-read or capped. Daily files from 1.4.0 and earlier (YYYY-MM-DD.json) are still read.
 * Reports from the Error and Unclear buttons are log entries with type "report".
 * Browsers cannot delete files through Foundry, so old logs are removed by hand from the Data folder.
 */

export const LOG_DIR = "roll-lessons-logs";
export const STATUS_FILE = "report-status.json";
const FLUSH_MS = 30000;
let queue = [];
let timer = null;
const madeDirs = new Set();
let seq = 0;

export const isWriter = () => !!game.user?.isGM && (game.users?.activeGM?.id ?? game.user.id) === game.user.id;

const FP = () => foundry.applications.apps.FilePicker.implementation ?? foundry.applications.apps.FilePicker;

/** Path of one batch file. Exported for tests. */
export function batchPath(date = new Date(), n = 0, id = "") {
  const iso = date.toISOString();
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 19).replace(/:/g, "");
  return { dir: `${LOG_DIR}/${day}`, name: `${time}-${String(n).padStart(3, "0")}${id ? `-${id}` : ""}.json` };
}

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

const versions = () => ({ foundry: game.version, dnd5e: game.system?.version, rollLessons: game.modules?.get(MODULE_ID)?.version });

function summarize(message) {
  const entries = [];
  message.rolls?.forEach((roll, i) => {
    const L = roll.options?.rollLessons;
    if (L?.v !== 2) return;
    const numeric = L.i.filter(it => typeof it[1] === "number").reduce((a, it) => a + it[1], 0);
    const dice = signedDiceTotal(roll);
    const items = L.i.map(([key, value, extra, how, ex]) => (ex ? { key, value, extra, how, ex } : { key, value, extra, how }));
    const entry = {
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
      versions: versions()
    };
    if (L.r) entry.reasons = L.r;
    entries.push(entry);
  });
  return entries;
}

function enqueue(entries, now = false) {
  queue.push(...entries);
  if (now) return flushLog();
  timer ??= setTimeout(flushLog, FLUSH_MS);
}

export function logMessage(message) {
  if (!cfg.rollLog || !isWriter()) return;
  try {
    const entries = summarize(message);
    if (entries.length) enqueue(entries);
  } catch (err) {
    console.error(`${MODULE_ID} | log entry failed`, err);
  }
}

/** A report from the Error or Unclear button. Logged even when the roll log is off, and written at once. */
export function logReport(report) {
  return enqueue([{ ...report, type: "report" }], true);
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
  const entry = { t: new Date().toISOString(), type: "panel-issue", ...issue, user: game.user?.name, browser: globalThis.navigator?.userAgent, versions: versions() };
  console.warn(`${MODULE_ID} | panel issue`, entry);
  if (!cfg.rollLog || !isWriter()) return;
  enqueue([entry]);
}

async function ensureDir(path) {
  if (madeDirs.has(path)) return;
  const parts = path.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const p = parts.slice(0, i).join("/");
    if (madeDirs.has(p)) continue;
    let exists = false;
    try { await FP().browse("data", p); exists = true; } catch (err) { exists = false; }
    if (!exists) { try { await FP().createDirectory("data", p, {}); } catch (err) { /* made by another GM */ } }
    madeDirs.add(p);
  }
}

async function upload(dir, name, data) {
  await ensureDir(dir);
  const file = new File([JSON.stringify(data)], name, { type: "application/json" });
  return FP().upload("data", dir, file, {}, { notify: false });
}

export async function flushLog() {
  clearTimeout(timer);
  timer = null;
  if (!queue.length || !isWriter()) return 0;
  const pending = queue;
  queue = [];
  const { dir, name } = batchPath(new Date(), seq++, foundry.utils.randomID?.(4) ?? "");
  try {
    const res = await upload(dir, name, pending);
    if (res === false) throw new Error("upload refused");
    return pending.length;
  } catch (err) {
    console.error(`${MODULE_ID} | log write failed`, err);
    queue = pending.concat(queue);
    timer ??= setTimeout(flushLog, FLUSH_MS);
    return 0;
  }
}

/* ---------- Reading (GM only: browsing the Data folder needs file access) ---------- */

async function browse(path) {
  try { return await FP().browse("data", path); } catch (err) { return { files: [], dirs: [] }; }
}

/** Every log file: daily files from older versions and batch files. */
export async function listLogFiles() {
  const root = await browse(LOG_DIR);
  const files = (root.files ?? []).filter(f => f.endsWith(".json") && !f.endsWith(STATUS_FILE));
  for (const d of root.dirs ?? []) {
    const sub = await browse(d);
    files.push(...(sub.files ?? []).filter(f => f.endsWith(".json")));
  }
  return files.sort();
}

async function readJSON(path) {
  try {
    const res = await fetch(`${foundry.utils.getRoute(path)}?t=${Date.now()}`, { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch (err) { return null; }
}

/** All log entries, oldest first. Each entry gets `_file`. */
export async function readAllLogs({ onlyReports = false } = {}) {
  const out = [];
  for (const path of await listLogFiles()) {
    const list = await readJSON(path);
    if (!Array.isArray(list)) continue;
    for (const e of list) if (!onlyReports || e?.type === "report") out.push({ ...e, _file: path });
  }
  return out;
}

/** Review status of reports: { [reportId]: { s: "fixed"|"reworded"|"wontfix", v?: version, note?: text } }. */
export async function readReportStatus() {
  return (await readJSON(`${LOG_DIR}/${STATUS_FILE}`)) ?? {};
}

export async function setReportStatus(ids, status) {
  const all = await readReportStatus();
  for (const id of [].concat(ids)) {
    if (status === null) delete all[id];
    else all[id] = { ...status, at: new Date().toISOString() };
  }
  await upload(LOG_DIR, STATUS_FILE, all);
  return all;
}
