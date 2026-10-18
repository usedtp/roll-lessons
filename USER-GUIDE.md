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
| Open breakdowns by default | Each user | On | Shows each panel open under its roll. |
| Custom rule text (JSON) | World | Empty | Overrides wording. Applies on save, also to old messages. |
| Debug logging | Each user | Off | Writes roll details to the browser console. |
| Roll log | World, GM only | On | Saves every roll's breakdown to `Data/roll-lessons-logs/YYYY-MM-DD/`, a new file every 30 seconds while rolls are made, written by the GM's browser. Reports are saved even when this is off. |
| Hide damage that can only be 0 | World | On | Hides damage rolls with no dice and no bonus (for example True Strike's extra Radiant damage below level 5) from chat cards and breakdowns. The roll is kept in the data. |
| Error and Unclear buttons | World | On | Shows the report buttons under every breakdown. |
| GM to-do bar | World | On | Orange bar at the top of the GM's screen listing what the GM still needs to apply, each with a fix button. |
| Effect check on spell and feature cards | World | On | Says when an effect from a spell or feature card never reached the creature it is for, and applies it with one click. |
| Roll Lessons reports | GM only | Button | Opens the list of Error and Unclear reports. |

## Reading a panel

Click "How this total was built" under a roll. The panel content is built the first time you open it.

- d20 roll: the d20 result that counted, plus any dropped die from advantage or disadvantage.
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
- Ability modifier rows on attacks and damage say why that ability is used: melee weapons use Strength, ranged weapons Dexterity, Finesse weapons the higher of the two, spells the spellcasting ability, or an effect such as True Strike.
- "No ability modifier": dnd5e added none to an attack. The row names the expected modifier; check the ability chosen in the roll window.
- Save against a spell: which ability the spell calls for, what a saving throw and a DC are, how the DC is built, and what the result means for the creature (resists, half damage, or the effect happens).
- Not applied: an effect on the creature that would change this roll but is turned off, expired or suppressed, such as Rage after it ends.
- Weapon Mastery: the mastery property's rule, and a warning when no Weapon Mastery feature or Weapon Master feat grants it.
- How to fix: every warning is followed by a green line with the steps that correct it.
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

## Effect check on spell and feature cards

dnd5e applies a card's effects (Rage, Mage Armor, Bless, Shield) only when someone clicks Apply in the card, only to the selected tokens, and it skips creatures the clicking player doesn't own. When an effect is not applied, its modifiers never count: Mage Armor's Armor Class, Bless's 1d4, Rage Damage.

Under each such card, the GM and the player who used it see a box when:
- the effect is not on a creature it is for;
- it is on the creature but turned off;
- a hand-made copy with the same name changes nothing;
- no target was selected, so it reached no one.

The box says what the effect changes and has buttons: "Apply to (creatures)", "Apply to my targets" (target each creature first: hover over its token and press T), and, for touch spells such as Mage Armor, "Apply to (caster)". Creatures the player doesn't own are applied by the GM's browser, so a GM must be online. The box disappears once the effects are on, and is checked for as long as the effect lasts (at least an hour).

## GM to-do bar

dnd5e leaves several things for someone to apply by hand: effects from spell and feature cards, and damage and healing. When nobody does, the numbers are wrong without anyone noticing. The GM sees an orange bar at the top of the screen, plus a notice, whenever something needs applying:
- an effect from a spell or feature card (Rage, Mage Armor, Bless, Shield) that is not on its creature 20 seconds after the card, or a card used with no target;
- damage or healing rolled against a target whose hit points have not changed 45 seconds later;
- an effect that is turned off but would have changed a roll just made, such as Rage.

Click the bar to open it. Each item says what is wrong, why it matters, and has buttons: Apply, Apply to my targets, Apply full damage, Apply half damage, Apply healing, Turn on, Show message, Dismiss. An item disappears once it is fixed. Only the GM sees the bar; with more than one GM online, the active GM gets it.

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
