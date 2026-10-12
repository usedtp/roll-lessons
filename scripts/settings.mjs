export const MODULE_ID = "roll-lessons";

/** Cached setting values. Updated on change so hot paths never call game.settings.get. */
export const cfg = {
  enabled: true,
  visibility: "all",
  detail: "beginner",
  expanded: false,
  debug: false,
  rollLog: true,
  hideZeroDamage: true
};

export function registerSettings(onRulesChange) {
  const reg = (key, data) => {
    game.settings.register(MODULE_ID, key, {
      name: `ROLLLESSONS.settings.${key}.name`,
      hint: `ROLLLESSONS.settings.${key}.hint`,
      config: true,
      onChange: v => { if (key in cfg) cfg[key] = v; },
      ...data
    });
  };

  reg("enabled", { scope: "world", type: Boolean, default: true });
  reg("visibility", {
    scope: "world", type: String, default: "all",
    choices: { all: "ROLLLESSONS.settings.visibility.all", gm: "ROLLLESSONS.settings.visibility.gm" }
  });
  reg("detail", {
    scope: "client", type: String, default: "beginner",
    choices: { beginner: "ROLLLESSONS.settings.detail.beginner", advanced: "ROLLLESSONS.settings.detail.advanced" }
  });
  reg("expanded", { scope: "client", type: Boolean, default: false });
  reg("customRules", { scope: "world", type: String, default: "", onChange: () => onRulesChange?.() });
  reg("debug", { scope: "client", type: Boolean, default: false });
  reg("rollLog", { scope: "world", type: Boolean, default: true, restricted: true });
  reg("hideZeroDamage", { scope: "world", type: Boolean, default: true });
}

/** Read all cached values. Called once settings storage is fully loaded. */
export function refreshSettings() {
  for (const key of Object.keys(cfg)) cfg[key] = game.settings.get(MODULE_ID, key);
}
