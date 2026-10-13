// packages/ledger/src/blocklist.ts
var BLOCKED_WORDS = ["heck", "darn", "frick", "blockedword"];
var blocked = new Set(BLOCKED_WORDS);
function isBlocked(text) {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((word) => blocked.has(word));
}

// packages/ledger/src/books.ts
import {
  BUDGETS as BUDGETS2
} from './protocol.js';
import {
  hashState as hashState2,
  replay as replay2,
  SIM_VERSION as SIM_VERSION2,
  step
} from './sim.js';

// packages/ledger/src/migrate.ts
import { BUDGETS } from './protocol.js';
import {
  hashState,
  migrate,
  migrateGoods,
  replay,
  SIM_VERSION
} from './sim.js';
function refusalText(refusal) {
  return refusal.reason === "ahead" ? `v${refusal.from} is ahead of v${refusal.to}` : `gap in the chain, no step from v${refusal.at}`;
}
function walkGoods(goods, from, chain) {
  const r = migrateGoods(goods, from, { chain });
  if (!r.ok) throw new Error(`migrate: goods refused from v${from}: ${refusalText(r)}`);
  return r.goods;
}
function eventGoods(event, rule) {
  switch (event.t) {
    case "returned":
    case "bought":
      return { ...event, goods: rule(event.goods) };
    case "rewarded":
      return { ...event, goods: event.goods && rule(event.goods) };
    case "order_filled": {
      const goods = rule({ kind: "item", item: event.item });
      return goods.kind === "item" ? { ...event, item: goods.item } : event;
    }
    default:
      return event;
  }
}
async function migrateRecord(record, { chain, now }) {
  const committed = record.committedState ?? record.state;
  const from = committed.v;
  const result = migrate(committed, { chain });
  if (!result.ok) return result;
  const rule = (goods) => walkGoods(goods, from, chain);
  record.committedState = result.state;
  record.log = record.log.map(({ n, event }) => ({ n, event: eventGoods(event, rule) }));
  record.returns = record.returns.map((entry) => ({ ...entry, goods: rule(entry.goods) }));
  record.state = replay(
    record.committedState,
    record.log.map((e) => e.event)
  ).state;
  record.committedHash = hashState(record.committedState);
  const at = await now();
  for (const kind of Object.keys(BUDGETS)) {
    if (typeof record.buckets[kind] !== "number") record.buckets[kind] = BUDGETS[kind].capacity;
    if (typeof record.refillAt[kind] !== "number") record.refillAt[kind] = at;
  }
  return null;
}
function behind(record) {
  return (record.committedState ?? record.state).v !== SIM_VERSION;
}

