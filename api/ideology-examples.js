const classifier = require("./_classifier.cjs");
const { SEED } = require("./_seed-examples.js");

const UA = "NS-Dossier-Explorer (https://nation-states-analyzer.vercel.app)";
const API = "https://www.nationstates.net/cgi-bin/api.cgi";

const KEY_MAP = "nsde:ideo:examples";
const KEY_LOCK = "nsde:ideo:lock";
const KEY_UPDATED = "nsde:ideo:updated";
const KEY_MINED = "nsde:ideo:candidates";

const PACE_MS = 1000;
const MAX_SCAN_REQUESTS = 250;
const TICK_REQUESTS = 6;
const MAX_PER_IDEOLOGY = 6;
const LOCK_TTL_SECONDS = 12 * 3600;
const TICK_LOCK_TTL_SECONDS = 30 * 60;
const MAP_TTL_SECONDS = 21 * 86400;

const REGIONS = ["The Rejected Realms", "Lazarus", "Balder", "Osiris", "The Pacific",
  "The North Pacific", "The South Pacific", "The East Pacific", "The West Pacific",
  "10000 Islands", "Europeia", "Cascadia"];

const SCALES = [0, 1, 2, 8, 17, 27, 28, 29, 32, 33, 36, 38, 42, 43, 45, 46, 47, 48, 49, 53, 54, 59, 62, 69, 70, 72, 75, 87];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function redisConfig() {
  return {
    base: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "",
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ""
  };
}
async function redisGet(key) {
  const { base, token } = redisConfig();
  if (!base || !token) return null;
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/get/${key}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.result === null || data.result === undefined) return null;
    return JSON.parse(data.result);
  } catch (_) { return null; }
}
async function redisSet(key, value, ttlSeconds) {
  const { base, token } = redisConfig();
  if (!base || !token) return;
  try {
    const payload = encodeURIComponent(JSON.stringify(value));
    await fetch(`${base.replace(/\/+$/, "")}/set/${key}/${payload}/EX/${ttlSeconds}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (_) {  }
}
async function redisAcquireLock(key, ttlSeconds) {
  const { base, token } = redisConfig();
  if (!base || !token) return true;
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/set/${key}/1/EX/${ttlSeconds}/NX`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return false;
    const data = await res.json();
    return data && data.result === "OK";
  } catch (_) { return true; }
}
async function redisReleaseLock(key) {
  const { base, token } = redisConfig();
  if (!base || !token) return;
  try { await fetch(`${base.replace(/\/+$/, "")}/del/${key}`, { headers: { Authorization: `Bearer ${token}` } }); } catch (_) {  }
}

async function roster(region) {
  const res = await fetch(`${API}?${new URLSearchParams({ region, q: "nations" })}`, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const xml = await res.text();
  const m = xml.match(/<NATIONS>([\s\S]*?)<\/NATIONS>/);
  if (!m) return [];
  return m[1].split(":").map((s) => s.trim()).filter(Boolean);
}

function parseNationXML(xml) {
  const scales = [];
  const re = /<SCALE id="(\d+)">([\s\S]*?)<\/SCALE>/g;
  let m;
  while ((m = re.exec(xml))) {
    const id = Number(m[1]);
    const sc = m[2].match(/<SCORE>([\s\S]*?)<\/SCORE>/);
    const pr = m[2].match(/<PRANK>([\s\S]*?)<\/PRANK>/);
    scales.push({ id, score: sc ? parseFloat(sc[1]) : NaN, prank: pr ? parseFloat(pr[1]) : NaN });
  }
  const sectors = { state: 0, private: 0, black: 0 };
  const secM = xml.match(/<SECTORS>([\s\S]*?)<\/SECTORS>/);
  if (secM) {
    const body = secM[1];
    const b = body.match(/<BLACKMARKET>([\s\S]*?)<\/BLACKMARKET>/);
    const g = body.match(/<GOVERNMENT>([\s\S]*?)<\/GOVERNMENT>/);
    const i = body.match(/<INDUSTRY>([\s\S]*?)<\/INDUSTRY>/);
    const p = body.match(/<PUBLIC>([\s\S]*?)<\/PUBLIC>/);
    if (b) sectors.black = parseFloat(b[1]) || 0;
    if (g) sectors.state = parseFloat(g[1]) || 0;
    if (i) sectors.private = parseFloat(i[1]) || 0;
    if (p) sectors.state = (sectors.state || 0) + (parseFloat(p[1]) || 0);
  }

  const govt = {};
  const GOVT_KEYS = { administration: "administration", defence: "defence", education: "education",
    environment: "environment", healthcare: "healthcare", commerce: "commerce", internationalaid: "aid",
    lawandorder: "lawandorder", publictransport: "transport", socialequality: "social", spirituality: "spirituality", welfare: "welfare" };
  const govtM = xml.match(/<GOVT>([\s\S]*?)<\/GOVT>/);
  if (govtM) {
    const gRe = /<([A-Z]+)>(-?[\d.]+)<\/\1>/g;
    let gm;
    while ((gm = gRe.exec(govtM[1]))) {
      const key = GOVT_KEYS[gm[1].toLowerCase()];
      const v = parseFloat(gm[2]);
      if (key && Number.isFinite(v)) govt[key] = v;
    }
  }
  const catM = xml.match(/<CATEGORY>([\s\S]*?)<\/CATEGORY>/);
  const category = catM ? catM[1].trim() : null;
  return { scales, sectors, govt, category };
}

async function classify(name) {
  const res = await fetch(`${API}?${new URLSearchParams({ nation: name, q: "census+sectors+govt+category", scale: SCALES.join("+"), mode: "score+prank" })}`, { headers: { "User-Agent": UA, Accept: "application/xml" } });
  if (!res.ok) return null;
  const xml = await res.text();
  if (/<ERROR>/.test(xml)) return null;
  const { scales, sectors, govt, category } = parseNationXML(xml);
  if (!scales.length) return null;
  const p = classifier.compassPoint(scales, { entityType: "nation", sectors, govt, category: category || undefined });
  const r = classifier.specificIdeology(p, null, sectors, null);
  return r ? r.name : null;
}

function dayNumber() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / 86400000);
}

