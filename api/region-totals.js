const DUMP_URL = "https://www.nationstates.net/pages/nations.xml.gz";
const UA = "NS-Dossier-Explorer (https://nation-states-analyzer.vercel.app)";
const BUCKETS = 16;
const DUMP_TTL_SECONDS = 36 * 3600;

const zlib = require("zlib");
const { Readable } = require("stream");
const { mineBlock, mineScore, capCandidates } = require("./_mining.js");
const MINED_KEY = "nsde:ideo:candidates";
const MINED_TTL_SECONDS = 48 * 3600;

const ECON_MOD = { Frightening: 0.04, "All-Consuming": 0.03, Powerhouse: 0.02, Thriving: 0.02, "Very Strong": 0.01, Strong: 0.01, Good: 0, Reasonable: -0.01, Fair: -0.01, Developing: -0.02, Weak: -0.02, Fragile: -0.03, Struggling: -0.04, "Basket Case": -0.05, Imploded: -0.06 };
const PRODUCTION = { Frightening: 35000, "All-Consuming": 30000, Powerhouse: 25000, Thriving: 20000, "Very Strong": 15000, Strong: 10000, Good: 7500, Reasonable: 5000, Fair: 4000, Developing: 3000, Weak: 2000, Fragile: 1000, Struggling: 650, "Basket Case": 350, Imploded: 100 };

const CR_MOD_WE = { Frightening: -0.02, Excessive: 0.01, "World Benchmark": 0.05, Superb: 0.04, Excellent: 0.03, "Very Good": 0.02, Good: 0.01, Average: 0, "Below Average": -0.01, Some: -0.02, Few: -0.03, Rare: -0.04, "Unheard Of": -0.06, Outlawed: -0.08 };
const CR_MOD_CC = { Frightening: -0.01, Excessive: 0.01, "World Benchmark": 0.05, Superb: 0.04, Excellent: 0.03, "Very Good": 0.02, Good: 0.01, Average: 0, "Below Average": -0.01, Some: -0.02, Few: -0.04, Rare: -0.06, "Unheard Of": -0.08, Outlawed: -0.1 };
const PF_MOD_WE = { Corrupted: -0.01, "Widely Abused": 0, Excessive: 0.01, "World Benchmark": 0.02, Superb: 0.01, Excellent: 0.01, "Very Good": 0, Good: 0, Average: 0, "Below Average": -0.01, Some: -0.02, Few: -0.02, Rare: -0.04, "Unheard Of": -0.03, Outlawed: -0.04 };
const PF_MOD_GE = { Corrupted: -0.15, "Widely Abused": -0.1, Excessive: -0.05, "World Benchmark": -0.01, Superb: -0.02, Excellent: -0.02, "Very Good": -0.03, Good: -0.04, Average: -0.04, "Below Average": -0.05, Some: -0.06, Few: -0.08, Rare: -0.1, "Unheard Of": -0.15, Outlawed: -0.2 };

function taxModifier(tax) {
  if (tax <= 0) return 0.02;
  const brackets = [[1, 10, 0, -0.02], [11, 20, -0.02, -0.04], [21, 30, -0.04, -0.06], [31, 40, -0.06, -0.08], [41, 50, -0.08, -0.1], [51, 60, -0.1, -0.12], [61, 70, -0.12, -0.14], [71, 80, -0.14, -0.16], [81, 90, -0.16, -0.18], [91, 100, -0.18, -0.2]];
  const b = brackets.find((br) => tax >= br[0] && tax <= br[1]);
  if (!b) return 0;
  const [lo, hi, vLo, vHi] = b;
  return vLo + (vHi - vLo) * ((tax - lo) / (hi - lo));
}

function adminCurve(adminBudget) {
  const x = adminBudget;
  if (x === 0.3) return 1;
  return 1 - x * Math.sign(x - 0.3) * Math.cbrt(Math.abs(x - 0.3)) + 0.2 * x;
}

function section(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1] : "";
}

function field(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : "";
}

function normRegion(raw) {
  return (raw || "").trim().toLowerCase().replace(/[\s_]+/g, "_");
}

function regionBucket(key) {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return Math.abs(h) % BUCKETS;
}

function nationTotals(block) {
  const freedom = section(block, "FREEDOM");
  const econWord = field(freedom, "ECONOMY");
  const crWord = field(freedom, "CIVILRIGHTS");
  const pfWord = field(freedom, "POLITICALFREEDOM");
  const tax = parseFloat(field(block, "TAX"));
  const pop = parseFloat(field(block, "POPULATION"));
  const adminRaw = parseFloat(field(block, "ADMINISTRATION"));
  if (!econWord || !crWord || !pfWord || !Number.isFinite(tax) || !Number.isFinite(pop) || pop <= 0) return null;

  const eMod = ECON_MOD[econWord] ?? 0;
  const crWE = CR_MOD_WE[crWord] ?? 0;
  const crCC = CR_MOD_CC[crWord] ?? 0;
  const pfWE = PF_MOD_WE[pfWord] ?? 0;
  const pfGE = PF_MOD_GE[pfWord] ?? 0;
  const tMod = taxModifier(tax);
  const production = PRODUCTION[econWord] ?? 7500;

  const workerEnthusiasm = 1 + crWE + pfWE + tMod;
  const consumerConfidence = 1 + eMod + crCC;
  const adminPct = Number.isFinite(adminRaw) ? adminRaw : 20;
  const govEfficiency = 1 + pfGE / (adminCurve(adminPct / 100) || 1);

  const output = production * pop * 1e6 * workerEnthusiasm * consumerConfidence;
  const consumption = output * (1 - tax / 100);
  const govBudget = output * govEfficiency * (tax / 100 + consumerConfidence / 10 + workerEnthusiasm / 40);
  const govExpend = govBudget * govEfficiency;
  const imports = ((1 / consumerConfidence) / 8) * (consumption + govExpend);

  if (!Number.isFinite(output) || !Number.isFinite(imports) || output <= 0 || imports <= 0) return null;
  return { output, imports };
}