// packages/ledger/src/books.ts
var BATCH_RING = 200;
var LOG_CAP = 500;
var KINDS = Object.keys(BUDGETS2);
var recordKey = (accountId) => `pf:acct:${accountId}:record`;
var tokenKey = (token) => `pf:token:${token}`;
var linkKey = (code) => `pf:link:${code}`;
var loginBanKey = (login) => `pf:ban:${login.toLowerCase()}`;
var RETURNS_KEY = "pf:returns";
var LINKS_KEY = "pf:links";
var FLAGS_KEY = "pf:flags";
function everyKind(value) {
  const out = {};
  for (const kind of KINDS) out[kind] = value;
  return out;
}
function fullBuckets() {
  const out = {};
  for (const kind of KINDS) out[kind] = BUDGETS2[kind].capacity;
  return out;
}
function isCurrent(record) {
  return record.state.v === SIM_VERSION2;
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
    committedHash: hashState2(state),
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
  record.committedHash = hashState2(record.state);
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
    record.committedState = replay2(record.committedState, [oldest.event]).state;
    record.committedCursor = oldest.n;
    record.committedHash = hashState2(record.committedState);
  }
  return null;
}
function hasRoom(state, goods) {
  return goods.kind === "item" ? state.inventory.length < state.inventoryCap : state.roster.length < state.rosterCap;
}
var TrackedKeyValue = class {
  constructor(inner, onWrite = () => void 0) {
    this.inner = inner;
    this.onWrite = onWrite;
  }
  inner;
  onWrite;
  dirty = false;
  get(key) {
    return this.inner.get(key);
  }
  set(key, value) {
    this.dirty = true;
    this.onWrite(key);
    return this.inner.set(key, value);
  }
  delete(key) {
    this.dirty = true;
    this.onWrite(key);
    return this.inner.delete(key);
  }
  async flush() {
    if (!this.dirty) return;
    await this.inner.flush?.();
    this.dirty = false;
  }
};
var Books = class {
  constructor(kv, migrator) {
    this.kv = kv;
    this.migrator = migrator;
  }
  kv;
  migrator;
  /** Records refused a migration and already logged, as `<account>:v<version>`: one line each per process. */
  refused = /* @__PURE__ */ new Set();
  /** Records migrated and already logged, keyed the same way: a load migrates until a write saves it. */
  migrated = /* @__PURE__ */ new Set();
  /**
   * The one way a record enters the ledger. A record behind the sim version is migrated here, in
   * memory: only an operation that writes anyway saves it, so a secondary session's reads never
   * write over the primary's record (spec §9). One the chain refuses is answered as stored.
   */
  async load(accountId) {
    const raw = await this.kv.get(recordKey(accountId));
    if (!raw) return null;
    const record = raw;
    if (behind(record)) await this.migrate(record);
    return record;
  }
  async migrate(record) {
    const id = record.account.accountId;
    const from = (record.committedState ?? record.state).v;
    const key = `${id}:v${from}`;
    const refusal = await migrateRecord(record, this.migrator);
    if (refusal) {
      if (this.refused.has(key)) return;
      this.refused.add(key);
      this.migrator.log(`not migrated account ${id} from v${from}: ${refusalText(refusal)}`);
      return;
    }
    if (this.migrated.has(key)) return;
    this.migrated.add(key);
    this.migrator.log(`migrated account ${id} from v${from} to v${SIM_VERSION2}`);
  }
  async save(record) {
    await this.kv.set(recordKey(record.account.accountId), record);
  }
  /** Deletes the record, its token and its place on the returns queue: an account delete. */
  async remove(record, token) {
    record.returns = [];
    await this.syncReturnsQueue(record);
    await this.kv.delete(recordKey(record.account.accountId));
    await this.kv.delete(tokenKey(token));
  }
  async accountFor(token) {
    const raw = await this.kv.get(tokenKey(token));
    return typeof raw === "string" ? raw : null;
  }
  async authenticate(auth) {
    const accountId = await this.accountFor(auth.deviceToken);
    return accountId ? this.load(accountId) : null;
  }
  async loginBan(login) {
    const raw = await this.kv.get(loginBanKey(login));
    return raw ? raw : null;
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
  async openLinks() {
    const raw = await this.kv.get(LINKS_KEY);
    return Array.isArray(raw) ? raw : [];
  }
  /** Writes a link row and its entry in `pf:links`. */
  async putLink(code, link) {
    await this.kv.set(linkKey(code), link);
    const open2 = (await this.openLinks()).filter((e) => e.code !== code);
    await this.kv.set(LINKS_KEY, [...open2, { code, createdAt: link.createdAt }]);
  }
  /** Deletes a link row and its entry in `pf:links`, if it has one. */
  async dropLink(code) {
    await this.kv.delete(linkKey(code));
    const open2 = await this.openLinks();
    const kept = open2.filter((e) => e.code !== code);
    if (kept.length !== open2.length) await this.kv.set(LINKS_KEY, kept);
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
  BUDGETS as BUDGETS3,
  compareSemver,
  PRESENCE_TTL_MS,
  ServerEventSchema
} from './protocol.js';
import {
  createInitialState,
  hashState as hashState3,
  MIGRATIONS,
  replay as replay3,
  SANDBOX_EVENT_KINDS,
  SIM_VERSION as SIM_VERSION4
} from './sim.js';

// packages/ledger/src/boss.ts
import {
  BOSS_BASE_HP,
  BOSS_GRID_MS,
  BOSS_THRESHOLD_BP,
  BOSS_TOP_BONUS,
  BOSS_WINDOW_MS,
  weekStartOf as weekStartOf3
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
  weekStartOf as weekStartOf2
} from './protocol.js';

// packages/ledger/src/hunt.ts
import {
  HUNT_THRESHOLD_BP,
  WEEK_MS as WEEK_MS2,
  weekStartOf
} from './protocol.js';
import { huntAt, huntCount } from './sim.js';
var HUNT_KEY = "pf:world:hunt";
var huntOn = (ctx) => ctx.flags["hunt.enabled"] !== false;
async function loadHunt(kv) {
  const raw = await kv.get(HUNT_KEY);
  return raw ?? null;
}
function newHunt(weekStart) {
  const week = Math.floor(weekStart / WEEK_MS2);
  const row = huntAt(week);
  return {
    huntId: `h${week.toString(36)}`,
    row: row.id,
    name: row.name,
    kind: row.kind,
    target: row.target,
    weekStart,
    endsAt: weekStart + WEEK_MS2,
    count: 0,
    contributions: {},
    closed: false
  };
}
function toHuntView(ctx, hunt, accountId) {
  if (!hunt || !huntOn(ctx) || hunt.closed || ctx.now >= hunt.endsAt) return null;
  const { name, target, count, endsAt } = hunt;
  return { name, target, count, endsAt, yours: hunt.contributions[accountId] ?? 0 };
}
async function closeHunt(ctx, hunt) {
  for (const [id, contribution] of Object.entries(hunt.contributions)) {
    if (contribution * 1e4 < hunt.target * HUNT_THRESHOLD_BP) continue;
    const record = await ctx.books.load(id);
    if (!record || !isCurrent(record)) continue;
    await payReward(ctx, record, hunt.huntId, "hunt");
    await ctx.books.syncReturnsQueue(record);
    await ctx.books.save(record);
  }
  hunt.closed = true;
  await ctx.books.kv.set(HUNT_KEY, hunt);
}
async function advanceHunt(ctx) {
  if (!huntOn(ctx)) return;
  const stored = await loadHunt(ctx.books.kv);
  if (stored && !stored.closed && ctx.now >= stored.endsAt) await closeHunt(ctx, stored);
  const weekStart = weekStartOf(ctx.now);
  if (stored && stored.weekStart === weekStart) return;
  await ctx.books.kv.set(HUNT_KEY, newHunt(weekStart));
}
async function countHunt(ctx, record, before) {
  if (record.bot || !huntOn(ctx)) return;
  const hunt = await loadHunt(ctx.books.kv);
  if (!hunt || hunt.closed || ctx.now < hunt.weekStart || ctx.now >= hunt.endsAt) return;
  const delta = huntCount(hunt.kind, record.state) - huntCount(hunt.kind, before);
  if (delta <= 0) return;
  const id = record.account.accountId;
  hunt.count += delta;
  hunt.contributions[id] = (hunt.contributions[id] ?? 0) + delta;
  await ctx.books.kv.set(HUNT_KEY, hunt);
}

// packages/ledger/src/world.ts
var WorldMemo = class {
  second = Number.NaN;
  advanced = Number.NaN;
  counts = null;
  boss = null;
  hunt = null;
  messages = null;
  slices = /* @__PURE__ */ new Map();
  /** True on the first call in each second: the boss advance runs then, as it ran on every poll. */
  advanceDue(now) {
    const second = Math.floor(now / 1e3);
    if (second === this.advanced) return false;
    this.advanced = second;
    return true;
  }
  /** Drops every part when `now` is in another second than the one they were built in. */
  roll(now) {
    const second = Math.floor(now / 1e3);
    if (second === this.second) return;
    this.second = second;
    this.counts = null;
    this.boss = null;
    this.hunt = null;
    this.dropChat();
  }
  presenceChanged() {
    this.counts = null;
  }
  /** The store's write hook. */
  written(key) {
    if (key === BOSS_KEY) this.boss = null;
    if (key === HUNT_KEY) this.hunt = null;
    if (key === CHAT_KEY) this.dropChat();
  }
  presenceCounts(presence) {
    if (this.counts) return this.counts;
    const counts = /* @__PURE__ */ new Map();
    for (const entry of presence.values()) {
      counts.set(entry.zone, (counts.get(entry.zone) ?? 0) + 1);
    }
    this.counts = {
      online: presence.size,
      zones: [...counts.entries()].sort(([a], [b]) => a - b).map(([zone, count]) => ({ zone, count }))
    };
    return this.counts;
  }
  async bossRecord(kv) {
    this.boss ??= { record: await loadBoss(kv) };
    return this.boss.record;
  }
  async huntRecord(kv) {
    this.hunt ??= { record: await loadHunt(kv) };
    return this.hunt.record;
  }
  async chatSince(kv, since) {
    const cached = this.slices.get(since);
    if (cached) return cached;
    this.messages ??= (await loadChat(kv)).messages;
    const slice = since <= 0 ? this.messages.slice(-CHAT_SERVE) : this.messages.filter((m) => m.id > since);
    this.slices.set(since, slice);
    return slice;
  }
  dropChat() {
    this.messages = null;
    this.slices.clear();
  }
};
var CHAT_KEY = "pf:chat";
var BOARDS_KEY = "pf:boards";
async function loadChat(kv) {
  const raw = await kv.get(CHAT_KEY);
  return raw ?? { nextId: 1, messages: [] };
}
async function loadBoards(kv, now) {
  const raw = await kv.get(BOARDS_KEY);
  return raw ?? { zone: [], week: { start: weekStartOf2(now), damage: {} } };
}
function prune(ctx) {
  let dropped = false;
  for (const [id, entry] of ctx.presence) {
    if (!(ctx.now - entry.at < ctx.ttl)) {
      ctx.presence.delete(id);
      dropped = true;
    }
  }
  return dropped;
}
async function world(ctx, record, since, engageCaller = true) {
  const presenceOn = ctx.flags["presence.enabled"] !== false;
  const id = record.account.accountId;
  const memo = ctx.memo;
  memo.roll(ctx.now);
  if (prune(ctx)) memo.presenceChanged();
  if (presenceOn && isCurrent(record)) {
    const before = ctx.presence.get(id);
    ctx.presence.set(id, { zone: record.state.zone, name: publicName(record), at: ctx.now });
    if (before?.zone !== record.state.zone) memo.presenceChanged();
  }
  let online = 0;
  let zones = [];
  let here = [];
  if (presenceOn) {
    ;
    ({ online, zones } = memo.presenceCounts(ctx.presence));
    const mine = ctx.presence.get(id);
    if (mine) {
      here = [...ctx.presence.entries()].filter(([other, entry]) => other !== id && entry.zone === mine.zone).sort(([, a], [, b]) => b.at - a.at).slice(0, HERE_MAX).map(([, entry]) => entry.name);
    }
  }
  const boss = await memo.bossRecord(ctx.books.kv);
  if (engageCaller && boss && ctx.flags["worldboss.enabled"] !== false && isLive(ctx, boss) && (!presenceOn || ctx.presence.has(id)) && isCurrent(record) && !(id in boss.contributions)) {
    engage(record, boss);
    await ctx.books.save(record);
    await ctx.books.kv.set(BOSS_KEY, boss);
  }
  let chat2 = [];
  if (ctx.flags["chat.enabled"] !== false) chat2 = await memo.chatSince(ctx.books.kv, since);
  return {
    serverNow: ctx.now,
    speed: ctx.speed,
    online,
    zones,
    here,
    boss: toBossView(ctx, boss, id),
    hunt: toHuntView(ctx, await memo.huntRecord(ctx.books.kv), id),
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
  const weekStart = weekStartOf2(ctx.now);
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
async function dropFromBoards(kv, accountId) {
  const boards = await kv.get(BOARDS_KEY);
  if (!boards) return;
  const zone = boards.zone.filter((r) => r.accountId !== accountId);
  const { [accountId]: dropped, ...damage } = boards.week.damage;
  if (zone.length === boards.zone.length && !dropped) return;
  await kv.set(BOARDS_KEY, { zone, week: { ...boards.week, damage } });
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
  const def = content.enemies[content.zones[0]?.boss ?? ""];
  if (!def) throw new Error("content has no zone 1 boss");
  return { ...def.stats, atk: def.baseAtk ?? def.stats.atk };
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
async function payReward(ctx, record, rewardId, source) {
  const tagged = source ? { source } : {};
  const zone = record.state.zone;
  const rolled = rollRewardItem(ctx.seedSource() >>> 0, zone, partyClasses(record.state));
  if (!rolled) {
    author(record, {
      t: "rewarded",
      bossId: rewardId,
      goods: null,
      gold: rewardGold("rare", zone),
      ...tagged
    });
    return;
  }
  const item = { ...rolled, id: await nextLedgerId(ctx.books.kv, "r") };
  const goods = { kind: "item", item };
  const gold = rewardGold(item.rarity, zone);
  if (hasRoom(record.state, goods)) {
    author(record, { t: "rewarded", bossId: rewardId, goods, gold, ...tagged });
  } else {
    record.returns.push({ listingId: rewardId, goods });
    author(record, { t: "rewarded", bossId: rewardId, goods: null, gold, ...tagged });
  }
}
async function settleBoss(ctx, boss, options) {
  const kv = ctx.books.kv;
  const threshold = Math.floor(BOSS_BASE_HP * BOSS_THRESHOLD_BP / 1e4);
  const top = Object.entries(boss.contributions).filter(([, value]) => value > 0).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0)).slice(0, BOSS_TOP_BONUS).map(([id]) => id);
  for (const [id, contribution] of Object.entries(boss.contributions)) {
    const record = options.inHand?.account.accountId === id ? options.inHand : await ctx.books.load(id);
    if (!record || !isCurrent(record)) continue;
    const rolls = (options.allPaid || contribution >= threshold ? 1 : 0) + (!options.expired && top.includes(id) ? 1 : 0);
    for (let i = 0; i < rolls; i++) await payReward(ctx, record, boss.bossId);
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
  if (!record.bot) await offerDamage(kv, ctx.now, record, delta);
  if (boss.hp === 0) await settleBoss(ctx, boss, { expired: false, inHand: record });
  else await saveBoss(kv, boss);
}
async function offerDamage(kv, now, record, delta) {
  const id = record.account.accountId;
  const weekStart = weekStartOf3(now);
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
}

// packages/ledger/src/journal.ts
import {
  DAY_MS as DAY_MS2,
  DEFAULT_REST_DAYS,
  dayOf,
  nextMonday,
  weekdayOf
} from './protocol.js';
import {
  achievementCount,
  content as content2,
  dailyGoal,
  goalCount,
  goalGold
} from './sim.js';
var journalKey = (accountId) => `pf:acct:${accountId}:journal`;
function emptyJournal() {
  return {
    achievements: {},
    goalsMet: 0,
    day: null,
    streak: { length: 0, lastMet: null },
    rest: [{ from: 0, days: [...DEFAULT_REST_DAYS] }]
  };
}
async function loadJournal(kv, accountId) {
  const raw = await kv.get(journalKey(accountId));
  return raw ?? emptyJournal();
}
function restDaysOn(journal, day) {
  let days = [...DEFAULT_REST_DAYS];
  for (const entry of journal.rest) if (entry.from <= day) days = entry.days;
  return days;
}
function isWorkDay(journal, day) {
  return !restDaysOn(journal, day).includes(weekdayOf(day));
}
function missedSince(journal, lastMet, today) {
  if (today - lastMet > 8) return true;
  for (let day = lastMet + 1; day < today; day++) if (isWorkDay(journal, day)) return true;
  return false;
}
function streakOn(journal, today) {
  const { length, lastMet } = journal.streak;
  return lastMet !== null && missedSince(journal, lastMet, today) ? 0 : length;
}
function baselineOf(state) {
  return {
    kills: goalCount("kills", state),
    zone_bosses: goalCount("zone_bosses", state),
    rare_drops: goalCount("rare_drops", state),
    turn_boss: goalCount("turn_boss", state)
  };
}
function pruneRest(journal, today) {
  const { lastMet } = journal.streak;
  const pivot = lastMet !== null && today - lastMet <= 8 ? Math.min(lastMet, today) : today;
  let keep = 0;
  journal.rest.forEach((entry, i) => {
    if (entry.from <= pivot) keep = i;
  });
  journal.rest = journal.rest.slice(keep);
}
async function onCommit(kv, record, now) {
  const accountId = record.account.accountId;
  const state = record.committedState;
  const journal = await loadJournal(kv, accountId);
  const today = dayOf(now);
  journal.streak.length = streakOn(journal, today);
  if (journal.day?.index !== today) {
    journal.day = {
      index: today,
      goal: dailyGoal(today, accountId, state.zone),
      zone: state.zone,
      baseline: baselineOf(state),
      met: false
    };
  }
  const day = journal.day;
  if (!day.met && progressOf(day, state) >= day.goal.target) {
    day.met = true;
    journal.goalsMet += 1;
    author(record, { t: "credited", gold: goalGold(day.zone), reason: `goal:${today}` });
    if (isWorkDay(journal, today)) {
      const { lastMet } = journal.streak;
      const follows = lastMet !== null && lastMet < today && !missedSince(journal, lastMet, today);
      journal.streak = { length: follows ? journal.streak.length + 1 : 1, lastMet: today };
    }
  }
  const counts = { goalsMet: journal.goalsMet, streak: journal.streak.length };
  for (const row of content2.achievements) {
    const value = achievementCount(row.reads, state, counts);
    const crossed = journal.achievements[row.id] ?? [];
    row.steps.forEach((step2, i) => {
      const n = i + 1;
      if (value < step2.at || crossed.some((c) => c.step === n)) return;
      author(record, { t: "credited", gold: step2.gold, reason: `achievement:${row.id}:${n}` });
      crossed.push({ step: n, at: now });
    });
    if (crossed.length > 0) journal.achievements[row.id] = crossed;
  }
  pruneRest(journal, today);
  await kv.set(journalKey(accountId), journal);
}
function progressOf(day, state) {
  return Math.max(0, goalCount(day.goal.kind, state) - day.baseline[day.goal.kind]);
}
function journalView(journal, record, now) {
  const state = record.committedState;
  const today = dayOf(now);
  const open2 = journal.day?.index === today ? journal.day : null;
  const pending2 = journal.rest.filter((e) => e.from > today).at(-1);
  return {
    achievements: Object.entries(journal.achievements).map(([id, steps]) => ({
      id,
      steps: steps.map((s) => ({ ...s }))
    })),
    day: {
      index: today,
      goal: open2?.goal ?? dailyGoal(today, record.account.accountId, state.zone),
      progress: open2 ? progressOf(open2, state) : 0,
      met: open2?.met ?? false,
      resetsAt: (today + 1) * DAY_MS2
    },
    goalsMet: journal.goalsMet,
    streak: { length: streakOn(journal, today), lastMet: journal.streak.lastMet },
    restDays: {
      current: [...restDaysOn(journal, today)],
      next: pending2 ? { days: [...pending2.days], from: pending2.from } : null
    }
  };
}
function restDaysRefusal(days) {
  if (days.length !== 2) return "rest_days_count";
  if (!days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) return "rest_days_range";
  if (days[0] === days[1]) return "rest_days_same";
  return null;
}
function setRestDays(journal, days, now) {
  const today = dayOf(now);
  journal.rest = [
    ...journal.rest.filter((e) => e.from <= today),
    { from: nextMonday(today), days: [...days].sort((a, b) => a - b) }
  ];
  pruneRest(journal, today);
}

// packages/ledger/src/market.ts
import {
  LISTINGS_PER_PAGE
} from './protocol.js';
import {
  content as content3,
  migrateGoods as migrateGoods2,
  SIM_VERSION as SIM_VERSION3
} from './sim.js';
var LISTINGS_KEY = "pf:listings";
var ORDERS_KEY = "pf:orders";
var listingKey = (id) => `pf:listing:${id}`;
var orderKey = (id) => `pf:order:${id}`;
var MARK_KEY = "pf:market:v";
var UNMARKED = 5;
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
async function normaliseBook(ctx, chain, log) {
  const raw = await ctx.books.kv.get(MARK_KEY);
  const from = typeof raw === "number" ? raw : UNMARKED;
  if (from === SIM_VERSION3) return true;
  const listings = await openListings(ctx);
  const walked = [];
  for (const listing of listings) {
    const r = migrateGoods2(listing.goods, from, { chain });
    if (!r.ok) {
      log(`not migrated the market book from v${from}: ${refusalText(r)}`);
      return false;
    }
    walked.push({ ...listing, goods: r.goods });
  }
  for (const listing of walked) await ctx.books.kv.set(listingKey(listing.id), listing);
  await ctx.books.kv.set(MARK_KEY, SIM_VERSION3);
  log(`migrated the market book from v${from} to v${SIM_VERSION3}`);
  return true;
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
async function closeAllOf(ctx, accountId) {
  for (const listing of await openListings(ctx)) {
    if (listing.sellerId === accountId) await closeListing(ctx, listing.id);
  }
  for (const order of await openOrders(ctx)) {
    if (order.buyerId === accountId) await closeOrder(ctx, order.id);
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
  if (!Object.hasOwn(content3.itemBases, input.base)) return refuse("unknown_goods");
  if (input.affixId !== null && !Object.hasOwn(content3.affixes, input.affixId)) {
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
var SETTABLE_FLAGS = [
  "market.enabled",
  "chat.enabled",
  "worldboss.enabled",
  "presence.enabled",
  "leaderboards.enabled",
  "hunt.enabled",
  "maintenance"
];
function settable(raw) {
  const out = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const flag of SETTABLE_FLAGS) {
    const value = raw[flag];
    if (typeof value === "boolean") out[flag] = value;
  }
  return out;
}
var PLAYER_NAME_MAX = 64;
var LINK_URL = "https://github.com/login/device";
var LINK_INTERVAL_MS = 5e3;
var LINK_TTL_MS = 15 * 6e4;
function approveAs(login) {
  return {
    start: async (code) => ({
      code,
      url: LINK_URL,
      intervalMs: LINK_INTERVAL_MS,
      deviceCode: code
    }),
    poll: async () => login === null ? { status: "pending" } : { status: "approved", login }
  };
}
var unauthorized = { reason: "unauthorized" };
var unknownToken = {
  refusal: "unknown",
  message: "The server does not know this account."
};
var pending = { status: "pending" };
var refusedUnauthorized = { ok: false, reason: "unauthorized" };
var chatUnauthorized = { ok: false, reason: "unauthorized" };
var sandboxOff = { ok: false, reason: "sandbox_off" };
function bannedOf(record) {
  if (!record.banned) return null;
  return {
    reason: "banned",
    message: `Promptfall: this account is banned: ${record.banned.reason}`
  };
}
function refusedBanned(record) {
  const banned = bannedOf(record);
  return banned ? { ok: false, ...banned } : null;
}
var Ledger = class {
  constructor(options) {
    this.options = options;
    this.kv = new TrackedKeyValue(options.kv, (key) => this.memo.written(key));
    this.books = new Books(this.kv, {
      chain: options.migrations ?? MIGRATIONS,
      now: options.now,
      log: options.log ?? (() => void 0)
    });
    this.loaded = (async () => {
      this.stored = settable(await options.kv.get(FLAGS_KEY));
    })();
    this.loaded.catch(() => void 0);
    this.host = {
      mint: (input) => this.run(() => this.mint(input)),
      credit: (accountId, gold, reason) => this.run(() => this.credit(accountId, gold, reason)),
      settle: (accountId) => this.run(() => this.settleAccount(accountId)),
      sweep: () => this.run(() => this.sweep()),
      sandbox: (accountId, event) => this.run(() => this.sandbox(accountId, event)),
      spawnBoss: () => this.run(() => this.spawnBoss()),
      settleBoss: () => this.run(() => this.settleBoss()),
      setFlags: (flags) => this.run(() => this.setFlags(flags)),
      ban: (accountId, reason) => this.run(() => this.ban(accountId, reason)),
      unban: (login) => this.run(() => this.unban(login))
    };
  }
  options;
  host;
  kv;
  books;
  chain = Promise.resolve();
  presence = /* @__PURE__ */ new Map();
  memo = new WorldMemo();
  /** The flags under `pf:flags`, over the start flags. */
  stored = {};
  /** Whether this ledger has brought the market book up to the sim version. */
  bookCurrent = false;
  /** The stored flags read at start; every operation waits on it. */
  loaded;
  /**
   * The flush runs even when `fn` threw, so an operation must validate before
   * its first `set`; `author` throws before it touches the record for that reason.
   */
  run(fn) {
    const next = this.chain.then(async () => {
      try {
        await this.loaded;
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
      "hunt.enabled": true,
      maintenance: false,
      "sandbox.enabled": false,
      ...this.options.flags,
      ...this.stored
    };
  }
  async setFlags(flags) {
    this.stored = { ...this.stored, ...settable(flags) };
    await this.kv.set(FLAGS_KEY, this.stored);
    return this.flags();
  }
  async ban(accountId, reason) {
    const record = await this.books.load(accountId);
    if (!record) return null;
    record.banned = { reason, at: await this.options.now() };
    await this.books.save(record);
    const login = record.account.linked?.login;
    if (login) {
      const prior = await this.books.loginBan(login);
      const ban = prior ?? { ...record.banned, accountIds: [] };
      if (!ban.accountIds.includes(accountId)) ban.accountIds = [...ban.accountIds, accountId];
      await this.kv.set(loginBanKey(login), ban);
    }
    return record.banned;
  }
  async unban(login) {
    const ban = await this.books.loginBan(login);
    if (!ban) return null;
    await this.kv.delete(loginBanKey(login));
    const lifted = [];
    for (const accountId of ban.accountIds) {
      const record = await this.books.load(accountId);
      if (!record?.banned) continue;
      delete record.banned;
      await this.books.save(record);
      lifted.push(accountId);
    }
    return { login: login.toLowerCase(), lifted };
  }
  async config() {
    return {
      minClientVersion: this.options.minClientVersion,
      simVersion: SIM_VERSION4,
      flags: this.flags(),
      serverNow: await this.options.now(),
      speed: this.options.speed ?? 1
    };
  }
  /**
   * Every market call starts here, so the book is normalised before its first read. A read that
   * does not persist leaves it as stored; a refused walk is tried again on the next call.
   */
  async marketContext({ persist } = {}) {
    const ctx = { books: this.books, now: await this.options.now(), flags: this.flags() };
    if (!this.bookCurrent && persist !== false) {
      const { chain, log } = this.books.migrator;
      this.bookCurrent = await normaliseBook(ctx, chain, log);
    }
    return ctx;
  }
  async worldContext(at) {
    const speed = this.options.speed ?? 1;
    return {
      books: this.books,
      now: at ?? await this.options.now(),
      flags: this.flags(),
      presence: this.presence,
      memo: this.memo,
      ttl: this.options.presenceTtlMs ?? PRESENCE_TTL_MS * speed,
      speed,
      seedSource: this.options.seedSource,
      log: this.options.log ?? (() => void 0)
    };
  }
  bootstrap(input) {
    return this.run(async () => {
      if (input.deviceToken !== null) {
        const record2 = await this.books.authenticate({ deviceToken: input.deviceToken });
        const banned = record2 && bannedOf(record2);
        if (banned) return { refusal: "banned", message: banned.message };
        if (record2) return this.bootFor(input.deviceToken, record2);
        return unknownToken;
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
  /** Whether `deviceToken` names an account: a read that writes nothing. */
  knowsToken(deviceToken) {
    return this.run(async () => await this.books.authenticate({ deviceToken }) !== null);
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
        hash: hashState3(record.state),
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
      const banned = bannedOf(record);
      if (banned) return banned;
      return {
        account: record.account,
        returns: isCurrent(record) ? record.returns.length : 0,
        config: await this.config(),
        delivery: deliveryOf(record)
      };
    });
  }
  /**
   * Deletes the caller's account. Its open listings and orders close with nothing returned or
   * refunded, its rows leave both boards and presence, and its record and token go. Nothing
   * else is settled: a counterparty, the boss record and the chat history are untouched. The
   * one call a ban lets through: a banned player may leave. A login ban stays behind.
   */
  deleteAccount(auth) {
    return this.run(async () => {
      const record = await this.books.authenticate(auth);
      if (!record) return unauthorized;
      const id = record.account.accountId;
      await closeAllOf(await this.marketContext(), id);
      await dropFromBoards(this.kv, id);
      if (this.presence.delete(id)) this.memo.presenceChanged();
      if (record.linkCode) await this.books.dropLink(record.linkCode);
      await this.kv.delete(journalKey(id));
      await this.books.remove(record, auth.deviceToken);
      return { deleted: true };
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
      const banned = refusedBanned(record);
      if (banned) return banned;
      const { minClientVersion } = this.options;
      if (compareSemver(batch.clientVersion, minClientVersion) < 0) {
        return { ok: false, reason: "version_gate", minClientVersion };
      }
      if (batch.simVersion !== SIM_VERSION4 || !isCurrent(record)) {
        return { ok: false, reason: "sim_version", simVersion: SIM_VERSION4 };
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
        const { refillMs, capacity } = BUDGETS3[kind];
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
      const result = replay3(record.state, events).state;
      const prevDealt = dealtBefore(record.state, result);
      const before = record.state;
      const hash = hashState3(result);
      const seq = record.seq + 1;
      for (const kind of KINDS) buckets[kind] -= counts[kind];
      record.state = result;
      record.seq = seq;
      record.refillAt = refillAt;
      record.buckets = buckets;
      record.batches = [...record.batches, { batchId: batch.batchId, hash, seq }].slice(-BATCH_RING);
      settle(record);
      const worldCtx = await this.worldContext(now);
      await contribute(worldCtx, record, prevDealt);
      await countHunt(worldCtx, record, before);
      await this.books.deliverReturns(record);
      await onCommit(this.kv, record, now);
      await this.offerZone(record, now);
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
  // GitHub link: the approver's round trips sit between two short locked steps.
  async linkStart(auth) {
    const found = await this.run(async () => {
      const record = await this.books.authenticate(auth);
      if (!record) return unauthorized;
      return bannedOf(record) ?? record.account.accountId;
    });
    if (typeof found !== "string") return found;
    const accountId = found;
    const started = await this.options.linkApprover.start(this.linkCode());
    if ("refusal" in started) return started;
    const { deviceCode, ...start } = started;
    return this.run(async () => {
      const record = await this.books.authenticate(auth);
      if (!record || record.account.accountId !== accountId) return unauthorized;
      if (record.linkCode) await this.books.dropLink(record.linkCode);
      await this.books.putLink(start.code, {
        accountId,
        createdAt: await this.options.now(),
        deviceCode
      });
      record.linkCode = start.code;
      await this.books.save(record);
      return start;
    });
  }
  async linkPoll(auth, code) {
    const found = await this.run(async () => {
      const record = await this.books.authenticate(auth);
      if (!record) return unauthorized;
      const banned = bannedOf(record);
      if (banned) return banned;
      const link = await this.kv.get(linkKey(code));
      if (!link || link.accountId !== record.account.accountId) return pending;
      return link;
    });
    if (!("accountId" in found)) return found;
    const answer = await this.options.linkApprover.poll(found.deviceCode ?? code);
    if (answer.status === "pending") return pending;
    return this.run(async () => {
      const record = await this.books.authenticate(auth);
      if (!record) return unauthorized;
      const banned = bannedOf(record);
      if (banned) return banned;
      const link = await this.kv.get(linkKey(code));
      if (!link || link.accountId !== record.account.accountId) {
        return record.account.linked ? { status: "linked", account: record.account } : pending;
      }
      await this.books.dropLink(code);
      if (record.linkCode === code) delete record.linkCode;
      if (answer.status === "ended") {
        await this.books.save(record);
        return answer;
      }
      const loginBan = await this.books.loginBan(answer.login);
      if (loginBan) {
        await this.books.save(record);
        return {
          status: "ended",
          reason: "denied",
          message: `Promptfall: this GitHub account is banned: ${loginBan.reason}`.slice(0, 200)
        };
      }
      record.account = {
        ...record.account,
        displayName: answer.login,
        linked: { provider: "github", login: answer.login }
      };
      await this.books.save(record);
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
  marketRead(auth, { expire = true, persist = true }, fn) {
    return this.run(async () => {
      const record = await this.authenticated(auth, expire, persist);
      if (!record) return unauthorized;
      if ("message" in record) return record;
      return fn(record.ctx, record.record);
    });
  }
  marketWrite(auth, expire, fn) {
    return this.run(async () => {
      const record = await this.authenticated(auth, expire);
      if (!record) return refusedUnauthorized;
      if ("message" in record) return { ok: false, ...record };
      return fn(record.ctx, record.record);
    });
  }
  /**
   * The caller's current record, after expiring what is due. Expiry runs only
   * for an authenticated caller, and the record is read after it, since
   * expiring the caller's own listing changes the caller's record. A banned caller expires nothing.
   */
  async authenticated(auth, expire, persist = true) {
    const ctx = await this.marketContext({ persist });
    const caller = await this.books.authenticate(auth);
    if (!caller || !isCurrent(caller)) return null;
    const banned = bannedOf(caller);
    if (banned) return banned;
    if (!expire) return { ctx, record: caller };
    await expireDue(ctx);
    const record = await this.books.load(caller.account.accountId);
    return record ? { ctx, record } : null;
  }
  browse(auth, query, options = {}) {
    return this.marketRead(auth, options, (ctx, record) => browse(ctx, record, query));
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
  myOrders(auth, options = {}) {
    return this.marketRead(auth, options, (ctx, record) => myOrders(ctx, record));
  }
  placeOrder(auth, input) {
    return this.marketWrite(auth, false, (ctx, record) => placeOrder(ctx, record, input));
  }
  cancelOrder(auth, orderId) {
    return this.marketWrite(auth, true, (ctx, record) => cancelOrder(ctx, record, orderId));
  }
  matchingOrders(auth, itemId, options = {}) {
    return this.marketRead(
      auth,
      options,
      (ctx, record) => matchingOrders(ctx, record, itemId)
    );
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
  world(auth, since, { advance = true } = {}) {
    return this.run(async () => {
      const ctx = await this.worldContext();
      if (advance && this.memo.advanceDue(ctx.now)) {
        await advanceBoss(ctx);
        await advanceHunt(ctx);
      }
      const record = await this.books.authenticate(auth);
      if (!record) return unauthorized;
      const banned = bannedOf(record);
      if (banned) return banned;
      return world(ctx, record, since, advance);
    });
  }
  chat(auth, text) {
    return this.run(async () => {
      const ctx = await this.worldContext();
      const record = await this.books.authenticate(auth);
      if (!record) return chatUnauthorized;
      const banned = refusedBanned(record);
      if (banned) return banned;
      return chat(ctx, record, text);
    });
  }
  leaderboards(auth) {
    return this.run(async () => {
      const ctx = await this.worldContext();
      const record = await this.books.authenticate(auth);
      if (!record) return unauthorized;
      const banned = bannedOf(record);
      if (banned) return banned;
      return leaderboards(ctx);
    });
  }
  // ---------------------------------------------------------------------------
  // Journal
  /** The caller's journal from its committed state: a read that never writes. */
  journal(auth) {
    return this.run(async () => {
      const record = await this.books.authenticate(auth);
      if (!record || !isCurrent(record)) return unauthorized;
      const banned = bannedOf(record);
      if (banned) return banned;
      const stored = await loadJournal(this.kv, record.account.accountId);
      return journalView(stored, record, await this.options.now());
    });
  }
  setRestDays(auth, days) {
    return this.run(async () => {
      const record = await this.books.authenticate(auth);
      if (!record || !isCurrent(record)) return { ok: false, reason: "unauthorized" };
      const banned = refusedBanned(record);
      if (banned) return banned;
      const refusal = restDaysRefusal(days);
      if (refusal) return { ok: false, reason: refusal };
      const now = await this.options.now();
      const stored = await loadJournal(this.kv, record.account.accountId);
      setRestDays(stored, days, now);
      await this.kv.set(journalKey(record.account.accountId), stored);
      return { ok: true, journal: journalView(stored, record, now) };
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
    if (input.bot) record.bot = true;
    await this.books.save(record);
    await this.kv.set(tokenKey(deviceToken), accountId);
    await this.offerZone(record, now);
    return { accountId, deviceToken };
  }
  /** Offers the account's row to the highest-zone board; a bot's is never offered. */
  async offerZone(record, now) {
    if (record.bot) return;
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
    const ctx = await this.worldContext();
    await advanceBoss(ctx);
    await advanceHunt(ctx);
    await expireDue(await this.marketContext());
    for (const accountId of await this.books.returnsQueue()) {
      const record = await this.books.load(accountId);
      if (!record) continue;
      await this.books.deliverReturns(record);
      await this.books.save(record);
    }
    await this.sweepLinks();
  }
  /** Drops the link rows past their lifetime and clears each account's pointer to one. */
  async sweepLinks() {
    const cutoff = await this.options.now() - LINK_TTL_MS * (this.options.speed ?? 1);
    for (const { code, createdAt } of await this.books.openLinks()) {
      if (createdAt > cutoff) continue;
      const link = await this.kv.get(linkKey(code));
      await this.books.dropLink(code);
      const record = link ? await this.books.load(link.accountId) : null;
      if (record?.linkCode !== code) continue;
      delete record.linkCode;
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
  SETTABLE_FLAGS,
  WORLD_BOSSES,
  approveAs,
  isBlocked,
  listingFee,
  nextLedgerId,
  saleFee,
  saleNet,
  transfer,
  validPrice
};
