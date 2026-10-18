import { MODULE_ID, cfg } from "./settings.mjs";
import { isWriter } from "./log.mjs";
import { CHANNEL } from "./report.mjs";
import { normalizeKey } from "./effects.mjs";

/*
 * Effect check on spell and feature cards (Rage, Mage Armor, Bless, Shield...).
 * dnd5e only applies a card's effects when someone clicks Apply, only to selected tokens (or recorded
 * targets), and silently skips creatures the clicking player does not own. So effects are often never
 * applied and their modifiers never count. This box says which effects are missing on which creatures,
 * why it matters, and applies them with one click. A player's click on a creature they don't own is
 * sent to the GM's browser, which applies it.
 * Effect data is prepared the same way dnd5e 6.0.6 does (EffectApplicationElement#_prepareEffectData).
 */

const loc = key => game.i18n.localize(`ROLLLESSONS.apply.${key}`);
const fmt = (key, data) => game.i18n.format(`ROLLLESSONS.apply.${key}`, data);
const FLAG = "effectsApplied";
const HOUR = 3600000;
const SECONDS = { seconds: 1, minutes: 60, hours: 3600, days: 86400, rounds: 6, turns: 6 };

function docFrom(uuid) {
  if (!uuid) return null;
  try { return fromUuidSync(uuid, { strict: false }) ?? null; } catch (err) { return null; }
}

const norm = s => String(s ?? "").toLowerCase().replace(/armour/g, "armor").replace(/[^a-z]/g, "");

/** What a change does, in a few words, for the "why it matters" line. */
function changeWords(effect) {
  const out = new Set();
  for (const ch of effect?.changes ?? []) {
    const k = normalizeKey(ch.key);
    if (/\.ac\.(calc|formula)$/.test(k) || /\.ac\.(bonus|flat|value)$/.test(k) || /attributes\.ac/.test(k)) out.add(loc("w_ac"));
    else if (/save\.(roll\.)?bonus$|rolls\.ability\.save/.test(k)) out.add(loc("w_saves"));
    else if (/rolls\.attack|\.attack\.roll/.test(k)) out.add(loc("w_attacks"));
    else if (/rolls\.damage/.test(k)) out.add(loc("w_damage"));
    else if (/check\.roll|rolls\.ability\.(check|skill|tool)|skills\./.test(k)) out.add(loc("w_checks"));
    else if (/traits\.(dr|di|dv)/.test(k)) out.add(loc("w_resist"));
    else if (/\.mode$/.test(k)) out.add(loc("w_advantage"));
    else if (/movement/.test(k)) out.add(loc("w_speed"));
  }
  return [...out];
}

/** Effect templates on the card that should end up on creatures. */
function cardEffects(message) {
  if (message?.type !== "usage") return null;
  let activity;
  try { activity = message.getAssociatedActivity?.(); } catch (err) { activity = null; }
  activity ??= docFrom(message.system?.activity?.uuid);
  // Effects from saves and attacks land only on a failed save or a hit; enchantments go on items.
  if (!activity || !["utility", "heal"].includes(activity.type)) return null;
  const effects = (activity.effects ?? []).map(e => e.effect ?? docFrom(e.uuid)).filter(Boolean);
  if (!effects.length) return null;
  return { activity, effects, caster: activity.actor ?? message.getAssociatedActor?.() ?? null, item: activity.item };
}

function isSelf(activity) {
  return activity.target?.affects?.type === "self" || activity.range?.units === "self";
}

/** How long the card stays checked: the effect's duration, at least one hour. */
function windowMs(effects) {
  let max = HOUR;
  for (const e of effects) {
    const d = e.duration ?? {};
    const sec = Number(d.value) * (SECONDS[d.units] ?? 0) || Number(d.seconds) || 0;
    max = Math.max(max, sec * 1000);
  }
  return max;
}

/** The copy of `template` on `actor`, if any, and its state. */
export function effectState(template, actor, activity) {
  const list = [...(actor?.effects ?? [])];
  let found = list.find(e => e._stats?.duplicateSource === template.uuid || e._stats?.compendiumSource === template.uuid
    || (activity && (e.system?.origin?.activity === activity.uuid || e.origin === activity.uuid) && norm(e.name) === norm(template.name)));
  if (found) return { state: found.disabled ? "off" : "ok", effect: found };
  found = list.find(e => norm(e.name) === norm(template.name));
  if (!found) return { state: "missing" };
  const hasChanges = (found.changes ?? []).length > 0;
  const needs = (template.changes ?? []).length > 0;
  if (needs && !hasChanges) return { state: "empty", effect: found };
  return { state: found.disabled ? "off" : "ok", effect: found };
}

