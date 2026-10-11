---
name: promptfall-content
description: Promptfall's content names and ids. Use when a task names a zone, enemy, boss, item or hero, or needs the exact name or id the game uses for one.
---

# Promptfall content

The game's content lives in one registry, the `content` export of `@promptfall/sim` (`packages/sim/src/content/`). [`reference/content.md`](reference/content.md) lists every zone, enemy and boss, item base, hero template and rarity in it. Look a name up there before writing it in code, a test, a ticket or a reply.

## Ids and display names

Every enemy, item base and hero template has two names:

- The **id**, snake_case, the registry's key: `elder_treant`, `oak_staff`, `knight_1`. Game state, events, sprite keys (`enemy:elder_treant`, `item:oak_staff`) and tests hold ids.
- The **display name**, what the player reads: Elder Treant, Oak Staff, Aldric.

Zones have an index (1 to 12) and a display name, no id. Rarities are their own id: `common` through `legendary`. A hero in a roster is a template plus an epithet drawn at recruit ("Aldric the Bold"), so two roster heroes can share a template name.

Bosses are enemies. A zone's boss has archetype `boss`, its turn boss `turn_boss`; both sit in the enemy table beside the four wave enemies. World bosses (The Promptwyrm and the rest) are the ledger's, in `WORLD_BOSSES` of `packages/ledger/src/boss-config.ts`, and are not in this registry.

## How a typed name resolves

The sandbox verbs (`/promptfall sandbox boss|item|level …`) take a name and match it against the registry:

- Case-insensitive prefix of the display name, of any word in it, or of the id. `treant`, `elder` and `elder_t` all find Elder Treant.
- `boss` matches zone bosses and turn bosses by their enemy names; `item` matches item bases by name or id; `level` matches the roster's heroes by name; a rarity matches by its name. `zone` takes the index.
- One match runs. Several answer `Which one: …` with the candidates and run nothing. None answers `No boss named 'x'` (or item, hero, rarity) with the full list for that kind.

So a word several names share is ambiguous: `staff` finds Oak Staff, Rune Staff, Willow Staff and Seraph Staff. Pick a prefix the reference shows to be unique.

## Keeping the reference current

The reference is generated: `pnpm content` rewrites it from the registry, and `pnpm content:check` (in CI) fails when the committed copy differs. A change to the content runs `pnpm content` and commits the result in the same change.
