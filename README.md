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
- Damage dice and flat bonuses, with the source of each loose number.
- Active traits such as Halfling Lucky, Elven Accuracy and Reliable Talent.
- Natural 1 and critical hit rules, and the target number (DC or AC).

Covers attacks, damage, healing, ability checks, skill checks, tool checks, saving throws, initiative, concentration, death saves and hit dice. Works for player characters, NPCs and monsters.

## Settings

Open **Game Settings**, **Configure Settings**, **Roll Lessons**.

| Setting | Default | Effect |
|---|---|---|
| Enable Roll Lessons | On | Turns breakdowns on or off |
| Who sees the breakdown | Everyone | Everyone, or GM only |
| Detail level | Beginner | Beginner shows rule text. Advanced shows labels and values |
| Open breakdowns by default | Off | Expands each panel automatically |
| Custom rule text (JSON) | Empty | Overrides the wording of any rule |
| Debug logging | Off | Writes roll details to the browser console |

Full details, limits and troubleshooting: [USER-GUIDE.md](USER-GUIDE.md).

## Notes

- Rule text follows the 2024 Player's Handbook.
- Only rolls made after the module is enabled get a panel.
- Rolls typed in chat (`/roll 1d20+5`) are not dnd5e rolls and get no panel.
- Status: checked against the dnd5e 6.0.6 source and tested with mocks. Not yet run in a live Foundry world.

## Report a problem

Open an issue on this repo. Include your Foundry and dnd5e versions. Turn on **Debug logging**, make the roll that is wrong, and copy the `roll-lessons | breakdown` line from the browser console (F12).
