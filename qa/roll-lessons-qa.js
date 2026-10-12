/*
 * Roll Lessons QA suite.
 * Run as a GM in the Phandelver & Below world: paste into the browser console (F12), or run through Claude.
 * Read-only: every roll uses create:false, so nothing is posted to chat and no actor data changes.
 * The only setting touched (detail level, this browser only) is restored at the end.
 * Returns { version, passed, failed, skipped, results }.
 */
(async () => {
  const MOD = "roll-lessons";
  const D = { configure: false };
  const M = { create: false };
  const results = [];
  const actor = n => game.actors.getName(n);
  const activity = (a, itemName, type) => a?.items.getName(itemName)?.system.activities
    .find(x => (type ? x.type === type : (x.damage?.parts?.length || x.healing)));

  async function render(rolls, { actorDoc, type = "base", visible = true } = {}) {
    rolls = Array.isArray(rolls) ? rolls : [rolls];
    const msg = new ChatMessage.implementation({ speaker: actorDoc ? ChatMessage.getSpeaker({ actor: actorDoc }) : {}, rolls, type });
    if (!visible) Object.defineProperty(msg, "isContentVisible", { get: () => false });
    const html = await msg.renderHTML();
    const panels = [...html.querySelectorAll(".roll-lessons")];
    return panels.map((p, i) => {
      p.open = true;
      p.dispatchEvent(new Event("toggle"));
      const rows = [...p.querySelectorAll(".rl-row")].map(r => ({
        v: r.querySelector(".rl-value").textContent.trim(),
        label: r.querySelector(".rl-label").textContent.trim(),
        text: r.querySelector(".rl-text")?.textContent.trim() ?? "",
        unknown: r.classList.contains("rl-unknown")
      }));
      const notes = [...p.querySelectorAll(".rl-note")].map(n => n.textContent.replace(/\s+/g, " ").trim());
      const total = Number(p.querySelector(".rl-total .rl-value")?.textContent);
      const roll = msg.rolls[i];
      return { roll, rows, notes, total, textCount: p.querySelectorAll(".rl-text").length };
    });
  }

  /** Standard checks every panel must pass. */
  function standard(panel) {
    const issues = [];
    const sum = panel.rows.reduce((a, r) => a + (Number(r.v.replace("+", "")) || 0), 0);
    if (panel.total !== panel.roll.total) issues.push(`panel total ${panel.total} != roll total ${panel.roll.total}`);
    if (sum !== panel.roll.total) issues.push(`rows add to ${sum}, roll total ${panel.roll.total}`);
    for (const r of panel.rows) {
      if (r.unknown || /Source not found|Unnamed effect|Not identified|Not from a Player's Handbook rule|Added after the roll/.test(r.label) || /^[a-z]+(\.[a-z]+)+$/.test(r.label)) {
        issues.push(`unexplained row: ${r.label}`);
      }
      if (r.v === "+0" && !/modifier|Proficiency/i.test(r.label)) issues.push(`zero row: ${r.label}`);
    }
    for (const n of panel.notes) if (/(\b[\w ]+\b) \(\1\)/.test(n)) issues.push(`duplicated name: ${n}`);
    return issues;
  }

  async function test(name, fn, expect = () => [], opts = {}) {
    try {
      const rolls = await fn();
      if (!rolls || (Array.isArray(rolls) && !rolls.length)) {
        results.push({ name, status: "skipped", why: "dnd5e returned no roll" });
        return;
      }
      const panels = await render(rolls, opts);
      if (opts.visible === false) {
        results.push({ name, status: panels.length ? "failed" : "passed", why: panels.length ? "panel shown on hidden roll" : "" });
        return;
      }
      if (!panels.length) { results.push({ name, status: "failed", why: "no panel" }); return; }
      const p = panels[0];
      const issues = [...standard(p), ...expect(p)];
      results.push({
        name, status: issues.length ? "failed" : "passed", why: issues.join("; "),
        formula: p.roll.formula, total: p.roll.total, rows: p.rows.map(r => `${r.v} ${r.label}`), notes: p.notes
      });
    } catch (err) {
      results.push({ name, status: "failed", why: `error: ${err.message}` });
    }
  }

  const has = (p, re, where = "rows") => (where === "rows" ? p.rows.some(r => re.test(r.label)) : p.notes.some(n => re.test(n)));
  const need = (cond, msg) => (cond ? [] : [msg]);

  const T = actor("Teddy"), V = actor("Devlin Straussenheim"), A = actor("Alwen"), C = actor("Cyrus"), TH = actor("Thogrum Fireforge");
  const goblin = canvas.tokens?.placeables.find(t => t.name === "Goblin")?.actor ?? actor("Goblin");
  const bandit = actor("Bandit");
  const goblinAttack = goblin?.items.find(i => i.system.activities?.some(x => x.type === "attack"))?.system.activities.find(x => x.type === "attack");

  // D20 tests
  await test("Teddy STR check: Rage gives advantage", () => T.rollAbilityCheck({ ability: "str" }, D, M), p => need(has(p, /Advantage.*Rage/, "notes"), "Rage not named as advantage source"), { actorDoc: T });
  const profSkill = Object.entries(T.system.skills).find(([, s]) => s.prof?.multiplier === 1)?.[0];
  const unprofSkill = Object.entries(T.system.skills).find(([, s]) => !s.prof?.multiplier)?.[0];
  await test(`Teddy skill ${profSkill}: proficient`, () => T.rollSkill({ skill: profSkill }, D, M), p => need(has(p, /Proficiency/), "no proficiency row"), { actorDoc: T });
  await test(`Teddy skill ${unprofSkill}: not proficient`, () => T.rollSkill({ skill: unprofSkill }, D, M), p => need(!has(p, /Proficiency/), "proficiency row on unproficient skill"), { actorDoc: T });
  await test("Teddy tool: cartographer", () => T.rollToolCheck({ tool: "cartographer" }, D, M), () => [], { actorDoc: T });
  await test("Devlin INT save: Gnomish Cunning advantage", () => V.rollSavingThrow({ ability: "int" }, D, M), p => need(has(p, /Advantage.*Gnomish Cunning/, "notes"), "Gnomish Cunning not named"), { actorDoc: V });
  await test("Devlin DEX save: no +0 cover row", () => V.rollSavingThrow({ ability: "dex" }, D, M), () => [], { actorDoc: V });
  await test("Alwen WIS save with target 13", () => A.rollSavingThrow({ ability: "wis", target: 13 }, D, M), p => need(has(p, /Target number/, "notes"), "no target note"), { actorDoc: A });
  await test("Cyrus concentration", () => C.rollConcentration({}, D, M), () => [], { actorDoc: C });
  await test("Teddy initiative (tracker)", async () => { const r = T.getInitiativeRoll(); await r.evaluate(); return r; }, () => [], { actorDoc: T });
  await test("Teddy DEX check: forced disadvantage, no source", () => T.rollAbilityCheck({ ability: "dex", disadvantage: true }, D, M), p => need(has(p, /did not report a reason/, "notes"), "missing no-reason text"), { actorDoc: T });
  await test("Bandit stealth (NPC, CR 1/8)", () => bandit.rollSkill({ skill: "ste" }, D, M), () => [], { actorDoc: bandit });
  await test("Goblin DEX save (NPC)", () => goblin.rollSavingThrow({ ability: "dex" }, D, M), () => [], { actorDoc: goblin });

  // Attacks
  await test("Thogrum Warhammer attack", () => activity(TH, "Warhammer", "attack").rollAttack({}, D, M), () => [], { actorDoc: TH });
  await test("Alwen Mace attack", () => activity(A, "Mace", "attack").rollAttack({}, D, M), () => [], { actorDoc: A });
  await test("Cyrus Light Crossbow attack", () => activity(C, "Light Crossbow", "attack").rollAttack({}, D, M), () => [], { actorDoc: C });
  await test("Goblin attack (NPC)", () => goblinAttack.rollAttack({}, D, M), () => [], { actorDoc: goblin });
  await test("Teddy Halberd attack", () => activity(T, "Halberd", "attack").rollAttack({}, D, M), () => [], { actorDoc: T });

  // Natural 1 note: roll until a natural 1 appears (max 200 tries)
  await test("Natural 1 note on attack", async () => {
    const at = activity(TH, "Warhammer", "attack");
    for (let i = 0; i < 200; i++) { const r = await at.rollAttack({}, D, M); if (r?.[0]?.isFumble) return r; }
    return null;
  }, p => need(has(p, /Natural 1/, "notes"), "no natural 1 note"), { actorDoc: TH });

  // Damage and healing
  await test("Thogrum Warhammer damage", () => activity(TH, "Warhammer", "attack").rollDamage({}, D, M), () => [], { actorDoc: TH, type: "damage" });
  await test("Thogrum Warhammer critical damage", () => activity(TH, "Warhammer", "attack").rollDamage({ isCritical: true }, D, M),
    p => [...need(has(p, /Critical hit/, "notes"), "no critical note"), ...need(has(p, /doubled by the critical hit/), "dice not marked as doubled")], { actorDoc: TH, type: "damage" });
  await test("Thogrum Warhammer two-handed (Versatile)", () => activity(TH, "Warhammer", "attack").rollDamage({ attackMode: "twoHanded" }, D, M),
    p => need(has(p, /Versatile/), "no Versatile label"), { actorDoc: TH, type: "damage" });
  await test("Teddy Halberd damage: Rage named", () => activity(T, "Halberd", "attack").rollDamage({}, D, M),
    p => need(has(p, /Damage bonus: Rage/), "Rage not named"), { actorDoc: T, type: "damage" });
  await test("Teddy thrown Handaxe: Rage gap flagged", () => activity(T, "Handaxe", "attack").rollDamage({ attackMode: "thrown" }, D, M),
    p => need(has(p, /Rage Damage not added/, "notes"), "Rage gap not flagged"), { actorDoc: T, type: "damage" });
  await test("Cyrus Light Crossbow damage", () => activity(C, "Light Crossbow", "attack").rollDamage({}, D, M), () => [], { actorDoc: C, type: "damage" });
  await test("Goblin damage (NPC)", () => goblinAttack.rollDamage({}, D, M), () => [], { actorDoc: goblin, type: "damage" });
  await test("Cyrus Mind Sliver damage", () => activity(C, "Mind Sliver").rollDamage({}, D, M), () => [], { actorDoc: C, type: "damage" });
  await test("Alwen Sacred Flame damage", () => activity(A, "Sacred Flame").rollDamage({}, D, M), () => [], { actorDoc: A, type: "damage" });
  await test("Devlin Magic Missile: one-dart note", () => activity(V, "Magic Missile").rollDamage({}, D, M),
    p => [...need(has(p, /Bonus written into the damage line/), "+1 not explained"), ...need(has(p, /this is one dart/, "notes"), "no one-dart note")], { actorDoc: V, type: "damage" });
  await test("Alwen Healing Word: healing labels", () => A.items.getName("Healing Word").system.activities.find(x => x.type === "heal").rollDamage({}, D, M),
    p => [...need(has(p, /Healing dice/), "not labelled Healing dice"), ...need(!p.rows.some(r => /Damage usually/.test(r.text)), "damage wording on healing")], { actorDoc: A, type: "damage" });

  // Real roll dialog with a situational bonus
  await test("Attack dialog + situational 1d4 + 1", async () => {
    const pr = activity(TH, "Warhammer", "attack").rollAttack({}, {}, M);
    await new Promise(r => setTimeout(r, 700));
    const dlg = [...foundry.applications.instances.values()].find(a => a.constructor.name.includes("RollConfigurationDialog"));
    const sit = dlg?.element.querySelector('input[name="roll.0.situational"]');
    if (sit) { sit.value = "1d4 + 1"; sit.dispatchEvent(new Event("change", { bubbles: true })); }
    await new Promise(r => setTimeout(r, 300));
    [...(dlg?.element.querySelectorAll("button") ?? [])].find(b => /normal/i.test(b.textContent))?.click();
    return pr;
  }, p => need(has(p, /Situational bonus: 1d4 \+ 1 rolled .*\+1/), "situational +1 not shown"), { actorDoc: TH });

  // Real damage dialog: this world rebuilds damage configs with numbers in place of @references
  await test("Damage dialog: Halberd keeps Rage and Strength labels", async () => {
    const pr = activity(T, "Halberd", "attack").rollDamage({}, {}, M);
    await new Promise(r => setTimeout(r, 700));
    const dlg = [...foundry.applications.instances.values()].find(a => a.constructor.name.includes("RollConfigurationDialog"));
    [...(dlg?.element.querySelectorAll("button") ?? [])].find(b => /normal/i.test(b.textContent))?.click();
    return pr;
  }, p => [...need(has(p, /Damage bonus: Rage/), "Rage not named"), ...need(has(p, /Strength modifier/), "Strength modifier not named"),
    ...need(!p.rows.some(r => /\.hp\.|\.ac\./.test(r.label)), "matched an HP or AC effect")], { actorDoc: T, type: "damage" });

  // Privacy
  await test("Hidden roll shows no panel", () => TH.rollAbilityCheck({ ability: "str" }, D, M), () => [], { actorDoc: TH, visible: false });

  // Advanced detail hides rule text (die row keeps kept/dropped detail)
  const before = game.settings.get(MOD, "detail");
  await game.settings.set(MOD, "detail", "advanced");
  await test("Advanced detail hides rule text", () => TH.rollAbilityCheck({ ability: "str" }, D, M), p => need(p.textCount <= 1, `rule text shown in advanced (${p.textCount})`), { actorDoc: TH });
  await game.settings.set(MOD, "detail", before);

  // System health
  const t0 = performance.now();
  let renderErrors = 0;
  for (const m of game.messages.contents) { try { await m.renderHTML(); } catch (e) { renderErrors++; } }
  const renderAllMs = Math.round(performance.now() - t0);
  results.push({ name: `Re-render ${game.messages.size} chat messages`, status: renderErrors ? "failed" : "passed", why: renderErrors ? `${renderErrors} errors` : `${renderAllMs} ms` });
  const dupes = ["dnd5e.postBuildRollConfig", "dnd5e.postRollConfiguration", "dnd5e.preConfigureInitiative", "dnd5e.renderChatMessage"]
    .filter(h => (Hooks.events[h] ?? []).filter(x => /rollLessons|injectPanels|buildLessons/.test(String(x.fn))).length !== 1);
  results.push({ name: "One listener per hook", status: dupes.length ? "failed" : "passed", why: dupes.join(", ") });
  const hasSelector = [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => r.selectorText?.includes(":has(> .roll-lessons)")); } catch { return false; } });
  results.push({ name: "No page-wide :has() style rule", status: hasSelector ? "failed" : "passed", why: "" });

  // Not testable without changing world data
  for (const name of ["Death save (needs a character at 0 HP)", "Hit Die roll (spends a Hit Die)", "Expertise / Jack of All Trades (no character has them)", "Custom rule text and GM-only setting (world settings)"]) {
    results.push({ name, status: "skipped", why: "would change world data or no test subject" });
  }

  const count = s => results.filter(r => r.status === s).length;
  const summary = { version: game.modules.get(MOD)?.version, passed: count("passed"), failed: count("failed"), skipped: count("skipped"), results };
  console.log("roll-lessons | QA", summary);
  return summary;
})();
