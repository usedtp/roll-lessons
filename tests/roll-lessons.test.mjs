// Node tests for Roll Lessons logic that does not need a browser. Run: npm test
import fs from "node:fs";

let fetchPlan = [];
const fetched = [];
const hooks = [];
globalThis.foundry = { utils: {
  getRoute: p => `/${p}`,
  getProperty: (o, k) => k.split(".").reduce((c, x) => c?.[x], o)
} };
globalThis.Hooks = { callAll: (n, s) => hooks.push([n, s]), on() {}, once() {} };
globalThis.ui = { notifications: { warn() {} } };
globalThis.CONFIG = { DND5E: { abilities: {} } };
// Node 22 provides navigator.userAgent.
globalThis.game = {
  modules: { get: () => ({ version: "1.4.0" }) },
  settings: { get: () => "" },
  i18n: { localize: k => k, format: (k, d) => `${k} ${JSON.stringify(d)}` },
  user: { name: "test", isGM: false }, version: "14.369", system: { version: "6.0.6" }
};
globalThis.fetch = async url => {
  fetched.push(url);
  const next = fetchPlan.shift() ?? "ok";
  if (next === "ok") return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(new URL("../data/rules.json", import.meta.url))) };
  return { ok: false, status: 404, json: async () => ({}) };
};
globalThis.Roll = class {
  constructor(f) { this.f = f; }
  static replaceFormulaData(f, data) { return f.replace(/@([\w.]+)/g, (_, p) => String(p.split(".").reduce((c, x) => c?.[x], data) ?? 0)); }
  static safeEval(f) { return Function(`return (${f})`)(); }
  evaluateSync() { return { total: Roll.safeEval(this.f) }; }
};

const { RuleBook } = await import("../scripts/rules.mjs");
const { repairParts, buildLessons } = await import("../scripts/breakdown.mjs");
const { isEmptyRoll } = await import("../scripts/render.mjs");
const { signedDiceTotal } = await import("../scripts/log.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => c ? pass++ : (fail++, console.log("FAIL:", m));
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

// Rule book loading
fetchPlan = ["ok"];
ok(await RuleBook.load() === true && RuleBook.status.state === "ok", "rules load");
ok(fetched.at(-1).endsWith("rules.json?v=1.4.0"), `cache-busting url ${fetched.at(-1)}`);
ok(RuleBook.status.count > 50 && "cantripUpgrade" in RuleBook.data, "rules count and new key");
ok(hooks.some(([n, s]) => n === "roll-lessons.rulesLoaded" && s.state === "ok"), "rulesLoaded hook");
fetchPlan = ["404", "ok"];
ok(await RuleBook.load() === true && RuleBook.status.state === "ok", "retry after one failure");
const keep = RuleBook.data;
fetchPlan = ["404", "404"];
ok(await RuleBook.load() === false && RuleBook.status.state === "failed" && RuleBook.status.error === "HTTP 404", "fails after two attempts with reason");
ok(RuleBook.data === keep, "failed reload keeps previous rules");
fetchPlan = ["ok"];
await RuleBook.load();

// Repair of parts split inside brackets (Automated Conditions 5e)
eq(repairParts(["(floor((@details.level", "1) / 6))d6"]), ["(floor((@details.level + 1) / 6))d6"], "True Strike parts rejoined");
const balanced = ["1d8", "@mod"];
ok(repairParts(balanced) === balanced, "balanced parts untouched");
eq(repairParts(["1d6[fire]", "(1", "2)d4", "@mod"]), ["1d6[fire]", "(1 + 2)d4", "@mod"], "only broken parts merged");
eq(repairParts(["@mod"]), ["@mod"], "single part");

// Breakdown
const data = { details: { level: 1 }, mod: 4 };
const ts = buildLessons({ subject: {} }, { parts: ["(floor((@details.level", "1) / 6))d6"], data, options: { type: "radiant" } }, "damage");
eq(ts.pp, ["(floor((@details.level + 1) / 6))d6"], "True Strike stored part repaired");
ok(ts.i.length === 1 && ts.i[0][0] === "cantripUpgrade", `True Strike labelled Cantrip Upgrade: ${JSON.stringify(ts.i)}`);
ok(!ts.i.some(i => i[0] === "notFromRules"), "no 'not from rules' row");
const cb = buildLessons({ subject: {} }, { parts: ["1d8", "@mod"], data, options: { type: "piercing" } }, "damage");
eq(cb.i.map(i => i[0]), ["dmgBase", "mod.damage"], "crossbow damage unchanged");

// Zero-only damage rolls
class DamageRoll { constructor(o) { Object.assign(this, o); } }
const die = (number, total) => ({ number, faces: 6, total });
ok(isEmptyRoll(new DamageRoll({ dice: [die(0, 0)], terms: [die(0, 0)], total: 0 })), "0d6 is empty");
ok(!isEmptyRoll(new DamageRoll({ dice: [die(1, 4)], terms: [die(1, 4)], total: 4 })), "1d6 is not empty");
ok(!isEmptyRoll(new DamageRoll({ dice: [die(0, 0)], terms: [die(0, 0), { operator: "+" }, { number: 2 }], total: 2 })), "0d6 + 2 is not empty");
class D20Roll { constructor(o) { Object.assign(this, o); } }
ok(!isEmptyRoll(new D20Roll({ dice: [die(0, 0)], terms: [], total: 0 })), "attack rolls never hidden");

// Roll log: subtracted dice
const terms = [{ faces: 20, total: 11 }, { operator: "+" }, { number: 3 }, { operator: "-" }, { faces: 4, total: 1 }];
ok(signedDiceTotal({ terms }) === 10, "1d20 + 3 - 1d4 counts the d4 as negative");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
