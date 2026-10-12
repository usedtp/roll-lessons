# Changelog

Versions follow [Semantic Versioning](https://semver.org): MAJOR for breaking changes, MINOR for new features, PATCH for fixes.

## 1.4.0 - 2026-10-12

### Fixed
- Rows no longer read "Not identified" because the rule text had not finished loading in that browser. Rule text now starts loading earlier, panels wait for it, and a panel opened too early rebuilds itself once the text arrives.
- If the rule text cannot be loaded at all, the panel says so, shows the error and the address it tried, and retries when reopened.
- The rule text request carries the module version, so a browser cannot reuse a copy cached from an older version after an update.
- True Strike's extra damage was explained as "Not from a Player's Handbook rule". Automated Conditions 5e splits damage formulas on every "+", including inside brackets; Roll Lessons now rejoins the pieces before explaining them.
- Roll log: subtracted dice (Mind Sliver's -1d4 on a save) were counted as added and flagged as unaccounted.

### New
- Damage that can only total 0 (no dice and no bonus, such as True Strike's extra Radiant damage below level 5) is hidden from the chat card and gets no breakdown. World setting "Hide damage that can only be 0", on by default. The roll stays in the data.
- "Cantrip Upgrade" row for cantrip dice that grow at levels 5, 11 and 17, showing the dice actually rolled.
- A row that still cannot be explained says why (rule text missing for a named key, or not loaded) and is recorded in the roll log with the user, browser and versions.
- Tests: `npm test`. GitHub Actions run them on every push and build the release files.

## 1.3.0

### Fixed
- Damage rolled through the roll window no longer shows "Source not found". Rage and ability modifiers that the window turns into plain numbers keep their labels (player 1 's Halberd and Handaxe +4, Player 2's Warhammer +3).
- A hit point setting (Tough) is no longer shown as a damage source.
- Rows with no source are replaced by Player's Handbook matching: a plain number is matched to the sources the rules allow for that roll type, including two sources merged into one number.

### New
- Bonuses added by Automated Conditions 5e are named by the effect that granted them.
- Saves and checks with no proficiency show a "+0 No proficiency" row naming the proficiencies the creature does have.
- Saves against a spell or ability show how the DC is built (8 + spellcasting modifier + Proficiency Bonus), whether the save succeeded, and what the spell text says happens.
- Save results folded into spell cards by dnd5e's "Summary Chat Cards" now carry the full breakdown.
- Attacks show Hit or Miss against each target's Armor Class; natural 1 and 20 are called out.
- Damage shows each target's Resistance, Immunity or Vulnerability to the damage type, its source, and the damage taken.
- Roll log: every roll's breakdown is saved to `Data/roll-lessons-logs/` (one file per day) by the GM's browser. GM setting "Roll log", on by default.
- Test bench `qa/roll-lessons-bench.js` covering every weapon and spell in the installed compendiums.

### Install
Manifest URL: `https://github.com/usedtp/roll-lessons/releases/latest/download/module.json`

Requires Foundry VTT v14 and dnd5e 6.0.0 or newer.
