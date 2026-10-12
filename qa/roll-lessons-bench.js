/*
 * Roll Lessons test bench. Run as a GM through the browser.
 * Builds (once) the "Roll Lessons QA" folder, NPCs and scene, then rolls every weapon and spell
 * against QA targets and checks every breakdown against the 2024 Player's Handbook rules.
 * Test chat messages are whispered to GMs and deleted at the end of the run.
 *
 * Options (set before running): window.__rlBench = { phases: ["setup","weapons","spells","ui","log"],
 *   spellLimit: Infinity, weaponLimit: Infinity, keepMessages: false }
 * Returns a summary; full results are kept in window.__rlBenchResults.
 */
(async () => {
  const MOD = "roll-lessons";
  const QA = "Roll Lessons QA";
  const opt = Object.assign({ phases: ["setup", "weapons", "spells", "ui", "log"], spellLimit: Infinity, weaponLimit: Infinity, keepMessages: false }, window.__rlBench ?? {});
  const D = { configure: false };
  const PRIVATE = CONST.DICE_ROLL_MODES?.PRIVATE ?? "gmroll";
  const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
  const msg = () => ({ create: true, rollMode: PRIVATE, data: { whisper: gmIds } });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const results = [];
  const created = new Set();
  const hook = Hooks.on("createChatMessage", m => created.add(m.id));
  const startedAt = Date.now();
  const abilityLabel = id => CONFIG.DND5E.abilities[id]?.label ?? id;
  const record = (area, name, issues, extra = {}) => results.push({ area, name, status: issues.length ? "failed" : "passed", why: issues.join("; "), ...extra });

  /* ---------- Panel reading and checks ---------- */

  async function panelsOf(message, { summaries = false } = {}) {
    const html = await message.renderHTML();
    const sel = summaries ? ".roll-lessons.rl-summary" : ".roll-lessons:not(.rl-summary)";
    return [...html.querySelectorAll(sel)].map(p => {
      p.open = true;
      p.dispatchEvent(new Event("toggle"));
      return {
        rows: [...p.querySelectorAll(".rl-row")].map(r => ({
          v: r.querySelector(".rl-value").textContent.trim(),
          label: r.querySelector(".rl-label").textContent.trim(),
          text: r.querySelector(".rl-text")?.textContent.trim() ?? "",
          unknown: r.classList.contains("rl-unknown")
        })),
        notes: [...p.querySelectorAll(".rl-note")].map(n => n.textContent.replace(/\s+/g, " ").trim()),
        total: Number(p.querySelector(".rl-total .rl-value")?.textContent)
      };
    });
  }

  function standard(p, roll) {
    const issues = [];
    const sum = p.rows.reduce((a, r) => a + (Number(r.v.replace("+", "")) || 0), 0);
    if (p.total !== roll.total) issues.push(`panel total ${p.total} != roll ${roll.total}`);
    if (sum !== roll.total) issues.push(`rows add to ${sum}, roll ${roll.total}`);
    for (const r of p.rows) {
      if (r.unknown || /Source not found|Unnamed effect|Not identified|Not from a Player's Handbook rule|Added after the roll/.test(r.label)) issues.push(`unexplained: ${r.v} ${r.label}`);
      if (/hp\.|\.ac\./i.test(r.label)) issues.push(`hit point or AC effect as source: ${r.label}`);
      if (r.v === "+0" && !/modifier|Proficiency|No proficiency/i.test(r.label)) issues.push(`zero row: ${r.label}`);
    }
    return issues;
  }

  const row = (p, re) => p.rows.find(r => re.test(r.label));
  const noteHas = (p, re) => p.notes.some(n => re.test(n));

  async function checkMessage(area, name, message, oracle = () => []) {
    if (!message) { record(area, name, ["no chat message"]); return; }
    let panels;
    try { panels = await panelsOf(message); } catch (err) { record(area, name, [`render error: ${err.message}`]); return; }
    if (!panels.length) { record(area, name, ["no panel"]); return; }
    message.rolls.forEach((roll, i) => {
      const p = panels[i];
      if (!p) { record(area, `${name} [roll ${i}]`, ["missing panel"]); return; }
      const issues = [...standard(p, roll), ...oracle(p, roll, message)];
      record(area, name + (message.rolls.length > 1 ? ` [roll ${i}]` : ""), issues, { message: message.id, formula: roll.formula, total: roll.total, rows: p.rows.map(r => `${r.v} ${r.label}`), notes: p.notes });
    });
  }

  /* ---------- Setup ---------- */

  async function compendiumItems(kind) {
    const byName = new Map();
    const packs = game.packs.filter(p => p.documentName === "Item").sort((a, b) => (b.collection.includes("players-handbook") ? 1 : 0) - (a.collection.includes("players-handbook") ? 1 : 0));
    for (const pack of packs) {
      const index = await pack.getIndex({ fields: ["type", "system.type.value", "system.level"] });
      for (const e of index) {
        if (e.type !== kind || byName.has(e.name)) continue;
        if (kind === "weapon" && !["simpleM", "simpleR", "martialM", "martialR"].includes(e.system?.type?.value)) continue;
        byName.set(e.name, { pack, id: e._id });
      }
    }
    const docs = [];
    for (const [, ref] of byName) {
      const d = await ref.pack.getDocument(ref.id);
      if (d) docs.push(d.toObject());
    }
    return docs;
  }

  const ab = (str, dex, con, int, wis, cha) => ({ str: { value: str }, dex: { value: dex }, con: { value: con }, int: { value: int }, wis: { value: wis }, cha: { value: cha } });
  const slots = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => [`spell${n}`, { value: 4, override: 4 }]));
  const allSaves = mode => ["str", "dex", "con", "int", "wis", "cha"].map(a => ({ key: `system.abilities.${a}.save.roll.mode`, type: "add", value: mode }));

  async function setup() {
    let folder = game.folders.find(f => f.type === "Actor" && f.name === QA) ?? await Folder.create({ name: QA, type: "Actor" });
    const existing = name => game.actors.find(a => a.name === name && a.folder?.id === folder.id);
    const weapons = (await compendiumItems("weapon")).slice(0, opt.weaponLimit);
    const spells = (await compendiumItems("spell")).slice(0, opt.spellLimit);
    const weaponItems = proficient => weapons.map(w => { const o = foundry.utils.deepClone(w); delete o._id; o.system.proficient = proficient; return o; });
    const spellItems = () => spells.map(s => { const o = foundry.utils.deepClone(s); delete o._id; return o; });
    const defs = [
      { name: "QA Strength Fighter", system: { abilities: ab(18, 12, 14, 10, 10, 10) }, items: () => weaponItems(1) },
      { name: "QA Dexterity Fighter", system: { abilities: ab(10, 18, 14, 10, 10, 10) }, items: () => weaponItems(1) },
      { name: "QA Unproficient", system: { abilities: ab(18, 12, 14, 10, 10, 10) }, items: () => weaponItems(0) },
      { name: "QA Barbarian (raging)", system: { abilities: ab(18, 14, 16, 8, 10, 10) }, items: () => weaponItems(1),
        effects: [{ name: "Rage", img: "icons/svg/terror.svg", changes: [
          { key: "system.bonuses.mwak.damage", type: "add", value: "+2" },
          { key: "system.traits.dr.value", type: "add", value: "bludgeoning" },
          { key: "system.traits.dr.value", type: "add", value: "piercing" },
          { key: "system.traits.dr.value", type: "add", value: "slashing" },
          { key: "system.abilities.str.check.roll.mode", type: "add", value: 1 },
          { key: "system.abilities.str.save.roll.mode", type: "add", value: 1 }] }] },
      { name: "QA Caster", system: { abilities: ab(10, 12, 14, 18, 10, 10), attributes: { spellcasting: "int" }, spells: slots, details: { spellLevel: 9 } }, items: spellItems },
      { name: "QA Target, plain", system: { abilities: ab(10, 10, 10, 10, 10, 10), attributes: { ac: { calc: "flat", flat: 12 }, hp: { value: 200, max: 200 } } }, items: () => [] },
      { name: "QA Target, defended", system: { abilities: { ...ab(10, 10, 10, 10, 10, 10), wis: { value: 10, proficient: 1 } }, attributes: { ac: { calc: "flat", flat: 16 }, hp: { value: 200, max: 200 } },
        traits: { dr: { value: ["bludgeoning", "piercing", "slashing"] }, di: { value: ["fire"] }, dv: { value: ["cold"] } } }, items: () => [] },
      { name: "QA Target, Magic Resistance", system: { abilities: ab(10, 10, 10, 10, 10, 10), attributes: { ac: { calc: "flat", flat: 14 }, hp: { value: 200, max: 200 } } }, items: () => [],
        effects: [{ name: "Magic Resistance", img: "icons/svg/aura.svg", changes: allSaves(1) }] }
    ];
    for (const d of defs) {
      if (existing(d.name)) continue;
      await Actor.create({ name: d.name, type: "npc", folder: folder.id, system: foundry.utils.mergeObject({ details: { cr: 1 }, attributes: { hp: { value: 100, max: 100 } } }, d.system), items: d.items(), effects: d.effects ?? [] });
    }
    let scene = game.scenes.find(s => s.name === QA);
    if (!scene) scene = await Scene.create({ name: QA, width: 2400, height: 1600, grid: { size: 100 }, padding: 0 });
    const want = defs.map(d => existing(d.name)).filter(Boolean);
    const have = new Set(scene.tokens.map(t => t.actorId));
    const tokens = [];
    want.forEach((a, i) => { if (!have.has(a.id)) tokens.push(foundry.utils.mergeObject(a.prototypeToken.toObject(), { actorId: a.id, actorLink: true, x: 200 + (i % 4) * 300, y: 200 + Math.floor(i / 4) * 400 })); });
    if (tokens.length) await scene.createEmbeddedDocuments("Token", tokens);
    record("setup", "QA folder, NPCs and scene", want.length === defs.length ? [] : [`${want.length}/${defs.length} NPCs`], { weapons: weapons.length, spells: spells.length });
    return { folder, scene };
  }

  const qa = name => game.actors.find(a => a.name === name && a.folder?.name === QA);

  async function viewQA() {
    const scene = game.scenes.find(s => s.name === QA);
    if (canvas.scene?.id !== scene.id) { await scene.view(); await sleep(1500); }
    return scene;
  }

  function target(actorName) {
    const tok = canvas.tokens.placeables.find(t => t.actor?.name === actorName);
    game.user.updateTokenTargets(tok ? [tok.id] : []);
    return tok;
  }

  /* ---------- Weapons ---------- */

  function expectedAttackAbility(actor, item, mode) {
    const props = item.system.properties;
    const ranged = ["simpleR", "martialR"].includes(item.system.type?.value);
    const s = actor.system.abilities.str.mod, d = actor.system.abilities.dex.mod;
    if (props.has("fin")) return s >= d ? "str" : "dex";
    if (ranged) return "dex";
    return "str";
  }

  async function weapons() {
    await viewQA();
    const attackers = ["QA Strength Fighter", "QA Dexterity Fighter", "QA Unproficient", "QA Barbarian (raging)"].map(qa);
    const targets = ["QA Target, plain", "QA Target, defended"];
    for (const actor of attackers) {
      const raging = actor.appliedEffects.some(e => e.name === "Rage");
      for (const item of actor.items.filter(i => i.type === "weapon")) {
        const act = item.system.activities.find(a => a.type === "attack");
        if (!act) continue;
        const props = item.system.properties;
        const modes = ["default"];
        if (props.has("ver")) modes.push("twoHanded");
        if (props.has("thr") && !["simpleR", "martialR"].includes(item.system.type?.value)) modes.push("thrown");
        if (props.has("lgt")) modes.push("offhand");
        for (const tName of targets) {
          target(tName);
          const abil = expectedAttackAbility(actor, item);
          const mod = actor.system.abilities[abil].mod;
          const proficient = item.system.prof?.multiplier >= 1;
          const name = `${actor.name}: ${item.name} vs ${tName}`;
          const atk = await act.rollAttack({}, D, msg());
          await checkMessage("weapon attack", name, atk?.[0]?.parent, p => [
            ...(row(p, new RegExp(`${abilityLabel(abil)} modifier`)) ? [] : [`expected ${abilityLabel(abil)} modifier (PHB: ${props.has("fin") ? "Finesse uses the higher of Str and Dex" : abil === "dex" ? "ranged weapons use Dex" : "melee weapons use Str"})`]),
            ...(row(p, /modifier/)?.v === `${mod >= 0 ? "+" : ""}${mod}` ? [] : [`modifier value ${row(p, /modifier/)?.v}, expected ${mod}`]),
            ...(proficient === !!row(p, /^Proficiency/) ? [] : [proficient ? "proficient but no proficiency row" : "proficiency row without proficiency"]),
            ...(noteHas(p, /Hit\.|Miss\.|Critical Hit|Miss \(natural 1\)/) ? [] : ["no hit or miss outcome"])
          ]);
          for (const mode of modes) {
            for (const crit of [false, true]) {
              if (crit && mode !== "default") continue;
              const cfgD = { isCritical: crit };
              if (mode !== "default") cfgD.attackMode = mode;
              const dmg = await act.rollDamage(cfgD, D, msg());
              const m = dmg?.[0]?.parent;
              const type = dmg?.[0]?.options?.type;
              await checkMessage("weapon damage", `${name} damage (${mode}${crit ? ", critical" : ""})`, m, (p, roll) => {
                const issues = [];
                const modRow = row(p, /modifier/);
                if (mode === "offhand") { if (mod > 0 && modRow) issues.push("off-hand light attack added a positive modifier (PHB Light: no modifier unless negative)"); }
                else if (!modRow && mod !== 0) issues.push(`expected ${abilityLabel(abil)} modifier on damage`);
                const meleeStr = abil === "str" && mode !== "thrown" && !["simpleR", "martialR"].includes(item.system.type?.value);
                if (raging && meleeStr && !row(p, /Rage/)) issues.push("raging Strength melee hit without Rage Damage");
                if (raging && abil === "str" && mode === "thrown" && !noteHas(p, /Rage Damage not added/)) issues.push("thrown Strength attack while raging: Rage gap not flagged");
                if (crit && !row(p, /doubled by the critical hit/)) issues.push("critical dice not marked doubled");
                if (mode === "twoHanded" && !row(p, /Versatile/)) issues.push("two-handed Versatile not labelled");
                if (tName.includes("defended") && ["bludgeoning", "piercing", "slashing"].includes(type)) {
                  const want = Math.floor(roll.total / 2);
                  if (!noteHas(p, new RegExp(`Resistance to .*Takes ${want}\\.`))) issues.push(`no Resistance line with Takes ${want}`);
                }
                return issues;
              });
            }
          }
        }
      }
    }
  }

  /* ---------- Spells ---------- */

  async function setCaster(actor, abil) {
    const abilities = Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(a => [a, { value: a === abil ? 18 : a === "dex" ? 12 : a === "con" ? 14 : 10 }]));
    await actor.update({ "system.abilities": abilities, "system.attributes.spellcasting": abil });
  }

  async function spells() {
    await viewQA();
    const caster = qa("QA Caster");
    const saveTargets = ["QA Target, plain", "QA Target, defended", "QA Target, Magic Resistance"];
    for (const abil of ["int", "wis", "cha"]) {
      await setCaster(caster, abil);
      const mod = caster.system.abilities[abil].mod;
      const prof = caster.system.attributes.prof;
      for (const item of caster.items.filter(i => i.type === "spell")) {
        const base = item.system.level;
        for (const act of item.system.activities) {
          const name = `${item.name} (${act.name || act.type}, ${abilityLabel(abil)} caster)`;
          try {
            if (act.type === "attack") {
              target("QA Target, plain");
              const atk = await act.rollAttack({}, D, msg());
              await checkMessage("spell attack", name, atk?.[0]?.parent, p => [
                ...(row(p, new RegExp(`${abilityLabel(abil)} modifier`))?.v === `${mod >= 0 ? "+" : ""}${mod}` ? [] : [`expected ${abilityLabel(abil)} modifier ${mod} (PHB: spell attacks use the spellcasting ability)`]),
                ...(row(p, /^Proficiency/) ? [] : ["spell attack without proficiency (PHB: spell attack modifier includes Proficiency Bonus)"])
              ]);
            }
            if (act.damage?.parts?.length || act.healing) {
              const levels = abil === "int" && base > 0 ? Array.from({ length: 10 - base }, (_, i) => base + i) : [Math.max(base, 0)];
              for (const lvl of levels) {
                target("QA Target, defended");
                const dmg = await act.rollDamage({ scaling: lvl - base }, D, msg());
                const m = dmg?.[0]?.parent;
                await checkMessage("spell damage", `${name} at level ${lvl}`, m, (p, roll) => {
                  const issues = [];
                  const type = roll.options?.type;
                  if (type === "fire" && !noteHas(p, /Immunity to .*Takes 0\./)) issues.push("fire against Immunity: no Takes 0 line");
                  if (type === "cold" && !noteHas(p, new RegExp(`Vulnerability to .*Takes ${roll.total * 2}\\.`))) issues.push("cold against Vulnerability: no doubled line");
                  if (["bludgeoning", "piercing", "slashing"].includes(type) && !noteHas(p, new RegExp(`Resistance to .*Takes ${Math.floor(roll.total / 2)}\\.`))) issues.push("no Resistance line");
                  return issues;
                });
              }
            }
            if (act.type === "save") {
              target("QA Target, plain");
              const res = await act.use({ consume: false, spell: { slot: base > 0 ? `spell${base}` : undefined } }, D, { create: true, data: { whisper: gmIds } });
              const usage = res?.message ?? game.messages.contents.at(-1);
              const dc = act.save.dc.value;
              for (const tName of saveTargets) {
                const tActor = qa(tName);
                const ability = act.save.ability.first();
                const speaker = ChatMessage.getSpeaker({ actor: tActor });
                await tActor.rollSavingThrow({ ability, target: dc }, D, { create: true, rollMode: PRIVATE, data: { whisper: gmIds, speaker, system: { ...act.messageSources, origin: usage.id } } });
              }
              await sleep(200);
              const panels = await panelsOf(usage, { summaries: true });
              const saveMsgs = game.messages.contents.filter(m => m.system?.origin === usage.id);
              const issues = [];
              if (panels.length < saveTargets.length) issues.push(`summary panels ${panels.length}/${saveTargets.length}`);
              const expectedDC = 8 + mod + prof;
              panels.forEach((p, i) => {
                const roll = saveMsgs[i]?.rolls?.[0];
                if (!roll) return;
                issues.push(...standard(p, roll).map(s => `${saveMsgs[i].speaker.alias}: ${s}`));
                if (dc === expectedDC && !noteHas(p, new RegExp(`DC ${dc} = 8 \\+ .*${abilityLabel(abil)} modifier`))) issues.push("DC build line missing (PHB: 8 + spellcasting modifier + Proficiency Bonus)");
                const ok = roll.isSuccess ?? roll.total >= dc;
                if (!noteHas(p, ok ? /Succeeded:/ : /Failed:/)) issues.push(`${saveMsgs[i].speaker.alias}: outcome line wrong or missing`);
                const tProf = saveMsgs[i].speaker.alias === "QA Target, defended" && ability === "wis";
                if (!tProf && !row(p, /No proficiency/)) issues.push(`${saveMsgs[i].speaker.alias}: no "No proficiency" row`);
              });
              record("spell save", name, issues, { message: usage?.id });
            }
          } catch (err) {
            record("spell", name, [`error: ${err.message}`]);
          }
        }
      }
    }
    await setCaster(caster, "int");
  }

  /* ---------- Real interface clicks ---------- */

  async function clickNormal() {
    await sleep(600);
    const dlg = [...foundry.applications.instances.values()].find(a => a.constructor.name.includes("RollConfigurationDialog"));
    [...(dlg?.element.querySelectorAll("button") ?? [])].find(b => /normal/i.test(b.textContent))?.click();
    await sleep(800);
  }

  async function ui() {
    await viewQA();
    const fighter = qa("QA Strength Fighter");
    const item = fighter.items.find(i => i.name === "Longsword") ?? fighter.items.find(i => i.type === "weapon");
    target("QA Target, defended");
    const before = new Set(game.messages.keys());
    await item.system.activities.find(a => a.type === "attack").use({}, D, { create: true, data: { whisper: gmIds } });
    await sleep(800);
    const card = game.messages.contents.find(m => !before.has(m.id) && m.type === "usage");
    const el = () => document.querySelector(`[data-message-id="${card?.id}"]`);
    el()?.querySelector('[data-action="rollAttack"]')?.click();
    await clickNormal();
    el()?.querySelector('[data-action="rollDamage"]')?.click();
    await clickNormal();
    const fresh = game.messages.contents.filter(m => !before.has(m.id) && m.isRoll);
    for (const m of fresh) await checkMessage("ui", `clicked ${item.name} ${m.flavor}`, m);
    const dom = fresh.map(m => document.querySelector(`[data-message-id="${m.id}"] .roll-lessons`));
    record("ui", "panels drawn in the chat log", dom.every(Boolean) ? [] : ["panel missing from chat log DOM"]);
    window.__rlBenchUi = fresh.map(m => m.id);
  }

  /* ---------- Log ---------- */

  async function log() {
    const api = game.modules.get(MOD)?.api;
    const n = await api?.flushLog?.();
    const day = new Date().toISOString().slice(0, 10);
    const res = await fetch(foundry.utils.getRoute(`${api?.LOG_DIR}/${day}.json`) + `?t=${Date.now()}`, { cache: "no-store" });
    const entries = res.ok ? await res.json() : [];
    const ids = new Set(entries.map(e => e.message));
    const ours = [...created].filter(id => game.messages.get(id)?.rolls?.some(r => r.options?.rollLessons));
    const logged = ours.filter(id => ids.has(id)).length;
    record("log", "roll log written and readable", res.ok && (logged > 0 || !ours.length) ? [] : [`log ${res.status}, ${logged}/${ours.length} logged`], { flushed: n, entries: entries.length });
  }

  /* ---------- Run ---------- */

  const previousScene = canvas.scene?.id;
  try {
    if (opt.phases.includes("setup")) await setup();
    if (opt.phases.includes("weapons")) await weapons();
    if (opt.phases.includes("spells")) await spells();
    if (opt.phases.includes("ui")) await ui();
    if (opt.phases.includes("log")) await log();
  } catch (err) {
    record("bench", "run", [`stopped: ${err.message}`]);
  } finally {
    Hooks.off("createChatMessage", hook);
    game.user.updateTokenTargets([]);
    if (!opt.keepMessages && created.size) await ChatMessage.deleteDocuments([...created].filter(id => game.messages.has(id)));
    if (previousScene && canvas.scene?.id !== previousScene) await game.scenes.get(previousScene)?.view();
  }

  window.__rlBenchResults = results;
  const by = s => results.filter(r => r.status === s).length;
  const areas = {};
  for (const r of results) { areas[r.area] ??= { passed: 0, failed: 0 }; areas[r.area][r.status]++; }
  return { version: game.modules.get(MOD)?.version, minutes: +((Date.now() - startedAt) / 60000).toFixed(1), passed: by("passed"), failed: by("failed"), areas, messagesDeleted: opt.keepMessages ? 0 : created.size, failures: results.filter(r => r.status === "failed").slice(0, 60).map(r => `${r.area} | ${r.name} | ${r.why}`) };
})();
