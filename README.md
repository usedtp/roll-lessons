# Roll Lessons

A Foundry VTT module for the dnd5e system. It adds a collapsible panel under every roll in chat that lists each number in the total, where it came from, and the rule behind it. Built to teach players how their numbers are made.

## Requirements

- Foundry VTT v14
- dnd5e system 6.0.0 or newer (built against 6.0.6)

## Install

1. In Foundry, open **Add-on Modules**, then **Install Module**.
2. Paste this into **Manifest URL** and click **Install**:
   `https://github.com/usedtp/roll-lessons/releases/latest/download/module.json`
3. Launch your world as GM. Open **Game Settings**, **Manage Modules**, tick **Roll Lessons**, click **Save Module Settings**.
4. Make a roll. A "How this total was built" header appears under it.

## Update

Open **Add-on Modules** and click **Update** next to Roll Lessons.

## What it shows

- The d20 that counted, plus any die dropped by advantage or disadvantage, and why.
- Every modifier with its value, name, and rule text: ability modifier, proficiency, Expertise, magic bonus, cover, conditions, situational bonuses.
- Damage dice and flat bonuses, with the source of every number. Numbers dnd5e passes without a label are matched to the 2024 Player's Handbook sources for that roll, including two sources merged into one number (Strength +4 and Rage +2 shown as 6).
- "No proficiency" rows that name the proficiencies the creature does have.
- Bonuses added by Automated Conditions 5e, named by the effect that granted them.
- Bonuses and penalties from effects, named with their source ("Penalty: Slivered, from the caster's Mind Sliver"), the rule sentence, the amount in words for formulas, and how long they last.
- Conditions behind advantage or disadvantage, with their Player's Handbook rule text.
- Timing warnings: an effect that applies to one roll only, one already used by an earlier roll, one applied before the save that decides it, and one past its duration.
- Attacks: Hit or Miss against each target's Armor Class.
- Saves against a spell or ability: how the DC is built (8 + spellcasting modifier + Proficiency Bonus), Succeeded or Failed, and what the spell says happens. Also shown on the save results folded into spell cards.
- Damage: each target's Resistance, Immunity or Vulnerability, its source, and the damage taken.
- Active traits such as Halfling Lucky, Elven Accuracy and Reliable Talent.
- Natural 1 and critical hit rules.

Covers attacks, damage, healing, ability checks, skill checks, tool checks, saving throws, initiative, concentration, death saves and hit dice. Works for player characters, NPCs and monsters.

## Settings

Open **Game Settings**, **Configure Settings**, **Roll Lessons**.

| Setting | Default | Effect |
|---|---|---|
| Enable Roll Lessons | On | Turns breakdowns on or off |
| Who sees the breakdown | Everyone | Everyone, or GM only |
| Detail level | Beginner | Beginner shows rule text. Advanced shows labels and values |
| Open breakdowns by default | On | Shows each panel open under its roll |
| Custom rule text (JSON) | Empty | Overrides the wording of any rule |
| Debug logging | Off | Writes roll details to the browser console |
| Roll log (GM) | On | Saves every roll's breakdown and every report to `Data/roll-lessons-logs/`, one folder per day |
| Hide damage that can only be 0 | On | Hides damage rolls that can only total 0, such as True Strike's extra damage below level 5 |
| Error and Unclear buttons | On | Shows the report buttons under every breakdown |
| GM to-do bar | On | Orange bar at the top of the GM's screen listing effects, damage and healing that still need applying, each with a fix button |
| Effect check on spell and feature cards | On | Says when an effect (Rage, Mage Armor, Bless) never reached its creature, and applies it with one click |
| Roll Lessons reports (GM) | Button | Opens the list of reports |

Full details, limits and troubleshooting: [USER-GUIDE.md](USER-GUIDE.md).

## Notes

- Rule text follows the 2024 Player's Handbook.
- Only rolls made after the module is enabled get a panel.
- Rolls typed in chat (`/roll 1d20+5`) are not dnd5e rolls and get no panel.
- Tested live with Foundry 14.369 and dnd5e 6.0.6. `qa/roll-lessons-bench.js` rolls every weapon and spell in your compendiums and checks each breakdown.
- Changes per version: [CHANGELOG.md](CHANGELOG.md).

## Report a problem

In the game: click **Error** or **Unclear** under the breakdown. Mark the lines that are wrong, add a comment if you want, and send. The GM reads reports in **Configure Settings**, **Roll Lessons**, **Roll Lessons reports**.

On GitHub: open an issue with your Foundry and dnd5e versions and the day's folder from `Data/roll-lessons-logs/`.