/** Who each effect is for, and which are missing. */
export function checkCard(message) {
  const card = cardEffects(message);
  if (!card) return null;
  const { activity, effects, caster } = card;
  const self = isSelf(activity);
  const targets = (message.system?.targets ?? []).map(t => docFrom(t.actor) ?? docFrom(t.token)?.actor).filter(Boolean);
  const recipients = self ? (caster ? [caster] : []) : targets;
  const problems = [];
  for (const actor of recipients) {
    for (const template of effects) {
      const s = effectState(template, actor, activity);
      if (s.state !== "ok") problems.push({ actor, template, ...s });
    }
  }
  const affects = activity.target?.affects?.type;
  return {
    ...card, self, recipients, problems,
    noTargets: !self && !targets.length,
    canSelf: !self && caster && ["willing", "ally", "creature", "any", ""].includes(affects ?? "") && activity.range?.units === "touch"
  };
}

/** Same data dnd5e builds when its Apply button is clicked. */
async function prepareEffectData(message, template, actor) {
  const originActor = message.getAssociatedActor?.();
  const concentration = originActor?.effects.get(message.system?.concentration);
  const item = message.getAssociatedItem?.({ scaled: true });
  const activity = message.getAssociatedActivity?.({ scaled: true });
  const sourceKey = template.inCompendium ? "compendiumSource" : "duplicateSource";
  const changes = activity?.getAppliedEffectChanges?.(template, { chatMessage: message, target: actor }) ?? {};
  foundry.utils.mergeObject(changes, {
    flags: { dnd5e: { dependentOn: concentration?.uuid, scaling: message.system?.scaling, spellLevel: message.system?.level } },
    system: { origin: {
      [activity ? "activity" : "item"]: activity ? activity.uuid : item?.uuid,
      effect: concentration?.uuid,
      message: message.uuid,
      profile: activity ? activity.effects?.find(e => (e.uuid === template.uuid) || (e._id === template.id))?._id : undefined
    } }
  });
  const existing = actor.effects.find(e => e._stats?.[sourceKey] === template.uuid);
  if (existing) {
    return { action: "update", data: foundry.utils.mergeObject({
      _id: existing.id, disabled: false, duration: { expired: false }, start: template.constructor.getEffectStart?.()
    }, changes) };
  }
  const data = foundry.utils.mergeObject({
    ...template.toObject(), disabled: false, transfer: false,
    _stats: { [sourceKey]: template.uuid, [template.inCompendium ? "duplicateSource" : "compendiumSource"]: null }
  }, changes);
  if (data.system?.changes && ActiveEffect.implementation.forApplication) {
    data.system.changes = await ActiveEffect.implementation.forApplication(data.system.changes, activity ?? item ?? originActor, actor);
  }
  return { action: "create", data };
}

/** Apply on this browser. Replaces an empty hand-made copy. Returns the number applied. */
async function applyHere(message, actors) {
  const card = cardEffects(message);
  if (!card) return 0;
  let n = 0;
  for (const actor of actors) {
    if (!game.user.isGM && !actor.isOwner) continue;
    for (const template of card.effects) {
      const s = effectState(template, actor, card.activity);
      if (s.state === "ok") continue;
      if (s.state === "empty") await s.effect.delete();
      if (s.state === "off" && s.effect && !s.effect._stats?.duplicateSource && !s.effect._stats?.compendiumSource) {
        await s.effect.update({ disabled: false });
        n++;
        continue;
      }
      const op = await prepareEffectData(message, template, actor);
      if (op.action === "update") await actor.effects.get(op.data._id)?.update(op.data);
      else await ActiveEffect.implementation.create(op.data, { parent: actor });
      n++;
    }
  }
  return n;
}

/** Apply, sending creatures this user doesn't own to the GM. */
export async function apply(message, actors) {
  const own = actors.filter(a => game.user.isGM || a.isOwner);
  const others = actors.filter(a => !own.includes(a));
  let n = await applyHere(message, own);
  if (others.length) {
    if (!game.users?.activeGM) ui.notifications.warn(loc("noGM"));
    else {
      game.socket.emit(CHANNEL, { action: "applyEffects", message: message.id, actors: others.map(a => a.uuid), from: game.user.id });
      n += others.length;
    }
  }
  if (n) ui.notifications.info(fmt("done", { count: n }));
  return n;
}

export function onApplySocket(data) {
  if (data?.action !== "applyEffects" || !isWriter()) return;
  const message = game.messages.get(data.message);
  const actors = (data.actors ?? []).map(docFrom).map(d => d?.actor ?? d).filter(Boolean);
  if (message && actors.length) applyHere(message, actors).catch(err => console.error(`${MODULE_ID} | apply failed`, err));
}

function button(label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", async ev => {
    ev.preventDefault();
    ev.stopPropagation();
    b.disabled = true;
    try { await onClick(); } catch (err) { console.error(`${MODULE_ID} | apply failed`, err); ui.notifications.error(loc("failed")); }
    b.disabled = false;
  });
  return b;
}

function line(text, cls) {
  const p = document.createElement("p");
  if (cls) p.className = cls;
  p.textContent = text;
  return p;
}

