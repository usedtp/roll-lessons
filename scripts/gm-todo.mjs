import { MODULE_ID, cfg } from "./settings.mjs";
import { cardTodo } from "./apply.mjs";

/*
 * GM to-do list: an orange bar at the top of the GM's screen whenever something needs the GM to apply it.
 *  - Effects from spell and feature cards that never reached their creature (Rage, Mage Armor, Bless...).
 *  - Damage or healing rolled against a target whose hit points did not change.
 *  - An effect that is turned off but would have changed a roll just made (Rage turned off).
 * Each item says what is wrong and has the buttons that fix it. Shown to GMs only.
 */

const loc = key => game.i18n.localize(`ROLLLESSONS.todo.${key}`);
const fmt = (key, data) => game.i18n.format(`ROLLLESSONS.todo.${key}`, data);
const CARD_WAIT = 20000;
const DAMAGE_WAIT = 45000;
const items = new Map();
let open = false;

function docFrom(uuid) {
  if (!uuid) return null;
  try { return fromUuidSync(uuid, { strict: false }) ?? null; } catch (err) { return null; }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Add or replace an item. `check` returns false once the problem is gone. */
export function addItem(item) {
  const isNew = !items.has(item.id);
  items.set(item.id, { t: Date.now(), ...item });
  if (isNew) ui.notifications?.warn(fmt("notice", { text: item.lines[0] }));
  draw();
}

function removeItem(id) {
  items.delete(id);
  draw();
}

/** Drop items whose problem is gone. Runs when effects or actors change. */
let pending = null;
export function recheck() {
  clearTimeout(pending);
  pending = setTimeout(() => {
    for (const [id, item] of items) {
      try {
        if (item.check && item.check() === false) items.delete(id);
      } catch (err) { /* keep it */ }
    }
    draw();
  }, 400);
}

function draw() {
  if (!game.user?.isGM) return;
  let bar = document.getElementById("rl-gm-todo");
  if (!items.size) { bar?.remove(); return; }
  if (!bar) {
    bar = el("div");
    bar.id = "rl-gm-todo";
    document.body.append(bar);
  }
  bar.replaceChildren();
  const head = el("button", "rl-todo-head", fmt("head", { count: items.size }));
  head.type = "button";
  head.addEventListener("click", () => { open = !open; draw(); });
  bar.append(head);
  if (!open) return;
  const list = el("div", "rl-todo-list");
  for (const [id, item] of [...items].sort((a, b) => a[1].t - b[1].t)) {
    const card = el("div", "rl-todo-item");
    for (const line of item.lines) card.append(el("p", "", line));
    const buttons = el("div", "rl-todo-buttons");
    for (const a of item.actions ?? []) {
      const b = el("button", "", a.label);
      b.type = "button";
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          await a.run();
          if (a.done !== false) removeItem(id);
        } catch (err) {
          console.error(`${MODULE_ID} | to-do action failed`, err);
          ui.notifications.error(loc("failed"));
          b.disabled = false;
        }
      });
      buttons.append(b);
    }
    if (item.message) {
      const show = el("button", "", loc("show"));
      show.type = "button";
      show.addEventListener("click", () => {
        const node = document.querySelector(`.chat-log [data-message-id="${item.message}"]`);
        node?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      buttons.append(show);
    }
    const dismiss = el("button", "rl-todo-dismiss", loc("dismiss"));
    dismiss.type = "button";
    dismiss.addEventListener("click", () => removeItem(id));
    buttons.append(dismiss);
    card.append(buttons);
    list.append(card);
  }
  bar.append(list);
}

/* ---------- Sources ---------- */

/** A spell or feature card: give players time to click Apply, then check. */
function watchCard(message) {
  setTimeout(() => {
    const todo = cardTodo(message);
    if (!todo) return;
    addItem({ id: `card-${message.id}`, message: message.id, ...todo, check: () => !!cardTodo(message) });
  }, CARD_WAIT);
}

const hpOf = actor => {
  const hp = actor?.system?.attributes?.hp;
  return hp ? `${hp.value}|${hp.temp ?? 0}` : null;
};

