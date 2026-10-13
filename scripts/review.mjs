/*
 * Review of roll log entries: player reports grouped by category and cause, plus rolls the module itself
 * flags (rows matched by rule value, combination or sheet search, unmatched rows, totals that don't add up,
 * panel issues, effects with no rule sentence, timing warnings). Pure function: runs in Foundry and Node.
 */

const FLAG_HOW = { v: "matched by rule value", c: "matched by combination", s: "found by sheet search", x: "unmatched" };

function causeOf(report) {
  const L = report.lessons;
  const marked = (report.rows ?? []).join(" | ");
  const how = (L?.i ?? []).find(it => ["v", "c", "s", "x"].includes(it[3]));
  if (how) return `${report.kind ?? L?.k}: ${FLAG_HOW[how[3]]} (${how[0]})`;
  const noSentence = (L?.i ?? []).flatMap(it => it[4] ?? []).find(ex => !ex.s);
  if (noSentence) return `${report.kind ?? L?.k}: effect with no rule sentence (${noSentence.n})`;
  if (marked) return `${report.kind ?? L?.k}: ${marked.replace(/[+-]?\d+/g, "N").slice(0, 80)}`;
  return `${report.kind ?? L?.k ?? "?"}: no row marked`;
}

export function rollFlags(e) {
  const why = [];
  for (const it of e.items ?? []) {
    if (FLAG_HOW[it.how]) why.push(`${it.how}:${it.key}=${it.value}`);
    for (const ex of it.ex ?? []) {
      if (!ex.s) why.push(`no sentence: ${ex.n}`);
      for (const w of ex.w ?? []) if (w !== "once") why.push(`${w}: ${ex.n}`);
    }
  }
  for (const k of ["a", "d"]) for (const r of e.reasons?.[k] ?? []) if (r && typeof r === "object" && !r.s) why.push(`no sentence (${k === "a" ? "advantage" : "disadvantage"}): ${r.n}`);
  if (typeof e.unaccounted === "number" && e.unaccounted !== 0) why.push(`unaccounted ${e.unaccounted}`);
  return why;
}

/**
 * @param {object[]} entries  log entries (any mix of rolls, reports and panel issues)
 * @param {object} status     report-status.json contents
 */
export function review(entries, status = {}) {
  const seen = new Set();
  const reports = [];
  const issues = [];
  const flags = [];
  let rolls = 0;
  for (const e of entries ?? []) {
    if (e?.type === "report") {
      const id = e.id ?? `${e.t}|${e.user}|${e.message}`;
      if (seen.has(id)) continue;
      seen.add(id);
      reports.push({ ...e, id, status: status[id] ?? null, cause: causeOf(e) });
    } else if (e?.type === "panel-issue") issues.push(e);
    else if (e && !e.type) {
      rolls++;
      const why = rollFlags(e);
      if (why.length) flags.push({ t: e.t, message: e.message, kind: e.kind, formula: e.formula, total: e.total, why });
    }
  }
  const open = reports.filter(r => !r.status);
  const causes = {};
  for (const r of open) {
    const k = `${r.category} | ${r.cause}`;
    causes[k] = (causes[k] ?? 0) + 1;
  }
  const flagCauses = {};
  for (const f of flags) for (const w of f.why) {
    const k = `${f.kind} | ${w.replace(/=-?[\d.]+$/, "=N").replace(/unaccounted -?\d+/, "unaccounted N")}`;
    flagCauses[k] = (flagCauses[k] ?? 0) + 1;
  }
  return {
    counts: { rolls, reports: reports.length, open: open.length, error: open.filter(r => r.category === "error").length, unclear: open.filter(r => r.category === "unclear").length, flagged: flags.length, panelIssues: issues.length },
    causes: Object.entries(causes).sort((a, b) => b[1] - a[1]),
    flagCauses: Object.entries(flagCauses).sort((a, b) => b[1] - a[1]),
    reports,
    flags,
    issues
  };
}
