# Promptfall features

What the game does today, one short paragraph per feature, grouped by area, in the glossary's
words.

## Party

**Heroes.** A hero is one of four classes (Knight, Black Mage, White Mage, Archer) with a
generated name, a rarity and the traits its rarity rolls. It levels from kill XP up to its
rarity's cap, from 20 for Common to 50 for Legendary. Its sprite wears its rarity colour, from
Common grey to Legendary gold.

**The party and the Heroes tab.** The party is the three heroes on the stage, picked from the
roster in the pane's Heroes tab. Enter on a hero opens its command window: Party (or Unpick),
Sell and Dismiss, which asks Yes or No and pays gold. A new pick takes the field at
the next zone boss kill or wipe, farm restarts and wipes in zone 1 included (on a fresh save,
before the first kill, at once), and the stage draws the party in the list's order. A new save
starts with one Common hero of each class, three of them already in the party.

**Recruiting.** The Heroes tab's last row recruits a hero at the tavern for gold, at the odds the
Odds tab publishes, each recruit dearer than the last. Zone bosses, and turn bosses less often,
drop recruit contracts that bring a hero straight into the roster. A contract that finds the
roster full is vendored for gold.

**Rests.** Each prompt the player submits is a short rest: every hero heals 30% of max HP, and
fallen heroes get up at 30%.

## Combat

**Encounters and waves.** Each tool call Claude makes spawns an enemy into the encounter: at most
three fight at once and up to ten more wait. When nobody is left to fight, the next enemy of the
current wave walks in, so an idle session still plays. A zone is ten waves of one to three of its
own enemies, and clearing a wave heals every hero 15% and gets the fallen back up at 15%.

**Action gauge and action queue.** Every hero and enemy has an action gauge that fills with
battle time, faster with more speed, and a full gauge joins the action queue. Units act one at a
time in the order their gauges filled: the Knight strikes one enemy, the Black Mage's fireball
hits them all, the Archer shoots the weakest, and the White Mage attacks or heals the most hurt
ally. The party window shows each hero's gauge filling and turning gold when full, with ▶ beside
the hero who is acting; enemies' gauges never show.

**Zone bosses.** After the tenth wave the zone's boss takes the stage, standing at its full size
over the small party. Beating it moves the party on to the next of twelve zones, from Greenmeadow
Road to The Unwritten Reach, with a toast naming the zone ahead. The enemy window shows a boss with its HP
percentage.

**Turn bosses.** A Claude turn with ten or more tool calls ends in a turn boss: a mini-boss with
better drops and a chance of a recruit contract, separate from the zone's own boss. One that
arrives mid-wave leaves the wave where it was: the wave goes on after it and clears as usual.

**Wipe.** When every hero falls, the party retreats one zone (never below zone 1) to wave 1 at
full health, and nothing is lost. The combat log says so, and a toast names the zone it fell back
to.

**Tactics.** The purse shows the tactics, Push on or Farm here; `f` on the band or
`/promptfall farm` flips them. Farming restarts the zone at wave 1 after its boss instead of
moving on.

**Combat log.** The Party tab's message window types out each action as the stage plays it, in
Dragon Quest's words: "Aldric hits Wood Goblin for 12.", "Wood Goblin is defeated!". Hit lines
that fall behind are dropped; kills, drops, level-ups, deaths and sales always get their line.

## Loot

**Drops and rarities.** Kills drop items. An item is a base type, a rarity (Common, Uncommon,
Rare, Epic, Legendary) and one rolled affix for each rarity step above Common, and rarer items
carry higher base stats. Deeper zones and bosses roll rarer drops. A drop pops out of the
defeated enemy on the stage, and the Loot tab shows the last two, coloured by rarity.

**Inventory.** The pane's Inventory tab lists the items, each with its icon where the surface
draws pictures, and the detail window shows the ▶ item's stats and affixes. Enter opens its
command window: Equip, Unequip, Sell, Vendor and Reforge. Each hero has three slots (weapon,
armour, accessory), items are gated by class, and an equipped item still takes an inventory slot.

**Vendoring.** Vendoring sells an item to the game for gold, after a Yes or No; Common and
Uncommon items can only be vendored. A drop that finds the inventory full is vendored on the spot,
and the combat log says so.

