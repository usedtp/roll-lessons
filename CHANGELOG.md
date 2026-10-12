# Roll Lessons 1.3.0

## Fixed
- Damage rolled through the roll window no longer shows "Source not found". Rage and ability modifiers that the window turns into plain numbers keep their labels (Teddy's Halberd and Handaxe +4, Thogrum's Warhammer +3).
- A hit point setting (Tough) is no longer shown as a damage source.
- Rows with no source are replaced by Player's Handbook matching: a plain number is matched to the sources the rules allow for that roll type, including two sources merged into one number.

## New
- Bonuses added by Automated Conditions 5e are named by the effect that granted them.
- Saves and checks with no proficiency show a "+0 No proficiency" row naming the proficiencies the creature does have.
- Saves against a spell or ability show how the DC is built (8 + spellcasting modifier + Proficiency Bonus), whether the save succeeded, and what the spell text says happens.
- Save results folded into spell cards by dnd5e's "Summary Chat Cards" now carry the full breakdown.
- Attacks show Hit or Miss against each target's Armor Class; natural 1 and 20 are called out.
- Damage shows each target's Resistance, Immunity or Vulnerability to the damage type, its source, and the damage taken.
- Roll log: every roll's breakdown is saved to `Data/roll-lessons-logs/` (one file per day) by the GM's browser. GM setting "Roll log", on by default.
- Test bench `qa/roll-lessons-bench.js` covering every weapon and spell in the installed compendiums.

## Install
Manifest URL: `https://github.com/usedtp/roll-lessons/releases/latest/download/module.json`

Requires Foundry VTT v14 and dnd5e 6.0.0 or newer.