async function runScan(existingMap, opts) {
  const options = opts || {};
  const requestCap = options.requestCap || MAX_SCAN_REQUESTS;
  const missingOnly = !!options.missingOnly;
  const reverifyPool = !!options.reverifyPool;
  const verifyAll = !!options.verifyAll;
  const verifyCount = verifyAll ? Infinity : Number.isFinite(options.verifyCount) ? options.verifyCount : (reverifyPool ? 1 : 0);
  const map = existingMap || {};
  const all = classifier.IDEOLOGIES.map((r) => r[0]);
  for (const n of all) if (!map[n]) map[n] = [];

  const seen = new Set();
  for (const n of all) for (const ex of map[n] || []) seen.add(ex);

  let budget = requestCap;
  let stopped = false;

  const missing = new Set(all.filter((n) => !(map[n] || []).length));
  if (missingOnly && !missing.size && !reverifyPool) return map;

  const tryClassify = async (name) => {
    if (budget <= 0 || stopped || !name || seen.has(name)) return;
    seen.add(name);
    const lbl = await classify(name);
    budget--;
    if (lbl && (!missingOnly || missing.has(lbl)) && (map[lbl] || []).length < MAX_PER_IDEOLOGY * 2) {
      (map[lbl] = map[lbl] || []).push(name);
    }
    await sleep(PACE_MS);
  };

  if (verifyCount > 0) {
    const members = [];
    for (const n of all) for (const ex of map[n] || []) members.push([n, ex]);
    if (members.length) {
      members.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
      const start = dayNumber() % members.length;
      const toCheck = Math.min(verifyCount, members.length, budget);
      const driftedHomes = new Set();
      for (let i = 0; i < toCheck; i++) {
        const [homeIdeo, name] = members[(start + i) % members.length];
        if (budget <= 0) break;
        const live = await classify(name);
        budget--;
        await sleep(PACE_MS);
        if (live === null) {

          for (const n of all) map[n] = (map[n] || []).filter((ex) => ex !== name);
          driftedHomes.add(homeIdeo);
        } else if (live !== homeIdeo) {

          for (const n of all) {
            map[n] = (map[n] || []).filter((ex) => ex !== name || n === live);
          }

          if ((map[live] || []).length < MAX_PER_IDEOLOGY) (map[live] = map[live] || []).push(name);
          seen.delete(name);
          driftedHomes.add(homeIdeo);
        }
      }

      if (driftedHomes.size && budget > 0) {
        const mined = await redisGet(KEY_MINED);
        for (const home of driftedHomes) {
          if (budget <= 0) break;
          if ((map[home] || []).length) continue;
          const cands = (mined && Array.isArray(mined[home])) ? mined[home] : [];
          for (const name of cands) {
            if (budget <= 0 || (map[home] || []).length >= MAX_PER_IDEOLOGY) break;
            if (seen.has(name)) continue;
            seen.add(name);
            const lbl = await classify(name);
            budget--;
            if (lbl === home) (map[home] = map[home] || []).push(name);
            else if (lbl && (map[lbl] || []).length < MAX_PER_IDEOLOGY) (map[lbl] = map[lbl] || []).push(name);
            await sleep(PACE_MS);
          }
        }
      }
    }
  }

  const mined = await redisGet(KEY_MINED);
  if (mined && typeof mined === "object") {
    const needFirst = all.filter((n) => !(map[n] || []).length);
    const rest = missingOnly ? [] : all.filter((n) => (map[n] || []).length);
    const orderedIdeos = [...needFirst, ...rest]
      .filter((n) => Array.isArray(mined[n]) && mined[n].length);
    for (const ideo of orderedIdeos) {
      if (budget <= 0) break;
      for (const name of mined[ideo]) {
        if (budget <= 0) break;
        await tryClassify(name);
      }
    }
  }

  const offset = dayNumber() % REGIONS.length;
  const rosters = [];
  for (let k = 0; k < 3 && budget > 0; k++) {
    const region = REGIONS[(offset + k) % REGIONS.length];
    const names = await roster(region);
    budget--;
    await sleep(PACE_MS);
    if (names === null) { stopped = true; break; }
    rosters.push(names);
  }
  if (stopped) return map;

  if (budget > 0) {
    for (const names of rosters) {
      if (budget <= 0) break;
      for (let i = 0; i < 12 && budget > 0; i++) {
        const name = names[Math.floor(Math.random() * names.length)];
        await tryClassify(name);
      }
    }
  }

  for (const n of all) {
    const list = [...new Set((map[n] || []).concat(SEED[n] || []))];
    map[n] = list.slice(0, MAX_PER_IDEOLOGY);
  }
  return map;
}