**Reforging.** Reforging rerolls one affix of an item for gold, priced by the item's rarity. The
affix to reroll is chosen in a command window.

**Expansions.** The inventory starts at 30 slots and grows to 90; the roster starts at 24 heroes
and grows to 48. Each step is bought with gold from the Odds tab, which shows the next step's
price or says the limit is reached, and each step costs more than the last.

## Market

**Listings.** A Rare or better item or hero can be listed at a fixed price from 1 to 1,000,000
gold for seven days, from Sell in its command window. The sell window shows the matching buy
orders first, each with its net, then Set a price; the message window shows the 2% listing fee
and the net after the 5% sale fee. A listed item or hero leaves the inventory or roster at once,
and a hero must be out of the party and wear nothing to be listed.

**Browsing and buying.** The Market tab lists open listings ten a page with the seller's name,
and its Filters row opens a filter window for kind, sort, base or class and minimum rarity. Enter
on a listing asks Yes or No to buy it, and your own listings read `yours`. A purchase needs the
gold and a free slot, and a bought hero arrives at level 1.

**Buy orders.** A buy order asks for a base type, a minimum rarity, at most one affix and a
maximum price, with the gold held in escrow. The Orders tab's New buy order opens a form window
to place one. A seller fills an order by choosing it in the sell window; an order fills once,
expires after seven days, and cancelling it refunds the escrow in full. An order names a real
base and affix or is refused, and a fill the buyer has no free slot for is refused with "The
buyer's inventory is full", leaving the order open.

**Orders and returns.** The Orders tab shows the count waiting in returns, then your listings and
your buy orders, and Enter on one asks to cancel it, saying what happens to the fee or the held
gold. A listing that expires or is cancelled comes back to its owner. With no free slot it waits
in returns and arrives the moment a slot frees; returns are never vendored.

**Cooldowns.** An item or hero that changes hands cannot be listed again for 24 hours.

**Linking.** Browsing is open to every account, but listing, buying, ordering and posting to chat
need an account linked to a GitHub login. Link GitHub on the Account tab runs the device flow: a
code in the detail window and the URL to enter it under the picture. An unlinked account or a
closed market is said in the message window, with a hotkey to the Account tab.

## World

**Presence.** The World tab shows how many players are online and the names in your zone, and the
Leaderboards tab shows who is online by zone. Without fresh news from the server for 45 seconds,
the World tab dims as stale.

**Chat.** One global channel lives in the pane's Chat tab: a row per message, newest at the
bottom, the ▶ message whole in the detail window. Enter on a row puts the cursor in the compose
field; a message is at most 200 characters, posting is rate-limited, and a blocked word refuses
the message, naming the rule. The band's World tab shows the latest message as a one-line ticker.
Chat needs a server: the default in-process fake has it off and says so in place.

**Leaderboards.** The Leaderboards tab shows the top 20 by highest zone reached and by world boss
damage this week, your own rows in gold.

**World boss.** A shared enemy with one global HP spawns every three hours and lives twenty
minutes or until it dies, and every online party fights it at once. Meanwhile the party is in
boss mode: the boss stands alone on the stage, the enemy window shows its global HP bar,
percentage and time left, the bar dropping as the party's hits land, waves pause and tool calls
spawn nothing. In the compact layout, with no enemy window, the party window's title carries the
boss's time left. A wipe in boss mode empties
every gauge and heals the party in place with no retreat, and the boss itself drops nothing. It
needs a server; the default in-process fake runs none, and with the boss off the World tab's
records row says so in place when it has room.

**Rewards.** When the world boss dies or expires, every party that dealt enough damage gets a
reward, and the top three damage dealers of a kill get one bonus roll each. Each reward toasts as
"Your share of …", and goods with no free slot wait in returns.

## Interface

