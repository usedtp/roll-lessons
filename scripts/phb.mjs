/*
 * Expected sources for each roll type, per the 2024 Player's Handbook.
 * Used to account for numbers that reach Roll Lessons without a dnd5e label.
 */

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function evalBonus(raw, data) {
  const s = String(raw ?? "").trim().replace(/^\+\s*/, "");
  if (!s || /^0+$/.test(s)) return null;
  try {
    const f = Roll.replaceFormulaData(s, data ?? {}, { missing: "0" });
    if (/\d*d\d/i.test(f)) return null;
    if (/^[\d\s+\-*/().]+$/.test(f)) return num(Roll.safeEval(f));
  } catch (err) { /* not a flat bonus */ }
  return null;
}

/**
 * @returns {{key: string, v: number, extra?: string}[]} sources the rules say this roll can contain.
 */
export function expectedSources({ config, rc, x, kind, effectNames }) {
  const out = [];
  const add = (key, v, extra) => { const n = num(v); if (n !== null && n !== 0) out.push({ key, v: n, extra }); };
  const sys = x.actor?.system;
  const sub = config?.subject;
  const item = x.item;
  const data = rc?.data ?? {};
  const mod = num(x.c.m);
  const prof = num(x.c.p);
  let actionType;
  try { actionType = sub?.getActionType?.(rc?.options?.attackMode ?? config?.attackMode); } catch (err) { /* none */ }

  if (kind === "attack") {
    if (mod !== null) out.push({ key: "mod.attack", v: mod });
    const isSpell = item?.type === "spell" || sub?.attack?.type?.classification === "spell";
    const mult = isSpell ? 1 : num(item?.system?.prof?.multiplier) ?? 0;
    if (prof !== null && mult > 0) add("prof.attack", Math.floor(prof * mult));
    if (item?.system?.magicAvailable) add("weaponMagic", num(item.system.magicalBonus));
    add("bonus", evalBonus(sub?.attack?.bonus, data));
    if (actionType && sys) {
      const names = effectNames(x.actor, k => k === `system.bonuses.${actionType}.attack` || k.startsWith("system.rolls.attack"));
      add("actorAttackBonus", evalBonus(sys.bonuses?.[actionType]?.attack, data), names);
    }
  } else if (kind === "damage") {
    if (mod !== null) out.push({ key: "mod.damage", v: mod });
    if (item?.system?.magicAvailable) add("magicalBonus", num(item.system.magicalBonus));
    add("itemDamageBonus", evalBonus(item?.system?.damage?.bonus, data), item?.name);
    for (const p of sub?.damage?.parts ?? []) add("damageLineBonus", evalBonus(p?.bonus, data), `${item?.name ?? sub?.name}: ${p?.formula}`);
    const base = item?.system?.damage?.base;
    if (base?.bonus) add("damageLineBonus", evalBonus(base.bonus, data), `${item?.name}: ${base.formula}`);
    if (actionType && sys) {
      const names = effectNames(x.actor, k => k === `system.bonuses.${actionType}.damage` || k.startsWith(`system.rolls.damage.${actionType}`));
      add("actorDamageBonus", evalBonus(sys.bonuses?.[actionType]?.damage, data), names);
      add("actorDamageBonus", evalBonus(sys.rolls?.damage?.[actionType]?.bonus, data), names);
    }
  } else if (["save", "check", "skill", "tool", "initiative", "concentration", "death"].includes(kind)) {
    if (mod !== null) out.push({ key: "mod", v: mod });
    const p = kind === "skill" ? sys?.skills?.[x.skill]?.prof
      : kind === "tool" ? sys?.tools?.[x.tool]?.prof
      : kind === "save" || kind === "concentration" ? sys?.abilities?.[x.abilityId]?.save?.prof
      : kind === "initiative" ? sys?.attributes?.init?.prof
      : sys?.abilities?.[x.abilityId]?.check?.prof;
    const flat = num(p?.flat) ?? (prof !== null && num(p?.multiplier) ? Math.floor(prof * p.multiplier) : null);
    const key = p?.multiplier === 2 ? "prof.expertise" : p?.multiplier === 0.5 ? "prof.half" : "prof.proficient";
    add(key, flat);
    if (kind === "save") add("bonus", evalBonus(sys?.bonuses?.abilities?.save, data), effectNames(x.actor, k => k === "system.bonuses.abilities.save"));
    if (["check", "skill", "tool"].includes(kind)) add("bonus", evalBonus(sys?.bonuses?.abilities?.check, data), effectNames(x.actor, k => k === "system.bonuses.abilities.check"));
    if (kind === "initiative") add("bonus", evalBonus(sys?.attributes?.init?.bonus, data), effectNames(x.actor, k => k === "system.attributes.init.bonus"));
  }
  return out;
}

/**
 * Smallest set of unused sources (2 to 4) whose values add up to `target`.
 * @returns {number[]|null} indexes into `sources`
 */
export function findCombination(sources, target, used) {
  const free = sources.map((s, i) => i).filter(i => !used.has(i));
  for (let size = 2; size <= Math.min(4, free.length); size++) {
    const pick = [];
    const search = start => {
      if (pick.length === size) return pick.reduce((a, i) => a + sources[i].v, 0) === target;
      for (let j = start; j < free.length; j++) {
        pick.push(free[j]);
        if (search(j + 1)) return true;
        pick.pop();
      }
      return false;
    };
    if (search(0)) return [...pick];
  }
  return null;
}
