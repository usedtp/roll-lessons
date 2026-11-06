/*
 * Roll Lessons roll-log review. Run as a GM through the browser console (F12) or a script macro.
 * Reads every roll log file (daily files from 1.4.0 and earlier, batch folders from 1.5.0 on), then lists:
 *  - rolls the module flagged itself: rows matched by rule value (v), combination (c), sheet search (s),
 *    unmatched rows (x), totals that don't add up, effects with no rule sentence, timing warnings
 *  - reports and panel issues saved in the roll log by versions before 1.6.0
 * From 1.6.0, Error and Unclear reports and panel issues are in usedtp Logger: GM Settings > usedtp Logger > Open logs.
 * Options (set before running): window.__rlReview = { since: "2026-10-01" }   // only entries on or after this date
 * Returns a summary; full results are kept in window.__rlReviewResults.
 */
(async () => {
  const api = game.modules.get("roll-lessons")?.api;
  if (!api?.readAllLogs) return "Roll Lessons 1.5.0 or later must be active.";
  if (!game.user.isGM) return "Run this as a GM: reading the log folder needs file browser access.";
  const opt = window.__rlReview ?? {};
  const { review } = await import(foundry.utils.getRoute("modules/roll-lessons/scripts/review.mjs"));
  let entries = await api.readAllLogs();
  if (opt.since) entries = entries.filter(e => String(e.t ?? "") >= opt.since);
  const out = review(entries);
  window.__rlReviewResults = out;
  return {
    files: (await api.listLogFiles()).length,
    counts: out.counts,
    flagCauses: out.flagCauses.slice(0, 30).map(([k, n]) => `${n} x ${k}`),
    oldReportCauses: out.causes.slice(0, 20).map(([k, n]) => `${n} x ${k}`),
    oldPanelIssues: out.issues.slice(0, 10).map(i => `${i.t} | ${i.key} | ${i.reason}`)
  };
})();