**The band.** The game draws in a band above the prompt with three tabs, Party, Loot and World,
on the letter hotkeys `p`, `l` and `w`, and `c` collapses it. The Party tab is the stage over the
strip; Loot and World are the strip alone. The Party tab is 22 rows in every fight, the 17-row
stage over the 5-row strip, and never more than Claude Code gives it. With fewer rows a terminal
that draws images zooms the whole scene out to fit and the desktop scales it; a half-block
terminal crops the sky, down to the tallest actor on the stage. Past that, or on terminals 100 to
115 columns wide, the band drops to a compact stage beside one party window, then to a single row
under 100 columns, and it hides while Claude asks a question.

**The stage.** The stage is the animated battle in pixel art: the encounter's enemies on the left,
the party on the right, side-on, small against the zone's backdrop painting, one per zone, so a
boss lands at its full size. Actors bob between two idle
drawings and wind up and strike; fireballs, arrows and light bursts fly, hits flash white with a
rising damage number, heals rise green, the dead dissolve and drops pop out. A hero stands and
fights until the blow that kills him lands, then dims, and the party window's HP drops with each
hit as it lands, not when the game applies it. The stage is 17 rows in every fight and never
changes height. A monster that steps on partway through a tick
plays its first actions animated, on the desktop too. It draws as an image on Kitty and Ghostty,
in half-blocks on other terminals, and as vector art on the desktop. A terminal session asks which
it can draw, and lays the band out with the last session's answer while it waits, so the band holds
its height from the second session on.

**The strip.** The strip is the row of windows under the stage, drawn as Dragon Quest V draws
them: a charcoal field, a thin white line with cut corners, the game's pixel font. Left to right
come the enemy window (titled with the zone and wave, an HP bar per enemy), the message window,
the party window (each hero's name, level, HP bar and action gauge, the text orange under 25% HP
and red at 0) and the purse (the gold and the tactics, or `Sandbox` in the sandbox). The stage
and every window draw the staged state, the fight as the stage has played it so far, so they never
run ahead of the picture: a killed monster keeps its row until its death has played, the title
stays on the wave or zone being watched until its last monster has dissolved, the backdrop changes
zone only then, so a zone boss dies against its own painting, and the world boss bar drops as the
party's hits land. On the desktop, which redraws once
a tick, the HP bars drop at the moment each hit lands, as the action gauges fill between redraws.

**The command line.** The message window's first row, `▶Party Loot World ▾`, is the band's tabs
with ▶ on the current one. Under it the message window shows the combat log on Party, the last
two drops on Loot and the World rows on World.

**The pane.** `/promptfall` opens the pane on eight tabs: Inventory, Heroes, Market, Orders,
Account, Odds, Chat and Leaderboards, named in a tab window with each hotkey letter in gold. Each
tab is a list window with a ▶ cursor, a detail window beside it, and a two-line message window at
the foot saying what the keys do. Tab or the arrows move the ▶, Enter runs the row or opens its
command window, `q` backs out and Escape closes; Vendor, Dismiss, Buy, the cancels and Reset ask
Yes or No first. Long lists page with a footer such as `16-30/40`.

**Account tab.** The Account tab holds the settings as rows (Sound, Motion, Renderer), the band
shown or collapsed, Band off, Link GitHub and a reset of this machine's data that asks Yes or No.
Its detail window names the server, the client, the mode and the session.

**Odds tab.** The Odds tab publishes the drop, rarity and tavern odds for the current zone, and
sells the inventory and roster expansions.

**Motion.** Motion is full by default; set to still, the idle bob stops while attacks and hits
still play. It is set with `n` on the Account tab or `/promptfall motion full|still`.

**The `/promptfall` verbs.** `/promptfall <tab>` opens the pane on that tab. `off` and `on` hide
and show the band for the session while play goes on, `farm` flips the tactics, and `server <url>`
or `server local` points the machine at an HTTP server or back at the in-process fake, each with
its own account. `sound on|off`, `motion full|still` and `renderer auto|image|raster` set the
machine's settings.

**Primary session.** One session per account plays; running a gameplay verb or typing a prompt in
another session makes that one the primary. A prompt goes through at once and the band catches up
when the server answers. Every other session draws read-only and says "playing in another
session"; on the in-process save it writes nothing either, so expired listings and the world boss
wait for the primary. A primary that has paused (an update to install, a save to reset) answers
trades, `farm` and the sandbox verbs with "Promptfall is paused" instead. A session that stops playing drops its banner, and the new primary does not toast again
what the old one already toasted.

