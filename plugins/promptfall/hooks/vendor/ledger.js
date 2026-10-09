// packages/ledger/src/blocklist.ts
var BLOCKED_WORDS = ["heck", "darn", "frick", "blockedword"];
var blocked = new Set(BLOCKED_WORDS);
function isBlocked(text) {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((word) => blocked.has(word));
}

// packages/ledger/src/books.ts
import {
  BUDGETS
} from './protocol.js';
import {
  hashState,
  replay,
  SIM_VERSION,
  step
} from './sim.js';
var BATCH_RING = 200;
var LOG_CAP = 500;
var KINDS = Object.keys(BUDGETS);
var recordKey = (accountId) => `pf:acct:${accountId}:record`;
var tokenKey = (token) => `pf:token:${token}`;
var linkKey = (code) => `pf:link:${code}`;
var RETURNS_KEY = "pf:returns";
function everyKind(value) {
  const out = {};
  for (const kind of KINDS) out[kind] = value;
  return out;
}
function fullBuckets() {
  const out = {};
  for (const kind of KINDS) out[kind] = BUDGETS[kind].capacity;
  return out;
}
function isCurrent(record) {
  return record.state.v === SIM_VERSION;
}
function publicName(record) {
  const raw = record.account.displayName ?? record.account.linked?.login ?? null;
  if (raw === null) return "adventurer";
  const name = raw.replace(/\p{Cc}/gu, "");
  if (name.trim() === "" || isBlocked(name)) return "adventurer";
  return name;
}
function newRecord(account, state, now) {
  return {
    account,
    state,
    seq: 0,
    refillAt: everyKind(now),
    buckets: fullBuckets(),
    batches: [],
    cursor: 0,
    committedCursor: 0,
    committedState: state,
    committedHash: hashState(state),
    log: [],
    returns: []
  };
}
function deliveryOf(record) {
  if (!isCurrent(record)) return { cursor: 0, events: [] };
  return { cursor: record.cursor, events: record.log.map((e) => ({ ...e })) };
}
function settle(record) {
  record.committedState = record.state;
  record.committedCursor = record.cursor;
  record.committedHash = hashState(record.state);
  record.log = [];
}
function author(record, event) {
  const refused = tryAuthor(record, event);
  if (refused !== null) throw new Error(`ledger authored an unapplicable event: ${refused}`);
}
function tryAuthor(record, event) {
  const r = step(record.state, event);
  const refused = r.effects.find((e) => e.k === "rejected");
  if (refused?.k === "rejected") return refused.reason;
  record.state = r.state;
  record.cursor += 1;
  record.log.push({ n: record.cursor, event });
  while (record.log.length > LOG_CAP) {
    const oldest = record.log.shift();
    if (!oldest) break;
    record.committedState = replay(record.committedState, [oldest.event]).state;
    record.committedCursor = oldest.n;
    record.committedHash = hashState(record.committedState);
  }
  return null;
}
function hasRoom(state, goods) {
  return goods.kind === "item" ? state.inventory.length < state.inventoryCap : state.roster.length < state.rosterCap;
}
var TrackedKeyValue = class {
  constructor(inner) {
    this.inner = inner;
  }
  inner;
  dirty = false;
  get(key) {
    return this.inner.get(key);
  }
  set(key, value) {
    this.dirty = true;
    return this.inner.set(key, value);
  }
  delete(key) {
    this.dirty = true;
    return this.inner.delete(key);
  }
  async flush() {
    if (!this.dirty) return;
    await this.inner.flush?.();
    this.dirty = false;
  }
};
var Books = class {
  constructor(kv) {
    this.kv = kv;
  }
  kv;
  async load(accountId) {
    const raw = await this.kv.get(recordKey(accountId));
    return raw ? raw : null;
  }
  async save(record) {
    await this.kv.set(recordKey(record.account.accountId), record);
  }
  async accountFor(token) {
    const raw = await this.kv.get(tokenKey(token));
    return typeof raw === "string" ? raw : null;
  }
  async authenticate(auth) {
    const accountId = await this.accountFor(auth.deviceToken);
    return accountId ? this.load(accountId) : null;
  }
  async returnsQueue() {
    const raw = await this.kv.get(RETURNS_KEY);
    return Array.isArray(raw) ? raw : [];
  }
  /** Keeps `pf:returns` in step with the record's `returns`. Call before saving the record. */
  async syncReturnsQueue(record) {
    const queue = await this.returnsQueue();
    const id = record.account.accountId;
    const listed = queue.includes(id);
    const waiting = record.returns.length > 0;
    if (waiting && !listed) await this.kv.set(RETURNS_KEY, [...queue, id]);
    if (!waiting && listed)
      await this.kv.set(
        RETURNS_KEY,
        queue.filter((q) => q !== id)
      );
  }
  /**
   * Delivers waiting returns where a slot is free, oldest first. An entry
   * without a slot is skipped and does not block the next kind. Mutates the
   * record; the caller saves it.
   */
  async deliverReturns(record) {
    if (!isCurrent(record) || record.returns.length === 0) return;
    const kept = [];
    for (const entry of record.returns) {
      if (hasRoom(record.state, entry.goods)) {
        author(record, { t: "returned", listingId: entry.listingId, goods: entry.goods });
      } else {
        kept.push(entry);
      }
    }
    record.returns = kept;
    await this.syncReturnsQueue(record);
  }
};

// packages/ledger/src/boss-config.ts
var WORLD_BOSSES = [
  { name: "The Promptwyrm", glyph: "\u2620" },
  { name: "Hallucinox", glyph: "\u25C8" },
  { name: "The Context Leviathan", glyph: "\u224B" },
  { name: "Tokenmaw", glyph: "\u2736" }
];

