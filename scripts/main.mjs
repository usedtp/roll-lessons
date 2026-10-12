import { MODULE_ID, cfg, registerSettings, refreshSettings } from "./settings.mjs";
import { RuleBook } from "./rules.mjs";
import { buildLessons, addReasons, kindFromHookNames, restoreParts, repairParts } from "./breakdown.mjs";
import { injectPanels, onRulesLoaded } from "./render.mjs";
import { logMessage, flushLog, LOG_DIR } from "./log.mjs";

Hooks.once("init", () => {
  registerSettings(() => RuleBook.load());
  Hooks.on("dnd5e.postBuildRollConfig", onPostBuildRollConfig);
  Hooks.on("dnd5e.postRollConfiguration", onPostRollConfiguration);
  Hooks.on("dnd5e.preConfigureInitiative", onPreConfigureInitiative);
  Hooks.on("dnd5e.renderChatMessage", injectPanels);
  Hooks.on("createChatMessage", logMessage);
  Hooks.on(`${MODULE_ID}.rulesLoaded`, onRulesLoaded);
  game.modules.get(MODULE_ID).api = { flushLog, LOG_DIR };
});

// Start loading rule text as early as settings allow; panels wait for it (RuleBook.ready).
Hooks.once("setup", () => {
  refreshSettings();
  RuleBook.load();
});

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") {
    cfg.enabled = false;
    ui.notifications.warn(game.i18n.localize("ROLLLESSONS.warn.system"));
  }
});

/** Labelled roll parts per roll process, so rebuilt configs keep their sources. Garbage collected with the process. */
const labelledParts = new WeakMap();

function kindOf(config, roll) {
  const kind = kindFromHookNames(config?.hookNames);
  if (kind !== "generic" || !roll) return kind;
  const name = roll.constructor?.name;
  return name === "DamageRoll" ? "damage" : name === "D20Roll" ? "d20" : kind;
}

/**
 * Each roll config is final here, with or without the roll dialog. The stamp rides into the roll
 * through config.options. Fires once per hook name, so only the generic "" pass is used.
 */
function onPostBuildRollConfig(process, rc, index = 0) {
  if (!cfg.enabled || !rc) return;
  try {
    // Remember the labelled parts from the first build of this roll, keyed by the process config.
    let byIndex = labelledParts.get(process);
    if (!byIndex) labelledParts.set(process, (byIndex = new Map()));
    // Rejoin parts another module split inside brackets (Automated Conditions 5e splits on every "+").
    const parts = repairParts(rc.parts ?? []);
    if (parts.some(p => String(p).includes("@"))) byIndex.set(index, [...parts]);
    const effective = { ...rc, parts: restoreParts(byIndex.get(index), parts, rc.data) };
    rc.options ??= {};
    rc.options.rollLessons = buildLessons(process, effective, kindOf(process));
  } catch (err) {
    console.error(`${MODULE_ID} | postBuildRollConfig failed`, err);
  }
}

/** Rolls exist and advantage is decided. Add reasons, or build everything if the build hook was missed. */
function onPostRollConfiguration(rolls, config) {
  if (!cfg.enabled || !rolls?.length) return;
  rolls.forEach((roll, i) => {
    try {
      const rc = config.rolls?.[i] ?? {};
      let L = roll.options.rollLessons;
      if (L?.v !== 2) L = roll.options.rollLessons = buildLessons(config, rc, kindOf(config, roll));
      addReasons(L, config, rc, roll);
    } catch (err) {
      console.error(`${MODULE_ID} | postRollConfiguration failed`, err);
    }
  });
}

/** Initiative rolled from the combat tracker. */
function onPreConfigureInitiative(actor, rollConfig) {
  if (!cfg.enabled || !rollConfig) return;
  try {
    rollConfig.options ??= {};
    const config = { subject: actor, hookNames: ["initiative"] };
    const L = buildLessons(config, rollConfig, "initiative");
    rollConfig.options.rollLessons = addReasons(L, config, rollConfig, { options: rollConfig.options });
  } catch (err) {
    console.error(`${MODULE_ID} | preConfigureInitiative failed`, err);
  }
}
