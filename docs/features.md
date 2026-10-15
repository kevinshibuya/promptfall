# Promptfall features

What the game does today, one short paragraph per feature, grouped by area, in the glossary's
words.

## Party

**Heroes.** A hero is one of four classes (Knight, Black Mage, White Mage, Archer) with a
generated name, a rarity and the traits its rarity rolls. It levels from kill XP up to its
rarity's cap, from 20 for Common to 50 for Legendary. Rarer heroes carry higher base stats and
growth: the rarity multiplies them by the table items use, from 100% for Common to 150% for
Legendary, so a Rare recruit outhits and outlasts a Common of its level from level 1. Each level
costs a little more XP than the last, from 60 for level 2 to about 45 thousand for level 50:
about 10 thousand in all to reach level 10, 207 thousand to reach 30 and 836 thousand to reach
50. A hit lands its attack scaled by 100 / (100 + the target's defence), so 100 defence halves
it, never below 1. Its sprite wears its rarity colour, from Common grey to Legendary gold.

**The party and the Heroes tab.** The party is the three heroes on the stage, picked from the
roster in the pane's Heroes tab. Enter on a hero opens its command window: Party (or Unpick),
Sell and Dismiss, which asks Yes or No and pays gold. A new pick takes the field at
the next zone boss kill, wipe, retreat or travel, a Stay here restart included (on a fresh save,
before the first kill, at once), and the stage draws the party in the list's order. A new save
starts with one Common hero of each class, three of them already in the party.

**Recruiting.** The Heroes tab's last row recruits a hero at the tavern for gold, at the odds the
Odds tab publishes, each recruit dearer than the last. The tavern guarantee puts a floor under the
odds: a Rare or better comes within 20 tavern recruits, an Epic or better within 80 and a
Legendary within 400, so the recruit that would break the promise comes up at least that rare.
Zone bosses, and turn bosses less often, drop recruit contracts that bring a hero straight into
the roster; a contract never counts toward the guarantee, nor does a sandbox recruit. A contract
that finds the roster full is vendored for gold.

**Rests.** Each prompt the player submits is a short rest: every hero heals 50% of max HP, and
fallen heroes get up at 50%.

## Combat

**Encounters and waves.** A zone is ten waves, and a wave opens with a draw of one to three of
the zone's own enemies, drawn from all four, which all walk in together, so an idle session still
plays. Each tool call Claude makes adds an enemy to the wave: it steps onto the field if a place is
free, or waits in line, and the wave clears only when every enemy it got is dead. At most three
fight at once and up to ten more wait; a call past that brings nobody. Whenever a place on the
field is free and someone waits, they step on at once, in the same moment as the kill that freed
it. A tool call with no wave open opens one: its own enemy comes first, then the draw. At wave 11
the zone boss's turn comes: a call still brings an enemy, which counts toward nothing, and the boss
walks onto the empty field. Every zone has four wave enemies, a swift, a brute, a caster and a
tank, and the tool picks which one comes: a read or a web lookup brings out the swift, an edit or a
write the brute, a shell command the caster, and any other tool, an MCP tool or a subagent's call
the tank. A search runs through the shell today, so it brings out the caster. Clearing a wave heals
every hero 15% and gets the fallen back up at 15%. A kill pays by the enemy's toughness:
its XP, gold and drop chance follow its share of HP, so a zone's tank pays about 1.3 times the
zone's base and its swift about 0.74, and no kind pays better per point of HP it takes to kill. A
day of edits plays differently from a day of reads and earns the same.

**Action gauge and action queue.** Every hero and enemy has an action gauge that fills with
battle time, faster with more speed, and a full gauge joins the action queue. Units act one at a
time in the order their gauges filled: the Knight strikes one enemy, the Black Mage's fireball
hits them all, the Archer shoots the weakest, and the White Mage attacks or heals the most hurt
ally. The party window shows each hero's gauge filling and turning gold when full, with ▶ beside
the hero who is acting; enemies' gauges never show.

**Zone bosses.** After the tenth wave the zone's boss takes the stage, standing at its full size
over the small party. Beating it moves the party on to the next zone: twelve of them, from
Greenmeadow Road to The Unwritten Reach, and then the same twelve again in tier 2 and tier 3,
all on the one ladder. The zone's words arrive with the new backdrop: once the boss's chest has
played and the party has held its victory pose, the party walks off to the right as on a travel,
the backdrop changes as it goes, and the party walks back on from the left; the combat log's "The
party reached zone 2" and a toast naming the zone ahead land with the new backdrop. With Stay here
the party holds its pose and stays. The enemy window shows a boss with its HP
percentage. Each zone's boss holds more of a fight than the last: zone 1's is as quick as ever,
zone 12's takes four times as long against its waves, and from zone 7 the waves thicken and pay
more XP too, so the deeper zones take longer to clear. Zone 12's boss opens tier 2, zones 13 to 24: each zone's own monsters, boss and
backdrop, ramping on from zone 12's numbers with no wall at the door, stronger with every zone and
worth more XP and gold, and dropping any base at item tier 5 at zone 12's rarity odds; a boss
contract there rolls zone 12's odds too. Tier 3, zones 25 to 36, drops at item tier 6. The ladder ends at tier 3 for now, and zone 36 starts again at wave 1 after its boss, whatever the tactics. Past tier 1 the arrival toast
and the log name the tier in words, "The party reached tier 2, zone 1, Greenmeadow Road", and the
enemy window's title in the short form that fits it, "T2 Z1 · Wave 3". Inside tier 1 they read as
before. Each zone boss has one of four moves, the same in every tier: zones 1, 5 and 9 strike
twice, two hits on one hero at 70% each, both numbers landing at the lunge's one impact and the
log saying "Gorvax strikes twice!"; zones 2, 6 and 10 heal themselves under half HP for half
their attack, more often the lower they are, with the White Mage's light burst on the boss and
"Gorvax heals itself for 40."; zones 3, 7 and 11 sweep the whole party at 60% about one action
in three, beside their single attack, one lunge with every hero's hit landing at once and the
usual "hits 3 foes" line; zones 4, 8 and 12 rage under half
HP, every hit from there half again as hard, and "Gorvax's rage grows!" when the hit takes them
under. A raging boss that is also enraged takes both on that hit. Each move's boss attack is tuned
so the reference Knight still survives three to four of its actions; turn bosses and the world
boss keep the single attack. None of it toasts.

**Turn bosses.** A Claude turn with ten or more tool calls ends in a turn boss: a mini-boss with
better drops and a chance of a recruit contract, separate from the zone's own boss. It arrives
between waves, in a fight of its own, and counts toward no wave; a tool call made while it stands
alone opens the next wave around it.

**Wipe.** When every hero falls, the party restarts the zone it is in at wave 1, at full health,
and nothing is lost; the game counts the zone's wipes. The combat log says "The party fell.", and
a short toast reads "The party fell, back to wave 1 of zone 4, Old Barrow Hills".

**Retreat.** The third wipe in a zone with no zone boss kill between them is a retreat: the party
falls back one zone to wave 1 at full health (in zone 1 it restarts zone 1), and the wipe count
starts again. A zone boss kill or any change of zone also starts it again. The combat log says
"The party retreats to zone 3.", and a long toast reads "The party retreats to zone 3, Marsh of
Sighs".

**Travel.** The party can travel to any zone it has reached, from that zone's Journal page or
with `/promptfall travel <zone>`. It travels at once, with no cost and no cooldown. The fight on the
field ends with no drops and no XP, and the party starts the zone at wave 1. Past tier 1 a zone's
page offers each tier of it the party has reached. The command answers "The party travels to
zone 3, Marsh of Sighs." or says why it cannot go: a zone past the highest reached, the zone the
party is in, a world boss fight, or a zone that is not a number. A session with no game running
answers that it is not playing. A retreat still drops the party one zone, and travel can take it
straight back.

**Tactics.** The tactics say what the party does after a zone boss: Next zone moves on to the next
zone, Stay here starts the zone again from wave 1. The purse's second row reads `f: Next zone` or
`f: Stay here`, the `f:` dim, and `f` on the band or `/promptfall farm` flips them, in the sandbox
as in real play; the purse's alt text says what happens after the boss and what `f` does. While
the party stays, the World tab's records row ends `· staying` and the compact band's title adds
`· Stay here` when it fits; Next zone adds nothing.

**Reactive events.** The fight answers what Claude is doing, on the stage and in the combat log, and
never with a toast or a cue. While Claude works on a prompt the party has Haste: the heroes' gauges
fill a quarter faster, they bob twice as fast, and each hero standing trails light speed lines from
its back in a pale tint of its class's colour, flickering with the bob, and the log says "The party
quickens." A fallen hero shows no lines, nor does one in the guard stance or at camp, and the compact
stage shows the faster bob alone. A long turn stays hasted. Haste ends with the turn, or after three
minutes of battle with no sign of work, and the log says "The party slows." A subagent's turn leaves
it alone. A failed tool call enrages the strongest enemy on the field: a world boss, then a zone
boss, then a turn boss, then the wave enemy that hits hardest, the toughest and then the front-most
of equals, so a zone boss behind a field rat takes it. It flashes red and stays tinted red until its
next hit, which lands half again as hard, and the log says "Claude stumbles. Bandit Captain is
enraged!" With no enemy on the field, the strongest already enraged, or the party camped, nothing
happens, and stopping Claude or answering no to a prompt is no stumble. A compaction makes the party
camp as it starts, from a manual, auto or plugin compaction of the main conversation, never the
engine's precompute or a subagent's own: every hero heals half its HP and the fallen get up at half,
as at a rest, and the log says "The party makes camp while Claude gathers its thoughts." The fight
pauses. The enemies walk off the stage with their HP kept, the party huddles at a campfire with the
bob stopped, the enemy window's rows go blank but a dim `camping`, the message window shows
`g: back to the fight` under the newest log row, and the compact window shows `camping` for the
front enemy. Every gauge, enemy and queued enemy holds until the party breaks camp: at the next
prompt or tool call, a travel, a world boss appearing, the session ending, or `g` on the band or
`/promptfall go`. Then the fire goes out, the heroes step back to their slots, the same enemies walk
back in with the HP they had, and the log says "The party breaks camp." Haste never starts while
camped. With a world boss engaged there is no pause: the fire burns mid-field for four seconds, the
party heals and fights on. While Claude Code shows a permission prompt the party stands guard: the
heroes lean into a guard stance, stop bobbing and huddle in toward the front hero standing, who holds
a big blue shield on the enemies' side; a hit lands on the shield with a white flash. The heroes take
half damage and attack nobody while the enemies fight on, and the log says "The party stands guard."
The party lowers its guard and steps back to its slots when the call resolves, allowed or denied, or
after two minutes of battle with no answer. Guard comes from Claude Code's permission-request hook,
which fires only as a permission prompt shows and never for an auto-allowed call; the terminal stops
drawing the band while the prompt is up, so the huddle shows once it is answered. Haste, Enrage, Camp
and Guard leave XP, gold and drops alone, and a tool's enemy pays by its toughness, so faking an
event buys nothing but the picture. The server caps each kind on its own clock, and the plugin paces
them under those caps. Under Motion still the speed lines draw static, the stance and the shield
still draw, and the bob stays stopped.

**Combat log.** The Party tab's message window types out each action as the stage plays it, in
Dragon Quest's words: "Aldric hits Wood Goblin for 12.", "Wood Goblin is defeated!". Hit lines
that fall behind are dropped; kills, drops, level-ups, deaths, sales, reactive events, travels,
rewards and a boss's move always get their line.

## Loot

**Drops and rarities.** Kills drop items. An item is a base type, a rarity (Common, Uncommon,
Rare, Epic, Legendary) and one rolled affix for each rarity step above Common, and rarer items
carry higher base stats. An item also carries an item tier, set when it drops from its base's
minimum zone (zones 1 to 3 are tier 1, 4 to 6 tier 2, 7 to 9 tier 3, 10 to 12 tier 4), and every drop in
the ladder's tier 2 is item tier 5 and in tier 3 item tier 6. An affix keeps its flat roll, and
what it counts for in stats, in the detail window and in a listing is that roll times the item
tier's multiplier (×1, ×2, ×3.5, ×6, ×10, ×16), so a deeper item beats a rarer shallow one.
Deeper zones and bosses roll rarer drops. A kill that drops an item leaves a chest where the
enemy stood: it falls out of the enemy as it fades, sits closed, opens, and the item rises out of
it on a glow in its rarity colour, wider the rarer the item. The item holds there longer the
rarer it is (under a second for a Common, two for a Legendary), then the item, its glow and the
chest fade; the next enemy steps on after it. A monster killed in the tick it arrived, before the
band ever drew it, still leaves its chest, on the ground of the lowest free slot. An auto-vendored drop plays the same chest, and a
sandbox item is the drop of the front monster, struck down for it. The combat log's drop line,
the Loot tab's row and a Rare or better drop's toast and cue are each a held line that waits for
the reveal: they land together once the item has risen, not at the kill, while sales and
purchases show at once. The Loot tab shows the newest drops and sales and pages back through the
last 40 with `j` and `k`. Each row reads like an inventory row: it leads with the item's or hero's
art (the item's sprite for a drop, a sale or a trade, the hero's class sprite for a hero joining
or traded, a blank gap for a hero contract sold), then the name in its rarity colour, then the
rest of the line, its later rows hung under the name. On the Raster, which draws no pictures, the
art's two cells show a block in the rarity colour.

**Inventory.** The pane's Inventory tab lists the items, each with its icon where the surface
draws pictures, and the detail window shows the ▶ item's stats and affixes. Enter opens its
command window: Equip, Unequip, Sell, Vendor and Reforge. Each hero has three slots (weapon,
armour, accessory), items are gated by class, and an equipped item still takes an inventory slot.

**Vendoring.** Vendoring sells an item to the game for gold, after a Yes or No; Common and
Uncommon items can only be vendored. A drop that finds the inventory full is vendored on the spot,
and the combat log says so. The auto-vendor setting, off on every save and kept with the account,
vendors a Common drop on pickup, and an Uncommon one once the party is past zone 3, unless a party
hero has the item's slot empty and could wear it; it never touches a Rare or better. Its chest
plays as a full inventory's does and the combat log says `Oak Staff vendored, 3G.`

**Reforging.** Reforging rerolls one affix of an item for gold: it rolls the same flat range and
the item keeps its tier. The price is the rarity's price times the item tier's multiplier, shown on
the Reforge row of the Inventory command window before the pick, and the Odds tab says reforge is
priced by rarity and tier. The affix to reroll is chosen in a pick window that lists each affix
with its value and the range a roll can give at the item's tier, as `Vicious +3 atk · 3-7`. A roll
leaves the pick open with the new value in place and the price on its header, so the next roll is
one press; a roll without the gold is refused in the message window and the pick stays. q closes
it.

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
need an account linked to a GitHub login. Link GitHub on the Account tab runs the device flow: the
code the server gives at the top of the detail window, so a narrow pane or the dock still shows it,
the URL to enter it at under the picture, and a poll at the interval the server gives. A resize
keeps the code, the poll and whatever else the dialog had open. A server started with `--link github` runs GitHub's own device
flow with the OAuth app's client id from `PROMPTFALL_GITHUB_CLIENT_ID`: GitHub's code and URL, the
link completing on the first poll after the player authorises, and the GitHub login as the
account's name. When GitHub asks the server to slow down, the server answers the player's polls
"pending" without asking GitHub until the slower pace allows the next call. The server keeps the login and never the access token. A decline, an expired code
or GitHub not answering ends the link unlinked, with the reason in a toast; a `github` server
without a client id refuses the start the same way. `--link fake`, the default, approves on the
first poll as `--player-name`. The public server runs GitHub's flow. The server's sweep drops a
link left open past 15 minutes, GitHub's device-code lifetime (scaled by the speed); a poll on it
then answers pending until the client gives up. An unlinked account or a closed market is said in
the message window, with a hotkey to the Account tab.

## World

**Presence.** On the band's World tab presence sits on the command line, after the tabs:
`· 13 online · zone 1: Bea, Kit`, the dots dim. When the tabs, presence and `c ▾` do not fit the
message window it drops the names, then the zone, then the word "online", down to the count alone,
`· 13`; the hint is never dropped, and the window's alt text keeps presence whole. With presence
off, or before the first snapshot, "presence is off" or "connecting to the world…" takes its place,
dim. The compact band's World rows open with
it instead. The Leaderboards tab shows who is online by zone. Both name a zone past tier 1 as
"T2 Z1" and one inside it as today. Without fresh news from the server for 45 seconds, presence
dims as stale.

**Chat.** One global channel lives in the pane's Chat tab: a row per message, newest at the
bottom, the ▶ message whole in the detail window. Enter on a row puts the cursor in the compose
field; a message is at most 200 characters, posting is rate-limited, and a blocked word refuses
the message, naming the rule. The band's World tab shows the latest message in its second row,
under the records row: chat never hides the records row, and the records row never hides chat. A
message longer than the row is cut with an ellipsis, the one cut the band makes, since the row is
fixed and the Chat tab shows it whole. With no message the row reads "chat is quiet", dim, and
with chat off "chat is closed". Chat needs a server: the in-process fake (`/promptfall server
local`) has it off and the row says "chat needs a server".

**Leaderboards.** The Leaderboards tab shows the top 20 by highest zone reached and by world boss
damage this week, your own rows in gold. The highest zone is the running number, so tier 2's zone 1
ranks above zone 12; past 12 it reads "T2 Z1", here, on the World tab's records row and on the
Account tab, and the plain number inside tier 1.

**Bots.** An HTTP server can run bots (`--bots <n>`): seeded accounts that play, chat, trade and
fight the world boss through the same routes as a player. Each one's name starts `[bot] `, and
none ever holds a row on either leaderboard. A bot saved under an older name or sim version is
minted again on the server's start, and its old account is deleted first, so the replaced bot
leaves both boards with it. At normal speed each bot acts about once a minute and polls the
world twice as often, so every bot stays online and joins each world boss. Bots buy item
listings only below twice vendor value, keep listing at three times and up, and vendor their
cheapest unequipped item through a batch when their inventory is full before trading. A player's
bargain can sell while the bots' stock stays available to browse. The public server runs six
during the soft wave with the same tuning and none from the public listing on.

**Flags and the mint cap.** An HTTP server started with `PROMPTFALL_ADMIN_TOKEN` in its environment
takes `POST /v1/admin/flags` with that token as a bearer and a body like `{"chat.enabled": false}`:
the market, chat, the world boss, presence, the leaderboards, the hunt (`hunt.enabled`) and
maintenance switch on the next
call, and stay switched after a restart, over the `--flag` values it starts with. The sandbox flag
is refused there. Each admin call logs one line with its time, the flags it set and its outcome,
never the token. A server without the token has no admin routes. A server makes at most five new
accounts an hour for one client address (the one Caddy forwards); a known token always gets in.
Only a launch with no token makes an account: a token the server does not know is refused as
`unknown` and makes nothing, so a second session or a stale client never mints an orphan. The
playing session clears that token, unless another session has stored a new one meanwhile, and
launches again with none, which mints; a session that is not playing waits for the token the
playing one stores. A delete's reset and a wiped dev store heal this way.

**Bans.** The same token bans an account: `POST /v1/admin/ban` with `{"accountId", "reason"}`
stores the ban on the account's record, never on the account the wire carries, and logs one line
with the account id. From the next call on, every call of that account but its delete (the
bootstrap, batches, the market, the world poll, chat, the boards, the link) answers `banned` with
`Promptfall: this account is banned: <reason>`. The plugin pauses play and shows that line in the
message window, as it shows the update notice; it does not ask again until the next session, which
shows it again. The ban reaches the account's GitHub login too: a fresh account that links the
same login, in any case, has the link end denied with `Promptfall: this GitHub account is banned:
<reason>` and stays unlinked, though it is not banned for trying. An account that never linked is
banned by its id alone. `POST /v1/admin/unban` with `{"login"}` lifts the login's ban and the ban
of every account still there that carried it, whether or not the banned account was deleted.

**Deleting an account.** Delete my account on this server, on the Account tab, asks Yes or No, then
calls `DELETE /v1/account` with the machine's token. The server closes the account's open listings
and buy orders without returning the goods or refunding the escrow, which leave with the account,
takes its rows off both leaderboards and out of the online count, and deletes its record, its
token and any GitHub link it had open; nothing of any other player's changes. From then on that token is unknown to the server.
On the server's confirmation the plugin resets this machine's data, as the reset does, starts a
fresh account on the same server, and says so in the message window once it plays. That launch has
no token, so it counts against the mint cap: when the server refuses it, play pauses and the message
window says the delete happened and why nothing plays, in one line,
`Promptfall: your account was deleted.` followed by the server's message, which stays through the
pause's later retries. When the server does not confirm, nothing on the machine changes and the
pane says the account was not deleted; in a banned session that line shows under the ban's. The
row is not on the sandbox save, nor in a session that is not playing, except one a ban paused, as
a banned account may delete itself: its Account tab shows the row, under Reset when the ban
refused the session's start, and the delete reaches the server with the stored token, the one call
of that session that does. The in-process server deletes the same way.

**World boss.** A shared enemy with one global HP spawns every three hours and lives twenty
minutes or until it dies, and every online party fights it at once. Meanwhile the party is in
boss mode: the boss stands alone on the stage, the enemy window shows its global HP bar,
percentage and time left, the bar dropping as the party's hits land, waves pause and tool calls
spawn nothing. In the compact layout, with no enemy window, the compact window's title carries the
boss's time left. A wipe in boss mode empties
every gauge and heals the party in place with no retreat, and the boss itself drops nothing. It
needs a server; the in-process fake runs none, and with the boss off the World tab's
records row ends in "world boss is off", shortening the records to keep it.

**Rewards.** When the world boss dies or expires, every party that dealt enough damage gets a
reward, and the top three damage dealers of a kill get one bonus roll each. Each reward toasts as
"Your share of …", and goods with no free slot wait in returns.

**Weekly hunt.** One target a week shared by everyone on the server, from Monday 00:00 UTC on the
server's clock: one enemy kind across every zone (casters, brutes, tanks, swifts) or zone bosses,
in turn from a table, each with a target such as 20,000 casters. The server counts every account's
kills of that kind as its batches commit, never a bot's, and the World tab's records row shows it
after the highest zone and the kills, as "Hunt: casters ████░░░░ 12,400 / 20,000, 3 days left".
A narrower row shortens the counts (`12.4k / 20k`), then the time and the label (`Hunt casters …
3d`), then the records (`Z9 K184 W90`), then the bar to four cells; then it tightens the counts
(`12k/20k`) and drops the bar to keep the short records, so the band's World tab at 120 columns
reads `Z1 K0 W0 · Hunt casters 12k/20k 3d`; then it drops the records with the bar back at four
cells and drops the bar last, so at 116 columns it still reads `Hunt casters ██░░ 12k/20k 3d`.
When the week ends every account that counted at least half
a percent of the target gets one reward rolled at its zone, whether or not the target was reached:
it toasts "Your share of the hunt: 120 gold and Oak Staff", the combat log says the same, and goods
with no free slot wait in returns. The next week's hunt opens then. It needs a server and the
`hunt.enabled` flag, on by default; with it off the records row says "hunt is off" in place, and
"world boss and hunt are off" with the boss off too, as on the in-process fake. The off notices
outlast the hunt and the records: a narrow row drops those first and ends in the notice.

## Servers

**The public server.** Promptfall's own server runs at `https://promptfall.kevinshibuya.com`: the
same rules as every other server, with the world boss on its three-hour grid, the market, chat and
the leaderboards, on the real clock. Linking there goes through GitHub itself. During the soft wave
six bots keep its market stocked; at the public listing it runs none. The README's privacy
paragraph says what it keeps about an account and for how long.

**The default server and `local`.** A fresh install, with no server set, plays on the public
server. `/promptfall server local` moves this machine to the in-process fake, which plays offline
with no chat, no world boss and no hunt; `/promptfall server <url>` moves it to any other server, and
`/promptfall server` says which one is in force. Each server has its own account on the machine,
and nothing moves between them. The sandbox always plays on the in-process fake, whatever the
setting.

**Updates.** The public server asks for the launch version, 0.3.0, or newer. An older plugin
pauses and the band asks for an update instead of being refused in silence.

## Interface

**The band.** The game draws in a band above the prompt with three tabs, Party, Loot and World,
on the letter hotkeys `p`, `l` and `w`, and `c` collapses it; the command line shows the key as a
dim `c ▾` at its right end. The Party, Loot and World tabs all show the stage over the strip, so
switching tabs changes the picture and never the band's height: 22 rows in every fight and on
every tab, the 17-row stage over the 5-row strip, and never more than Claude Code gives it. A half-block terminal
shows the same scene as the terminals that draw images and the desktop, with the same art, frames,
marks and timing, at fewer pixels: about two thirds of them, the heroes and enemies the same size
on screen as there, and damage numbers drawn as text. `/promptfall renderer raster` and `/promptfall
renderer image` switch one terminal between the two. With fewer rows a terminal that draws images
zooms the whole scene out to fit and the desktop scales it; a half-block terminal crops the sky
first, down to the tallest actor on the stage, then zooms what is left out the same way, so a
boss fight still shows the whole boss, down to a floor of 8 stage rows, under which a figure in
so few half-block rows would be a smear. Past that, or on terminals 100 to
115 columns wide, the band drops to a compact stage beside one window, then to a single row
under 100 columns. The compact window shows the tab's four rows: on Party the three heroes and the
front enemy, on Loot the newest four loot rows, on World who is online, the records row, chat and
a blank row; a notice takes the last row, and `j` and `k` do not page there. It never hides itself while Claude asks for a permission or a question; it
lays out at whatever size the rows left to it allow. In the terminal, though, Claude Code draws
the prompt in the band's place and stops drawing the band until the answer, so the party is not on
screen while a prompt waits (an engine finding, seen live on 2.1.299). The band comes back at the
answer.

**The playfield on the shell.** The band is one picture. A flat charcoal shell, the windows' own
field, fills the band's whole box, and on it sits the playfield: at most 160 columns wide and
centred, the stage with the strip beneath it on every tab,
edged by one white line with cut corners like the windows'. On a wide terminal the shell fills
the margins, and on a short one the zoomed-out stage and the strip still sit inside the line, so
the terminal's background never shows through the band (Ghostty and cmux keep the picture's
shape, so a sliver of terminal can show just above and below it). It draws as one image on Kitty, Ghostty
and cmux (up to 255 columns, past which the terminal shows beside the shell), as one half-block
picture on other terminals (where the line opens over a boss's head rather than cover it), and
as two stacked vector pictures, the stage's and the strip's, on
the desktop. The compact band is the same: its small stage and its window inside one line
on the shell. Only the one-row collapsed band stays engine text.

**The collapsed line.** Collapsed, the band is one line of text in the band's colours:
`Promptfall · Z3 w4 · K184 B90 W140 · 1,240g`, the game's name and the separators dim, the zone
and wave plain, each hero's initial and HP in the party window's colour for that HP (plain, orange
under a quarter, red at 0), the gold in gold, then any notice. It says `Sandbox` after the name in
the sandbox and `camping` after the wave while the party camps. A secondary session's line starts
`playing in another session`.

**The stage.** The stage is the animated battle in pixel art: the encounter's enemies on the left,
the party on the right, side-on, small against the zone's 1.5× backdrop painting, one per zone, so a boss
lands at its full size. The compact stage keeps its ground strip. Actors bob between two idle drawings and wind up and strike. Every attacker,
hero or monster, the world boss included, steps forward as it winds up, a hero toward the
enemies and a monster toward the party, the same few pixels for all, holds there through its blow and steps back as its action ends; the knight and the
enemies lunge from the stepped position. Fireballs, arrows and light bursts fly, hits flash white
with a rising damage number, heals rise green, the dead dissolve and a drop leaves a chest. A hero
stands and fights until the blow that kills him lands, then dims, and the party window's HP drops
with each hit as it lands, not when the game applies it. The stage is 17 rows in every fight and
never changes height, the party small on the zone's painting, so a boss lands at its full size. A
monster that steps on partway through a tick plays its first actions animated, on the desktop too.
Three moments get a scene of their own. When the party travels, the heroes step off to the right
and fade, the enemies it left stand until the backdrop changes to the destination's, and the
heroes step back on from the left; the log's "The party travels to zone 3, Marsh of Sighs." lands
as the backdrop changes. A level-up flashes the hero gold and its gains rise over it in gold,
"+3 atk  +2 def", for just over a second, slower than damage numbers so they can be read; when
several heroes level at once, each flashes and rises a quarter second after the one before, in
party order. When a zone boss falls, the party holds a victory pose over the empty ground for
about two seconds after the boss has dissolved. With Next zone it then walks to the next zone as on
a travel: it steps off once the pose and any chest are over, the backdrop changes, the arrival's
line and toast land, and it steps on. With Stay here it holds and stays; a turn boss and the world
boss get no hold.
The pose is a slot: on every surface it holds the class's drawn victory frame, the weapon raised,
and the idle art where a class has none; the compact stage holds the idle.
It draws inside the band's picture, as described under the playfield above. A terminal session asks
which picture it can draw, and lays the band out with the last session's answer while it waits, so
the band holds its height from the second session on.

**The strip.** The strip is the row of windows under the stage, drawn as Dragon Quest V draws
them: a charcoal field, a thin white line with cut corners, the game's pixel font. Left to right
come the enemy window (titled with the zone and wave, an HP bar per enemy, and a dim `+4 waiting`
cut into its bottom line while the wave's queue holds enemies), the message window, the party
window (each hero's name, level, HP bar and action gauge, the text orange under 25% HP and red at
0) and the purse (the gold in gold, the tactics, `f: Next zone` or `f: Stay here`, and the falls, `Falls 1/3`:
the zone's wipes out of the three that make a retreat, none in a world boss fight). Both counts
are the game's as it stands, not the stage's: a fall shows before its blow has played. The compact
layout has neither the enemy window nor the purse, so it shows neither the queue nor the falls. The
queue's count is the game's own, not the staged one: while a kill's replacement waits out the
dissolve, the line already reads the shorter queue. The stage
and every window draw the staged state, the fight as the stage has played it so far, so they never
run ahead of the picture: a killed monster keeps its row until its death has played, a wiped hero
falls on his blow and is up at full only once the field has cleared, a monster that leaves alive
keeps its HP through its fade, the title
stays on the wave or zone being watched until its last monster has dissolved, the backdrop changes
zone only then, so a zone boss dies against its own painting, and the world boss bar drops as the
party's hits land, the boss standing at an empty bar until the server lets it go. On the desktop, which redraws once
a tick, the HP bars drop at the moment each hit lands, as the action gauges fill between redraws.

**The command line.** The message window's first row, `▶Party Loot World c ▾`, is the band's
tabs with ▶ on the current one, and on World presence after them. Under it the message window
shows the combat log on Party, the loot log on Loot, and on World two fixed rows: the records row,
then chat.

**Paging the logs.** On Party and Loot, `j` pages the message window two rows back toward older
lines and `k` two rows forward; they do nothing in the compact or collapsed band, and the World
tab never pages. While paged back the command line's right end shows a footer in the pane's
shape, `5-6/61`, the rows shown out of the log's rows, before `c ▾`; at the newest there is none,
and a narrow message window shortens the footer to `5/61`, then `/61`, before it drops it, and
always keeps the hint. A new line while paged back
leaves the window where it is; at the newest the window follows the new lines. A tab switch, `c`,
a compact layout and a travel to another zone put the window back at the newest. No line is ever
cut with an ellipsis: every log line wraps over the rows it needs, the newest position shows the
tail, and `j` reaches a long line's head. A notice, or the camp's `g: back to the fight`, wraps in
full and is the newest of the paging: with one up the window shows its first rows, the footer
says when there is more, `k` pages on through it and `j` back into the log.

**The pane.** `/promptfall` opens the pane on nine tabs: Inventory, Heroes, Market, Orders,
Account, Odds, Journal, Chat and Leaderboards, named in a tab window with each hotkey letter in gold. Each
tab is a list window with a ▶ cursor, a detail window beside it, and a two-line message window at
the foot saying what the keys do. Tab or the arrows move the ▶, Enter runs the row or opens its
command window, `q` backs out and Escape closes; Vendor, Dismiss, Buy, the cancels and Reset ask
Yes or No first. Long lists page with a footer such as `16-30/40`.

**Account tab.** The Account tab holds the settings as rows (Sound, Motion, Renderer, and
Auto-vendor off or on, the one kept with the account rather than the machine), the rest days, the
band shown or collapsed, Band off, Link GitHub, a reset of this machine's data and Delete my
account on this server, each of the last two asking Yes or No. The rest-days row, "Rest days: Sat,
Sun", is the account's too and reads the journal, which the tab loads on open: Enter opens a pick
of the seven days with the two in force marked, and the second day picked sends the pair to the
server, which applies it from the next Monday. Until that Monday passes the row reads "Rest days:
Sat, Sun (Tue, Thu from Monday)"; a refusal flashes in the message window. A session that is not
playing shows Auto-vendor and the rest days and cannot change them. Its detail window names the
server, the client, the mode and the session.

**Odds tab.** The Odds tab publishes the drop, rarity and tavern odds for the current zone, and
sells the inventory and roster expansions. Past tier 1 its title and its message name the tier
("Odds · tier 2, zone 1") and the table shows zone 12's odds, which every zone of tiers 2 and 3 drops at. Under
the tables three rows publish the tavern guarantee from the save's own counts, "Rare guaranteed in
13 recruits", "Epic guaranteed in 61 recruits" and "Legendary guaranteed in 377 recruits" ("on the
next recruit" at one), then it says that rarity multiplies base stats, heroes and items alike, and
that reforge is priced by rarity and tier. On the Heroes tab the recruit row's detail gives the
price and the nearest guarantee in one line ("120G · Rare guaranteed in 13").

**Journal tab.** The Journal tab, on `u`, keeps the player's record. Today shows the daily goal
with its progress, "Resets in 5 h" from the server's clock and the streak in work days. The goal
shows as soon as the tab opens; the progress, the reset and the streak arrive with the journal read,
with "Loading…" in their place until then. Bestiary lists one row per zone reached, all twelve
past tier 1, each with its enemies defeated out of six. Collection and Achievements follow. Enter
on a zone opens its page: the six enemies with how often each was seen and defeated, a `*` on each
defeated at least once, the zone boss in orange, and Travel here (`t`), which is left out on the
zone the party is in. The Collection page lists every item base with five rarity letters,
`C U R E L`, lit in each rarity the party has held it in. The Achievements page shows each ladder
as one row of step marks with the next step's gold and the date of the last step crossed, and each
one-off with its mark and date. `q` backs out of a page. The bestiary and the collection count from
the version that brought them. A session that is not playing reads the Journal and writes nothing.
`/promptfall journal` opens the pane on it. Unequip in an item's command window is on `n`, since
`u` is the Journal's.

**Motion.** Motion is full by default; set to still, the idle bob stops while attacks and hits
still play. It is set with `n` on the Account tab or `/promptfall motion full|still`.

**The `/promptfall` verbs.** `/promptfall <tab>` opens the pane on that tab, `journal` among
them. `off` and `on` hide and show the band for the session while play goes on, `farm` flips the
tactics, `travel <zone>` moves the party to a zone it has reached, `autovendor on`
and `autovendor off` set the account's auto-vendor setting (any other word answers the usage),
and `server <url>` or `server local` points the machine at an HTTP server or at the in-process
fake, each with its own account; `server` alone says which is in force. A fresh install, with no server set, plays on
the public server. `sound off|quiet|normal|loud`, `motion full|still` and
`renderer auto|image|raster` set the machine's settings.

**Primary session.** One session per account plays; running a gameplay verb or typing a prompt in
another session makes that one the primary. A prompt goes through at once and the band catches up
when the server answers. Every other session draws read-only and says "playing in another
session"; on the in-process save it writes nothing either, so expired listings and the world boss
wait for the primary. A primary that has paused (an update to install, a save to reset) answers
trades, `farm`, `autovendor`, `travel` and the sandbox verbs with "Promptfall is paused" instead. A session that stops playing drops its banner, and the new primary does not toast again
what the old one already toasted, nor leaves out what arrived after the old one last looked.
Claude's work reaches the fight only in the primary: another session's tool calls, turns,
failures, compactions and permission prompts spawn and change nothing.
Claude Code's agents view (← from an empty prompt) moves the conversation into a background process
of its own and keeps a spare one warm beside it; coming back attaches the terminal to the
conversation's process. The process left behind draws nowhere, so within a couple of seconds it
flushes, steps back and lets the lease go, and the process the conversation moved to picks it up a
couple of seconds later: the band plays on with no command. The spare never takes a free lease; it
plays only once a prompt or a `/promptfall` verb in it claims one. Claude Code starts those
background processes with pictures off; one started from Ghostty, cmux or kitty, outside tmux or
screen, turns them back on for itself unless the renderer is set to raster, so the band comes back
as the same image it left.
A session that becomes primary more than ten minutes after this account was last seen playing on
this machine says what the party did since, in a toast and for 20 seconds in the message window:
"Since Tuesday: 412 kills, 3 bosses, 2 levels, 1 Legendary, 2 Epics, 1,200 gold, zone 5 reached.
Today's goal: kill 40 enemies." It names the weekday when a day or more has passed and says
"Since your last session" under a day, leaves out what did not change, and says nothing when
nothing did.
A shorter break says nothing and loses nothing: the next summary still counts it. The play counted
runs from the last summary, and a reset starts it over.

**Server status.** When the server stops answering or refuses a batch, the band says "server
unreachable, retrying" and play goes on for two minutes, then pauses until the server answers
again. The first answer sends everything played during the outage at once. When the server runs a
newer game than the plugin, the band asks for a plugin update. A save from an older game is
migrated by the server the first time it loads it, heroes, items and gold kept, and the local and
sandbox saves the same way; the band asks for a reset from the Account tab only when the server
cannot migrate it, and the server's log says why. When the server will not make this machine
an account (too many new ones from its address this hour), the band shows the server's message
and the plugin asks again five minutes later. A banned account's band shows the ban and its reason,
and play stays paused until a new session asks again.

## Notifications and cues

**Toasts.** Only the primary session toasts, one sentence per event worth a glance: a Rare or
better drop, a recruit, a level-up, a zone arrival, a wipe, a retreat, a boss reward, a sale, a purchase, a
return, a world boss appearing or going down, a revoked item, a Rare or better drop vendored
for lack of room, an achievement step ("Achievement: ten thousand kills, 1,500 gold") and the
daily goal met ("Daily goal met: 40 gold"). A gold credit whose reason is neither, such as a bot's
stipend, toasts nothing, and neither of the two prints a log line. Everyday toasts last four seconds and the weighty ones (a legendary drop, a
recruit, a reward, a retreat, a world boss appearing, a revoked item) eight. Effects of one kind that
land in the same burst, such as a boss kill levelling the party or a day of sales arriving at
once, fold into one toast with the count and the sum ("3 items sold for 410 gold"), while a
legendary, epic or rare drop, a vendored item, a recruit, a reward, a wipe, a retreat, a zone
arrival, an achievement or a goal met keeps its own. Achievements never fold: each toasts its
step's words and gold, oldest first. Toasts follow the game, not the stage, except a held line: a drop's or a vendored item's
toast lands at its reveal, as the item rises out of the chest, and a zone arrival's with the new
backdrop, after the boss's drop toast; either lands at once when no band is drawn.
A wipe or retreat toast can show up to one cadence before the last hero falls on the stage. A world boss already up when the session first polls toasts its arrival with no cue.
Routine combat, the reactive events, a clear while staying and chat never toast, the open pane holds toasts until it closes,
and the session raises two toasts of its own: a first launch's welcome that points at the Heroes tab,
and the session summary when a session becomes primary after a break (under Primary session).

**Cues.** Nine toasts also play a cue: a Rare or Epic drop, a Legendary drop, a level-up, a
world boss appearing, a zone arrival (the zone-cleared cue), a recruit, a retreat, an achievement
and a goal met (both the goal cue); a wipe plays none. A burst plays each of its cues once, after its toasts; a held toast's cue plays with it, so
a drop's lands at the reveal and a zone arrival's with the new backdrop. Only the primary session
plays them, and hiding the band does not silence them. The set holds eight cues, one family
written by `pnpm cues` and checked in CI.

## Sound

**Volume.** Sound is on by default, at quiet. The volume is one setting per machine with four
steps, off, quiet, normal and loud, which play the cues at a quarter, half and all of the engine's
default gain. The Account tab's row reads "Sound: quiet" and `s` cycles the four steps;
`/promptfall sound off|quiet|normal|loud` sets one and answers it, `on` still works and means
quiet. The setting survives a reset of the machine's data. A first launch's welcome notice says
sound is on and that `/promptfall sound off` silences it, unless the setting is off.

**Silent here.** Claude Code plays the cues on macOS and in the desktop app; a Linux or Windows
terminal has no player and skips them. The first cue a terminal skips or cannot play marks the
session: it stops trying, the Account row reads "Sound: quiet, silent here" and the detail window
explains that this system has no audio player and the setting is kept. The mark is the
session's: the stored step is untouched, and the next session tries again.

**The switch to on.** A machine that stored sound as on or off before the volume steps reads as
quiet, since that value was mostly written by the renderer probe, not chosen. The first session
to start there rewrites it and, once it plays, toasts once, for 8 seconds, "Sound is now on by
default. /promptfall sound off silences it."

## Sandbox

**The switch.** Starting Claude Code with `PROMPTFALL_SANDBOX=1` turns the sandbox on for that
session: the game plays on the in-process fake whatever server the machine points at, with chat
and the hunt off and the world boss on, and `/promptfall server` answers that the sandbox pins the server.
Without the variable the `sandbox` verb is not in the command's hint, and typing it anyway answers
"Sandbox is off. Start Claude Code with PROMPTFALL_SANDBOX=1."

**The sandbox save.** The sandbox plays a separate save with its own account, which it keeps
across sessions like the real one. The real party is never read or changed, and a sandbox session
and a real session can play side by side. The settings (sound, motion, renderer) are the
machine's and stay shared. The sandbox account never links to GitHub: the Account tab has no Link
GitHub row.

**The mark.** The message window is titled `Sandbox` on every tab while the save is a sandbox one,
so a screenshot of the sandbox is never mistaken for real play; outside the sandbox it has no
title. The collapsed line says `Sandbox`, and the compact band's title adds `· Sandbox` when it
fits. The enemy window's title does not change, and the purse shows the tactics as in real play.

**The verbs.** `/promptfall sandbox <verb>` hands out what play would earn, each answering in one
line once the grant is in the view; `/promptfall sandbox` alone lists them. `boss <name>` makes a
zone boss or turn boss the next encounter, moving the party to its zone. `worldboss` spawns a
world boss and engages the party; `worldboss end` settles it and pays every engaged party. Each
answers once the boss's "appeared" or "down" toast has shown, and refuses while a boss is already
live or when none is. The sandbox keeps the world boss's own schedule, so one can also appear by
itself. `item <base> [rarity]`: the front hero
strikes the front monster down and the item, common unless a rarity is given, is that kill's drop,
with the kill's XP and gold, and a zone boss's kill clears its zone. With no monster on the field,
between spawns or against a world boss, the item drops alone: against a world boss its chest
falls on the boss, and between spawns a chest on the empty ground still plays on the front slot,
the next monster stepping on after it. With the inventory full, or when the auto-vendor setting
sells it, it is vendored, as in play, and the reply says which: `vendored, inventory full`, or
`auto-vendored` with the gold the vendor paid. `level <hero> <n>` raises a hero level by level up to its rarity's cap. `gold <n>` adds
gold. `zone <n>` moves the party to that zone at wave 1, any zone up to the ladder's end at 36,
and refuses past it with the range. `recruit [rarity]` recruits a hero, and
refuses with a full roster. `wipe` makes the party fall now: it restarts the
zone, and the third in a zone retreats. `boss`, `zone` and `wipe` refuse while
the party fights a world boss. `reset` throws the sandbox save away and starts a fresh one in
place. Names match by the start of a name, any word in it or its id, and an ambiguous or unknown
name answers with the candidates.

## Planned

Wishes, not features. Nothing here exists yet.

- **Cinematic intro.** The game's logo in pixel art, an animation, and a transition into the game
  view.