/** The box under a spell or feature card. Shown to the GM and the card's author. */
export function applyBox(message) {
  const c = checkCard(message);
  if (!c) return null;
  if (!c.problems.length && !c.noTargets) {
    if (c.recipients.length && !message.getFlag?.(MODULE_ID, FLAG) && (message.isOwner || game.user.isGM)) {
      message.setFlag(MODULE_ID, FLAG, true).catch(() => {});
    }
    return null;
  }
  const box = document.createElement("div");
  box.className = "rl-apply";
  box.dataset.messageId = message.id;
  const itemName = c.item?.name ?? "";
  const words = [...new Set(c.effects.flatMap(changeWords))];
  const why = words.length ? fmt("why", { what: words.join(", ") }) : loc("whyGeneric");
  box.append(line(loc("title"), "rl-apply-title"));

  const byState = {};
  for (const p of c.problems) (byState[p.state] ??= []).push(p);
  for (const [state, list] of Object.entries(byState)) {
    const names = [...new Set(list.map(p => p.actor.name))].join(", ");
    const effects = [...new Set(list.map(p => p.template.name))].join(", ");
    box.append(line(fmt(`state_${state}`, { effect: effects, names, item: itemName }), "rl-warn"));
  }
  if (c.problems.length) {
    box.append(line(why));
    const actors = [...new Set(c.problems.map(p => p.actor))];
    box.append(line(fmt("fixApply", { names: actors.map(a => a.name).join(", ") }), "rl-fix"));
    box.append(button(fmt("applyTo", { names: actors.map(a => a.name).join(", ") }), () => apply(message, actors)));
  }
  if (c.noTargets) {
    box.append(line(fmt("noTargets", { item: itemName, effect: c.effects.map(e => e.name).join(", ") }), "rl-warn"));
    box.append(line(why));
    box.append(line(loc("fixTargets"), "rl-fix"));
    box.append(button(loc("applyMyTargets"), () => {
      const actors = [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
      if (!actors.length) { ui.notifications.warn(loc("noneTargeted")); return 0; }
      return apply(message, actors);
    }));
    if (c.canSelf) box.append(button(fmt("applyTo", { names: c.caster.name }), () => apply(message, [c.caster])));
  }
  return box;
}

function eligible(message) {
  if (!cfg.enabled || !cfg.effectCheck) return false;
  if (!(game.user.isGM || message.isAuthor)) return false;
  if (message.getFlag?.(MODULE_ID, FLAG)) return false;
  const card = cardEffects(message);
  if (!card) return false;
  return Date.now() - (message.timestamp ?? 0) < windowMs(card.effects);
}

export function injectApplyCheck(message, html) {
  try {
    if (!eligible(message)) return;
    html.querySelector(".rl-apply")?.remove();
    const box = applyBox(message);
    if (box) (html.querySelector(".message-content") ?? html).append(box);
  } catch (err) {
    console.error(`${MODULE_ID} | effect check failed`, err);
  }
}

let pending = null;
/** Effects changed somewhere: redraw the boxes still showing in the chat log. */
export function refreshApplyBoxes() {
  clearTimeout(pending);
  pending = setTimeout(() => {
    for (const box of document.querySelectorAll(".rl-apply[data-message-id]")) {
      const message = game.messages.get(box.dataset.messageId);
      const next = message && eligible(message) ? applyBox(message) : null;
      if (next) box.replaceWith(next);
      else box.remove();
    }
  }, 300);
}

export function registerApply() {
  game.socket?.on(CHANNEL, onApplySocket);
  for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) Hooks.on(hook, refreshApplyBoxes);
}

/** Lines and buttons for the GM to-do list: the same check as the card box, without the DOM. */
export function cardTodo(message) {
  if (!cfg.enabled || !cfg.effectCheck) return null;
  const c = checkCard(message);
  if (!c || (!c.problems.length && !c.noTargets)) return null;
  const itemName = c.item?.name ?? "";
  const who = c.caster?.name ?? message.speaker?.alias ?? "";
  const words = [...new Set(c.effects.flatMap(changeWords))];
  const lines = [];
  const actions = [];
  if (c.problems.length) {
    const actors = [...new Set(c.problems.map(p => p.actor))];
    const effects = [...new Set(c.problems.map(p => p.template.name))].join(", ");
    lines.push(fmt("todoMissing", { effect: effects, item: itemName, who, names: actors.map(a => a.name).join(", ") }));
    actions.push({ label: fmt("applyTo", { names: actors.map(a => a.name).join(", ") }), run: () => apply(message, actors) });
  }
  if (c.noTargets) {
    lines.push(fmt("todoNoTargets", { item: itemName, who }));
    actions.push({ label: loc("applyMyTargets"), run: () => {
      const actors = [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
      if (!actors.length) { ui.notifications.warn(loc("noneTargeted")); return 0; }
      return apply(message, actors);
    } });
    if (c.canSelf && c.caster) actions.push({ label: fmt("applyTo", { names: c.caster.name }), run: () => apply(message, [c.caster]) });
  }
  if (words.length) lines.push(fmt("why", { what: words.join(", ") }));
  return { lines, actions };
}
