# Roll Lessons User Guide

Roll Lessons adds a collapsible panel under every dnd5e roll in chat. The panel lists each number in the total, where it came from, and the rule behind it.

Requirements: Foundry VTT v14, dnd5e system 6.0.0 or newer (built against 6.0.6).

## Install

1. Find your User Data folder. Foundry's main menu (the setup screen) shows it as User Data Path on the Configuration tab. Defaults:
   - Windows: `%localappdata%/FoundryVTT`
   - macOS: `~/Library/Application Support/FoundryVTT`
   - Linux: `/home/$USER/.local/share/FoundryVTT`
2. Close Foundry completely.
3. Create the folder `{User Data}/Data/modules/roll-lessons/` and unzip `module.zip` into it. The result must be `Data/modules/roll-lessons/module.json`.
4. Start Foundry. Roll Lessons now appears on the Add-on Modules tab of the setup screen.
5. Launch your world as GM. Open Game Settings, Manage Modules, tick Roll Lessons, Save Module Settings. Foundry reloads the world.
6. Make a roll. A "How this total was built" header appears under it.

If Foundry runs on a hosting service instead of your computer, upload the `roll-lessons` folder into `Data/modules/` with that service's file manager, then follow steps 4 to 6.

## Rules source

Rule text follows the 2024 Player's Handbook. Where dnd5e's automation differs from the book (for example, Magic Missile rolls one dart), the panel says so.

## Install from GitHub

In Foundry's setup screen: Add-on Modules, Install Module, paste this Manifest URL and click Install:

`https://github.com/usedtp/roll-lessons/releases/latest/download/module.json`

