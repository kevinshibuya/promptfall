# Phase 2 manual pass

Run from the repository root on a terminal at least 100 columns wide, with two terminals open.
Each step says what you should see. A step that shows something else is a red.

## Part A: ledger, HTTP fake, outages, link flow (PR 1)

1. **Start the fake.** In the first terminal run `pnpm fake --port 7777 --player-name <your name>`.
   One line appears: `promptfall fake on http://127.0.0.1:7777 seed 1 speed 1 data <path>`, the
   path ending in `.promptfall/fake.json`.
2. **Play on it.** In the second terminal run `claude --plugin-dir plugins/promptfall`, then
   `/promptfall server http://127.0.0.1:7777`. The reply reads
   `Promptfall now plays on http://127.0.0.1:7777`. `/promptfall account` shows
   `Server: http://127.0.0.1:7777` on the Account tab. The account is fresh (zone 1, 0 gold, the
   welcome line), since nothing moves between servers. The band ticks as in phase 1.
3. **Kill the fake.** Press Ctrl-C in the first terminal. Within 15 seconds the band's status row
   reads `Promptfall: server unreachable, retrying`. The band keeps ticking for two minutes, then
   the status row reads `Promptfall: server unreachable` and HP stops moving.
4. **Bring it back.** Run the step 1 command again, same `--data`. Within 45 seconds the notice
   clears and ticking resumes, with the progress made during the outage kept (gold did not reset).
5. **Link GitHub.** `/promptfall account`, press `Link GitHub`. A line reads
   `Enter <8-character code> at https://github.com/login/device`. Within 5 seconds it becomes
   `Linked as <your name>`.
6. **Back to the in-process ledger.** Run `/promptfall server local`. The reply reads
   `Promptfall now plays on in-process`.
   - With a phase 1 store on this machine, the band is one line reading
     `Promptfall · Promptfall: this machine's data is from an older version, reset it in
     /promptfall account`. `/promptfall account` shows `Server: in-process` and a
     `Reset this machine's data` button. Pressing it starts a fresh account: the band comes back
     at zone 1 with the welcome line.
   - With no phase 1 store, a fresh account starts directly.
7. **Look at the snapshot.** Quit both. `head -c 300 .promptfall/fake.json` shows JSON starting
   `{"clock":{"virtualAt":` followed by the `kv` map with `pf:` keys.

## Part B: market, orders, hero trading, bots (PR 2)

The fake runs at speed 10 here: virtual time, the bots and every server deadline move ten times
faster than the wall clock, and the dialog shows real time left.

1. **Set up.** Run `pnpm fake --port 7777 --speed 10 --player-name <you>`. In the plugin session,
   switch to it and link (part A steps 2 and 5). Play until you have at least 200 gold: a fresh
   account starts at 0.
2. **Browse.** `/promptfall market`. Within 30 seconds the tab lists items from bots, seller names
   such as `Hollis` or `Kestrel`. Heroes listed by bots appear within a few minutes (`items`
   toggles to `heroes`). `m`, `r` and `i` switch between Market, Orders and Inventory. `next`
   pages when there are more than 10. Picking a base in `Base` filters the list and goes back
   to page 1.
3. **Buy.** Press `buy` on the cheapest item you can afford. A line asks
   `Buy <name> for <price>g?`. Press `y`. A toast reads `Bought <name> for <price>g`. The item is
   on the Inventory tab, gold is down by the price, and the loot log shows
   `bought <name> for <price>g`.
4. **Sell.** Press `sell` on the item you just bought: the panel reads `Tradeable in 2h` (24
   virtual hours at speed 10) and has no price field. Press `close`, then `sell` on a Rare+ drop
   of your own. The price field takes a number, and `fee <n>g · you get <n>g` updates as you
   type. Press Enter or `list`. The item leaves the inventory, and the Orders tab lists it with
   `expires in 16h`.
5. **A bot buys.** Price an item under four times its vendor value. Within 2 minutes a bot buys
   it: a toast reads `Sold <name> for <net>g` and gold rises by the net.
6. **Place and cancel an order.** On the Orders tab press `New order`, pick a base, rarity `rare`,
   affix `none`, type a max price and press Enter. The order is listed under `My buy orders` and
   gold drops by the price (the escrow). Press its `cancel`: gold comes back.
7. **Fill a bot's order.** Bots order rare items of random bases. `sell` on a Rare+ item of a
   base someone ordered shows `Matching orders` first, each `accept <price>g, you get <net>g`.
   Press `accept`: the item leaves and gold rises by the net.
8. **Heroes.** On the Heroes tab, `sell` on a Rare+ hero in the party reads `in party`. On a
   spare hero wearing gear it reads `unequip first` with an `unequip` button per slot. On a bare
   spare hero the price form appears: list it, then cancel it on the Orders tab. It comes back at
   the same level.
9. **Returns.** List an item, then fill the inventory to its cap (30). Cancel the listing: the
   Orders tab reads `Returns waiting: 1`. Vendor one item. Within 15 seconds the listed item is
   back in the inventory, and reopening the Orders tab no longer shows the count.
10. **In-process.** Run `/promptfall server local` (after the part A reset, if this machine had
    phase 1 data). The Market tab reads `Link your GitHub account: press a for the Account tab`
    until you link on the Account tab, which takes 5 seconds there. Listings are empty (no bots
    in-process), and `New order` works.
11. **Restart slower.** Run `/promptfall server http://127.0.0.1:7777` again, stop the fake, and
    start it with the same command at `--speed 1`. Nothing is lost, and the Orders tab's
    `expires in` now reads in real days, such as `6d 23h`.