// packages/ledger/src/goods.ts
import {
  heroStats,
  RARITIES
} from './sim.js';
var DAY_MS = 864e5;
var WEEK_MS = 6048e5;
var COOLDOWN_MS = DAY_MS;
var EXPIRY_MS = WEEK_MS;
var MIN_PRICE = 1;
var MAX_PRICE = 1e6;
function listingFee(price) {
  return Math.max(1, Math.floor(price * 200 / 1e4));
}
function saleFee(price) {
  return Math.floor(price * 500 / 1e4);
}
function saleNet(price) {
  return price - saleFee(price);
}
function validPrice(price) {
  return Number.isInteger(price) && price >= MIN_PRICE && price <= MAX_PRICE;
}
function tradeableRarity(rarity) {
  return RARITIES.indexOf(rarity) >= RARITIES.indexOf("rare");
}
function atLeast(rarity, min) {
  return RARITIES.indexOf(rarity) >= RARITIES.indexOf(min);
}
function goodsBase(goods) {
  return goods.kind === "item" ? goods.item.base : goods.hero.template;
}
function goodsRarity(goods) {
  return goods.kind === "item" ? goods.item.rarity : goods.hero.rarity;
}
async function transfer(goods, now, nextId, receiver) {
  const tradeableAt = now + COOLDOWN_MS;
  if (goods.kind === "item") {
    const id2 = goods.item.id.startsWith("t") ? goods.item.id : await nextId();
    const item = { ...goods.item, id: id2, equippedBy: null, tradeableAt };
    return { kind: "item", item };
  }
  const id = goods.hero.id.startsWith("t") ? goods.hero.id : await nextId();
  const hero = {
    ...goods.hero,
    id,
    level: 1,
    xp: 0,
    equipment: { weapon: null, armour: null, accessory: null },
    tradeableAt
  };
  hero.hp = heroStats(receiver, hero).hp;
  return { kind: "hero", hero };
}

// packages/ledger/src/ids.ts
var COUNTER_KEY = "pf:counter";
async function nextLedgerId(kv, prefix) {
  const raw = await kv.get(COUNTER_KEY);
  const n = typeof raw === "number" ? raw : 0;
  await kv.set(COUNTER_KEY, n + 1);
  return prefix + n.toString(36);
}

// packages/ledger/src/ledger.ts
import {
  BatchSchema,
  BUDGETS as BUDGETS2,
  compareSemver,
  PRESENCE_TTL_MS,
  ServerEventSchema
} from './protocol.js';
import {
  createInitialState,
  hashState as hashState2,
  replay as replay2,
  SANDBOX_EVENT_KINDS,
  SIM_VERSION as SIM_VERSION2
} from './sim.js';

// packages/ledger/src/boss.ts
import {
  BOSS_BASE_HP,
  BOSS_GRID_MS,
  BOSS_THRESHOLD_BP,
  BOSS_TOP_BONUS,
  BOSS_WINDOW_MS,
  weekStartOf as weekStartOf2
} from './protocol.js';
import {
  content,
  rollRewardItem
} from './sim.js';

// packages/ledger/src/world.ts
import {
  BOARD_ROWS,
  CHAT_BUCKET_CAPACITY,
  CHAT_KEEP,
  CHAT_MAX_CHARS,
  CHAT_REFILL_MS,
  CHAT_SERVE,
  HERE_MAX,
  weekStartOf
} from './protocol.js';
var CHAT_KEY = "pf:chat";
var BOARDS_KEY = "pf:boards";
async function loadChat(kv) {
  const raw = await kv.get(CHAT_KEY);
  return raw ?? { nextId: 1, messages: [] };
}
async function loadBoards(kv, now) {
  const raw = await kv.get(BOARDS_KEY);
  return raw ?? { zone: [], week: { start: weekStartOf(now), damage: {} } };
}
function prune(ctx) {
  for (const [id, entry] of ctx.presence) {
    if (!(ctx.now - entry.at < ctx.ttl)) ctx.presence.delete(id);
  }
}
async function world(ctx, record, since) {
  const presenceOn = ctx.flags["presence.enabled"] !== false;
  const id = record.account.accountId;
  prune(ctx);
  if (presenceOn && isCurrent(record)) {
    ctx.presence.set(id, { zone: record.state.zone, name: publicName(record), at: ctx.now });
  }
  let online = 0;
  let zones = [];
  let here = [];
  if (presenceOn) {
    const counts = /* @__PURE__ */ new Map();
    for (const entry of ctx.presence.values()) {
      counts.set(entry.zone, (counts.get(entry.zone) ?? 0) + 1);
    }
    online = ctx.presence.size;
    zones = [...counts.entries()].sort(([a], [b]) => a - b).map(([zone, count]) => ({ zone, count }));
    const mine = ctx.presence.get(id);
    if (mine) {
      here = [...ctx.presence.entries()].filter(([other, entry]) => other !== id && entry.zone === mine.zone).sort(([, a], [, b]) => b.at - a.at).slice(0, HERE_MAX).map(([, entry]) => entry.name);
    }
  }
  const boss = await loadBoss(ctx.books.kv);
  if (boss && ctx.flags["worldboss.enabled"] !== false && isLive(ctx, boss) && (!presenceOn || ctx.presence.has(id)) && isCurrent(record) && !(id in boss.contributions)) {
    engage(record, boss);
    await ctx.books.save(record);
    await ctx.books.kv.set(BOSS_KEY, boss);
  }
  let chat2 = [];
  if (ctx.flags["chat.enabled"] !== false) {
    const { messages } = await loadChat(ctx.books.kv);
    chat2 = since <= 0 ? messages.slice(-CHAT_SERVE) : messages.filter((m) => m.id > since);
  }
  return {
    serverNow: ctx.now,
    speed: ctx.speed,
    online,
    zones,
    here,
    boss: toBossView(ctx, boss, id),
    chat: chat2,
    flags: ctx.flags
  };
}
function refillChat(bucket, now) {
  if (!bucket) return { tokens: CHAT_BUCKET_CAPACITY, refillAt: now };
  const n = Math.floor(Math.max(0, now - bucket.refillAt) / CHAT_REFILL_MS);
  const tokens = Math.min(CHAT_BUCKET_CAPACITY, bucket.tokens + n);
  return {
    tokens,
    refillAt: tokens === CHAT_BUCKET_CAPACITY ? now : bucket.refillAt + n * CHAT_REFILL_MS
  };
}
async function chat(ctx, record, text) {
  if (ctx.flags["chat.enabled"] === false) return { ok: false, reason: "chat_closed" };
  if (!record.account.linked) return { ok: false, reason: "not_linked" };
  const trimmed = text.replace(/\p{Cc}/gu, "").trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (trimmed.length > CHAT_MAX_CHARS) return { ok: false, reason: "too_long" };
  if (isBlocked(trimmed)) return { ok: false, reason: "blocked" };
  const bucket = refillChat(record.chat, ctx.now);
  if (bucket.tokens < 1) return { ok: false, reason: "rate_limited" };
  record.chat = { tokens: bucket.tokens - 1, refillAt: bucket.refillAt };
  const stored = await loadChat(ctx.books.kv);
  const message = {
    id: stored.nextId,
    name: publicName(record),
    text: trimmed,
    at: ctx.now
  };
  await ctx.books.save(record);
  await ctx.books.kv.set(CHAT_KEY, {
    nextId: stored.nextId + 1,
    messages: [...stored.messages, message].slice(-CHAT_KEEP)
  });
  return { ok: true, message };
}
async function leaderboards(ctx) {
  const weekStart = weekStartOf(ctx.now);
  if (ctx.flags["leaderboards.enabled"] === false) {
    return { highestZone: [], damage: [], weekStart };
  }
  const boards = await loadBoards(ctx.books.kv, ctx.now);
  const damage = boards.week.start === weekStart ? Object.entries(boards.week.damage).map(([accountId, { name, value }]) => ({ accountId, name, value })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)).slice(0, BOARD_ROWS) : [];
  const highestZone = [];
  for (const row of boards.zone)
    if (await isPlaying(ctx.books, row.accountId)) highestZone.push(row);
  return { highestZone, damage, weekStart };
}
async function isPlaying(books, accountId) {
  const record = await books.load(accountId);
  return record !== null && isCurrent(record);
}
async function offerZone(kv, now, row, keep = async () => true) {
  const boards = await loadBoards(kv, now);
  const before = JSON.stringify(boards.zone);
  const rows = [];
  for (const r of boards.zone) {
    if (r.accountId === row.accountId || await keep(r.accountId)) rows.push({ ...r });
  }
  const mine = rows.find((r) => r.accountId === row.accountId);
  if (mine) {
    mine.name = row.name;
    mine.value = Math.max(mine.value, row.value);
  } else {
    const last = rows.at(-1);
    if (rows.length < BOARD_ROWS || last && row.value > last.value) rows.push({ ...row });
  }
  rows.sort((a, b) => b.value - a.value);
  const zone = rows.slice(0, BOARD_ROWS);
  if (JSON.stringify(zone) === before) return;
  await kv.set(BOARDS_KEY, { ...boards, zone });
}

