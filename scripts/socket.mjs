import { MODULE_ID } from "./settings.mjs";

/*
 * Roll Lessons' own socket, used only to apply effects: a player's Apply click on a creature they don't own
 * is sent to the active GM's browser, which applies it (apply.mjs). Reports go through usedtp Logger.
 */
export const CHANNEL = `module.${MODULE_ID}`;