async function computeAllTotals() {
  const res = await fetch(DUMP_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`dump download failed (HTTP ${res.status})`);
  const dumpAt = res.headers.get("last-modified") || new Date().toISOString();

  const decompressed = Readable.fromWeb(res.body).pipe(zlib.createGunzip());
  let buf = "";
  const totals = new Map();
  const mined = {};

  for await (const chunk of decompressed) {
    buf += chunk.toString("utf8");
    let idx;
    while ((idx = buf.indexOf("</NATION>")) !== -1) {
      const block = buf.slice(0, idx + "</NATION>".length);
      buf = buf.slice(idx + "</NATION>".length);
      const region = field(block, "REGION");
      if (region) {
        const key = normRegion(region);
        const t = nationTotals(block);
        if (t) {
          let acc = totals.get(key);
          if (!acc) { acc = { count: 0, totalOutput: 0, totalImports: 0 }; totals.set(key, acc); }
          acc.count++;
          acc.totalOutput += t.output;
          acc.totalImports += t.imports;
        }
      }

      for (const ideo of mineBlock(block)) {
        const name = field(block, "NAME");
        const score = mineScore(ideo, block);
        if (name && score > 0) (mined[ideo] = mined[ideo] || []).push([name, score]);
      }
    }
  }

  const capped = capCandidates(mined);
  let minedCount = 0;
  for (const list of Object.values(capped)) minedCount += list.length;
  if (minedCount) {
    try { await redisSet(MINED_KEY, capped, MINED_TTL_SECONDS); } catch (_) {}
  }
  return { dumpAt, totals, mined: capped };
}

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

let activeDumpDate = null;
let activeDownload = null;

function ensureBuckets(dumpDate) {
  if (activeDumpDate === dumpDate && activeDownload) return activeDownload;
  activeDumpDate = dumpDate;
  activeDownload = (async () => {
    const { totals } = await computeAllTotals();
    const maps = Array.from({ length: BUCKETS }, () => ({}));
    for (const [key, val] of totals) maps[regionBucket(key)][key] = val;

    maps.forEach((m, i) => redisSet(`nsde:rt:${dumpDate}:${i}`, m, DUMP_TTL_SECONDS));
    return maps;
  })().finally(() => { activeDumpDate = null; activeDownload = null; });
  return activeDownload;
}

async function dumpDateOf() {

  const res = await fetch(DUMP_URL, { method: "HEAD", headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`dump HEAD failed (HTTP ${res.status})`);
  const last = res.headers.get("last-modified") || new Date().toISOString();
  return { date: last.slice(0, 10), dumpAt: last };
}

module.exports = async function handler(req, res) {
  const isCron = String((req.query && req.query.cron) || "") === "1";
  const region = String((req.query && req.query.region) || "").trim();
  if (!region && !isCron) {
    res.status(400).json({ error: "missing region" });
    return;
  }
  const wanted = normRegion(region);
  const bucket = regionBucket(wanted);

  let dumpDate, dumpAt;
  try {
    ({ date: dumpDate, dumpAt } = await dumpDateOf());
  } catch (err) {
    res.status(502).json({ error: `could not reach the nations dump: ${err.message}` });
    return;
  }

  const cachedBucket = await redisGet(`nsde:rt:${dumpDate}:${bucket}`);
  if (cachedBucket && typeof cachedBucket === "object" && cachedBucket[wanted]) {
    const t = cachedBucket[wanted];
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).json({ count: t.count, totalOutput: t.totalOutput, totalImports: t.totalImports, dumpAt });
    return;
  }

  try {
    const maps = await ensureBuckets(dumpDate);
    if (isCron && !wanted) {
      res.status(200).json({ warmed: true, dumpAt, regions: maps.reduce((n, b) => n + Object.keys(b).length, 0) });
      return;
    }
    const t = maps[bucket] && maps[bucket][wanted];
    if (!t) {
      res.status(404).json({ error: "region not found in the current dump" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).json({ count: t.count, totalOutput: t.totalOutput, totalImports: t.totalImports, dumpAt });
  } catch (err) {
    res.status(502).json({ error: `could not process the nations dump: ${err.message}` });
    return;
  }
};

module.exports.computeAllTotals = computeAllTotals;
module.exports.normRegion = normRegion;
module.exports.nationTotals = nationTotals;
module.exports.regionBucket = regionBucket;

module.exports.config = { maxDuration: 60 };