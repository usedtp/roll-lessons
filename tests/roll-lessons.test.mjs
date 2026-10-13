// Node tests for Roll Lessons logic that does not need a browser. Run: npm test
import fs from "node:fs";

let fetchPlan = [];
const fetched = [];
const hooks = [];
let rid = 0;
globalThis.foundry = { utils: {
  getRoute: p => `/${p}`,
  getProperty: (o, k) => k.split(".").reduce((c, x) => c?.[x], o),
  randomID: (n = 16) => `id${String(++rid).padStart(n - 2, "0")}`.slice(0, n)
} };
globalThis.Hooks = { callAll: (n, s) => hooks.push([n, s]), on() {}, once() {} };
const notices = [];
globalThis.ui = { notifications: { warn() {}, info: m => notices.push(m) } };
globalThis.CONFIG = { DND5E: { abilities: { int: { label: "Intelligence" }, wis: { label: "Wisdom" } }, skills: { arc: { label: "Arcana" } } } };
const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const uuids = new Map();
globalThis.fromUuidSync = u => uuids.get(u) ?? null;
// Node 22 provides navigator.userAgent.
globalThis.game = {
  modules: { get: () => ({ version: "1.5.0" }) },
  settings: { get: () => "" },
  i18n: { localize: k => k, format: (k, d) => `${k} ${JSON.stringify(d)}` },
  user: { id: "player1", name: "test", isGM: false }, users: { activeGM: null }, version: "14.369", system: { version: "6.0.6" },
  socket: { emit() {}, on() {} }
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
  static safeEval(f) { return Function("max", "min", "floor", "ceil", `return (${f})`)(Math.max, Math.min, Math.floor, Math.ceil); }
  evaluateSync() { return { total: Roll.safeEval(this.f) }; }
};