**Server status.** When the server stops answering or refuses a batch, the band says "server
unreachable, retrying" and play goes on for two minutes, then pauses until the server answers
again. The first answer sends everything played during the outage at once. When the server runs a
newer game than the plugin, the band asks for a plugin update; when this machine's save is from an
older game, it asks for a reset from the Account tab.

## Notifications and cues

**Toasts.** Only the primary session toasts, one sentence per event worth a glance: a Rare or
better drop, a recruit, a level-up, a zone arrival, a wipe, a boss reward, a sale, a purchase, a
return, a world boss appearing or going down, a revoked item, and a Rare or better drop vendored
for lack of room. Everyday toasts last four seconds and the weighty ones (a legendary drop, a
recruit, a reward, a wipe, a world boss appearing, a revoked item) eight. Effects of one kind that
land in the same burst, such as a boss kill levelling the party or a day of sales arriving at
once, fold into one toast with the count and the sum ("3 items sold for 410 gold"), while a
legendary drop, a recruit, a reward, a wipe or a zone arrival keeps its own. Toasts follow the
game, not the stage, so a wipe toast can show up to one cadence before the last hero falls on the
stage. A world boss already up when the session first polls toasts its arrival with no cue.
Routine combat, farming clears and chat never toast, the open pane holds toasts until it closes,
and a first launch toasts a welcome that points at the Heroes tab.

**Cues.** Four toasts also play a cue: a Rare or Epic drop, a Legendary drop, a level-up and a
world boss appearing. A burst plays each of its cues once, after its toasts. Only the primary
session plays them, and hiding the band does not silence them.

## Sound

**Sound toggle.** Sound is off by default and is one setting per machine: `s` on the Account tab
or `/promptfall sound on|off`. It switches the cues, at a fixed volume, and plays on macOS; other
systems stay silent. The setting survives a reset of the machine's data.

## Sandbox

**The switch.** Starting Claude Code with `PROMPTFALL_SANDBOX=1` turns the sandbox on for that
session: the game plays on the in-process fake whatever server the machine points at, with chat
off and the world boss on, and `/promptfall server` answers that the sandbox pins the server.
Without the variable the `sandbox` verb is not in the command's hint, and typing it anyway answers
"Sandbox is off. Start Claude Code with PROMPTFALL_SANDBOX=1."

**The sandbox save.** The sandbox plays a separate save with its own account, which it keeps
across sessions like the real one. The real party is never read or changed, and a sandbox session
and a real session can play side by side. The settings (sound, motion, renderer) are the
machine's and stay shared. The sandbox account never links to GitHub: the Account tab has no Link
GitHub row.

**The mark.** The purse says `Sandbox` where the tactics line sits, so a screenshot of the sandbox
is never mistaken for real play. While farming, the purse is titled `Farm`, and `f` still flips
the tactics.

**The verbs.** `/promptfall sandbox <verb>` hands out what play would earn, each answering in one
line once the grant is in the view; `/promptfall sandbox` alone lists them. `boss <name>` makes a
zone boss or turn boss the next encounter, moving the party to its zone. `worldboss` spawns a
world boss and engages the party; `worldboss end` settles it and pays every engaged party. Each
answers once the boss's "appeared" or "down" toast has shown, and refuses while a boss is already
live or when none is. The sandbox keeps the world boss's own schedule, so one can also appear by
itself. `item <base> [rarity]` drops an item
through the normal drop, common unless a rarity is given; with the inventory full it is vendored,
as in play. `level <hero> <n>` raises a hero level by level up to its rarity's cap. `gold <n>` adds
gold. `zone <n>` moves the party to that zone at wave 1. `recruit [rarity]` recruits a hero, and
refuses with a full roster. `wipe` makes the party fall now. `boss`, `zone` and `wipe` refuse while
the party fights a world boss. `reset` throws the sandbox save away and starts a fresh one in
place. Names match by the start of a name, any word in it or its id, and an ambiguous or unknown
name answers with the candidates.

## Planned

Wishes, not features. Nothing here exists yet.

- **Cinematic intro.** The game's logo in pixel art, an animation, and a transition into the game
  view.