// packages/ledger/src/boss.ts
var BOSS_KEY = "pf:world:boss";
function bossStats() {
  const stats = content.enemies[content.zones[0]?.boss ?? ""]?.stats;
  if (!stats) throw new Error("content has no zone 1 boss");
  return { ...stats };
}
async function loadBoss(kv) {
  const raw = await kv.get(BOSS_KEY);
  return raw ?? null;
}
async function saveBoss(kv, boss) {
  await kv.set(BOSS_KEY, boss);
}
function toBossView(ctx, boss, accountId) {
  if (!boss || ctx.flags["worldboss.enabled"] === false || ctx.now >= boss.endsAt) return null;
  const { bossId, name, glyph, maxHp, hp, spawnedAt, endsAt } = boss;
  return {
    bossId,
    name,
    glyph,
    maxHp,
    hp,
    spawnedAt,
    endsAt,
    yours: boss.contributions[accountId] ?? 0
  };
}
function isLive(ctx, boss) {
  return !boss.closed && boss.hp > 0 && ctx.now < boss.endsAt;
}
function engage(record, boss) {
  if (!isCurrent(record)) return;
  const engaged = record.state.boss;
  if (engaged?.bossId !== boss.bossId) {
    if (engaged) author(record, { t: "boss_disengaged", bossId: engaged.bossId });
    author(record, {
      t: "boss_engaged",
      bossId: boss.bossId,
      name: boss.name,
      glyph: boss.glyph,
      stats: bossStats()
    });
  }
  boss.contributions[record.account.accountId] ??= 0;
}
function disengage(ctx, record, bossId) {
  if (record.state.boss?.bossId === bossId) {
    author(record, { t: "boss_disengaged", bossId });
    return;
  }
  ctx.log(`boss ${bossId}: ${record.account.accountId} was not engaged, nothing to disengage`);
}
function partyClasses(state) {
  const classes = [];
  for (const id of state.party) {
    const hero = state.roster.find((h) => h.id === id);
    if (hero) classes.push(hero.cls);
  }
  return classes;
}
function rewardGold(rarity, zone) {
  return 3 * content.rarity[rarity].vendorGoldPerZone * zone;
}
async function settleBoss(ctx, boss, options) {
  const kv = ctx.books.kv;
  const threshold = Math.floor(BOSS_BASE_HP * BOSS_THRESHOLD_BP / 1e4);
  const top = Object.entries(boss.contributions).filter(([, value]) => value > 0).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0)).slice(0, BOSS_TOP_BONUS).map(([id]) => id);
  for (const [id, contribution] of Object.entries(boss.contributions)) {
    const record = options.inHand?.account.accountId === id ? options.inHand : await ctx.books.load(id);
    if (!record || !isCurrent(record)) continue;
    const rolls = (options.allPaid || contribution >= threshold ? 1 : 0) + (!options.expired && top.includes(id) ? 1 : 0);
    for (let i = 0; i < rolls; i++) {
      const zone = record.state.zone;
      const rolled = rollRewardItem(ctx.seedSource() >>> 0, zone, partyClasses(record.state));
      if (!rolled) {
        author(record, {
          t: "rewarded",
          bossId: boss.bossId,
          goods: null,
          gold: rewardGold("rare", zone)
        });
        continue;
      }
      const item = { ...rolled, id: await nextLedgerId(kv, "r") };
      const goods = { kind: "item", item };
      const gold = rewardGold(item.rarity, zone);
      if (hasRoom(record.state, goods)) {
        author(record, { t: "rewarded", bossId: boss.bossId, goods, gold });
      } else {
        record.returns.push({ listingId: boss.bossId, goods });
        author(record, { t: "rewarded", bossId: boss.bossId, goods: null, gold });
      }
    }
    await ctx.books.syncReturnsQueue(record);
    disengage(ctx, record, boss.bossId);
    await ctx.books.save(record);
  }
  boss.closed = true;
  await saveBoss(kv, boss);
}
async function settleIfOver(ctx, stored) {
  const on = ctx.flags["worldboss.enabled"] !== false;
  if (stored && !stored.closed && (ctx.now >= stored.endsAt || !on)) {
    await settleBoss(ctx, stored, { expired: true, inHand: null });
  }
}
function newBoss(bossId, spawnAt, online) {
  const gridIndex = Math.floor(spawnAt / BOSS_GRID_MS);
  const def = WORLD_BOSSES[gridIndex % WORLD_BOSSES.length] ?? { name: "World Boss", glyph: "\u2620" };
  const hp = BOSS_BASE_HP * Math.max(1, online.length);
  return {
    bossId,
    name: def.name,
    glyph: def.glyph,
    spawnedAt: spawnAt,
    endsAt: spawnAt + BOSS_WINDOW_MS,
    maxHp: hp,
    hp,
    contributions: {},
    closed: false
  };
}
function onlineIds(ctx) {
  return [...ctx.presence.entries()].filter(([, entry]) => ctx.now - entry.at < ctx.ttl).map(([id]) => id);
}
async function openBoss(ctx, boss, online) {
  for (const id of online) {
    const record = await ctx.books.load(id);
    if (!record) continue;
    engage(record, boss);
    await ctx.books.save(record);
  }
  await saveBoss(ctx.books.kv, boss);
}
async function advanceBoss(ctx) {
  const stored = await loadBoss(ctx.books.kv);
  await settleIfOver(ctx, stored);
  const gridIndex = Math.floor(ctx.now / BOSS_GRID_MS);
  const spawnAt = gridIndex * BOSS_GRID_MS;
  if (ctx.flags["worldboss.enabled"] === false || ctx.now >= spawnAt + BOSS_WINDOW_MS) return;
  if (stored && ctx.now < stored.endsAt) return;
  const online = onlineIds(ctx);
  await openBoss(ctx, newBoss(`wb${gridIndex.toString(36)}`, spawnAt, online), online);
}
async function spawnNow(ctx) {
  const stored = await loadBoss(ctx.books.kv);
  await settleIfOver(ctx, stored);
  if (stored && !stored.closed) return false;
  const online = onlineIds(ctx);
  const bossId = await nextLedgerId(ctx.books.kv, "sb");
  await openBoss(ctx, newBoss(bossId, ctx.now, online), online);
  return true;
}
async function settleNow(ctx) {
  const stored = await loadBoss(ctx.books.kv);
  if (!stored || stored.closed) return false;
  stored.hp = 0;
  await settleBoss(ctx, stored, { expired: true, inHand: null, allPaid: true });
  return true;
}
function dealtBefore(before, after) {
  if (!before.boss || !after.boss || before.boss.bossId !== after.boss.bossId) return null;
  return before.boss.dealt;
}
async function contribute(ctx, record, prevDealt) {
  const next = record.state.boss;
  if (prevDealt === null || !next) return;
  const kv = ctx.books.kv;
  const boss = await loadBoss(kv);
  if (ctx.flags["worldboss.enabled"] === false) return;
  if (!boss || boss.bossId !== next.bossId || !isLive(ctx, boss)) return;
  const delta = next.dealt - prevDealt;
  if (delta <= 0) return;
  const id = record.account.accountId;
  boss.hp = Math.max(0, boss.hp - delta);
  boss.contributions[id] = (boss.contributions[id] ?? 0) + delta;
  const weekStart = weekStartOf2(ctx.now);
  const boards = await kv.get(BOARDS_KEY) ?? {
    zone: [],
    week: { start: weekStart, damage: {} }
  };
  const week = boards.week.start === weekStart ? boards.week : { start: weekStart, damage: {} };
  const value = (week.damage[id]?.value ?? 0) + delta;
  await kv.set(BOARDS_KEY, {
    ...boards,
    week: {
      start: weekStart,
      damage: { ...week.damage, [id]: { name: publicName(record), value } }
    }
  });
  if (boss.hp === 0) await settleBoss(ctx, boss, { expired: false, inHand: record });
  else await saveBoss(kv, boss);
}

