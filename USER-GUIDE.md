# Roll Lessons User Guide

Roll Lessons adds a collapsible panel under every dnd5e roll in chat. The panel lists each number in the total, where it came from, and the rule behind it.

Requirements: Foundry VTT v14, dnd5e system 6.0.0 or newer (built against 6.0.6).

## Install

1. Find your User Data folder. Foundry's main menu (the setup screen) shows it as User Data Path on the Configuration tab. Defaults:
   - Windows: `%localappdata%/FoundryVTT`
   - macOS: `~/Library/Application Support/FoundryVTT`
   - Linux: `/home/$USER/.local/share/FoundryVTT`
2. Close Foundry completely.
3. Unzip `roll-lessons.zip` into `{User Data}/Data/modules/`. The result must be `Data/modules/roll-lessons/module.json`. If unzipping creates `roll-lessons/roll-lessons/`, move the inner folder up one level.
4. Start Foundry. Roll Lessons now appears on the Add-on Modules tab of the setup screen.
5. Launch your world as GM. Open Game Settings, Manage Modules, tick Roll Lessons, Save Module Settings. Foundry reloads the world.
6. Make a roll. A "How this total was built" header appears under it.

If Foundry runs on a hosting service instead of your computer, upload the `roll-lessons` folder into `Data/modules/` with that service's file manager, then follow steps 4 to 6.

## Rules source

Rule text follows the 2024 Player's Handbook. Where dnd5e's automation differs from the book (for example, Magic Missile rolls one dart), the panel says so.

## Settings

Open Game Settings, Configure Settings, Roll Lessons.

| Setting | Scope | Default | Effect |
|---|---|---|---|
| Enable Roll Lessons | World | On | Turns breakdowns on or off. Only rolls made after enabling carry a breakdown. |
| Who sees the breakdown | World | Everyone | Everyone, or GM only. |
| Detail level | Each user | Beginner | Beginner shows rule text. Advanced shows labels and values only. |
| Open breakdowns by default | Each user | Off | Expands each panel automatically. |
| Custom rule text (JSON) | World | Empty | Overrides wording. Applies on save, also to old messages. |
| Debug logging | Each user | Off | Writes roll details to the browser console. |

## Reading a panel

Click "How this total was built" under a roll. The panel content is built the first time you open it.

- Die: the d20 result that counted, plus any dropped die from advantage or disadvantage.
- Advantage or Disadvantage box: lists the effects found that cause it. If none is found, the panel says dnd5e did not report a reason. It may have been picked in the roll dialog or with a held key.
- Modifier rows: one per modifier, with the signed value, its name, and the rule text. Examples: ability modifier, proficiency bonus, Expertise (proficiency counted double), half proficiency, magic weapon bonus, cover, condition penalties, situational bonus.
- Rows in italics: a value the module could not name. The number is still correct.
- "Fixed number in the damage formula": a number typed into the weapon or activity damage formula. If it matches an ability modifier, the panel says so and how to replace it with @mod.
- "Damage bonus: <effect>": a damage bonus from an effect such as Rage, named by the effect that sets it.
- Every loose number is traced in this order: the character's damage bonus for the attack type, the weapon's damage bonus, the activity's own damage parts, every bonus setting on the character, then every active effect on the character and the item. The row names the first match.
- "Source not found": shown only when none of those hold the number. It lists what was checked and the exact roll part. That means another module or a manual edit added it.
- Active traits: Halfling Lucky, Elven Accuracy, Reliable Talent, minimum or maximum die results, extended critical range.
- Natural 1 box: appears when an attack rolls a natural 1, which always misses.
- Critical hit box: appears on critical attacks and damage, with the critical damage rule.
- Target number: shown when the roll has a DC or AC target.
- Total: the final result.

Damage rolls show each set of dice with what it rolled, then each flat modifier. Healing, hit dice, death saves, concentration, initiative, ability checks, skill checks, tool checks, saving throws and attacks all use the same panel.

## Changing the rule text

Paste JSON into Custom rule text. Each key matches an entry in `data/rules.json`. Only the keys you list change.

```json
{
  "prof.expertise": {
    "title": "Expertise",
    "text": "Your proficiency bonus counts twice here."
  }
}
```

Placeholders you can use in text: `{ability}`, `{cr}`, `{score}`, `{mod}`, `{prof}`, `{level}`, `{status}`, `{target}`, `{threshold}`, `{minimum}`, `{maximum}`. A sentence that uses a placeholder with no value is left out. Invalid JSON is ignored and a warning appears at load.

## Who it covers

- Player characters, NPCs and monsters, including unlinked tokens. NPC proficiency text shows challenge rating (CR) instead of level.
- Blind and whispered rolls: the panel only appears for users allowed to see the roll's content. A GM's hidden monster roll stays hidden.
- Rolls typed in chat (`/roll 1d20+5`) or inline rolls (`[[1d20]]`) are not dnd5e rolls and get no panel.

## Limits

- Rolls made before the module was enabled have no panel.
- A modifier added by another module or macro that does not go through dnd5e's roll configuration appears as "Unnamed effect" with its value.
- Advantage and disadvantage reasons come from active effects on the roll mode fields, dnd5e applied rules, and the skill plus tool double proficiency case. Sources set any other way (dialog choice, held key, travel pace) show "dnd5e did not report a reason".
- Initiative panels from the combat tracker depend on dnd5e passing its configuration through. If one is missing, roll initiative from the character sheet.
- This module was checked against the dnd5e 6.0.6 source and tested with mocks, but not run in a live Foundry world. See Troubleshooting.

## Performance

The module does no work between rolls. It runs once when a roll is configured and once when a chat card is drawn. Panel contents are built only when opened. Turn Debug logging off when you are not reporting a problem.

## QA test

`qa/roll-lessons-qa.js` tests every roll type with this world's characters. It is read-only: nothing is posted to chat and no character data changes. To run it, log in as a GM, press F12, open the Console, paste the whole file and press Enter. It prints a pass, fail and skip count with details for each test.

## Troubleshooting

No panel appears:
1. Confirm the module is enabled in the world and Enable Roll Lessons is on.
2. Make a new roll. Old messages are not updated.
3. Press F12, open the Console, and look for lines starting with `roll-lessons |`.

To report a problem:
1. Turn on Debug logging.
2. Make the roll that is wrong.
3. In the Console, copy the line `roll-lessons | breakdown` (expand it), and any red errors.
4. Send those with your Foundry and dnd5e versions.

Two other modules that change chat roll cards can hide the panel. Disable them one at a time to find the conflict.