const { RuleBook } = await import("../scripts/rules.mjs");
const { repairParts, buildLessons } = await import("../scripts/breakdown.mjs");
const { isEmptyRoll, flatTotal, diceSigns } = await import("../scripts/render.mjs");
const { signedDiceTotal, batchPath } = await import("../scripts/log.mjs");
const { resolve, describeFormula, pickSentence, conditionClauses, plainText } = await import("../scripts/text.mjs");
const { appliedEarly, normalizeKey, explainReason } = await import("../scripts/effects.mjs");
const report = await import("../scripts/report.mjs");
const { review } = await import("../scripts/review.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => c ? pass++ : (fail++, console.log("FAIL:", m));
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

// Rule book loading
fetchPlan = ["ok"];
ok(await RuleBook.load() === true && RuleBook.status.state === "ok", "rules load");
ok(fetched.at(-1).endsWith("rules.json?v=1.5.0"), `cache-busting url ${fetched.at(-1)}`);
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

// 1.5.0: nested @references (Thaumaturge showed +1 instead of +3)
const wis3 = { ruleBonus: "(max(1,@abilities.wis.mod))", abilities: { wis: { mod: 3 } } };
ok(resolve("@ruleBonus", wis3) === 3, `nested @ref resolves to 3: ${resolve("@ruleBonus", wis3)}`);
ok(resolve("@ruleBonus", { ruleBonus: "-1d4" }) === "-1d4", "dice bonus kept as formula");
eq(describeFormula("(max(1,@abilities.wis.mod))"), "Wisdom modifier, minimum +1", "formula in words");
ok(describeFormula("2") === null, "plain number needs no words");

// 1.5.0: effect keys dnd5e 6 redirects
eq(normalizeKey("system.bonuses.abilities.save"), "system.rolls.ability.save.bonus", "legacy save key");
eq(normalizeKey("system.skills.arc.bonuses.check"), "system.skills.arc.roll.bonus", "legacy skill key");
eq(normalizeKey("system.abilities.int.bonuses.save"), "system.abilities.int.save.roll.bonus", "legacy ability save key");

// 1.5.0: effect attribution. Fixture text is written for the test, not quoted from a book.
const cyrus = { documentName: "Actor", name: "Cyrus", uuid: "Actor.cyrus", id: "cyrus" };
const sliverText = "<p>You try to sliver the mind of one creature you can see within range. The target must succeed on an Intelligence saving throw or take 1d6 Psychic damage and subtract 1d4 from the next saving throw it makes before the end of your next turn.</p><p><strong>Cantrip Upgrade.</strong> The damage increases by 1d6 when you reach levels 5 (2d6), 11 (3d6), and 17 (4d6).</p>";
const msItem = { documentName: "Item", name: "Mind Sliver", uuid: "Actor.cyrus.Item.ms", actor: cyrus, system: { description: { value: sliverText }, properties: new Set() } };
const msAct = { documentName: "Activity", uuid: "Actor.cyrus.Item.ms.Activity.save1", item: msItem };
uuids.set(msAct.uuid, msAct);
const alwen = { documentName: "Actor", name: "Alwen", uuid: "Actor.alwen", id: "alwen", items: [],
  system: { abilities: { int: { mod: 3, save: { prof: { multiplier: 0 } }, check: { prof: { multiplier: 0 } } }, wis: { mod: 3 } }, skills: { arc: { prof: { multiplier: 0 } } }, attributes: { prof: 2 } },
  appliedEffects: [] };
const slivered = { name: "Slivered", uuid: "Actor.alwen.ActiveEffect.sl", origin: msAct.uuid, description: "", duration: { value: 1, units: "rounds" },
  changes: [{ key: "system.bonuses.abilities.save", type: "add", value: "-1d4" }], statuses: new Set(), _stats: { createdTime: 2000 }, flags: {} };
const order = { documentName: "Item", name: "Divine Order", uuid: "Actor.alwen.Item.do", actor: alwen, system: { properties: new Set(), description: { value: "<p>Thaumaturge. You know one extra cantrip from the Cleric spell list. In addition, your mystical connection to the divine gives you a bonus to your Intelligence (Arcana or Religion) checks. The bonus equals your Wisdom modifier (minimum of +1).</p>" } } };
const thaum = { name: "Thaumaturge", uuid: "Actor.alwen.Item.do.ActiveEffect.th", parent: order, description: "", duration: {}, statuses: new Set(), flags: {},
  changes: [{ key: "system.skills.arc.bonuses.check", type: "add", value: "(max(1,@abilities.wis.mod))" }] };
alwen.appliedEffects = [slivered, thaum];

const sv = buildLessons({ subject: alwen, ability: "int" }, { parts: ["@mod", "@ruleBonus"], data: { mod: 3, ruleBonus: "-1d4" }, options: {} }, "save");
const pen = sv.i.find(i => i[0] === "rulePenalty");
ok(pen, `save penalty row: ${JSON.stringify(sv.i)}`);
eq(pen?.[2], "Slivered, from Cyrus's Mind Sliver", "penalty names effect and source");
eq(pen?.[4]?.[0]?.s, "Subtract 1d4 from the next saving throw it makes before the end of Cyrus's next turn.", "rule sentence from the spell, caster named");
eq(pen?.[4]?.[0]?.d, "1 round", "duration");
ok(pen?.[4]?.[0]?.w?.includes("once") && pen?.[4]?.[0]?.x1 === 1, "one-roll effect flagged");
ok(!sv.i.some(i => i[4]?.some(e => e.n === "Thaumaturge")), "skill bonus not attached to a save");

slivered.flags = { "roll-lessons": { usedBy: "msg1" } };
const sv2 = buildLessons({ subject: alwen, ability: "int" }, { parts: ["@mod", "@ruleBonus"], data: { mod: 3, ruleBonus: "-1d4" }, options: {} }, "save");
ok(sv2.i.find(i => i[0] === "rulePenalty")?.[4]?.[0]?.w?.includes("used"), "already-used effect warned");
slivered.flags = {};

const ex = pen?.[4]?.[0] ?? {};
const cast = { activity: msAct.uuid, item: msItem.uuid };
ok(appliedEarly(ex, { ...cast, castAt: 1000 }) === "yes", "applied after this casting: too early");
ok(appliedEarly(ex, { ...cast, castAt: 3000 }) === false, "applied by an earlier casting: fine");
ok(appliedEarly(ex, cast) === "maybe", "casting time unknown: maybe");
ok(appliedEarly(ex, { activity: "Actor.x.Item.y.Activity.z", item: "Actor.x.Item.y" }) === false, "other spell: no warning");

const sk = buildLessons({ subject: alwen, ability: "int", skill: "arc" }, { parts: ["@mod", "@ruleBonus"], data: { mod: 3, ...wis3 }, options: {} }, "skill");
const th = sk.i.find(i => i[0] === "ruleBonus");
ok(th?.[1] === 3, `Thaumaturge value 3: ${JSON.stringify(th)}`);
eq(th?.[2], "Thaumaturge, from Divine Order", "Thaumaturge source");
ok(/Arcana or Religion/.test(th?.[4]?.[0]?.s ?? "") && /minimum of \+1/.test(th?.[4]?.[0]?.s ?? ""), `Thaumaturge sentence: ${th?.[4]?.[0]?.s}`);
eq(th?.[4]?.[0]?.f, "Wisdom modifier, minimum +1", "Thaumaturge amount in words");
ok(!sk.i.some(i => i[4]?.some(e => e.n === "Slivered")), "save penalty not attached to a skill check");

// Sentence picking and condition text
ok(pickSentence("You bless up to three creatures within range. Whenever a target makes an attack roll or a saving throw before the spell ends, the target adds 1d4 to the attack roll or save.", { kind: "save", amount: "1d4" })?.startsWith("Whenever a target"), "Bless sentence kept whole");
ok(pickSentence("A plain description with no rules.", { kind: "save", amount: "2" }) === null, "no sentence when nothing fits");
eq(conditionClauses("Attack rolls against you have Disadvantage, and your attack rolls have Advantage.", "attack"), "Your attack rolls have Advantage.", "condition clause for own attack");
eq(conditionClauses("You have Disadvantage on attack rolls and ability checks.", "check"), "You have Disadvantage on attack rolls and ability checks.", "poisoned check");
eq(plainText("<p>It&rsquo;s @UUID[Compendium.x.y]{Bless}.</p>"), "It's Bless.", "plain text from HTML");

const poisoned = { name: "Poisoned", uuid: "Actor.f.ActiveEffect.p", statuses: new Set(["poisoned"]), description: "<p>See the rules.</p>", duration: {}, flags: {}, changes: [] };
eq(explainReason(poisoned, alwen, "attack").s, "You have Disadvantage on attack rolls and ability checks.", "condition reason uses the condition rule text");

// Render cross-check counts bracketed terms ("Added after" false row in 1.4.0)
const alwenRoll = { terms: [{ faces: 20, total: 11 }, { operator: "+" }, { number: 3, total: 3 }, { operator: "+" }, { total: 3, dice: [] }] };
ok(flatTotal(alwenRoll) === 6, `flat total counts (max(1,3)): ${flatTotal(alwenRoll)}`);
ok(flatTotal({ terms: [{ faces: 20, total: 9 }, { operator: "+" }, { number: 3 }, { operator: "-" }, { faces: 4, total: 2 }] }) === 3, "subtracted dice ignored by flat total");

eq(diceSigns("1d4 + -1d4"), [1, -1], "mixed bonus and penalty dice keep their signs");
eq(diceSigns("(floor((@details.level + 1) / 6))d6 + 2d8"), [1, 1], "bracketed dice count positive");

// Batch log files
eq(batchPath(new Date("2026-10-13T04:05:06Z"), 7, "ab12"), { dir: "roll-lessons-logs/2026-10-13", name: "040506-007-ab12.json" }, "batch file name");

// Reports
const msg = { id: "m1", speaker: { alias: "Alwen" } };
const rep = report.buildReport({ category: "unclear", message: msg, index: 0, roll: { formula: "1d20 + 3", total: 14 }, L: sv, text: "x", rows: ["-1d4 Penalty"], comment: "a".repeat(600) });
ok(rep.category === "unclear" && rep.message === "m1" && rep.comment.length === 500 && rep.lessons === sv && rep.id, "report payload");
const quiet = report.buildReport({ category: "error", message: msg, index: 0, comment: "   " });
ok(!("comment" in quiet), "empty comment left out");
ok(await report.sendReport(rep) === "queued" && report.storage.load().length === 1, "no GM online: report queued");
game.users.activeGM = { id: "gm" };
game.socket.emit = (ch, data) => { if (data.action === "report") setTimeout(() => report.onSocket({ action: "reportAck", id: data.report.id, to: game.user.id }), 5); };
ok(await report.resendQueued() === 1 && report.storage.load().length === 0, "queued report sent when a GM is online");
ok(await report.sendReport(quiet) === "sent", "report acknowledged by GM");

// Review
const rv = review([
  { message: "a", kind: "skill", items: [{ key: "notFromRules", value: 2, how: "x" }], unaccounted: 2 },
  { message: "b", kind: "save", items: [{ key: "rulePenalty", value: "-1d4", how: "l", ex: [{ n: "Hex" }] }], unaccounted: 0 },
  { ...rep, type: "report" }, { ...rep, type: "report" }, { ...quiet, type: "report" }
], { [quiet.id]: { s: "fixed", v: "1.5.0" } });
ok(rv.counts.rolls === 2 && rv.counts.flagged === 2 && rv.counts.reports === 2 && rv.counts.open === 1 && rv.counts.unclear === 1, `review counts ${JSON.stringify(rv.counts)}`);
ok(rv.flags[1].why.includes("no sentence: Hex"), "effect without sentence flagged");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