// packages/ledger/src/market.ts
import {
  LISTINGS_PER_PAGE
} from './protocol.js';
import { content as content2 } from './sim.js';
var LISTINGS_KEY = "pf:listings";
var ORDERS_KEY = "pf:orders";
var listingKey = (id) => `pf:listing:${id}`;
var orderKey = (id) => `pf:order:${id}`;
function refuse(reason) {
  return { ok: false, reason };
}
function open(ctx) {
  return ctx.flags["market.enabled"] !== false;
}
async function ids(ctx, key) {
  const raw = await ctx.books.kv.get(key);
  return Array.isArray(raw) ? raw : [];
}
async function openListings(ctx) {
  const out = [];
  for (const id of await ids(ctx, LISTINGS_KEY)) {
    const listing = await ctx.books.kv.get(listingKey(id));
    if (listing) out.push(listing);
  }
  return out;
}
async function openOrders(ctx) {
  const out = [];
  for (const id of await ids(ctx, ORDERS_KEY)) {
    const order = await ctx.books.kv.get(orderKey(id));
    if (order) out.push(order);
  }
  return out;
}
async function openListing(ctx, id) {
  if (!(await ids(ctx, LISTINGS_KEY)).includes(id)) return null;
  return await ctx.books.kv.get(listingKey(id)) ?? null;
}
async function openOrder(ctx, id) {
  if (!(await ids(ctx, ORDERS_KEY)).includes(id)) return null;
  return await ctx.books.kv.get(orderKey(id)) ?? null;
}
async function closeListing(ctx, id) {
  await ctx.books.kv.set(
    LISTINGS_KEY,
    (await ids(ctx, LISTINGS_KEY)).filter((x) => x !== id)
  );
  await ctx.books.kv.delete(listingKey(id));
}
async function closeOrder(ctx, id) {
  await ctx.books.kv.set(
    ORDERS_KEY,
    (await ids(ctx, ORDERS_KEY)).filter((x) => x !== id)
  );
  await ctx.books.kv.delete(orderKey(id));
}
async function counterparty(ctx, accountId) {
  const record = await ctx.books.load(accountId);
  if (!record) throw new Error(`market: no account ${accountId}`);
  return record;
}
async function giveBack(ctx, record, listing) {
  if (hasRoom(record.state, listing.goods)) {
    author(record, { t: "returned", listingId: listing.id, goods: listing.goods });
  } else {
    record.returns.push({ listingId: listing.id, goods: listing.goods });
    await ctx.books.syncReturnsQueue(record);
  }
}
function owned(state, kind, id) {
  if (kind === "item") {
    const item = state.inventory.find((i) => i.id === id);
    return item ? { kind: "item", item } : null;
  }
  const hero = state.roster.find((h) => h.id === id);
  return hero ? { kind: "hero", hero } : null;
}
function sellerRefusal(ctx, state, goods) {
  if (!goods) return "unknown_goods";
  if (!tradeableRarity(goodsRarity(goods))) return "not_tradeable_rarity";
  const tradeableAt = goods.kind === "item" ? goods.item.tradeableAt : goods.hero.tradeableAt;
  if (tradeableAt !== null && tradeableAt > ctx.now) return "in_cooldown";
  if (goods.kind === "item") {
    if (goods.item.equippedBy !== null) return "equipped";
  } else {
    if (Object.values(goods.hero.equipment).some((id2) => id2 !== null)) return "equipped";
    const id = goods.hero.id;
    if (state.party.includes(id) || state.pendingParty?.includes(id)) return "in_party";
  }
  return null;
}
function gateRefusal(ctx, record) {
  if (!open(ctx)) return "market_closed";
  if (!record.account.linked) return "not_linked";
  return null;
}
function matches(order, item) {
  return order.base === item.base && atLeast(item.rarity, order.minRarity) && (order.affixId === null || item.affixes.some((a) => a.id === order.affixId));
}
async function finish(ctx, records, caller) {
  for (const record of records) {
    await ctx.books.deliverReturns(record);
    await ctx.books.save(record);
  }
  return { ok: true, delivery: deliveryOf(caller) };
}
async function expireDue(ctx) {
  for (const listing of await openListings(ctx)) {
    if (listing.expiresAt > ctx.now) continue;
    const seller = await counterparty(ctx, listing.sellerId);
    await giveBack(ctx, seller, listing);
    await ctx.books.save(seller);
    await closeListing(ctx, listing.id);
  }
  for (const order of await openOrders(ctx)) {
    if (order.expiresAt > ctx.now) continue;
    const buyer = await counterparty(ctx, order.buyerId);
    author(buyer, { t: "order_refunded", orderId: order.id, escrow: order.maxPrice });
    await ctx.books.save(buyer);
    await closeOrder(ctx, order.id);
  }
}
async function browse(ctx, _record, query) {
  const rows = (await openListings(ctx)).filter((l) => {
    if (l.goods.kind !== query.kind) return false;
    if (query.base !== void 0 && goodsBase(l.goods) !== query.base) return false;
    if (query.cls !== void 0 && (l.goods.kind !== "hero" || l.goods.hero.cls !== query.cls))
      return false;
    if (query.minRarity !== void 0 && !atLeast(goodsRarity(l.goods), query.minRarity))
      return false;
    return true;
  });
  const newest = (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  rows.sort(query.sort === "price" ? (a, b) => a.price - b.price || newest(a, b) : newest);
  const start = query.page * LISTINGS_PER_PAGE;
  return {
    listings: rows.slice(start, start + LISTINGS_PER_PAGE),
    page: query.page,
    total: rows.length
  };
}
async function myOrders(ctx, record) {
  const id = record.account.accountId;
  return {
    listings: (await openListings(ctx)).filter((l) => l.sellerId === id),
    orders: (await openOrders(ctx)).filter((o) => o.buyerId === id),
    returns: record.returns.length
  };
}
async function matchingOrders(ctx, record, itemId) {
  const item = record.state.inventory.find((i) => i.id === itemId);
  if (!item) return [];
  return (await openOrders(ctx)).filter((o) => o.buyerId !== record.account.accountId && matches(o, item)).sort((a, b) => b.maxPrice - a.maxPrice || a.createdAt - b.createdAt);
}
async function list(ctx, record, input) {
  const gate = gateRefusal(ctx, record);
  if (gate) return refuse(gate);
  const goods = owned(record.state, input.kind, input.id);
  const refusal = sellerRefusal(ctx, record.state, goods);
  if (refusal || !goods) return refuse(refusal ?? "unknown_goods");
  if (!validPrice(input.price)) return refuse("bad_price");
  const fee = listingFee(input.price);
  if (record.state.gold < fee) return refuse("not_enough_gold");
  const id = await nextLedgerId(ctx.books.kv, "L");
  author(record, { t: "listed", listingId: id, kind: input.kind, id: input.id, fee });
  const listing = {
    id,
    sellerId: record.account.accountId,
    sellerName: publicName(record),
    goods,
    price: input.price,
    createdAt: ctx.now,
    expiresAt: ctx.now + EXPIRY_MS
  };
  await ctx.books.kv.set(listingKey(id), listing);
  await ctx.books.kv.set(LISTINGS_KEY, [...await ids(ctx, LISTINGS_KEY), id]);
  return finish(ctx, [record], record);
}
async function cancelListing(ctx, record, listingId) {
  const listing = await openListing(ctx, listingId);
  if (!listing) return refuse("gone");
  if (listing.sellerId !== record.account.accountId) return refuse("not_owner");
  await giveBack(ctx, record, listing);
  await closeListing(ctx, listing.id);
  return finish(ctx, [record], record);
}
async function buy(ctx, record, listingId) {
  const listing = await openListing(ctx, listingId);
  if (!listing) return refuse("gone");
  if (listing.sellerId === record.account.accountId) return refuse("self_trade");
  const gate = gateRefusal(ctx, record);
  if (gate) return refuse(gate);
  if (record.state.gold < listing.price) return refuse("not_enough_gold");
  if (!hasRoom(record.state, listing.goods)) return refuse("no_space");
  const seller = await counterparty(ctx, listing.sellerId);
  const goods = await transfer(
    listing.goods,
    ctx.now,
    () => nextLedgerId(ctx.books.kv, "t"),
    record.state
  );
  author(record, { t: "bought", listingId, goods, price: listing.price });
  author(seller, {
    t: "sold",
    listingId,
    kind: listing.goods.kind,
    base: goodsBase(listing.goods),
    rarity: goodsRarity(listing.goods),
    price: listing.price,
    net: saleNet(listing.price)
  });
  await closeListing(ctx, listing.id);
  return finish(ctx, [record, seller], record);
}
async function placeOrder(ctx, record, input) {
  const gate = gateRefusal(ctx, record);
  if (gate) return refuse(gate);
  if (!validPrice(input.maxPrice)) return refuse("bad_price");
  if (!tradeableRarity(input.minRarity)) return refuse("not_tradeable_rarity");
  if (!Object.hasOwn(content2.itemBases, input.base)) return refuse("unknown_goods");
  if (input.affixId !== null && !Object.hasOwn(content2.affixes, input.affixId)) {
    return refuse("unknown_goods");
  }
  if (record.state.gold < input.maxPrice) return refuse("not_enough_gold");
  const id = await nextLedgerId(ctx.books.kv, "O");
  author(record, { t: "order_placed", orderId: id, escrow: input.maxPrice });
  const order = {
    id,
    buyerId: record.account.accountId,
    base: input.base,
    minRarity: input.minRarity,
    affixId: input.affixId,
    maxPrice: input.maxPrice,
    createdAt: ctx.now,
    expiresAt: ctx.now + EXPIRY_MS
  };
  await ctx.books.kv.set(orderKey(id), order);
  await ctx.books.kv.set(ORDERS_KEY, [...await ids(ctx, ORDERS_KEY), id]);
  return finish(ctx, [record], record);
}
async function cancelOrder(ctx, record, orderId) {
  const order = await openOrder(ctx, orderId);
  if (!order) return refuse("gone");
  if (order.buyerId !== record.account.accountId) return refuse("not_owner");
  author(record, { t: "order_refunded", orderId, escrow: order.maxPrice });
  await closeOrder(ctx, orderId);
  return finish(ctx, [record], record);
}
async function fillOrder(ctx, record, orderId, itemId) {
  const order = await openOrder(ctx, orderId);
  if (!order) return refuse("gone");
  const gate = gateRefusal(ctx, record);
  if (gate) return refuse(gate);
  const goods = owned(record.state, "item", itemId);
  const refusal = sellerRefusal(ctx, record.state, goods);
  if (refusal || goods?.kind !== "item") return refuse(refusal ?? "unknown_goods");
  if (order.buyerId === record.account.accountId) return refuse("self_trade");
  if (!matches(order, goods.item)) return refuse("no_match");
  const buyer = await counterparty(ctx, order.buyerId);
  if (!hasRoom(buyer.state, goods)) return refuse("buyer_full");
  const moved = await transfer(goods, ctx.now, () => nextLedgerId(ctx.books.kv, "t"), buyer.state);
  if (moved.kind !== "item") throw new Error("market: an order fill moved a hero");
  author(record, {
    t: "order_sold",
    orderId,
    itemId,
    base: goods.item.base,
    rarity: goods.item.rarity,
    price: order.maxPrice,
    net: saleNet(order.maxPrice)
  });
  author(buyer, { t: "order_filled", orderId, item: moved.item, price: order.maxPrice });
  await closeOrder(ctx, orderId);
  return finish(ctx, [record, buyer], record);
}

// packages/ledger/src/ledger.ts
var PLAYER_NAME_MAX = 64;
var LINK_URL = "https://github.com/login/device";
var LINK_INTERVAL_MS = 5e3;
var unauthorized = { reason: "unauthorized" };
var refusedUnauthorized = { ok: false, reason: "unauthorized" };
var chatUnauthorized = { ok: false, reason: "unauthorized" };
var sandboxOff = { ok: false, reason: "sandbox_off" };
var Ledger = class {
  constructor(options) {
    this.options = options;
    this.kv = new TrackedKeyValue(options.kv);
    this.books = new Books(this.kv);
    this.host = {
      mint: (input) => this.run(() => this.mint(input)),
      credit: (accountId, gold, reason) => this.run(() => this.credit(accountId, gold, reason)),
      settle: (accountId) => this.run(() => this.settleAccount(accountId)),
      sweep: () => this.run(() => this.sweep()),
      sandbox: (accountId, event) => this.run(() => this.sandbox(accountId, event)),
      spawnBoss: () => this.run(() => this.spawnBoss()),
      settleBoss: () => this.run(() => this.settleBoss())
    };
  }
  options;
  host;
  kv;
  books;
  chain = Promise.resolve();
  presence = /* @__PURE__ */ new Map();
  /**
   * The flush runs even when `fn` threw, so an operation must validate before
   * its first `set`; `author` throws before it touches the record for that reason.
   */
  run(fn) {
    const next = this.chain.then(async () => {
      try {
        return await fn();
      } finally {
        await this.kv.flush();
      }
    });
    this.chain = next.catch(() => void 0);
    return next;
  }
  flags() {
    return {
      "market.enabled": true,
      "chat.enabled": true,
      "worldboss.enabled": true,
      "presence.enabled": true,
      "leaderboards.enabled": true,
      maintenance: false,
      "sandbox.enabled": false,
      ...this.options.flags
    };
  }
  async config() {
    return {
      minClientVersion: this.options.minClientVersion,
      simVersion: SIM_VERSION2,
      flags: this.flags(),
      serverNow: await this.options.now(),
      speed: this.options.speed ?? 1
    };
  }
  async marketContext() {
    return { books: this.books, now: await this.options.now(), flags: this.flags() };
  }
  async worldContext(at) {
    const speed = this.options.speed ?? 1;
    return {
      books: this.books,
      now: at ?? await this.options.now(),
      flags: this.flags(),
      presence: this.presence,
      ttl: this.options.presenceTtlMs ?? PRESENCE_TTL_MS * speed,
      speed,
      seedSource: this.options.seedSource,
      log: this.options.log ?? (() => void 0)
    };
  }
  // ---------------------------------------------------------------------------
  // Accounts
  bootstrap(input) {
    return this.run(async () => {
      if (input.deviceToken) {
        const record2 = await this.books.authenticate({ deviceToken: input.deviceToken });
        if (record2) return this.bootFor(input.deviceToken, record2);
      }
      const now = await this.options.now();
      const seed = this.options.seedSource() >>> 0;
      const deviceToken = this.options.tokenSource();
      const accountId = this.options.tokenSource();
      const record = newRecord(
        { accountId, seed, createdAt: now, displayName: null, linked: null },
        createInitialState(seed),
        now
      );
      await this.books.save(record);
      await this.kv.set(tokenKey(deviceToken), accountId);
      return this.bootFor(deviceToken, record);
    });
  }
  async bootFor(deviceToken, record) {
    const config = await this.config();
    if (!isCurrent(record)) {
      return {
        deviceToken,
        account: record.account,
        config,
        state: record.state,
        seq: record.seq,
        hash: hashState2(record.state),
        cursor: 0,
        delivery: { cursor: 0, events: [] }
      };
    }
    return {
      deviceToken,
      account: record.account,
      config,
      state: record.committedState,
      seq: record.seq,
      hash: record.committedHash,
      cursor: record.committedCursor,
      delivery: deliveryOf(record)
    };
  }
  account(auth) {
    return this.run(async () => {
      const record = await this.books.authenticate(auth);
      if (!record) return unauthorized;
      return {
        account: record.account,
        returns: isCurrent(record) ? record.returns.length : 0,
        config: await this.config(),
        delivery: deliveryOf(record)
      };
    });
  }
  // ---------------------------------------------------------------------------
  // Batches
  submit(input, auth) {
    return this.run(async () => {
      const batch = BatchSchema.parse(input);
      const owner = await this.books.accountFor(auth.deviceToken);
      if (!owner || owner !== batch.accountId) return { ok: false, reason: "unauthorized" };
      const record = await this.books.load(owner);
      if (!record) return { ok: false, reason: "unauthorized" };
      const { minClientVersion } = this.options;
      if (compareSemver(batch.clientVersion, minClientVersion) < 0) {
        return { ok: false, reason: "version_gate", minClientVersion };
      }
      if (batch.simVersion !== SIM_VERSION2 || !isCurrent(record)) {
        return { ok: false, reason: "sim_version", simVersion: SIM_VERSION2 };
      }
      const seen = record.batches.find((c) => c.batchId === batch.batchId);
      if (seen) {
        return {
          ok: true,
          duplicate: true,
          seq: seen.seq,
          hash: seen.hash,
          delivery: deliveryOf(record)
        };
      }
      if (batch.seq !== record.seq) return this.adopt(record, "seq_mismatch");
      if (batch.cursor > record.cursor || batch.cursor < record.committedCursor) {
        return this.adopt(record, "cursor_mismatch");
      }
      if (batch.cursor < record.cursor) {
        return { ok: false, reason: "cursor_behind", delivery: deliveryOf(record) };
      }
      if (batch.baseHash !== record.committedHash) return this.adopt(record, "hash_mismatch");
      const now = await this.options.now();
      const buckets = {};
      const refillAt = {};
      for (const kind of KINDS) {
        const { refillMs, capacity } = BUDGETS2[kind];
        const n = Math.floor(Math.max(0, now - record.refillAt[kind]) / refillMs);
        buckets[kind] = Math.min(capacity, record.buckets[kind] + n);
        refillAt[kind] = record.refillAt[kind] + n * refillMs;
      }
      const counts = {};
      for (const kind of KINDS) counts[kind] = 0;
      for (const e of batch.events) if (e.t in counts) counts[e.t] += 1;
      for (const kind of KINDS) {
        if (counts[kind] > buckets[kind]) return this.adopt(record, "rate_capped", kind);
      }
      const events = batch.events.map(
        ({ at: _at, ...event }) => event
      );
      const result = replay2(record.state, events).state;
      const prevDealt = dealtBefore(record.state, result);
      const hash = hashState2(result);
      const seq = record.seq + 1;
      for (const kind of KINDS) buckets[kind] -= counts[kind];
      record.state = result;
      record.seq = seq;
      record.refillAt = refillAt;
      record.buckets = buckets;
      record.batches = [...record.batches, { batchId: batch.batchId, hash, seq }].slice(-BATCH_RING);
      settle(record);
      await contribute(await this.worldContext(now), record, prevDealt);
      await this.books.deliverReturns(record);
      await offerZone(
        this.kv,
        now,
        {
          accountId: record.account.accountId,
          name: publicName(record),
          value: record.state.highestZone
        },
        (id) => isPlaying(this.books, id)
      );
      if (hash === batch.resultHash) {
        await this.books.save(record);
        return { ok: true, duplicate: false, seq, hash, delivery: deliveryOf(record) };
      }
      settle(record);
      await this.books.save(record);
      return {
        ok: false,
        reason: "hash_mismatch",
        seq,
        state: record.state,
        hash: record.committedHash,
        cursor: record.cursor,
        revokedItemIds: []
      };
    });
  }
  /** A state-carrying refusal: the client adopts the effective state, so the committed point moves there. */
  async adopt(record, reason, kind) {
    settle(record);
    await this.books.save(record);
    const common = {
      ok: false,
      seq: record.seq,
      state: record.state,
      hash: record.committedHash,
      cursor: record.cursor
    };
    if (reason === "hash_mismatch") return { ...common, reason, revokedItemIds: [] };
    if (reason === "rate_capped" && kind) return { ...common, reason, kind };
    return { ...common, reason };
  }
  // ---------------------------------------------------------------------------
  // GitHub link (approved by `linkApprover` until phase 5)
  linkStart(auth) {
    return this.run(async () => {
      const record = await this.books.authenticate(auth);
      if (!record) return unauthorized;
      const code = this.linkCode();
      const link = {
        accountId: record.account.accountId,
        createdAt: await this.options.now()
      };
      await this.kv.set(linkKey(code), link);
      return { code, url: LINK_URL, intervalMs: LINK_INTERVAL_MS };
    });
  }
  linkPoll(auth, code) {
    return this.run(async () => {
      const record = await this.books.authenticate(auth);
      if (!record) return unauthorized;
      const link = await this.kv.get(linkKey(code));
      if (!link || link.accountId !== record.account.accountId) return { status: "pending" };
      const approved = await this.options.linkApprover(code);
      if (!approved) return { status: "pending" };
      record.account = {
        ...record.account,
        displayName: approved.login,
        linked: { provider: "github", login: approved.login }
      };
      await this.books.save(record);
      await this.kv.delete(linkKey(code));
      return { status: "linked", account: record.account };
    });
  }
  /** Eight uppercase letters and digits drawn from the token source. */
  linkCode() {
    let code = "";
    for (let i = 0; i < 16 && code.length < 8; i++) {
      code += this.options.tokenSource().replace(/[^0-9a-z]/gi, "").toUpperCase();
    }
    if (code.length < 8) throw new Error("tokenSource gave no letters or digits");
    return code.slice(0, 8);
  }
  // ---------------------------------------------------------------------------
  // Market
  marketRead(auth, expire, fn) {
    return this.run(async () => {
      const record = await this.authenticated(auth, expire);
      if (!record) return unauthorized;
      return fn(record.ctx, record.record);
    });
  }
  marketWrite(auth, expire, fn) {
    return this.run(async () => {
      const record = await this.authenticated(auth, expire);
      if (!record) return refusedUnauthorized;
      return fn(record.ctx, record.record);
    });
  }
  /**
   * The caller's current record, after expiring what is due. Expiry runs only
   * for an authenticated caller, and the record is read after it, since
   * expiring the caller's own listing changes the caller's record.
   */
  async authenticated(auth, expire) {
    const ctx = await this.marketContext();
    const caller = await this.books.authenticate(auth);
    if (!caller || !isCurrent(caller)) return null;
    if (!expire) return { ctx, record: caller };
    await expireDue(ctx);
    const record = await this.books.load(caller.account.accountId);
    return record ? { ctx, record } : null;
  }
  browse(auth, query) {
    return this.marketRead(auth, true, (ctx, record) => browse(ctx, record, query));
  }
  list(auth, input) {
    return this.marketWrite(auth, false, (ctx, record) => list(ctx, record, input));
  }
  cancelListing(auth, listingId) {
    return this.marketWrite(
      auth,
      true,
      (ctx, record) => cancelListing(ctx, record, listingId)
    );
  }
  buy(auth, listingId) {
    return this.marketWrite(auth, true, (ctx, record) => buy(ctx, record, listingId));
  }
  myOrders(auth) {
    return this.marketRead(auth, true, (ctx, record) => myOrders(ctx, record));
  }
  placeOrder(auth, input) {
    return this.marketWrite(auth, false, (ctx, record) => placeOrder(ctx, record, input));
  }
  cancelOrder(auth, orderId) {
    return this.marketWrite(auth, true, (ctx, record) => cancelOrder(ctx, record, orderId));
  }
  matchingOrders(auth, itemId) {
    return this.marketRead(auth, true, (ctx, record) => matchingOrders(ctx, record, itemId));
  }
  fillOrder(auth, orderId, itemId) {
    return this.marketWrite(
      auth,
      true,
      (ctx, record) => fillOrder(ctx, record, orderId, itemId)
    );
  }
  // ---------------------------------------------------------------------------
  // World: presence, chat, leaderboards
  world(auth, since) {
    return this.run(async () => {
      const ctx = await this.worldContext();
      await advanceBoss(ctx);
      const record = await this.books.authenticate(auth);
      if (!record) return unauthorized;
      return world(ctx, record, since);
    });
  }
  chat(auth, text) {
    return this.run(async () => {
      const ctx = await this.worldContext();
      const record = await this.books.authenticate(auth);
      if (!record) return chatUnauthorized;
      return chat(ctx, record, text);
    });
  }
  leaderboards(auth) {
    return this.run(async () => {
      const ctx = await this.worldContext();
      const record = await this.books.authenticate(auth);
      if (!record) return unauthorized;
      return leaderboards(ctx);
    });
  }
  // ---------------------------------------------------------------------------
  // Host privileges
  async mint(input) {
    if (input.name.length < 1 || input.name.length > PLAYER_NAME_MAX) {
      throw new Error(
        `mint: name wants 1 to ${PLAYER_NAME_MAX} characters; got ${input.name.length}`
      );
    }
    const now = await this.options.now();
    const accountId = this.options.tokenSource();
    const deviceToken = this.options.tokenSource();
    const record = newRecord(
      {
        accountId,
        seed: input.state.seed,
        createdAt: now,
        displayName: input.name,
        linked: input.linked ? { provider: "github", login: input.name } : null
      },
      input.state,
      now
    );
    await this.books.save(record);
    await this.kv.set(tokenKey(deviceToken), accountId);
    await offerZone(
      this.kv,
      now,
      {
        accountId,
        name: publicName(record),
        value: input.state.highestZone
      },
      (id) => isPlaying(this.books, id)
    );
    return { accountId, deviceToken };
  }
  async currentRecord(accountId) {
    const record = await this.books.load(accountId);
    if (!record || !isCurrent(record)) throw new Error(`no current account ${accountId}`);
    return record;
  }
  async credit(accountId, gold, reason) {
    if (!Number.isInteger(gold) || gold < 0) throw new Error(`credit: bad gold ${gold}`);
    if (reason.length > 64) throw new Error("credit: reason over 64 characters");
    const record = await this.currentRecord(accountId);
    author(record, { t: "credited", gold, reason });
    await this.books.save(record);
  }
  async sandbox(accountId, input) {
    if (!this.flags()["sandbox.enabled"]) return sandboxOff;
    const event = ServerEventSchema.parse(input);
    if (!SANDBOX_EVENT_KINDS.includes(event.t)) {
      throw new Error(`sandbox: not a sandbox event: ${event.t}`);
    }
    const record = await this.currentRecord(accountId);
    const refused = tryAuthor(record, event);
    if (refused !== null) {
      return {
        ok: false,
        reason: "unapplicable",
        detail: refused.replace(/^server_event_unapplicable:/, "")
      };
    }
    await this.books.save(record);
    return { ok: true };
  }
  async spawnBoss() {
    if (!this.flags()["sandbox.enabled"]) return sandboxOff;
    return await spawnNow(await this.worldContext()) ? { ok: true } : { ok: false, reason: "boss_live" };
  }
  async settleBoss() {
    if (!this.flags()["sandbox.enabled"]) return sandboxOff;
    return await settleNow(await this.worldContext()) ? { ok: true } : { ok: false, reason: "no_boss" };
  }
  async settleAccount(accountId) {
    const record = await this.currentRecord(accountId);
    settle(record);
    await this.books.save(record);
  }
  async sweep() {
    await advanceBoss(await this.worldContext());
    await expireDue(await this.marketContext());
    for (const accountId of await this.books.returnsQueue()) {
      const record = await this.books.load(accountId);
      if (!record) continue;
      await this.books.deliverReturns(record);
      await this.books.save(record);
    }
  }
};
export {
  BLOCKED_WORDS,
  COOLDOWN_MS,
  EXPIRY_MS,
  LINK_INTERVAL_MS,
  LINK_URL,
  LOG_CAP,
  Ledger,
  MAX_PRICE,
  MIN_PRICE,
  PLAYER_NAME_MAX,
  WORLD_BOSSES,
  isBlocked,
  listingFee,
  nextLedgerId,
  saleFee,
  saleNet,
  transfer,
  validPrice
};