function mergedHasMembers(mergedNow) {
  for (const k of Object.keys(mergedNow)) {
    if (Array.isArray(mergedNow[k]) && mergedNow[k].length) return true;
  }
  return false;
}

let running = null;
let tickRunning = null;

module.exports = async function handler(req, res) {
  const isCron = String((req.query && req.query.cron) || "") === "1";
  const isTick = String((req.query && req.query.tick) || "") === "1";

  let map = await redisGet(KEY_MAP) || {};
  let updated = await redisGet(KEY_UPDATED) || null;

  const hasRedis = !!(redisConfig().base && redisConfig().token);

  if (isTick) {
    const mergedNow = {};
    const allNow = classifier.IDEOLOGIES.map((r) => r[0]);
    for (const n of allNow) mergedNow[n] = [...new Set((map[n] || []).concat(SEED[n] || []))];
    const uncovered = allNow.filter((n) => !mergedNow[n].length);

    if (!hasRedis || (!uncovered.length && !mergedHasMembers(mergedNow))) {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ tick: "skipped", covered: allNow.length - uncovered.length, total: allNow.length, remaining: uncovered.length });
      return;
    }
    const tickLock = "nsde:ideo:ticklock";
    if (!await redisAcquireLock(tickLock, TICK_LOCK_TTL_SECONDS)) {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ tick: "locked" });
      return;
    }
    try {
      tickRunning = tickRunning || (async () => {
        try {
          const fresh = await redisGet(KEY_MAP) || {};
          const merged = await runScan(fresh, {
            requestCap: TICK_REQUESTS,
            missingOnly: true,
            reverifyPool: !uncovered.length
          });
          if (merged !== fresh) {
            await redisSet(KEY_UPDATED, new Date().toISOString(), MAP_TTL_SECONDS);
            await redisSet(KEY_MAP, merged, MAP_TTL_SECONDS);
            map = merged;
          }
        } finally {
          await redisReleaseLock(tickLock);
          tickRunning = null;
        }
      })();
      await tickRunning;
    } catch (_) {  }

  }

  const shouldScan = isCron || (hasRedis && !Object.keys(map).length);
  if (shouldScan) {
    const locked = await redisAcquireLock(KEY_LOCK, LOCK_TTL_SECONDS);
    if (locked) {
      running = running || (async () => {
        try {
          const fresh = await redisGet(KEY_MAP) || {};

          const merged = await runScan(fresh, { requestCap: MAX_SCAN_REQUESTS, verifyAll: true });
          updated = new Date().toISOString();
          await redisSet(KEY_UPDATED, updated, MAP_TTL_SECONDS);
          await redisSet(KEY_MAP, merged, MAP_TTL_SECONDS);
          map = merged;
        } finally {
          await redisReleaseLock(KEY_LOCK);
          running = null;
        }
      })();
      await running;
    }
  }

  const all = classifier.IDEOLOGIES.map((r) => r[0]);
  const out = {};
  let covered = 0;
  for (const n of all) {
    const list = [...new Set((map[n] || []).concat(SEED[n] || []))].slice(0, MAX_PER_IDEOLOGY);
    if (list.length) covered++;
    out[n] = list;
  }

  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).json({ updated, covered, total: all.length, examples: out });
};

module.exports.runScan = runScan;
module.exports.classify = classify;
module.exports.KEY_MAP = KEY_MAP;

module.exports.config = { maxDuration: 300 };