/** Damage or healing against targets: if a target's hit points have not changed after a while, say so. */
function watchDamage(message) {
  const rolls = (message.rolls ?? []).filter(r => r.constructor?.name === "DamageRoll" || r.options?.rollLessons?.k === "damage");
  if (!rolls.length) return;
  const targets = (message.system?.targets ?? []).map(t => ({ name: t.name, actor: docFrom(t.actor) ?? docFrom(t.token)?.actor })).filter(t => t.actor);
  if (!targets.length) return;
  const before = targets.map(t => hpOf(t.actor));
  const damages = rolls.map(r => ({ value: r.total ?? 0, type: r.options?.type, properties: new Set(r.options?.properties ?? []) }));
  const total = damages.reduce((a, d) => a + d.value, 0);
  const healing = damages.every(d => ["healing", "temphp"].includes(d.type));
  const types = [...new Set(damages.map(d => CONFIG.DND5E?.damageTypes?.[d.type]?.label ?? CONFIG.DND5E?.healingTypes?.[d.type]?.label ?? d.type).filter(Boolean))].join(", ");
  setTimeout(() => {
    const unchanged = targets.filter((t, i) => hpOf(t.actor) === before[i]);
    if (!unchanged.length || !total) return;
    const names = unchanged.map(t => t.name).join(", ");
    const actions = [{ label: loc(healing ? "applyHealing" : "applyFull"), run: () => Promise.all(unchanged.map(t => t.actor.applyDamage(damages))) }];
    if (!healing) actions.push({ label: loc("applyHalf"), run: () => Promise.all(unchanged.map(t => t.actor.applyDamage(damages, { multiplier: 0.5 }))) });
    addItem({
      id: `dmg-${message.id}`,
      message: message.id,
      lines: [fmt(healing ? "healingNotApplied" : "damageNotApplied", { total, types, names, who: message.speaker?.alias ?? "" }), loc(healing ? "healingWhy" : "damageWhy")],
      actions,
      check: () => unchanged.some((t, i) => hpOf(t.actor) === before[targets.indexOf(t)])
    });
  }, DAMAGE_WAIT);
}

/** A roll that was missing an effect because it is turned off (Rage turned off). */
function watchOff(message) {
  for (const roll of message.rolls ?? []) {
    for (const o of roll.options?.rollLessons?.off ?? []) {
      const effect = docFrom(o.u);
      if (!effect || o.why === "suppressed") continue;
      addItem({
        id: `off-${o.u}`,
        message: message.id,
        lines: [fmt("offEffect", { name: o.n, who: effect.parent?.name ?? message.speaker?.alias ?? "" }), loc("offWhy")],
        actions: [{ label: fmt("turnOn", { name: o.n }), run: () => effect.update({ disabled: false, "duration.expired": false }) }],
        check: () => !!docFrom(o.u)?.disabled
      });
    }
  }
}

export function onCreateMessage(message) {
  if (!game.user?.isGM || !cfg.enabled || !cfg.gmTodo) return;
  if ((game.users?.activeGM?.id ?? game.user.id) !== game.user.id) return;
  try {
    if (message.type === "usage") watchCard(message);
    if (message.isRoll) { watchDamage(message); watchOff(message); }
  } catch (err) {
    console.error(`${MODULE_ID} | to-do check failed`, err);
  }
}

export function registerTodo() {
  if (!game.user?.isGM) return;
  Hooks.on("createChatMessage", onCreateMessage);
  for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "updateActor"]) Hooks.on(hook, recheck);
  // Cards from the last hour that still need applying, after a reload.
  const since = Date.now() - 3600000;
  for (const m of game.messages?.contents ?? []) {
    if (m.type !== "usage" || (m.timestamp ?? 0) < since) continue;
    const todo = cardTodo(m);
    if (todo) items.set(`card-${m.id}`, { t: m.timestamp, id: `card-${m.id}`, message: m.id, ...todo, check: () => !!cardTodo(m) });
  }
  draw();
}
