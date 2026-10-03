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
  const r = step(record.state, event);
  const refused = r.effects.find((e) => e.k === "rejected");
  if (refused?.k === "rejected") {
    throw new Error(`ledger authored an unapplicable event: ${refused.reason}`);
  }
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
  compareSemver
} from './protocol.js';
import {
  createInitialState,
  hashState as hashState2,
  replay as replay2,
  SIM_VERSION as SIM_VERSION2
} from './sim.js';

// packages/ledger/src/market.ts
import {
  LISTINGS_PER_PAGE
} from './protocol.js';
import { content } from './sim.js';
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
function nameOf(record) {
  return record.account.displayName ?? record.account.linked?.login ?? "adventurer";
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
    sellerName: nameOf(record),
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
  if (!content.itemBases[input.base]) return refuse("unknown_goods");
  if (input.affixId !== null && !content.affixes[input.affixId]) return refuse("unknown_goods");
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
  if (!hasRoom(buyer.state, goods)) return refuse("no_space");
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
var LINK_URL = "https://github.com/login/device";
var LINK_INTERVAL_MS = 5e3;
var unauthorized = { reason: "unauthorized" };
var refusedUnauthorized = { ok: false, reason: "unauthorized" };
var Ledger = class {
  constructor(options) {
    this.options = options;
    this.kv = new TrackedKeyValue(options.kv);
    this.books = new Books(this.kv);
    this.host = {
      mint: (input) => this.run(() => this.mint(input)),
      credit: (accountId, gold, reason) => this.run(() => this.credit(accountId, gold, reason)),
      settle: (accountId) => this.run(() => this.settleAccount(accountId)),
      sweep: () => this.run(() => this.sweep())
    };
  }
  options;
  host;
  kv;
  books;
  chain = Promise.resolve();
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
    return { "market.enabled": true, ...this.options.flags };
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
      const hash = hashState2(result);
      const seq = record.seq + 1;
      for (const kind of KINDS) buckets[kind] -= counts[kind];
      record.state = result;
      record.seq = seq;
      record.refillAt = refillAt;
      record.buckets = buckets;
      record.batches = [...record.batches, { batchId: batch.batchId, hash, seq }].slice(-BATCH_RING);
      settle(record);
      await this.books.deliverReturns(record);
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
      const ctx = await this.marketContext();
      if (expire) await expireDue(ctx);
      const record = await this.books.authenticate(auth);
      if (!record || !isCurrent(record)) return unauthorized;
      return fn(ctx, record);
    });
  }
  marketWrite(auth, expire, fn) {
    return this.run(async () => {
      const ctx = await this.marketContext();
      if (expire) await expireDue(ctx);
      const record = await this.books.authenticate(auth);
      if (!record || !isCurrent(record)) return refusedUnauthorized;
      return fn(ctx, record);
    });
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
  // Host privileges
  async mint(input) {
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
    return { accountId, deviceToken };
  }
  async currentRecord(accountId) {
    const record = await this.books.load(accountId);
    if (!record || !isCurrent(record)) throw new Error(`no current account ${accountId}`);
    return record;
  }
  async credit(accountId, gold, reason) {
    const record = await this.currentRecord(accountId);
    author(record, { t: "credited", gold, reason });
    await this.books.save(record);
  }
  async settleAccount(accountId) {
    const record = await this.currentRecord(accountId);
    settle(record);
    await this.books.save(record);
  }
  async sweep() {
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
  COOLDOWN_MS,
  EXPIRY_MS,
  LINK_INTERVAL_MS,
  LINK_URL,
  LOG_CAP,
  Ledger,
  MAX_PRICE,
  MIN_PRICE,
  listingFee,
  nextLedgerId,
  saleFee,
  saleNet,
  transfer,
  validPrice
};
