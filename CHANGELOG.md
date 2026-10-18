# Changelog

Versions follow [Semantic Versioning](https://semver.org): MAJOR for breaking changes, MINOR for new features, PATCH for fixes.

## 1.5.1 - 2026-10-18

Fixes from Error and Unclear reports.

### Fixed
- Saving throws: the panel now says which ability the spell calls for and why that modifier is added, what a saving throw and a DC are, and what the result means for the creature (resists the effect, takes half damage, or the effect happens).
- "No proficiency" on a save names only the save rolled ("not proficient in Dexterity saving throws") instead of listing the saves the creature is proficient in.
- The die row reads "d20 roll" instead of "Die (d20)".
- Attacks and damage say why they use their ability: melee Strength, ranged Dexterity, Finesse, spellcasting, or an effect. True Strike is named on the modifier row with its rule: the attack uses the spellcasting ability instead of Strength or Dexterity.
- An attack rolled with no ability modifier gets a "No ability modifier" row naming the expected one, with a warning.

### New
- "Not applied" note: an effect that would change the roll but is turned off, expired or suppressed is named, with the bonus or Advantage it would give (for example Rage turned off, so its Rage Damage is missing).
- Weapon Mastery note on attacks: the property's 2024 Player's Handbook rule, and a warning when no Weapon Mastery feature or Weapon Master feat grants it.
- Effect check on spell and feature cards: when an effect from Rage, Mage Armor, Bless, Shield or similar never reached the creature it is for (dnd5e applies effects only when Apply is clicked, only to selected tokens, and skips creatures the player doesn't own), the card says which creatures are missing it and what it changes, and applies it with one click. Creatures the player doesn't own are applied by the GM's browser. Also covers effects that are turned off and hand-made copies that change nothing. World setting "Effect check on spell and feature cards", on by default.
- GM to-do bar: an orange bar at the top of the GM's screen, with a notice, whenever the GM needs to apply something: an effect from a spell or feature card that never reached its creature (checked 20 seconds after the card, so players can apply it first), damage or healing rolled against a target whose hit points did not change after 45 seconds, and an effect turned off that a roll just needed (such as Rage). Each item has the button that fixes it: Apply, Apply full or half damage, Apply healing, Turn on. World setting "GM to-do bar", on by default.
- An attack rolled with no target says so, with how to target before rolling.
- Breakdowns open by default.
- Every warning ends with a "How to fix" line: the steps on the sheet or in the roll window that correct it, such as turning Rage back on, deleting an effect applied too early, or picking the missing ability.

## 1.5.0 - 2026-10-13

### Fixed
- A skill bonus written as a formula (Thaumaturge: Wisdom modifier, minimum +1) showed +1 instead of its real value. Formulas inside formulas are now resolved fully.
- A false "Added after the roll was set up" row appeared when a roll held a bracketed bonus such as "(max(1,3))". The check now counts every flat part of the roll.

### New
- Every bonus or penalty from an effect names the effect and where it came from, for example "Penalty: Slivered, from (caster)'s Mind Sliver", followed by the rule sentence from the effect or the spell, the amount in words for formulas, and how long it lasts.
- Conditions behind advantage or disadvantage show their 2024 Player's Handbook rule text.
- Timing warnings: an effect that applies to one roll only ("the next saving throw") says so and asks to be removed after the roll; a second roll that still finds it is warned; an effect applied by the same casting whose save is being rolled is flagged as applied too early; an effect past its duration is flagged.
- "Error" and "Unclear" buttons under every breakdown. A report can mark lines and add a comment. It goes to the GM's roll log; with no GM online it waits in the player's browser and is sent when a GM connects. World setting "Error and Unclear buttons", on by default.
- GM window "Roll Lessons reports" (module settings) lists reports with filters, status and a link to the chat message.
- `qa/roll-lessons-review.js` reads every log file, groups reports by cause, lists rolls the module flagged itself, and marks reports fixed.
- Roll log: each write is a new file in a folder per day (`Data/roll-lessons-logs/YYYY-MM-DD/`), with no limit per day. Files from earlier versions are still read. Old logs are deleted by hand; browsers cannot delete files through Foundry.
- Test bench: new "effects" phase (spell penalty with source, formula skill bonus, Bless, Poisoned, timing warnings) and checks for batch logs and reports.

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
- Damage rolled through the roll window no longer shows "Source not found". Rage and ability modifiers that the window turns into plain numbers keep their labels.
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