Foundry then offers updates whenever a new release is published.

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
| Roll log | World, GM only | On | Saves every roll's breakdown to `Data/roll-lessons-logs/YYYY-MM-DD/`, a new file every 30 seconds while rolls are made, written by the GM's browser. Reports are saved even when this is off. |
| Hide damage that can only be 0 | World | On | Hides damage rolls with no dice and no bonus (for example True Strike's extra Radiant damage below level 5) from chat cards and breakdowns. The roll is kept in the data. |
| Error and Unclear buttons | World | On | Shows the report buttons under every breakdown. |
| Roll Lessons reports | GM only | Button | Opens the list of Error and Unclear reports. |

## Reading a panel

Click "How this total was built" under a roll. The panel content is built the first time you open it.

- Die: the d20 result that counted, plus any dropped die from advantage or disadvantage.
- Advantage or Disadvantage box: lists the effects found that cause it. If none is found, the panel says dnd5e did not report a reason. It may have been picked in the roll dialog or with a held key.
- Modifier rows: one per modifier, with the signed value, its name, and the rule text. Examples: ability modifier, proficiency bonus, Expertise (proficiency counted double), half proficiency, magic weapon bonus, cover, condition penalties, situational bonus.
- Rows in italics: a value the module could not name. The number is still correct.
- "Fixed number in the damage formula": a number typed into the weapon or activity damage formula. If it matches an ability modifier, the panel says so and how to replace it with @mod.
- "Damage bonus: (effect)": a damage bonus from an effect such as Rage, named by the effect that sets it.
- "Bonus" or "Penalty" rows from effects: each effect is named with where it came from ("Slivered, from (caster)'s Mind Sliver" when one creature's spell affects another; "Thaumaturge, from Divine Order" for a creature's own feature). Under it: the rule sentence taken from the effect's description, or from the spell or feature that made it; the amount in words when it is a formula ("Wisdom modifier, minimum +1"); and the duration ("1 round", "Concentration, 9 rounds left").
- "No rule text found on this effect": the effect and the item it came from have no sentence about this kind of roll. Add a description to the effect.
- Warnings, in an orange box:
  - "applies to one roll only": the rule says "the next saving throw" (or attack roll, or check). This roll uses it up; remove the effect.
  - "an earlier roll already used": a second roll found an effect that applies to one roll only. It should have been removed.
  - "applied by the same casting": a save against a spell found a penalty that the same casting of that spell made. It should only be applied after a failed save.
  - "comes from (spell), which this save is against": same as above when the casting time is not known. If the effect came from an earlier casting, it applies.
  - "duration has run out": the effect is past its duration but still on the creature.
- Conditions in the Advantage or Disadvantage box show the condition's rule text from the 2024 Player's Handbook, for example "Poisoned: You have Disadvantage on attack rolls and ability checks."
- Every loose number is traced in this order: the character's damage bonus for the attack type, the weapon's damage bonus, the activity's own damage parts, every bonus setting on the character, then every active effect on the character and the item. The row names the first match.
- "Source not found": shown only when none of those hold the number. It lists what was checked and the exact roll part. That means another module or a manual edit added it.
- Active traits: Halfling Lucky, Elven Accuracy, Reliable Talent, minimum or maximum die results, extended critical range.
- Natural 1 box: appears when an attack rolls a natural 1, which always misses.
- Critical hit box: appears on critical attacks and damage, with the critical damage rule.
- Target number: shown when the roll has a DC or AC target.
- Total: the final result.
- Error and Unclear buttons: see Reports below.

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
- Effect durations are tracked by Foundry, not by Roll Lessons. The panel reads what the effect says. In combat, Foundry turns an effect off when its rounds run out; outside combat, rounds do not pass, so remove short effects by hand.
- An effect applied by hand with no origin is named, but its source is not. Effects applied from a spell or feature card carry their origin.
- Browsers cannot delete files through Foundry, so old logs are deleted by hand from `Data/roll-lessons-logs/`.
- Checked against the dnd5e 6.0.6 source and with the QA bench in a live Foundry 14.369 world.

## Performance

The module does no work between rolls. It runs once when a roll is configured and once when a chat card is drawn. Panel contents are built only when opened. Turn Debug logging off when you are not reporting a problem.

## What each panel explains

- Every number in the total, with its rule and source: ability modifier, proficiency (or "No proficiency" with the proficiencies the creature does have), Expertise, Rage, magic bonuses, item and feature bonuses, effects, and bonuses added by Automated Conditions 5e.
- Numbers dnd5e passes without a label are matched to the 2024 Player's Handbook sources for that roll type, including two sources merged into one number (for example Strength +4 and Rage +2 shown as 6).
- Attacks: Hit or Miss against each target's Armor Class.
- Saves against a spell or ability: how the DC is built (8 + spellcasting modifier + Proficiency Bonus), Succeeded or Failed, and what the spell says happens. This also appears on the one-line save results inside spell cards.
- Damage: each target's Resistance, Immunity or Vulnerability to the damage type, its source, and the damage taken.

## Reports

Every breakdown ends with "Explanation wrong or unclear?" and two buttons.

- **Error**: a number, source or rule is wrong.
- **Unclear**: the explanation is hard to understand.

The report window lists the breakdown's lines. Tick the ones the report is about (optional), add a comment of up to 500 characters (optional), and click **Send report**. The comment is saved in this world's roll log. The GM may share it with the Roll Lessons developer, so don't include real names or personal details.

The report goes to the GM's browser, which saves it in the roll log and shows a notice. If no GM is online, it is saved in the player's browser and sent when a GM connects.

GM: open **Configure Settings**, **Roll Lessons**, **Roll Lessons reports**. Filter by Error or Unclear, read the marked lines, comment and the breakdown as the player saw it, and click **Show message** to jump to the roll in chat. Reports marked fixed are hidden unless **Show fixed** is ticked.

## Roll log

The GM's browser writes the log to `Data/roll-lessons-logs/`. Each day has its own folder; each file holds the rolls and reports of up to 30 seconds. There is no limit per day. Files from version 1.4.0 and earlier (`YYYY-MM-DD.json`) stay readable. Only the GM's browser writes, so the log only records rolls while a GM is logged in.

`qa/roll-lessons-review.js` reads every log file and lists open reports grouped by cause, rolls the module flagged itself (numbers matched without a dnd5e label, unaccounted totals, effects with no rule sentence, timing warnings) and panel issues. Run it as a GM in the Console like the QA test. To mark reports fixed, set `window.__rlReview = { mark: { ids: ["report id"], s: "fixed", v: "1.5.1" } }` first; the status is saved in `Data/roll-lessons-logs/report-status.json`.

## QA test

`qa/roll-lessons-bench.js` is the full bench. It creates a "Roll Lessons QA" actor folder, QA NPCs and a "Roll Lessons QA" scene (once), rolls every weapon and spell from your compendiums against QA targets, checks each breakdown against the Player's Handbook, and deletes its whispered test messages at the end. Its "effects" phase adds and removes test effects on the QA NPCs (a Mind Sliver penalty, a formula skill bonus, Bless and Poisoned) to check sources, rule sentences, durations and timing warnings, and its "log" phase sends one test report and marks it "won't fix".

`qa/roll-lessons-qa.js` tests every roll type with this world's characters. It is read-only: nothing is posted to chat and no character data changes. To run it, log in as a GM, press F12, open the Console, paste the whole file and press Enter. It prints a pass, fail and skip count with details for each test.

## Troubleshooting

No panel appears:
1. Confirm the module is enabled in the world and Enable Roll Lessons is on.
2. Make a new roll. Old messages are not updated.
3. Press F12, open the Console, and look for lines starting with `roll-lessons |`.

To report a problem in the game, use the Error or Unclear button. To report one on GitHub:
1. Turn on Debug logging.
2. Make the roll that is wrong.
3. In the Console, copy the line `roll-lessons | breakdown` (expand it), and any red errors.
4. Send those with your Foundry and dnd5e versions.

Two other modules that change chat roll cards can hide the panel. Disable them one at a time to find the conflict.
