/*
 * Roll Lessons log review. Run as a GM through the browser console (F12) or a script macro.
 * Reads every roll log file (daily files from 1.4.0 and earlier, batch folders from 1.5.0), then lists:
 *  - open Error and Unclear reports, grouped by category and likely cause
 *  - rolls the module flagged itself: rows matched by rule value (v), combination (c), sheet search (s),
 *    unmatched rows (x), totals that don't add up, effects with no rule sentence, timing warnings
 *  - panel issues (rule text missing in a browser)
 * Options (set before running): window.__rlReview = {
 *   since: "2026-10-01",                         // only entries on or after this date
 *   mark: { ids: ["reportId"], s: "fixed", v: "1.5.1", note: "why" }   // write report-status.json; s: fixed | reworded | wontfix, or null to clear
 * }
 * Returns a summary; full results are kept in window.__rlReviewResults.
 */
(async () => {
  const api = game.modules.get("roll-lessons")?.api;
  if (!api?.readAllLogs) return "Roll Lessons 1.5.0 or later must be active.";
  if (!game.user.isGM) return "Run this as a GM: reading the log folder needs file browser access.";
  const opt = window.__rlReview ?? {};
  if (opt.mark?.ids?.length) await api.setReportStatus(opt.mark.ids, opt.mark.s === null ? null : { s: opt.mark.s ?? "fixed", v: opt.mark.v, note: opt.mark.note });
  const { review } = await import(foundry.utils.getRoute("modules/roll-lessons/scripts/review.mjs"));
  let entries = await api.readAllLogs();
  if (opt.since) entries = entries.filter(e => String(e.t ?? "") >= opt.since);
  const out = review(entries, await api.readReportStatus());
  window.__rlReviewResults = out;
  const open = out.reports.filter(r => !r.status);
  return {
    files: (await api.listLogFiles()).length,
    counts: out.counts,
    reportCauses: out.causes.slice(0, 20).map(([k, n]) => `${n} x ${k}`),
    openReports: open.slice(0, 30).map(r => `${r.id} | ${r.category} | ${r.t} | ${r.user} | ${r.kind} ${r.formula} = ${r.total} | rows: ${(r.rows ?? []).join("; ")} | ${r.comment ?? ""}`),
    flagCauses: out.flagCauses.slice(0, 30).map(([k, n]) => `${n} x ${k}`),
    panelIssues: out.issues.slice(0, 10).map(i => `${i.t} | ${i.key} | ${i.reason}`)
  };
})();
