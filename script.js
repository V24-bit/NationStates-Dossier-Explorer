(() => {
  "use strict";
  console.log("[NationStates Dossier Explorer] script.js v3 loaded.");

  const API_BASE = "https://www.nationstates.net/cgi-bin/api.cgi";

  const SCRIPT_IDENTITY = "NationStates Dossier Explorer (https://nationstates-dossier-explorer.vercel.app)";
  const CORS_PROXY = "https://api.allorigins.win/raw?url=";
  const MIN_REQUEST_SPACING_MS = 700;

  const NATION_SHARDS = [
    "name", "type", "fullname", "motto", "category", "wa", "endorsements",
    "influence", "influencenum", "freedom", "census", "govt", "govtdesc",
    "govtpriority", "sectors", "policies", "notable", "notables",
    "sensibilities", "animal", "animaltrait", "currency", "flag", "capital",
    "leader", "religion", "founded", "firstlogin", "lastlogin", "lastactivity",
    "region", "population", "gdp", "income", "tax", "majorindustry", "demonym",
    "banner",
    "dbid", "happenings", "dispatchlist", "deaths", "crime", "legislation",
    "publicsector", "poorest", "richest", "nstats", "factbooklist"
  ].join("+");

  const REGION_SHARDS = [
    "name", "factbook", "flag", "banner", "bannerby", "bannerurl", "delegate",
    "delegateauth", "delegatevotes", "founder", "founded", "foundedtime", "governor",
    "governortitle", "officers", "embassies", "tags", "power",    "numnations", "wanations", "nations", "census", "happenings", "history", "lastupdate",
    "lastmajorupdate", "messages", "banlist", "frontier", "recruiters",
    "magnetism", "dispatches", "poll"
  ].join("+");

  const enLocale = (n, opts) => Number(n).toLocaleString("en-US", opts || {});

  function stripBBCode(t) {
    if (!t) return "";
    return t
      .replace(/\[(nation|region)(?:=\w+)?\]([^\[]*)\[\/\1\]/gi, "$2")
      .replace(/\[url=[^\]]+\]([^\[]*)\[\/url\]/gi, "$1")

      .replace(/@@([^@]+)@@/g, (_, n) => n.replace(/_/g, " "))
      .replace(/%%([^%]+)%%/g, (_, n) => n.replace(/_/g, " "))
      .replace(/\[\/?[a-z0-9=_"'#%;,. ]+\]/gi, "")
      .trim();
  }

  function humanizeTag(tag) {
    const map = {
      ADMINISTRATION: "Administration", DEFENCE: "Defence", EDUCATION: "Education",
      ENVIRONMENT: "Environment", HEALTHCARE: "Healthcare", COMMERCE: "Commerce",
      INTERNATIONALAID: "International Aid", LAWANDORDER: "Law & Order",
      PUBLICTRANSPORT: "Public Transport", SOCIALEQUALITY: "Social Equality",
      SPIRITUALITY: "Spirituality", WELFARE: "Welfare",
      BLACKMARKET: "Black Market", GOVERNMENT: "Government", INDUSTRY: "Private Industry",
      PUBLIC: "State-Owned Industry"
    };
    if (map[tag]) return map[tag];
    return tag.charAt(0) + tag.slice(1).toLowerCase();
  }

  const AUTHORITY_MAP = {
    X: "Executive", W: "World Assembly", S: "Succession", A: "Appearance",
    B: "Border Control", C: "Communications", E: "Embassies", P: "Polls"
  };

  const CENSUS_NAMES_SEED = {
    0: "Civil Rights", 1: "Economy", 2: "Political Freedom", 3: "Population",
    4: "Wealth Gaps", 5: "Death Rate", 6: "Compassion", 7: "Eco-Friendliness",
    8: "Social Conservatism", 9: "Nudity", 10: "Industry: Automobile Manufacturing",
    11: "Industry: Cheese Exports", 12: "Industry: Basket Weaving", 13: "Industry: Information Technology",
    14: "Industry: Pizza Delivery", 15: "Industry: Trout Fishing", 16: "Industry: Arms Manufacturing",
    17: "Sector: Agriculture", 18: "Industry: Beverage Sales", 19: "Industry: Timber Woodchipping",
    20: "Industry: Mining", 21: "Industry: Insurance", 22: "Industry: Furniture Restoration",
    23: "Industry: Retail", 24: "Industry: Book Publishing", 25: "Industry: Gambling",
    26: "Sector: Manufacturing", 27: "Government Size", 28: "Welfare",
    29: "Public Healthcare", 30: "Law Enforcement", 31: "Business Subsidization",
    32: "Religiousness", 33: "Income Equality", 34: "Niceness", 35: "Rudeness",
    36: "Intelligence", 37: "Ignorance", 38: "Political Apathy", 39: "Health",
    40: "Cheerfulness", 41: "Weather", 42: "Compliance", 43: "Safety",
    44: "Lifespan", 45: "Ideological Radicality", 46: "Defense Forces", 47: "Pacifism",
    48: "Economic Freedom", 49: "Taxation", 50: "Freedom From Taxation", 51: "Corruption",
    52: "Integrity", 53: "Authoritarianism", 54: "Youth Rebelliousness", 55: "Culture",
    56: "Employment", 57: "Public Transport", 58: "Tourism", 59: "Weaponization",
    60: "Recreational Drug Use", 61: "Obesity", 62: "Secularism", 63: "Environmental Beauty",
    64: "Charmlessness", 65: "Influence", 66: "World Assembly Endorsements", 67: "Averageness",
    68: "Human Development Index", 69: "Primitiveness", 70: "Scientific Advancement",
    71: "Inclusiveness", 72: "Average Income", 73: "Average Income of Poor", 74: "Average Income of Rich",
    75: "Public Education", 76: "Economic Output", 77: "Crime", 78: "Foreign Aid",
    79: "Black Market", 80: "Residency", 81: "Survival", 82: "Zombies",
    83: "Zombie Deaths", 84: "Zombification", 85: "Average Disposable Income",
    86: "International Artwork", 87: "Patriotism", 88: "Food Quality", 89: "Accessibility"
  };

  const censusNameCache = new Map();
  try {
    const stored = JSON.parse(localStorage.getItem("ns_census_names") || "{}");
    Object.entries(stored).forEach(([k, v]) => censusNameCache.set(Number(k), v));
  } catch (_) {  }
  Object.entries(CENSUS_NAMES_SEED).forEach(([k, v]) => censusNameCache.set(Number(k), v));

  function persistCensusCache() {
    try { localStorage.setItem("ns_census_names", JSON.stringify(Object.fromEntries(censusNameCache))); }
    catch (_) {  }
  }

  const pendingFetch = [];
  const droppedGroups = new Set();
  let dispatchTimer = null;
  let lastRequestAt = 0;

  function dropQueuedGroup(group) { droppedGroups.add(group); }

  let lastTradeGroup = null;
  function bumpTradeGroup() {
    if (lastTradeGroup) dropQueuedGroup(lastTradeGroup);
    lastTradeGroup = "trade" + openSeq;
  }

  function queuedFetch(url, urgent, group) {
    return new Promise((resolve, reject) => {
      pendingFetch.push({ url, urgent: !!urgent, group, resolve, reject });
      pumpQueue();
    });
  }

  function pumpQueue() {
    if (dispatchTimer || !pendingFetch.length) return;
    const now = Date.now();
    const wait = Math.max(0, lastRequestAt + MIN_REQUEST_SPACING_MS - now);
    lastRequestAt = Math.max(now, lastRequestAt + MIN_REQUEST_SPACING_MS);
    dispatchTimer = setTimeout(() => {
      dispatchTimer = null;
      let job = null;
      while (pendingFetch.length) {
        const ui = pendingFetch.findIndex((j) => j.urgent);
        const cand = pendingFetch.splice(ui >= 0 ? ui : 0, 1)[0];
        if (cand.group && droppedGroups.has(cand.group)) { cand.resolve(null); continue; }
        job = cand;
        break;
      }
      if (job) rawFetch(job.url).then(job.resolve, job.reject);
      pumpQueue();
    }, wait);
  }

  async function rawFetch(url) {
    try {
      return await fetch(url, { headers: { "Accept": "text/xml" } });
    } catch (directError) {
      try {
        return await fetch(CORS_PROXY + encodeURIComponent(url));
      } catch (proxyError) {
        throw new Error("Could not reach the NationStates API, either directly or through the backup CORS proxy. Check your connection or the proxy configured in script.js.");
      }
    }
  }

  class NSApiError extends Error {}

  async function fetchXML(url, urgent, group, retried) {
    const res = await queuedFetch(url, urgent, group);
    if (res.status === 429 && !retried) {

      const header = Number(res.headers.get("Retry-After"));
      const waitSec = Number.isFinite(header) ? Math.min(30, Math.max(1, header)) : 3;
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      return fetchXML(url, urgent, group, true);
    }
    if (res.status === 404) throw new NSApiError("No dossier found under that name. Check the spelling.");
    if (res.status === 403) throw new NSApiError("Request rejected by the API (403). The server may be blocking requests without a recognizable User-Agent.");
    if (res.status === 429) {
      const retry = res.headers.get("Retry-After");
      throw new NSApiError(`Rate limit reached. Try again in ${retry || "a few"} seconds.`);
    }
    if (!res.ok) throw new NSApiError(`The API responded with an error (HTTP ${res.status}).`);
    const bodyText = await res.text();
    const doc = new DOMParser().parseFromString(bodyText, "application/xml");
    if (doc.querySelector("parsererror")) throw new NSApiError("The API response wasn't valid XML. Please try again.");
    return doc;
  }

  function buildUrl(params) {

    params.script = SCRIPT_IDENTITY;
    return `${API_BASE}?${new URLSearchParams(params).toString()}`;
  }
  function normalizeName(raw) { return raw.trim().toLowerCase().replace(/\s+/g, "_"); }

  async function fetchNation(name) {
    return fetchXML(buildUrl({
      nation: normalizeName(name), q: NATION_SHARDS,
      scale: "all", mode: "score+prank"
    }), true);
  }
  async function fetchRegionMain(name, urgent) {
    return fetchXML(buildUrl({
      region: normalizeName(name), q: REGION_SHARDS,
      scale: "all", mode: "score+prank", limit: "12"
    }), urgent);
  }
  async function resolveCensusName(id) {
    if (censusNameCache.has(id)) return censusNameCache.get(id);
    try {
      const doc = await fetchXML(buildUrl({ q: "censusname", scale: String(id) }), true);
      const name = (doc.documentElement.textContent || "").trim() || `World Census Scale #${id}`;
      censusNameCache.set(id, name);
      persistCensusCache();
      return name;
    } catch (_) { return `World Census Scale #${id}`; }
  }

  const $root = document.getElementById("dossier-root");
  const $banner = document.getElementById("status-banner");

  function showBanner(msg, type) { $banner.textContent = msg; $banner.className = "banner" + (type ? ` is-${type}` : ""); $banner.hidden = false; }
  function hideBanner() { $banner.hidden = true; }
  function text(doc, tag) { const el = doc.querySelector(tag); return el ? el.textContent.trim() : ""; }
  function fill(root, field, value, fallback = "—") {
    const el = root.querySelector(`[data-f="${field}"]`);
    if (!el) return;
    el.textContent = (value === undefined || value === null || value === "") ? fallback : value;
  }
  function fillImg(root, field, src) {
    const el = root.querySelector(`[data-f="${field}"]`);
    if (!el) return;
    if (src) { el.src = src; el.style.display = ""; } else { el.style.display = "none"; }
  }
  function makeChip(labelText, title) {
    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = labelText;
    if (title) span.title = title;
    return span;
  }
  function makeLogItem(timeLabel, bodyStr) {
    const li = document.createElement("li");
    const time = document.createElement("span"); time.className = "log-time"; time.textContent = timeLabel;
    const body = document.createElement("span"); body.className = "log-text"; body.textContent = bodyStr;
    li.append(time, body);
    return li;
  }
  function fmtDate(unixSeconds) {
    const n = Number(unixSeconds);
    if (!n) return "";
    return new Date(n * 1000).toLocaleString("en-US", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function foundedLabel(raw) {
    const v = (raw || "").trim();
    return v && v !== "0" ? v : "—";
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  const CHART_AVAILABLE = typeof Chart !== "undefined";
  if (CHART_AVAILABLE) {

    const cssVarNow = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    Chart.defaults.color = cssVarNow("--chart-text") || "#333333";
    Chart.defaults.borderColor = cssVarNow("--chart-border") || "#c9d3da";
    Chart.defaults.font.family = "Verdana, Arial, Helvetica, sans-serif";
    Chart.defaults.font.size = 11;
  } else {
    console.warn("Chart.js failed to load: charts will be skipped, the rest of the dossier still works.");
  }

  let activeCharts = [];
  function destroyChart(c) {
    if (!c) return;
    const i = activeCharts.indexOf(c);
    if (i >= 0) activeCharts.splice(i, 1);
    try { c.destroy(); } catch (_) {  }
  }
  function destroyCharts() {
    const all = activeCharts;
    activeCharts = [];
    all.forEach((c) => { try { c.destroy(); } catch (_) {  } });
  }

  const PALETTE = ["#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD", "#8C564B",
                    "#E377C2", "#7F7F7F", "#BCBD22", "#17BECF", "#3366CC", "#DC3912",
                    "#9933FF", "#109618", "#0099C6", "#DD4477", "#66AA00", "#B82E2E",
                    "#316395", "#994499"];

  const FREEDOM_POINT_COLORS = ["#2E5C82", "#B8860B", "#B00020"];
  function renderRadar(canvasId, labels, values) {
    if (!CHART_AVAILABLE) return;
    const el = document.getElementById(canvasId);
    if (!el) return;
    const chart = new Chart(el, {
      type: "radar",
      data: { labels, datasets: [{ data: values,
        backgroundColor: "rgba(46,92,130,0.18)",
        borderColor: "#2E5C82", borderWidth: 2,

        pointBackgroundColor: labels.map((_, i) => FREEDOM_POINT_COLORS[i] || "#C9A227"),
        pointBorderColor: "#fff",
        pointRadius: 4, pointHoverRadius: 5 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { r: { min: 0, max: 100, grid: { color: cssVar("--chart-grid") }, angleLines: { color: cssVar("--chart-grid") },
          pointLabels: { font: { size: 10.5 } }, ticks: { display: false } } }
      }
    });
    activeCharts.push(chart);
  }

  function renderDonut(canvasId, labels, values) {
    if (!CHART_AVAILABLE) return;
    const el = document.getElementById(canvasId);
    if (!el || !values.length) return;
    const chart = new Chart(el, {
      type: "doughnut",
      data: { labels, datasets: [{ data: values, backgroundColor: PALETTE, borderColor: cssVar("--chart-slice") || "#F5F7F9", borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `${c.label}: ${enLocale(c.parsed, { maximumFractionDigits: 1 })}%` } }
        }
      }
    });
    activeCharts.push(chart);

    const wrap = el.closest(".chart-box--govt")?.parentElement?.querySelector("[data-f=\"govt-legend\"]");
    if (wrap) {
      wrap.innerHTML = "";
      const total = values.reduce((a, b) => a + b, 0) || 1;
      labels.forEach((label, i) => {
        const item = document.createElement("span");
        item.className = "govt-legend__item";
        const dot = document.createElement("span");
        dot.className = "govt-legend__dot";
        dot.style.background = PALETTE[i % PALETTE.length];
        const txt = document.createElement("span");
        txt.textContent = `${label} ${enLocale((values[i] / total) * 100, { maximumFractionDigits: 1 })}%`;
        item.append(dot, txt);
        wrap.appendChild(item);
      });
    }
  }

  function renderHBar(canvasId, labels, values, suffix) {
    if (!CHART_AVAILABLE) return;
    const el = document.getElementById(canvasId);
    if (!el || !values.length) return;
    const chart = new Chart(el, {
      type: "bar",
      data: { labels, datasets: [{ data: values, backgroundColor: values.map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 2, maxBarThickness: 26 }] },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { color: cssVar("--chart-grid") }, ticks: { callback: (v) => v + (suffix || "") } }, y: { grid: { display: false } } }
      }
    });
    activeCharts.push(chart);
  }

  function parseCensusScales(doc) {
    return Array.from(doc.querySelectorAll("CENSUS SCALE")).map((scale) => ({
      id: Number(scale.getAttribute("id")),
      score: parseFloat(scale.querySelector("SCORE")?.textContent ?? "NaN"),
      prank: parseFloat(scale.querySelector("PRANK")?.textContent ?? "NaN")
    })).filter((s) => !Number.isNaN(s.id));
  }

  const historyCache = new Map();
  function histKey(entityType, entityName, scaleId) {
    return `${entityType}|${String(entityName || "").toLowerCase()}|${scaleId}`;
  }

  async function fetchCensusHistoryBatch(entityType, entityName, scaleIds, urgent) {
    const params = { q: "census", scale: scaleIds.join("+"), mode: "history" };
    if (entityType === "nation") params.nation = entityName;
    else if (entityType === "region") params.region = entityName;
    const doc = await fetchXML(buildUrl(params), urgent);
    const out = new Map();
    doc.querySelectorAll("SCALE").forEach((s) => {
      const id = Number(s.getAttribute("id"));
      const pts = [];
      s.querySelectorAll("POINT").forEach((p) => {
        const ts = Number(p.querySelector("TIMESTAMP")?.textContent);
        const v = Number(p.querySelector("SCORE")?.textContent);
        if (Number.isFinite(ts) && Number.isFinite(v)) pts.push({ t: ts, v });
      });
      pts.sort((a, b) => a.t - b.t);
      out.set(id, pts);
    });
    return out;
  }

  function prefetchCensusHistory(entityType, entityName, scaleIds) {
    const ids = (scaleIds || []).filter((id) => !historyCache.has(histKey(entityType, entityName, id)));
    if (!ids.length) return;
    ids.forEach((id) => historyCache.set(histKey(entityType, entityName, id), "loading"));
    fetchCensusHistoryBatch(entityType, entityName, ids)
      .then((map) => {
        map.forEach((pts, id) => {
          const key = histKey(entityType, entityName, id);
          if (historyCache.get(key) === "loading") historyCache.set(key, pts.length >= 2 ? pts : []);
        });
      })
      .catch(() => {
        ids.forEach((id) => {
          const key = histKey(entityType, entityName, id);
          if (historyCache.get(key) === "loading") historyCache.set(key, []);
        });
      });
  }

  async function fetchCensusHistory(entityType, entityName, scaleId, urgent) {

    const params = { q: "census", scale: String(scaleId), mode: "history" };
    if (entityType === "nation") params.nation = entityName;
    else if (entityType === "region") params.region = entityName;
    const doc = await fetchXML(buildUrl(params), urgent);
    const pts = [];
    doc.querySelectorAll("SCALE > POINT").forEach((p) => {
      const ts = Number(p.querySelector("TIMESTAMP")?.textContent);
      const sc = Number(p.querySelector("SCORE")?.textContent);
      if (Number.isFinite(ts) && Number.isFinite(sc)) pts.push({ t: ts, v: sc });
    });
    pts.sort((a, b) => a.t - b.t);
    return pts;
  }

  function currentEntityName() {
    const el = document.querySelector('.dossier [data-f="name"]');
    return el ? el.textContent.trim() : "";
  }

  function redrawOpenDossier() {
    const root = document.querySelector(".dossier");
    if (root && typeof root.__redraw === "function") root.__redraw();
  }
  window.__redrawOpenDossier = redrawOpenDossier;

  window.__contributeExample = contributeExampleNation;

  function drawHistorySeries(canvas, pts) {
    if (!CHART_AVAILABLE || !canvas) return null;
    const labels = pts.map((p) => new Date(p.t * 1000).toLocaleDateString(undefined, { month: "short", year: "2-digit" }));

    const fmtDate = (t) => new Date(t * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    const chart = new Chart(canvas, {
      type: "line",
      data: { labels, datasets: [{ data: pts.map((p) => p.v),
        borderColor: "#2E5C82", backgroundColor: "rgba(46,92,130,0.12)",
        fill: true, tension: 0.25, pointRadius: 0, pointHoverRadius: 6, pointHoverBackgroundColor: "#2E5C82",
        pointHoverBorderColor: "#fff", pointHoverBorderWidth: 2, borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: "index", intersect: false,
            backgroundColor: "rgba(20,34,48,0.94)", borderColor: "#2E5C82", borderWidth: 1,
            titleColor: "#DCEBF6", bodyColor: "#fff", padding: 8, cornerRadius: 4, displayColors: false,
            callbacks: {
              title: (items) => fmtDate(pts[items[0].dataIndex].t),
              label: (c) => `Score: ${enLocale(c.parsed.y, { maximumFractionDigits: 2 })}`
            }
          }
        },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 9.5 } } },
          y: { grid: { color: cssVar("--chart-grid") }, ticks: { font: { size: 9.5 } } } }
      }
    });
    activeCharts.push(chart);
    return chart;
  }

  const CENSUS_THEMES = [
    { name: "Economy",                color: "#B8860B", ids: [1, 4, 31, 33, 48, 49, 50, 56, 72, 73, 74, 76, 79, 85] },
    { name: "Industry",               color: "#17BECF", ids: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26] },
    { name: "Government & diplomacy", color: "#9467BD", ids: [2, 8, 27, 28, 51, 52, 53, 57, 66, 78, 80] },
    { name: "Health & welfare",       color: "#2CA02C", ids: [5, 29, 39, 44, 60, 61, 75, 81, 88] },
    { name: "Society & culture",      color: "#E377C2", ids: [0, 6, 9, 32, 34, 35, 36, 37, 38, 40, 45, 54, 55, 58, 62, 64, 67, 71, 86, 87, 89] },
    { name: "Environment & nature",   color: "#8C564B", ids: [7, 41, 63] },
    { name: "Safety & security",      color: "#D62728", ids: [30, 42, 43, 46, 47, 59, 77] },
    { name: "Development",            color: "#3366CC", ids: [68, 69, 70] },
    { name: "Population & events",    color: "#7F7F7F", ids: [3, 65, 82, 83, 84] }
  ];

  function renderCensusLadder(ladderEl, sorted, nameOf, mode) {
    if (!ladderEl) return;
    const byId = {};
    sorted.forEach((s) => { byId[s.id] = s; });

    const groups = CENSUS_THEMES.map((t) => ({ theme: t, scales: [] })).filter((g) => g.theme.ids.some((id) => byId[id]));
    groups.forEach((g) => {

      g.scales = g.theme.ids.map((id) => byId[id]).filter(Boolean)
        .sort((a, b) => (a.prank ?? 999) - (b.prank ?? 999));
    });
    ladderEl.innerHTML = "";
    groups.forEach((g) => {
      if (!g.scales.length) return;
      const sec = document.createElement("section");
      sec.className = "census-ladder-group";
      const head = document.createElement("div");
      head.className = "census-ladder-group__head";
      head.innerHTML = `<span class="census-ladder-group__dot" style="background:${g.theme.color}"></span><span class="census-ladder-group__name">${g.theme.name}</span><span class="census-ladder-group__count">${g.scales.length}</span>`;
      sec.appendChild(head);

      g.scales.forEach((s) => {

        const hasPrank = Number.isFinite(s.prank);
        const pct = hasPrank ? Math.max(0, Math.min(100, 100 - s.prank)) : 0;

        const item = document.createElement("div");
        item.className = "census-ladder-item";
        const row = document.createElement("button");
        row.type = "button";
        row.className = "census-ladder-row";
        row.dataset.scaleId = String(s.id);
        row.setAttribute("aria-expanded", "false");
        const label = document.createElement("span");
        label.className = "census-ladder-row__name";
        label.textContent = nameOf(s);
        label.title = nameOf(s);
        if (!censusNameCache.has(s.id)) resolveCensusName(s.id).then((nm) => { label.textContent = nm; label.title = nm; });
        const track = document.createElement("span");
        track.className = "census-ladder-row__track";
        const fill = document.createElement("span");
        fill.className = "census-ladder-row__fill";
        fill.style.width = pct + "%";
        fill.style.background = g.theme.color;
        track.appendChild(fill);
        const val = document.createElement("span");
        val.className = "census-ladder-row__val";
        val.textContent = hasPrank
          ? `Top ${enLocale(s.prank)}%`
          : (Number.isFinite(s.score) ? `Avg ${fmtWorldAvg(s.score)}` : "—");
        const chevron = document.createElement("span");
        chevron.className = "census-ladder-row__chevron";
        chevron.textContent = "▾";
        if (hasPrank) row.append(label, track, val, chevron);
        else { row.classList.add("is-avg"); row.append(label, val, chevron); }

        const body = document.createElement("div");
        body.className = "census-ladder-body";
        body.hidden = true;
        const chartBox = document.createElement("div");
        chartBox.className = "census-ladder-body__chart";
        const canvas = document.createElement("canvas");
        chartBox.appendChild(canvas);
        const note = document.createElement("span");
        note.className = "census-ladder-body__note";
        body.appendChild(chartBox);
        body.appendChild(note);

        const entityName = currentEntityName();
        const scaleId = String(s.id);
        const hkey = histKey(mode, entityName, scaleId);
        let openChart = null;
        row.addEventListener("click", () => {
          const open = body.hidden;
          if (open) {

            prefetchCensusHistory(mode, entityName, [s.id]);
            body.hidden = false;
            row.setAttribute("aria-expanded", "true");
            row.classList.add("is-open");
            note.textContent = "Loading trend…";
            const cached = historyCache.get(hkey);
            if (Array.isArray(cached)) {
              if (cached.length >= 2) { openChart = drawHistorySeries(canvas, cached); note.textContent = ""; }
              else { note.textContent = "No trend data available."; }
            } else if (cached === "loading") {

              const check = setInterval(() => {
                if (body.hidden || openChart) { clearInterval(check); return; }
                const c2 = historyCache.get(hkey);
                if (Array.isArray(c2)) {
                  clearInterval(check);
                  if (c2.length >= 2) { openChart = drawHistorySeries(canvas, c2); note.textContent = ""; }
                  else { note.textContent = "No trend data available."; }
                }
              }, 400);
              setTimeout(() => clearInterval(check), 20000);
            } else {

              fetchCensusHistory(mode, entityName, s.id, true).then((pts) => {
                historyCache.set(hkey, pts);
                if (!body.hidden && !openChart && pts.length >= 2) { openChart = drawHistorySeries(canvas, pts); note.textContent = ""; }
                else if (!body.hidden && pts.length < 2) { note.textContent = "No trend data available."; }
              }).catch(() => { if (!body.hidden) note.textContent = "Could not load trend data."; });
            }
          } else {
            if (openChart) { destroyChart(openChart); openChart = null; }
            body.hidden = true;
            row.setAttribute("aria-expanded", "false");
            row.classList.remove("is-open");
          }
        });
        item.append(row, body);
        sec.appendChild(item);
      });
      ladderEl.appendChild(sec);
    });
  }
  function renderCensusExplorer(root, scales, mode) {
    const section = root.querySelector('[data-f="census-section"]');
    if (!section || !scales.length) return;
    const ladderEl = section.querySelector('[data-f="census-ladder"]');

    const sorted = [...scales].sort((a, b) => (a.prank ?? 999) - (b.prank ?? 999));
    function nameOf(s) { return censusNameCache.get(s.id) || `World Census Scale #${s.id}`; }

    renderCensusLadder(ladderEl, sorted, nameOf, mode);

    prefetchCensusHistory(mode, currentEntityName(), [0, 1, 2, 3, 27, 29, 72, 75]);
  }

  function undecided(v) {
    if (!v) return "";
    const t = String(v).trim();
    if (/^(leader|capital( city)?|a major religion|no religion|new leader|new city|new order)$/i.test(t)) return "";
    return t;
  }

  async function renderNation(name, seq) {
    const doc = await fetchNation(name);
    if (seq !== openSeq) return;
    const tpl = document.getElementById("tpl-nation").content.cloneNode(true);
    const root = tpl.querySelector(".dossier");

    fillImg(root, "flag", text(doc, "FLAG"));

    const unstatus = text(doc, "UNSTATUS");
    const isMember = unstatus && !/non/i.test(unstatus);
    const badge = root.querySelector('[data-f="wa-badge"]');
    badge.textContent = unstatus || "Unknown";
    badge.classList.toggle("is-online", isMember);
    badge.classList.toggle("is-offline", !isMember && !!unstatus);

    fill(root, "category", text(doc, "CATEGORY"));
    fill(root, "dbid", text(doc, "DBID"));
    fill(root, "name", text(doc, "NAME"));
    fill(root, "fullname", text(doc, "FULLNAME"));
    fill(root, "motto", text(doc, "MOTTO"), "");

    fill(root, "region", text(doc, "REGION"));
    fill(root, "founded", foundedLabel(text(doc, "FOUNDED")));
    fill(root, "lastactivity", text(doc, "LASTACTIVITY"));
    fill(root, "firstlogin", fmtDate(text(doc, "FIRSTLOGIN")));
    fill(root, "lastlogin", fmtDate(text(doc, "LASTLOGIN")));
    const pop = text(doc, "POPULATION");
    fill(root, "population", pop ? `${enLocale(pop)} million` : "");
    fill(root, "capital", undecided(text(doc, "CAPITAL")));
    fill(root, "leader", undecided(text(doc, "LEADER")));
    fill(root, "religion", undecided(text(doc, "RELIGION")));
    fill(root, "animal", text(doc, "ANIMAL"));
    fill(root, "currency", text(doc, "CURRENCY"));
    fill(root, "demonym", text(doc, "DEMONYM"));
    fill(root, "majorindustry", text(doc, "MAJORINDUSTRY"));
    fill(root, "govtpriority", text(doc, "GOVTPRIORITY"));
    const tax = text(doc, "TAX");
    fill(root, "tax", tax ? `${enLocale(tax)}%` : "");
    const gdp = text(doc, "GDP");
    fill(root, "gdp", gdp ? `$${enLocale(gdp)}` : "");
    const income = text(doc, "INCOME");
    fill(root, "income", income ? `$${enLocale(income)}` : "");

    const publicsector = text(doc, "PUBLICSECTOR");
    fill(root, "publicsector", publicsector ? `${enLocale(publicsector)}%` : "");
    const poorest = text(doc, "POOREST"), richest = text(doc, "RICHEST");
    if (poorest || richest) fill(root, "poverty", `$${enLocale(poorest)} / $${enLocale(richest)}`);
    fill(root, "crime", text(doc, "CRIME"));

    const lawList = root.querySelector('[data-f="legislation"]');
    const laws = Array.from(doc.querySelectorAll("LEGISLATION LAW")).map((l) => l.textContent.trim()).filter(Boolean);
    if (lawList) {
      if (laws.length) {
        laws.slice(0, 8).forEach((law) => {
          const li = document.createElement("li");
          li.className = "quirk-list__item";
          li.textContent = law;
          lawList.appendChild(li);
        });
        if (laws.length > 8) {
          const more = document.createElement("li");
          more.className = "quirk-list__more muted";
          more.textContent = `… and ${laws.length - 8} more`;
          lawList.appendChild(more);
        }
      } else {
        const li = document.createElement("li");
        li.className = "muted";
        li.textContent = "No society headlines on record.";
        lawList.appendChild(li);
      }
    }

    const notableWrap = root.querySelector('[data-f="notables"]');
    const notables = Array.from(doc.querySelectorAll("NOTABLES NOTABLE")).map((n) => n.textContent.trim()).filter(Boolean);
    if (notables.length) notables.forEach((n) => notableWrap.appendChild(makeChip(n)));
    else { notableWrap.innerHTML = '<span class="chip">No notable traits</span>'; }

    fill(root, "side-population", pop ? `${enLocale(pop)}m` : "—");
    fill(root, "side-region", text(doc, "REGION"));
    fill(root, "side-founded", foundedLabel(text(doc, "FOUNDED")));

    let extra = text(doc, "GOVTDESC");
    const notable = text(doc, "NOTABLE");
    const sensibilities = text(doc, "SENSIBILITIES");
    if (notable) extra += (extra ? "\n\n" : "") + `Notable for: ${notable}.`;
    if (sensibilities) extra += (extra ? "\n\n" : "") + `National character: ${sensibilities}.`;
    fill(root, "govtdesc", extra, "");

    const scales = parseCensusScales(doc);
    const byId = Object.fromEntries(scales.map((s) => [s.id, s]));
    const civilScore = byId[0]?.score ?? 0, econScore = byId[1]?.score ?? 0, polScore = byId[2]?.score ?? 0;
    const civilTxt = text(doc, "CIVILRIGHTS"), econTxt = text(doc, "ECONOMY"), polTxt = text(doc, "POLITICALFREEDOM");
    fill(root, "fr-civil", [civilTxt, Number.isFinite(civilScore) ? civilScore.toFixed(1) : null].filter(Boolean).join(" · "));
    fill(root, "fr-econ", [econTxt, Number.isFinite(econScore) ? econScore.toFixed(1) : null].filter(Boolean).join(" · "));
    fill(root, "fr-pol", [polTxt, Number.isFinite(polScore) ? polScore.toFixed(1) : null].filter(Boolean).join(" · "));

    const endoRaw = text(doc, "ENDORSEMENTS");
    const endoCount = endoRaw ? endoRaw.split(",").filter(Boolean).length : 0;
    fill(root, "wa-status", unstatus || "Unknown");
    fill(root, "endo-count", enLocale(endoCount));
    const influenceNum = text(doc, "INFLUENCENUM");
    fill(root, "influence", text(doc, "INFLUENCE") + (influenceNum ? ` (${influenceNum})` : ""));

    const policyEls = Array.from(doc.querySelectorAll("POLICIES POLICY"));
    const policyWrap = root.querySelector('[data-f="policies-list"]');
    if (policyWrap) {
      policyWrap.innerHTML = "";
      if (policyEls.length) {
        policyEls.forEach((p) => {
          const label = p.querySelector("NAME")?.textContent?.trim() || p.querySelector("CAT")?.textContent?.trim();
          if (label) policyWrap.appendChild(makeChip(label, p.querySelector("DESC")?.textContent?.trim() || ""));
        });
      } else {
        policyWrap.innerHTML = '<span class="muted">No policies on record.</span>';
      }
    }

    const govtEl = doc.querySelector("GOVT");
    const govtScores = govtEl ? Array.from(govtEl.children).map((c) => ({ label: humanizeTag(c.tagName), value: parseFloat(c.textContent) })).filter((s) => s.value > 0) : [];

    const sectorsEl = doc.querySelector("SECTORS");
    const sectorScores = sectorsEl ? Array.from(sectorsEl.children).map((c) => ({ label: humanizeTag(c.tagName), value: parseFloat(c.textContent) })).filter((s) => Number.isFinite(s.value)) : [];

    const deathEls = Array.from(doc.querySelectorAll("DEATHS CAUSE"));
    const deathScores = deathEls.map((c) => ({ label: c.getAttribute("type") || "Unknown", value: parseFloat(c.textContent) }))
      .filter((s) => Number.isFinite(s.value)).sort((a, b) => b.value - a.value).slice(0, 8);

    const happeningsList = root.querySelector('[data-f="happenings"]');
    const events = Array.from(doc.querySelectorAll("HAPPENINGS EVENT"));
    if (events.length) {
      events.slice(0, 12).forEach((ev) => happeningsList.appendChild(makeLogItem(fmtDate(ev.querySelector("TIMESTAMP")?.textContent), stripBBCode(ev.querySelector("TEXT")?.textContent || ""))));
    } else {
      happeningsList.innerHTML = '<li class="muted">No recent public activity recorded.</li>';
    }

    const dispatches = Array.from(doc.querySelectorAll("DISPATCHLIST DISPATCH"));
    if (dispatches.length) {
      root.querySelector('[data-f="dispatch-section"]').hidden = false;
      const list = root.querySelector('[data-f="dispatches"]');

      const ts = (d) => Number(d.querySelector("EDITED")?.textContent || d.querySelector("CREATED")?.textContent || 0);
      [...dispatches].sort((a, b) => ts(b) - ts(a)).slice(0, 10).forEach((d) => {
        const id = d.getAttribute("id");
        const title = d.querySelector("TITLE")?.textContent?.trim() || "Untitled";
        const cat = d.querySelector("CATEGORY")?.textContent?.trim() || "";
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = `https://www.nationstates.net/page=dispatch/id=${encodeURIComponent(id || "")}`;
        a.target = "_blank"; a.rel = "noopener"; a.textContent = title;
        const span = document.createElement("span"); span.className = "log-text";
        span.append(a, document.createTextNode(cat ? ` — ${cat}` : ""));
        li.appendChild(span);
        list.appendChild(li);
      });
    }

    $root.innerHTML = ""; $root.appendChild(tpl); destroyCharts();
    renderRadar("chart-freedom", ["Civil Rights", "Economy", "Political Freedom"], [civilScore || 0, econScore || 0, polScore || 0]);
    renderDonut("chart-govt", govtScores.map((s) => s.label), govtScores.map((s) => s.value));
    renderHBar("chart-sectors", sectorScores.map((s) => s.label), sectorScores.map((s) => s.value), "%");
    if (deathScores.length) {
      const deathSection = $root.querySelector('[data-f="death-section"]');
      if (deathSection) deathSection.hidden = false;
      renderHBar("chart-deaths", deathScores.map((s) => s.label), deathScores.map((s) => s.value), "%");
    }
    renderCensusExplorer($root, scales, "nation");
    enhanceNation($root, doc, scales, name);
    wireLinks($root);
    initIdeoHistory($root);

    $root.firstElementChild.__redraw = () => { try { renderNation(name, seq); } catch (_) {} };
  }

  async function renderRegion(name, seq) {
    const doc = await fetchRegionMain(name);
    if (seq !== openSeq) return;
    const tpl = document.getElementById("tpl-region").content.cloneNode(true);
    const root = tpl.querySelector(".dossier");

    fillImg(root, "flag", text(doc, "FLAG") || text(doc, "BANNERURL"));

    const founder = text(doc, "FOUNDER");
    const badge = root.querySelector('[data-f="founder-badge"]');
    if (!founder || founder === "0") { badge.textContent = "Founderless"; badge.classList.add("is-offline"); }
    else { badge.textContent = "Founded region"; badge.classList.add("is-online"); }

    const tags = Array.from(doc.querySelectorAll("TAGS TAG")).map((t) => t.textContent.trim()).filter(Boolean);
    fill(root, "tags", tags.slice(0, 4).join(" · ") || "Region");
    fill(root, "name", text(doc, "NAME"));
    fill(root, "power", text(doc, "POWER"));

    fill(root, "founded", foundedLabel(text(doc, "FOUNDED")));
    fill(root, "founder", founder && founder !== "0" ? founder.replace(/_/g, " ") : "None");
    const governorName = text(doc, "GOVERNOR");
    const governorTitle = text(doc, "GOVERNORTITLE");
    fill(root, "governor", governorName && governorName !== "0" ? governorName.replace(/_/g, " ") + (governorTitle ? ` (${governorTitle})` : "") : "None");
    const delegate = text(doc, "DELEGATE");
    fill(root, "delegate", delegate && delegate !== "0" ? delegate.replace(/_/g, " ") : "None");
    fill(root, "delegatevotes", text(doc, "DELEGATEVOTES"));
    fill(root, "numnations", enLocale(text(doc, "NUMNATIONS") || 0));
    const waList = (text(doc, "UNNATIONS") || "").split(",").map((s) => s.trim()).filter(Boolean);
    fill(root, "numwanations", enLocale(waList.length || 0));
    const lastupdate = Number(text(doc, "LASTUPDATE"));
    fill(root, "lastupdate", lastupdate ? fmtDate(lastupdate) : "");

    const frontier = text(doc, "FRONTIER");
    fill(root, "frontier", frontier === "1" ? "Open" : frontier === "0" ? "Closed" : "");
    fill(root, "magnetism", text(doc, "MAGNETISM"));

    const banlist = Array.from(doc.querySelectorAll("BANLIST NATION")).map((n) => n.textContent.trim()).filter(Boolean);
    if (banlist.length) {
      root.querySelector('[data-f="banlist-wrap"]').hidden = false;
      fill(root, "ban-count", enLocale(banlist.length));
      const wrap = root.querySelector('[data-f="banlist"]');
      banlist.forEach((n) => wrap.appendChild(makeChip(n.replace(/_/g, " "))));
    }
    const recruiters = (text(doc, "RECRUITERS") || "").split(",").map((s) => s.trim().replace(/_/g, " ")).filter(Boolean);
    if (recruiters.length) {
      root.querySelector('[data-f="recruiters-wrap"]').hidden = false;
      const wrap = root.querySelector('[data-f="recruiters"]');
      recruiters.forEach((n) => wrap.appendChild(makeChip(n)));
    }

    const factbookRaw = stripBBCode(text(doc, "FACTBOOK"))
      .replace(/&nbsp;|\u00A0/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    fill(root, "factbook", factbookRaw ? factbookRaw.slice(0, 420) + (factbookRaw.length > 420 ? "…" : "") : "", "");

    fill(root, "side-population", enLocale(text(doc, "NUMNATIONS") || 0));
    fill(root, "side-founded", foundedLabel(text(doc, "FOUNDED")));
    fill(root, "side-delegate", delegate && delegate !== "0" ? delegate.replace(/_/g, " ") : "None");

    const authLetters = (text(doc, "DELEGATEAUTH") || "").split("");
    if (authLetters.length) {
      root.querySelector('[data-f="delegateauth-wrap"]').hidden = false;
      const wrap = root.querySelector('[data-f="delegateauth-list"]');
      authLetters.forEach((l) => { if (AUTHORITY_MAP[l]) wrap.appendChild(makeChip(AUTHORITY_MAP[l])); });
    }

    const officerEls = Array.from(doc.querySelectorAll("OFFICERS OFFICER"));
    if (officerEls.length) {
      root.querySelector('[data-f="officers-section"]').hidden = false;
      const list = root.querySelector('[data-f="officers-list"]');
      officerEls.forEach((o) => {
        const nm = (o.querySelector("NATION")?.textContent || "").replace(/_/g, " ");
        const office = o.querySelector("OFFICE")?.textContent?.trim() || "Officer";
        const authLetters2 = (o.querySelector("AUTHORITY")?.textContent || "").split("").map((l) => AUTHORITY_MAP[l]).filter(Boolean).join(", ");
        const li = document.createElement("li");
        const span = document.createElement("span"); span.className = "log-text";
        const strong = document.createElement("b"); strong.textContent = nm || "Unknown";
        span.append(strong, document.createTextNode(` — ${office}` + (authLetters2 ? ` (${authLetters2})` : "")));
        li.appendChild(span);
        list.appendChild(li);
      });
    }

    const scales = parseCensusScales(doc);
    const byId = Object.fromEntries(scales.map((s) => [s.id, s]));
    const civilScore = byId[0]?.score ?? 0, econScore = byId[1]?.score ?? 0, polScore = byId[2]?.score ?? 0;
    fill(root, "fr-civil", Number.isFinite(civilScore) ? civilScore.toFixed(1) : "—");
    fill(root, "fr-econ", Number.isFinite(econScore) ? econScore.toFixed(1) : "—");
    fill(root, "fr-pol", Number.isFinite(polScore) ? polScore.toFixed(1) : "—");

    const embassyEls = Array.from(doc.querySelectorAll("EMBASSIES EMBASSY"));
    fill(root, "embassy-count", enLocale(embassyEls.length));
    const embWrap = root.querySelector('[data-f="embassies"]');
    const typeLabel = { pending: "pending", invited: "invited", rejected: "rejected", closing: "closing" };
    if (embassyEls.length) {
      embassyEls.forEach((e) => {
        const type = e.getAttribute("type");
        const suffix = type && typeLabel[type] ? ` (${typeLabel[type]})` : "";
        embWrap.appendChild(makeChip(e.textContent.trim().replace(/_/g, " ") + suffix));
      });
    } else { embWrap.appendChild(makeChip("No embassies")); }

    const happeningsList = root.querySelector('[data-f="happenings"]');
    const events = Array.from(doc.querySelectorAll("HAPPENINGS EVENT"));
    if (events.length) {
      events.slice(0, 12).forEach((ev) => happeningsList.appendChild(makeLogItem(fmtDate(ev.querySelector("TIMESTAMP")?.textContent), stripBBCode(ev.querySelector("TEXT")?.textContent || ""))));
    } else { happeningsList.innerHTML = '<li class="muted">No recent public activity recorded.</li>'; }

    const histList = root.querySelector('[data-f="history"]');
    const histEvents = Array.from(doc.querySelectorAll("HISTORY EVENT"));
    if (histEvents.length && histList) {
      root.querySelector('[data-f="history-section"]').hidden = false;
      histEvents.slice(0, 12).forEach((ev) => histList.appendChild(makeLogItem(fmtDate(ev.querySelector("TIMESTAMP")?.textContent), stripBBCode(ev.querySelector("TEXT")?.textContent || ""))));
    }

    const posts = Array.from(doc.querySelectorAll("MESSAGES POST")).filter((p) => (p.querySelector("STATUS")?.textContent || "0") === "0");
    if (posts.length) {
      root.querySelector('[data-f="rmb-section"]').hidden = false;
      const feed = root.querySelector('[data-f="messages"]');
      posts.slice(-10).reverse().forEach((p) => {
        const nation = (p.querySelector("NATION")?.textContent || "").replace(/_/g, " ");
        const msg = stripBBCode(p.querySelector("MESSAGE")?.textContent || "").slice(0, 220);
        feed.appendChild(makeLogItem(fmtDate(p.querySelector("TIMESTAMP")?.textContent), `${nation}: ${msg}`));
      });
    }

    const nationsRaw = text(doc, "NATIONS");
    const nationNames = nationsRaw ? nationsRaw.split(":").filter(Boolean) : [];
    fill(root, "roster-count", enLocale(nationNames.length));
    const rosterWrap = root.querySelector('[data-f="roster"]');
    const rosterBtn = root.querySelector('[data-action="toggle-roster"]');
    const ROSTER_CAP = 300;
    let rosterBuilt = false;
    rosterBtn.addEventListener("click", () => {
      if (!rosterBuilt) {
        rosterBuilt = true;
        nationNames.slice(0, ROSTER_CAP).forEach((n) => rosterWrap.appendChild(makeChip(n.replace(/_/g, " "))));
        if (nationNames.length > ROSTER_CAP) rosterWrap.appendChild(makeChip(`+ ${enLocale(nationNames.length - ROSTER_CAP)} more not shown`));
      }
      rosterWrap.hidden = !rosterWrap.hidden;
      rosterBtn.textContent = rosterWrap.hidden ? "Show full roster" : "Hide roster";
    });

    $root.innerHTML = ""; $root.appendChild(tpl); destroyCharts();
    renderRadar("chart-freedom-region", ["Civil Rights", "Economy", "Political Freedom"], [civilScore || 0, econScore || 0, polScore || 0]);
    renderCensusExplorer($root, scales, "region");
    enhanceRegion($root, doc, scales);
    wireLinks($root);
    initIdeoHistory($root);
    $root.firstElementChild.__redraw = () => { try { renderRegion(name, seq); } catch (_) {} };

  }

  async function loadWorldTicker() {
    try {
      const doc = await fetchXML(buildUrl({ q: "numnations+numregions" }));
      const nations = enLocale(text(doc, "NUMNATIONS") || 0);
      const regions = enLocale(text(doc, "NUMREGIONS") || 0);
      document.getElementById("world-ticker").textContent = `${nations} active nations · ${regions} regions`;
    } catch (_) { document.getElementById("world-ticker").textContent = "World archive unreachable"; }
  }

  function tickClock() {
    const el = document.getElementById("live-clock");
    const now = new Date();
    el.textContent = now.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" }) + " · " + now.toLocaleTimeString("en-US");
  }

  function fmtWorldAvg(v) {
    if (!Number.isFinite(v)) return "—";
    const sign = v < 0 ? "−" : "";
    const a = Math.abs(v);
    const trim = (s) => s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    if (a >= 1e12) return sign + trim((v / 1e12).toFixed(2)) + "T";
    if (a >= 1e9) return sign + trim((v / 1e9).toFixed(2)) + "B";
    if (a >= 1e6) return sign + trim((v / 1e6).toFixed(2)) + "M";
    if (a >= 1e3) return sign + trim((v / 1e3).toFixed(1)) + "K";
    return sign + trim(v.toFixed(1));
  }

  async function renderWorld(seq) {

    const [doc, waDoc] = await Promise.all([
      fetchXML(buildUrl({ q: "numnations+numregions+census", scale: "all", mode: "score" }), true),
      fetchXML(buildUrl({ wa: "3", q: "numnations+numdelegates" }), true)
    ]);
    if (seq !== openSeq) return;
    const tpl = document.getElementById("tpl-world").content.cloneNode(true);
    const root = tpl.querySelector(".dossier");

    const scales = parseCensusScales(doc);
    const byId = Object.fromEntries(scales.map((s) => [s.id, s]));
    const civilScore = byId[0]?.score, econScore = byId[1]?.score, polScore = byId[2]?.score;

    const numnations = Number(text(doc, "NUMNATIONS")) || 0;
    const numregions = Number(text(doc, "NUMREGIONS")) || 0;
    const waNations = Number(text(waDoc, "NUMNATIONS")) || 0;
    const waDelegates = Number(text(waDoc, "NUMDELEGATES")) || 0;

    fill(root, "category", "Global Average");
    fill(root, "name", "The World");
    fill(root, "side-population", fmtWorldAvg(byId[3]?.score));
    fill(root, "side-regions", enLocale(numregions));
    fill(root, "side-founded", "2002");
    fill(root, "w-snapshot", `${enLocale(numnations)} nations · ${enLocale(numregions)} regions · ${enLocale(waNations)} in the World Assembly`);
    fill(root, "w-nations", enLocale(numnations));
    fill(root, "w-regions", enLocale(numregions));
    fill(root, "w-wa-nations", enLocale(waNations));
    fill(root, "w-wa-delegates", enLocale(waDelegates));
    fill(root, "w-wa-share", numnations ? (100 * waNations / numnations).toFixed(2) + "%" : "—");
    fill(root, "w-founded", "2002 — Founders' Day");
    fill(root, "w-archive-since", "Feb 2016 — daily archive");
    const num = (v) => Number.isFinite(v) ? v.toFixed(2) : "—";
    fill(root, "w-freedoms", `${num(civilScore)} · ${num(econScore)} · ${num(polScore)}`);
    fill(root, "fr-civil", num(civilScore));
    fill(root, "fr-econ", num(econScore));
    fill(root, "fr-pol", num(polScore));

    $root.innerHTML = ""; $root.appendChild(tpl); destroyCharts();
    renderRadar("chart-freedom-world", ["Civil Rights", "Economy", "Political Freedom"], [civilScore || 0, econScore || 0, polScore || 0]);
    renderCensusExplorer($root, scales, "world");

    enhanceWorld($root, scales);
    wireLinks($root);
    $root.firstElementChild.__redraw = () => { try { renderWorld(seq); } catch (_) {} };
    initIdeoHistory($root);
  }

  function enhanceWorld(root, scales) {
    const p = compassPoint(scales, { entityType: "world" });
    const ideo = ideologyFor(p);
    root.__compassLive = { p, ideo, canvasId: "chart-polcompass-world", extras: { entityType: "world" } };
    drawCompass("chart-polcompass-world", p);
    drawCompassMini(document.getElementById("chart-polcompass-world-mini"), p);
    fill(root, "ideology", ideo.name || ideo.quadrant);
    fill(root, "ideology-mini", ideo.name || ideo.quadrant);
    fill(root, "ideology-desc", ideo.desc);
    fillProgressive(root, p);
    renderCompassLegend(root);
  }

  let mode = "nation";
  let spotNation = null;
  let spotRegion = null;
  const form = document.getElementById("lookup-form");
  const input = document.getElementById("query-input");
  const prefix = document.getElementById("lookup-prefix");

  function setPlaceholder() {
    const example = mode === "world"
      ? "No name needed — open the world dossier"
      : mode === "nation"
        ? (spotNation ? "e.g. " + spotNation : "e.g. testlandia")
        : (spotRegion ? "e.g. " + spotRegion : "e.g. the_rejected_realms");
    input.placeholder = example;
  }

  function setMode(nextMode) {
    mode = nextMode;
    document.querySelectorAll(".tab[data-mode]").forEach((b) => {
      const active = b.dataset.mode === mode;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", String(active));
    });
    prefix.textContent = mode === "world" ? "world:" : mode + ":";

    if (mode === "world") { input.value = ""; input.disabled = true; }
    else input.disabled = false;
    setPlaceholder();
  }

  document.querySelectorAll(".tab[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setMode(btn.dataset.mode);

      if (btn.dataset.mode === "world") openDossier(null, "__world__");
    });
  });

  let openSeq = 0;
  async function openDossier(nextMode, name) {
    if (!name) return;
    if (nextMode) setMode(nextMode);
    const seq = ++openSeq;
    bumpTradeGroup();
    hideBanner();
    $root.innerHTML = "";
    const isWorld = name === "__world__";
    showBanner(isWorld ? "Loading the world dossier…" : `Opening dossier for "${name}"…`);
    try {
      if (isWorld) await renderWorld(seq);
      else if (mode === "nation") await renderNation(name, seq); else await renderRegion(name, seq);
      if (seq !== openSeq) return;
      hideBanner();
      if (typeof location.hash === "string") { try { history.replaceState(null, "", " "); } catch (_) {} }
      document.getElementById("dossier-root").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      showBanner(err instanceof NSApiError ? err.message : (err.message || "Unexpected error while fetching data."), "error");
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (mode === "world") { openDossier(null, "__world__"); return; }
    const value = input.value.trim();
    if (!value) return;
    openDossier(null, value);
  });

  const NS_NATION = (n) => `https://www.nationstates.net/nation=${n}`;
  const NS_REGION = (r) => `https://www.nationstates.net/region=${r}`;
  const NS_FACTBOOK = (n) => `https://www.nationstates.net/nation=${n}/detail`;
  const nsName = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, "_");

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeUrl(url) {
    if (!url) return "";
    return /^https?:\/\//i.test(url) ? url : "";
  }

  function linkField(root, field, href, keepText) {
    const el = root.querySelector(`[data-f="${field}"]`);
    if (!el) return;
    const label = keepText || el.textContent;
    if (!label || label === "—") return;
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = label;
    el.textContent = "";
    el.appendChild(a);
  }

  function clampCompass(v) { return Math.max(-100, Math.min(100, v)); }

  function clampCensus(v, fb = null) {
    return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : fb;
  }

  function compassPoint(scales, extras) {
    const byId = Object.fromEntries(scales.map((s) => [s.id, s]));
    const civil = clampCensus(byId[0]?.score, 50);
    const econ = clampCensus(byId[1]?.score, 50);
    const pol = clampCensus(byId[2]?.score, 50);
    const govtSize = byId[27] ? clampCensus(byId[27].score) : null;

    const efRaw = byId[48] && Number.isFinite(byId[48].score) ? Math.max(-100, Math.min(100, byId[48].score)) : null;
    const econFree = efRaw != null ? (efRaw + 100) / 2 : null;

    const entityType = (extras && extras.entityType) || "nation";

    const rank = {};
    const scores = {};
    scales.forEach((s) => {
      if (Number.isFinite(s.score)) scores[s.id] = s.score;
      if (Number.isFinite(s.prank)) rank[s.id] = Math.max(0, Math.min(100, 100 - s.prank));
    });

    let x = (econ - 50) * 2;
    let y = ((civil + pol) / 2 - 50) * 2;

    let lean = null;
    if (extras && extras.sectors) {
      const s = extras.sectors;
      const marketShare = (s.private || 0) + (s.black || 0);
      const stateShare = (s.state || 0);
      const total = marketShare + stateShare;
      if (total > 0) lean = (marketShare - stateShare) / total;
    } else if (Number.isFinite(econFree)) {
      lean = Math.max(-1, Math.min(1, (econFree - 50) / 50));
    }
    if (lean !== null) {

      const idx = Number.isFinite(econFree) ? (econFree + econ) / 2 : econ;

      const blend = Math.abs(lean) > 0.25 ? 0.9 : 0.45;
      x = lean * 92 * blend + (idx - 50) * (1 - blend);
    }

    const welfareRank = Number.isFinite(rank[28]) ? rank[28] : null;
    const taxIn = Number.isFinite(extras && extras.tax) ? Math.max(0, Math.min(100, extras.tax)) : null;
    const redistParts = [];
    if (welfareRank != null) redistParts.push((50 - welfareRank) * 0.2);
    if (taxIn != null) redistParts.push((50 - taxIn) * 0.3);
    if (redistParts.length) {
      const redist = redistParts.reduce((a, b) => a + b, 0) / redistParts.length;
      x += Math.max(-15, Math.min(15, redist));
    }

    if (Number.isFinite(govtSize)) y -= (govtSize - 50) * 0.6;

    const sec = (id) => { const s = byId[id]; return Number.isFinite(s?.score) ? clampCensus(s.score) : null; };

    let govt = null;
    if (extras && extras.govt && typeof extras.govt === "object") {
      govt = {};
      for (const k of Object.keys(extras.govt)) {
        const v = Number(extras.govt[k]);
        if (Number.isFinite(v)) govt[k] = Math.max(0, Math.min(100, v));
      }
    }
    const category = extras && typeof extras.category === "string" ? extras.category.trim() : null;

    return {
      x: clampCompass(x),
      y: clampCompass(y),
      civil, econ, pol, govtSize, entityType,
      rank, scores, govt, category, tax: taxIn, welfareRank,

      progressive: (civil + pol) / 2,

      socCons: sec(8),
      relig: entityType === "nation" ? (rank[32] != null ? rank[32] : sec(32)) : null,
      radical: sec(45),
      secular: sec(62),
      econFree,
      econFreeRaw: efRaw
    };
  }

  function sectorSplit(doc) {
    const el = doc.querySelector("SECTORS");
    if (!el) return null;
    const raw = {};
    Array.from(el.children).forEach((c) => {
      if (c.tagName === "BLACKMARKET") raw.black = parseFloat(c.textContent) || 0;
      else if (c.tagName === "GOVERNMENT") raw.state = parseFloat(c.textContent) || 0;
      else if (c.tagName === "INDUSTRY") raw.private = parseFloat(c.textContent) || 0;
      else if (c.tagName === "PUBLIC") raw.state = (raw.state || 0) + (parseFloat(c.textContent) || 0);
    });
    return (raw.state !== undefined || raw.private !== undefined) ? raw : null;
  }

  const GOVT_KEYS = { ADMINISTRATION: "administration", DEFENCE: "defence", EDUCATION: "education",
    ENVIRONMENT: "environment", HEALTHCARE: "healthcare", COMMERCE: "commerce", INTERNATIONALAID: "aid",
    LAWANDORDER: "lawandorder", PUBLICTRANSPORT: "transport", SOCIALEQUALITY: "social", SPIRITUALITY: "spirituality", WELFARE: "welfare" };
  function parseGovtShares(doc) {
    const el = doc.querySelector("GOVT");
    if (!el) return null;
    const out = {};
    Array.from(el.children).forEach((c) => {
      const key = GOVT_KEYS[c.tagName];
      const v = parseFloat(c.textContent);
      if (key && Number.isFinite(v)) out[key] = v;
    });
    return Object.keys(out).length ? out : null;
  }

  function compassTerritory(p) {
    const xz = p.x < -33 ? "left" : p.x > 33 ? "right" : "center";
    const yz = p.y < -33 ? "authoritarian" : p.y > 33 ? "libertarian" : "centrist";
    const names = {
      "authoritarian,left": "Authoritarian Left", "authoritarian,center": "Authoritarian", "authoritarian,right": "Authoritarian Right",
      "centrist,left": "Centre-Left", "centrist,center": "Centrist", "centrist,right": "Centre-Right",
      "libertarian,left": "Libertarian Left", "libertarian,center": "Libertarian", "libertarian,right": "Libertarian Right"
    };
    return { key: `${yz},${xz}`, name: names[`${yz},${xz}`] };
  }
  function quadrantOf(p) { return compassTerritory(p).name; }

  const IDEOLOGIES = [

    ["Anarcho-Capitalism", "Libertarian Right", 88, 74, 46, 55, "Stateless capitalism: every service privately provided, purely voluntary association."],
    ["Libertarianism", "Libertarian Right", 56, 62, 32, 38, "Free markets and strong individual rights under a minimal state."],
    ["Minarchism", "Libertarian Right", 76, 44, 48, 44, "Night-watchman state limited to courts, police and defence."],
    ["Paleolibertarianism", "Libertarian Right", 70, 0, 84, 60, "Radical free markets wedded to traditionalist social values."],
    ["Classical Liberalism", "Libertarian Right", 48, 40, 34, 32, "Free markets and civil liberties under a limited constitutional government."],
    ["Social Liberalism", "Centre-Right", 30, 36, 22, 30, "Free-market economy with strong civil liberties, strict laicity and equal opportunity."],
    ["Fiscal Conservatism", "Centre-Right", 32, 18, 56, 34, "Low taxation and a small public sector: the state takes a minimal share of output and spends little on redistribution."],
    ["Neoconservatism", "Centre-Right", 46, -14, 62, 62, "Free-market economics with strong defence spending and a patriotic, traditionalist society."],

    ["Anarcho-Communism", "Libertarian Left", -90, 82, 26, 88, "Stateless, classless, common ownership: 'from each according to ability, to each according to need'."],
    ["Anarcho-Syndicalism", "Libertarian Left", -58, 86, 30, 74, "Worker-run industry in a near-stateless society: collective ownership of production under maximal civil liberties."],
    ["Anarcho-Pacifism", "Libertarian Left", -20, 86, 26, 60, "Stateless and antimilitarist; change comes only through non-violence and free cooperation."],
    ["Anarcho-Primitivism", "Libertarian Left", -86, 56, 44, 95, "Dismantle industrial civilisation and settled agriculture; return to tribal hunter-gatherer life."],
    ["Libertarian Socialism", "Libertarian Left", -66, 66, 30, 70, "Broad civil liberties with worker self-management: collective ownership without an authoritarian state apparatus."],
    ["Mutualism", "Libertarian Left", -42, 52, 44, 46, "Free association of producers; mutual credit banks, no rent or profit."],
    ["Council Communism", "Libertarian Left", -86, 74, 14, 86, "Direct democracy through workers' councils: far-left ownership with maximal political participation and civil liberties."],
    ["Luxemburgism", "Libertarian Left", -60, 66, 14, 80, "Revolutionary socialism with genuine mass participation: far-left economics, high civil liberties and a highly politicised society."],
    ["Communalism", "Libertarian Left", -48, 62, 16, 60, "Confederal, ecological democracy of local assemblies; a green libertarian municipalism."],
    ["Participatory Socialism", "Democratic Left", -78, 46, 16, 44, "Society-wide public ownership run through citizen assemblies, co-ops and democratic planning."],
    ["Market Socialism", "Democratic Left", -35, 37, 24, 37, "Worker-owned cooperatives competing in markets: collective ownership of industry combined with genuine market exchange and political liberty."],

    ["Centrism", "Centrist", 4, 2, 46, 12, "Pragmatic middle: mixed markets, moderate welfare, steady reform."],
    ["Solidarism", "Centrist", 8, 6, 70, 20, "Society organised around solidarity, interclass cooperation and universal social insurance."],
    ["Distributism", "Centre", -8, -14, 78, 30, "Property spread widely: small owners, craftsmen and cooperatives over state or monopoly capital."],
    ["Ecomodernism", "Centre-Right", 21, 20, 28, 37, "High-technology environmentalism: strong eco-friendliness and scientific advancement paired with a substantial industrial base."],
    ["Ordoliberalism", "Centre-Right", 24, 4, 48, 22, "Free markets framed by strict state rules against monopoly and inflation."],
    ["Peronism", "Centre", -14, -16, 62, 58, "Justicialism: social justice, economic independence, sovereignty; interclassist and pragmatic."],

    ["Social Democracy", "Centre-Left", -16, 14, 34, 22, "Regulated capitalism with a strong welfare state, unions and redistribution."],
    ["Fabian Socialism", "Centre-Left", -30, 8, 46, 24, "The gradual, parliamentary, bureaucratic road to socialism."],
    ["Democratic Socialism", "Centre-Left", -54, 22, 36, 36, "Social ownership of the commanding heights, pursued democratically."],
    ["Eco-Socialism", "Centre-Left", -24, 38, 42, 54, "Green transition achieved through social ownership and planning."],
    ["Degrowth", "Centre-Left", -36, 24, 46, 58, "Deliberately low per-capita income combined with strong environmental protection: production is voluntarily constrained within ecological limits."],
    ["Eurocommunism", "Centre-Left", -50, -2, 42, 42, "Communist parties that accept parliamentary democracy, pluralism and civil rights."],
    ["Jacobinism", "Centre-Left", -44, 8, 50, 78, "Radical republicanism: a highly politicised, mobilised citizenry under a strong central state."],
    ["Religious Socialism", "Centre-Left", -26, 12, 72, 28, "Faith-inspired social ownership and welfare; religious tradition behind redistribution."],
    ["Left-Wing Populism", "Centre-Left", -34, -14, 60, 66, "Redistribution-led majoritarian politics: high welfare and equality with an activist, mobilised electorate."],

    ["One-Nation Conservatism", "Centre-Right", 6, -16, 72, 30, "Free markets tempered by social cohesion, tradition and a welfare floor."],
    ["Paleoconservatism", "Authoritarian Right", 14, -24, 97, 58, "Traditionalist and localist: near-maximal social conservatism and religiosity with strong patriotism."],
    ["National Conservatism", "Authoritarian Right", 26, -30, 88, 52, "Tradition, national identity and sovereignty over multicultural globalism."],
    ["Religious Nationalism", "Authoritarian Right", 18, -42, 96, 64, "National identity fused with militant religious tradition against secularism."],
    ["Religious Democracy", "Centre-Right", -12, -26, 82, 26, "Market economy restrained by faith-inspired social solidarity and subsidiarity."],
    ["Right-Wing Populism", "Authoritarian Right", 30, -2, 84, 68, "Majoritarian nationalism: a mobilised, patriotic and socially conservative society under a constrained liberal order."],
    ["Timocracy", "Centre-Right", 30, -22, 60, 42, "Political rights concentrated among property and military elites: pronounced wealth gaps alongside a substantial defence establishment."],

    ["Authoritarianism", "Authoritarian", 4, -44, 62, 44, "Concentrated executive power with little tolerance for dissent."],
    ["Technocracy", "Authoritarian", 14, -36, 28, 38, "Rule by technical expertise: an exceptionally educated and intelligent society governed through a large administrative apparatus."],
    ["Constitutional Monarchism", "Authoritarian", 0, -52, 90, 42, "A constitutional monarchy: the game classifies the state as a monarchy constrained by democratic institutions, in a deeply traditional society."],
    ["Absolute Monarchism", "Authoritarian", -4, -70, 97, 52, "An absolute monarchy: the game classifies the state as an unconstrained hereditary monarchy, in a deeply traditional society."],
    ["Theocracy", "Authoritarian", -10, -66, 98, 70, "Religious law is the law of the land."],
    ["Authoritarian Socialism", "Authoritarian Left", -52, -38, 58, 76, "Command economy under strict, single-party control of society."],
    ["Communism", "Authoritarian Left", -76, -64, 62, 90, "Totalising state socialism organised by a vanguard party."],
    ["Stalinism", "Authoritarian Left", -62, -72, 66, 98, "Rigid five-year-plan command economy; single-party terror against dissent."],
    ["Maoism", "Authoritarian Left", -56, -58, 74, 99, "A peasant-based revolutionary state: an agrarian economy under a highly mobilised, politicised society with extreme radicality."],
    ["Trotskyism", "Authoritarian Left", -84, -18, 30, 94, "Revolutionary far-left politics under libertarian conditions: maximal radicality with strong civil liberties and a participatory state."],
    ["State Atheism", "Authoritarian Left", -68, -50, 14, 92, "Officially atheist vanguard state that confines religion to private life."],
    ["Juche", "Authoritarian Left", -54, -78, 80, 94, "Autarkic, ultra-nationalist state socialism centred on the leader."],
    ["Authoritarian Capitalism", "Authoritarian Right", 56, -52, 58, 62, "Markets kept, but civil liberties and political opposition curtailed."],
    ["Plutocracy", "Authoritarian Right", 50, -42, 36, 50, "Wealth rules: extreme concentration of riches alongside heavy business subsidisation and a curtailed political arena."],
    ["State Capitalism", "Authoritarian", 38, -32, 46, 52, "Big state-owned conglomerates competing on capitalist terms (Chinese model)."],
    ["Fascism", "Authoritarian Right", 76, -68, 80, 92, "Everything within the state: aggressive nationalism, corporatism, leader cult."],
    ["Clerical Fascism", "Authoritarian Right", 38, -62, 96, 90, "Fascist mobilisation fused with intransigent religious integralism."],
    ["Neo-Fascism", "Authoritarian Right", 60, -80, 74, 96, "Ethno-nationalist, anti-capitalist authoritarianism rejecting both blocs."],
    ["Nazism", "Authoritarian Right", 86, -84, 62, 99, "Biological supremacist totalitarianism; state, race and empire fused."]
  ];

  const SIG = {

    "Anarcho-Primitivism": [
      { rank: { 69: { min: 60 } } },
      { rank: { 7: { min: 55 }, 70: { max: 45 } } }
    ],

    "Theocracy": [
      { rank: { 32: { min: 55 } } },
      { govt: { spirituality: { min: 20 } } }
    ],
    "Clerical Fascism": [
      { rank: { 32: { min: 55 } } },
      { govt: { spirituality: { min: 20 } } }
    ],

    "Juche": [{ rank: { 32: { max: 55 } } }],
    "State Atheism": [{ rank: { 32: { max: 40 } } }],

    "Anarcho-Pacifism": [{ rank: { 47: { min: 50 } } }],

    "Fascism": [{ rank: { 53: { min: 50 } } }, { rank: { 46: { min: 50 } } }, { rank: { 59: { min: 50 } } }],
    "Neo-Fascism": [{ rank: { 53: { min: 55 } } }, { rank: { 46: { min: 55 } } }, { rank: { 59: { min: 55 } } }],
    "Nazism": [{ rank: { 53: { min: 55 } } }, { rank: { 59: { min: 60 } } }],

    "Constitutional Monarchism": [{ category: { in: ["Constitutional Monarchy", "Absolute Monarchy"] } }],
    "Absolute Monarchism": [{ category: { in: ["Absolute Monarchy"] } }],

    "Technocracy": [{ rank: { 36: { min: 60 } } }],

    "Anarcho-Capitalism": [{ score: { 49: { max: 30 } } }],
    "Minarchism": [{ score: { 49: { max: 45 } } }],
    "Libertarianism": [{ score: { 49: { max: 65 } } }],
    "Classical Liberalism": [{ score: { 49: { max: 75 } } }]
  };

  const PREFS = {
    "Social Democracy": { rank: { 28: { min: 45 }, 29: { min: 45 }, 75: { min: 40 } }, govt: { welfare: { min: 12 }, healthcare: { min: 8 } } },
    "Religious Socialism": { rank: { 28: { min: 40 }, 32: { min: 35 } } },
    "Democratic Socialism": { rank: { 28: { min: 40 }, 33: { min: 45 } } },
    "Fabian Socialism": { rank: { 29: { min: 45 }, 75: { min: 45 } } },
    "Participatory Socialism": { rank: { 33: { min: 40 }, 7: { min: 35 } } },
    "Market Socialism": { rank: { 48: { min: 55 } } },
    "Eco-Socialism": { rank: { 7: { min: 55 } }, govt: { environment: { min: 6 } } },
    "Communalism": { rank: { 7: { min: 50 } } },
    "Ecomodernism": { rank: { 7: { min: 55 }, 70: { min: 55 } }, govt: { environment: { min: 5 } } },
    "Degrowth": { rank: { 7: { min: 45 }, 72: { max: 50 } }, govt: { environment: { min: 6 } } },
    "Anarcho-Communism": { rank: { 33: { min: 50 } } },
    "Anarcho-Capitalism": { rank: { 48: { min: 60 } } },
    "Libertarianism": { rank: { 48: { min: 50 } } },
    "Classical Liberalism": { rank: { 48: { min: 55 }, 62: { min: 40 } } },
    "Social Liberalism": { rank: { 62: { min: 45 } } },
    "Authoritarianism": { rank: { 53: { min: 60 } } },
    "State Capitalism": { rank: { 27: { min: 55 } }, govt: { administration: { min: 12 } } },
    "Religious Democracy": { rank: { 32: { min: 45 } } },
    "Paleoconservatism": { rank: { 8: { min: 60 }, 32: { min: 45 } } },
    "National Conservatism": { rank: { 8: { min: 55 }, 87: { min: 45 } } },
    "Fiscal Conservatism": { rank: { 49: { max: 45 } }, govt: { administration: { max: 8 }, welfare: { max: 8 } } },
    "Neoconservatism": { rank: { 87: { min: 55 } }, govt: { defence: { min: 12 } } },
    "Technocracy": { rank: { 36: { min: 55 } }, govt: { administration: { min: 8 } } },
    "Maoism": { rank: { 17: { min: 55 }, 38: { min: 55 } } },
    "Jacobinism": { rank: { 38: { min: 55 }, 54: { min: 40 } } },
    "Left-Wing Populism": { rank: { 38: { min: 50 }, 28: { min: 45 } } },
    "Right-Wing Populism": { rank: { 38: { min: 50 }, 87: { min: 55 } } },
    "Luxemburgism": { rank: { 38: { min: 45 }, 45: { min: 70 } } },
    "Trotskyism": { rank: { 38: { min: 45 }, 54: { min: 40 } } },
    "Plutocracy": { rank: { 74: { min: 60 } }, govt: { commerce: { min: 10 } } }
  };

  const PREF_SCALE = { 1: "economic output", 7: "eco-friendliness", 8: "social conservatism", 17: "agriculture sector", 27: "government size",
    28: "welfare", 29: "public healthcare", 32: "religiousness", 33: "income equality", 36: "intelligence", 38: "political apathy (inverted)",
    42: "compliance", 43: "safety", 45: "ideological radicality", 46: "defence spending", 47: "pacifism", 48: "economic freedom",
    49: "taxation", 53: "authoritarianism", 54: "youth rebelliousness", 59: "weaponization", 62: "secularism",
    69: "primitiveness", 70: "scientific advancement", 72: "average income (per capita)", 75: "public education", 87: "patriotism" };
  const GOVT_LABELS = { administration: "Administration", defence: "Defence", education: "Education", environment: "Environment", healthcare: "Healthcare", commerce: "Commerce", spirituality: "Spirituality", welfare: "Welfare", lawandorder: "Law & Order", social: "Social Equality", transport: "Public Transport", aid: "International Aid" };

  function prefsScore(name, p) {
    const rules = PREFS[name];
    if (!rules) return -1;
    let ok = 0, n = 0;
    for (const kind of ["rank", "govt"]) {
      const m = rules[kind];
      if (!m) continue;
      for (const idStr of Object.keys(m)) {
        const v = sigValue(p, kind, idStr);
        if (v == null) continue;
        n++;
        const cond = m[idStr];
        if ((cond.min == null || v >= cond.min) && (cond.max == null || v <= cond.max)) ok++;
      }
    }
    return n ? ok / n : -1;
  }

  function prefsReason(name, p) {
    const rules = PREFS[name];
    const hits = [];
    if (rules) {
      for (const kind of ["rank", "govt"]) {
        const m = rules[kind];
        if (!m) continue;
        for (const idStr of Object.keys(m)) {
          const v = sigValue(p, kind, idStr);
          if (v == null) continue;
          const cond = m[idStr];
          if ((cond.min == null || v >= cond.min) && (cond.max == null || v <= cond.max)) {
            const label = kind === "govt"
              ? (GOVT_LABELS[idStr] || idStr) + " budget"
              : (PREF_SCALE[Number(idStr)] || `scale ${idStr}`);
            hits.push(`${label} (${Math.round(v)}${kind === "govt" ? "%" : "/100"})`);
          }
        }
      }
    }
    return hits.slice(0, 3).join(", ");
  }

  function sigValue(p, kind, id) {
    if (kind === "rank") return (p.rank && Number.isFinite(p.rank[id]) ? p.rank[id] : null);
    if (kind === "govt") { const g = p.govt; return (g && Number.isFinite(g[id]) ? g[id] : null); }
    if (kind === "category") return (typeof p.category === "string" ? p.category : null);
    return (p.scores && Number.isFinite(p.scores[id]) ? p.scores[id] : null);
  }
  function sigPass(name, p) {
    const alts = SIG[name];
    if (!alts || !alts.length) return true;

    let anyEvaluated = false;
    for (const alt of alts) {
      let ok = true, anyData = false;
      for (const kind of Object.keys(alt)) {

        if (kind === "category") {
          const v = sigValue(p, "category", null);
          if (v == null) continue;
          anyData = true;
          if (alt[kind].in && !alt[kind].in.includes(v)) { ok = false; break; }
          continue;
        }
        for (const idStr of Object.keys(alt[kind])) {
          const v = sigValue(p, kind, idStr);
          if (v == null) continue;
          anyData = true;
          const cond = alt[kind][idStr];
          if ((cond.min != null && v < cond.min) || (cond.max != null && v > cond.max)) { ok = false; break; }
        }
        if (!ok) break;
      }
      if (anyData) anyEvaluated = true;
      if (ok && anyData) return true;
    }
    return anyEvaluated ? false : true;
  }

  function sigFailReason(p, name) {
    const r = (id) => (Number.isFinite(p.rank?.[id]) ? p.rank[id] : null);
    if (name === "Anarcho-Primitivism") {
      const prim = r(69), tech = r(70);
      const bits = [];
      if (prim != null) bits.push(`Primitiveness intensity ${prim}/100 — among the world's least primitive`);
      if (tech != null) bits.push(`Scientific Advancement intensity ${tech}/100`);
      return "the census shows a highly civilised, industrial society (" + (bits.join("; ") || "low primitiveness") + ")";
    }
    if (name === "Theocracy" || name === "Clerical Fascism") {
      const rl = r(32);
      return rl != null ? `religiousness is only intensity ${rl}/100 in the census` : "the census shows a secular society";
    }
    if (name === "Juche" || name === "State Atheism") {
      const rl = r(32);
      return rl != null ? `the census shows a devout society (Religiousness intensity ${rl}/100, incompatible with official state atheism)` : "its census contradicts official atheism";
    }
    if (name === "Anarcho-Pacifism") {
      const pac = r(47);
      return pac != null ? `its census shows a militarised society (Pacifism intensity ${pac}/100)` : "its census contradicts pacifism";
    }
    if (name === "Fascism" || name === "Neo-Fascism" || name === "Nazism") {
      const a = r(53), w = r(59), de = r(46);
      const vals = [a != null ? `authoritarianism ${a}` : null, w != null ? `weaponization ${w}` : null, de != null ? `defence ${de}` : null].filter(Boolean).join(", ");
      return "its census shows no real militarist-authoritarian machinery (" + (vals || "intensities all low") + " /100)";
    }
    if (name === "Technocracy") {
      const iq = r(36);
      return iq != null ? `the society's measured Intelligence intensity is only ${iq}/100 — not an expert class` : "its census contradicts rule by expertise";
    }
    if (name === "Anarcho-Capitalism" || name === "Minarchism" || name === "Libertarianism" || name === "Classical Liberalism") {
      const t = p.scores && Number.isFinite(p.scores[49]) ? Math.round(p.scores[49]) : null;
      return t != null
        ? `the state levies a ${t}% tax rate${t > 70 ? " — a confiscatory burden incompatible with a stateless or minimal-state economy" : " — beyond what the label's limited state admits"}`
        : "its taxation profile contradicts the label";
    }
    if (name === "Constitutional Monarchism" || name === "Absolute Monarchism") {
      return p.category ? `the game category is \u201c${p.category}\u201d, not a monarchy` : "the form of the head of state cannot be confirmed";
    }
    return "its census profile contradicts the label";
  }

  const ZONE_BLURB = {
    "authoritarian,left": "a state-run economy under concentrated power",
    "authoritarian,center": "concentrated power without a strong economic lean",
    "authoritarian,right": "markets or private wealth under concentrated power",
    "centrist,left": "a mixed economy with a moderate state",
    "centrist,center": "the pragmatic middle — balanced economy and freedoms",
    "centrist,right": "a mostly private economy with a moderate state",
    "libertarian,left": "wide civil liberties on a collectively-run economy",
    "libertarian,center": "wide personal freedoms with a balanced economy",
    "libertarian,right": "wide civil liberties on a free-market economy"
  };

  function specificIdeology(p, govtSpending, sectors, policies) {
    const pol = p.pol, econ = p.econ;
    const x = p.x, y = p.y;

    let trad;
    const tradParts = [];
    if (Number.isFinite(p.socCons)) tradParts.push(p.socCons);
    if (Number.isFinite(p.relig)) tradParts.push(p.relig);
    if (tradParts.length) trad = tradParts.reduce((a, b) => a + b, 0) / tradParts.length;
    else trad = 100 - (p.progressive ?? 50);
    trad = Math.max(0, Math.min(100, trad));

    const radic = Number.isFinite(p.radical) ? Math.max(0, Math.min(100, (p.radical / 51) * 100)) : null;

    let econWord;
    if (sectors && Number.isFinite(sectors.state) && Number.isFinite(sectors.private)) {
      const marketSH = (sectors.private || 0) + (sectors.black || 0);
      const stateSH = sectors.state || 0;
      const marketPct = marketSH + stateSH > 0 ? marketSH / (marketSH + stateSH) : 0.5;
      econWord = marketPct >= 0.66 ? "laissez-faire" : marketPct >= 0.4 ? "mixed-market" : "state-planned";
    } else if (Number.isFinite(p.econFree)) {
      econWord = p.econFree >= 66 ? "laissez-faire" : p.econFree >= 40 ? "mixed-market" : "planned";
    } else {
      econWord = econ >= 66 ? "laissez-faire" : econ >= 40 ? "mixed-market" : "planned";
    }
    const freeWord = pol >= 66 ? "liberal" : pol >= 40 ? "moderate" : "restrictive";

    const KT = 0.6, KR = 0.45;
    const scored = IDEOLOGIES.map(([name, family, cx, cy, tExp, rExp, note]) => {
      const dx = x - cx, dy = y - cy, dt = (trad - tExp) * KT;
      const dr = radic == null ? 0 : (radic - rExp) * KR;
      return { name, family, note, tExp, d: Math.sqrt(dx * dx + dy * dy + dt * dt + dr * dr) };
    }).sort((a, b) => a.d - b.d);

    const vetoes = [];
    for (const cand of scored) {
      if (sigPass(cand.name, p)) break;
      vetoes.push(cand);
    }
    const passable = scored.filter((c) => sigPass(c.name, p));
    if (!passable.length) passable.push(scored[0]);

    const band = passable.filter((c) => c.d <= passable[0].d + 5);
    const PROF_BONUS = 6;
    const mapLeader = band[0];
    let winner = mapLeader;
    let bestEff = winner.d - Math.max(0, prefsScore(winner.name, p)) * PROF_BONUS;
    for (let i = 1; i < band.length; i++) {
      const f = prefsScore(band[i].name, p);
      const eff = f < 0 ? band[i].d : band[i].d - PROF_BONUS * f;
      if (eff < bestEff) { bestEff = eff; winner = band[i]; }
    }
    const rivals = passable.filter((c) => c !== winner).slice(0, 2);

    const rowOf = (nm) => IDEOLOGIES.find((r) => r[0] === nm);
    const wRow = rowOf(winner.name);

    let mktPct = null;
    if (sectors && Number.isFinite(sectors.state) && Number.isFinite(sectors.private)) {
      const mkt = (sectors.private || 0) + (sectors.black || 0);
      const stt = sectors.state || 0;
      if (mkt + stt > 0) mktPct = (mkt / (mkt + stt)) * 100;
    }

    const rv = (n) => (Number.isFinite(n) ? Math.round(n) : null);
    const socBits = [];
    if (Number.isFinite(p.socCons)) socBits.push(`Social Conservatism ${rv(p.socCons)}`);
    if (Number.isFinite(p.relig)) socBits.push(`Religiousness ${rv(p.relig)}/100 in percentile intensity`);

    let dec = null;
    const run0 = rivals[0];
    const rRow = run0 ? rowOf(run0.name) : null;
    if (wRow && rRow) {
      const dims = [
        { k: "the economic axis", v: x, ew: wRow[2], er: rRow[2], wt: 1 },
        { k: "the authority axis", v: y, ew: wRow[3], er: rRow[3], wt: 1 },
        { k: "traditionalism", v: trad, ew: wRow[4], er: rRow[4], wt: KT },
        { k: "radicality", v: radic, ew: wRow[5], er: rRow[5], wt: KR }
      ].filter((d) => d.v != null);
      let best = null;
      dims.forEach((d) => {
        const adv = (Math.abs(d.v - d.er) - Math.abs(d.v - d.ew)) * d.wt;
        if (adv > 0.5 && (!best || adv > best.adv)) best = { k: d.k, v: d.v, ew: d.ew, er: d.er, adv };
      });
      if (best) dec = { dim: best.k, v: best.v, ew: best.ew, er: best.er };
    }

    let gap = null;
    if (wRow) {
      const dims = [
        { k: "the economic axis", v: x, e: wRow[2] },
        { k: "the authority axis", v: y, e: wRow[3] },
        { k: "traditionalism", v: trad, e: wRow[4] },
        { k: "radicality", v: radic, e: wRow[5] }
      ].filter((d) => d.v != null).map((d) => ({ k: d.k, gap: Math.abs(d.v - d.e) }));
      dims.sort((a, b) => b.gap - a.gap);
      if (dims[0] && dims[0].gap > 15) gap = { dim: dims[0].k, v: dims[0].gap };
    }

    let corr = null;
    if (winner === mapLeader) {
      const r = prefsReason(winner.name, p);
      if (r) corr = r;
    }

    const facts = {
      x, y, civil: p.civil, pol: p.pol, govtSize: p.govtSize, econFree: p.econFree, econ,
      mktPct, socBits, trad, radic, tax: p.tax, welfareRank: p.welfareRank,
      cx: wRow ? wRow[2] : null, cy: wRow ? wRow[3] : null, tExp: wRow ? wRow[4] : null, rExp: wRow ? wRow[5] : null,
      dist: winner.d, dec, gap, corr
    };
    const desc = ideoExplanation(winner, vetoes, rivals, p, econWord, freeWord, govtSpending, policies, mapLeader, facts);
    return { family: winner.family, name: winner.name, desc };
  }

  const tradAdj = (t) => t >= 70 ? "highly traditional" : t >= 55 ? "traditional-leaning" : t >= 40 ? "moderately traditional" : t >= 25 ? "moderately secular" : "strongly secular";

  const RAD_CEIL = 51;
  const radPct = (r) => (Number.isFinite(r) ? Math.max(0, Math.min(100, (r / RAD_CEIL) * 100)) : null);
  const radAdj = (r) => { const q = radPct(r); return q == null ? "" : q >= 75 ? "highly radical" : q >= 55 ? "markedly radical" : q >= 35 ? "moderately radical" : q >= 20 ? "mildly radical" : "of low radicality"; };
  const econAdj = (x) => x >= 60 ? "strongly market-run" : x >= 33 ? "market-leaning" : x >= -33 ? "mixed" : x >= -60 ? "state-leaning" : "strongly state-run";
  const libertyAdj = (y) => y >= 60 ? "strongly libertarian" : y >= 33 ? "libertarian" : y >= -33 ? "intermediate on the authority axis" : y >= -60 ? "authoritarian" : "strongly authoritarian";
  const humanJoin = (a) => { if (!a || !a.length) return ""; if (a.length === 1) return a[0]; if (a.length === 2) return `${a[0]} and ${a[1]}`; return a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; };

  function ideoExplanation(winner, vetoes, rivals, p, econWord, freeWord, govtSpending, policies, mapLeader, f) {
    const R = (n) => (Number.isFinite(n) ? Math.round(n) : null);
    const zone = compassTerritory(p);
    const P = [];

    let lead = `Closest of the ${IDEOLOGIES.length} named ideologies: ${winner.name} (${winner.family}). ${winner.note} The entity is positioned in the ${zone.name} zone (X ${R(f.x)}, Y ${R(f.y)}), which corresponds to ${ZONE_BLURB[zone.key] || zone.name}. `;
    if (f.mktPct != null) {
      lead += `The economic axis is derived from the production split (${R(f.mktPct)}% private or black-market, ${R(100 - f.mktPct)}% state-owned${Number.isFinite(f.econFree) ? `; Economic Freedom scores ${R(f.econFree)}/100 on the same market-state spectrum` : ""}). `;
    } else if (Number.isFinite(f.econFree)) {
      lead += `The economic axis is derived from the Economic Freedom census, which scores ${R(f.econFree)}/100. `;
    } else if (Number.isFinite(f.econ)) {
      lead += `The economic axis is derived from the Economy index (${R(f.econ)}/100). `;
    } else {
      lead += `The economic reading is consistent with the position. `;
    }
    if (Number.isFinite(f.civil) && Number.isFinite(f.pol)) {
      lead += `The authority axis is derived from Civil Rights (${R(f.civil)}) and Political Freedom (${R(f.pol)}), whose mean is ${R((f.civil + f.pol) / 2)}`;
      if (Number.isFinite(f.govtSize)) {
        const nudge = (f.govtSize - 50) * 0.6;
        if (Math.abs(nudge) >= 1) {
          lead += `, adjusted for Government Size (${R(f.govtSize)}/100, ${nudge > 0 ? "an authoritarian" : "a libertarian"} shift of about ${R(Math.abs(nudge))} points)`;
        }
      }
      lead += `. Together they describe an economy that is ${econWord} and a civil-liberties regime that is ${freeWord}, the defining combination of ${winner.name}.`;
    } else {
      lead += `The regime is ${econWord} economically with ${freeWord} civil liberties, the defining combination of ${winner.name}.`;
    }
    if (Number.isFinite(f.tax) || Number.isFinite(f.welfareRank)) {
      const parts = [];
      if (Number.isFinite(f.tax)) parts.push(`a tax rate of ${R(f.tax)}%`);
      if (Number.isFinite(f.welfareRank)) parts.push(`welfare spending at the ${R(f.welfareRank)}th world percentile`);
      const hiTax = Number.isFinite(f.tax) && f.tax > 50;
      const hiWel = Number.isFinite(f.welfareRank) && f.welfareRank > 50;
      const dir = hiTax || hiWel ? "leftward" : "rightward";
      lead += ` The redistribution evidence — ${humanJoin(parts)} — shifts the economic axis ${dir}.`;
    }
    P.push(lead);

    let soc = `The society factors used in the classification are consistent with the label. Traditionalism is ${R(f.trad)}/100 (${tradAdj(f.trad)}), based on ${f.socBits && f.socBits.length ? humanJoin(f.socBits) : "an estimate from the level of civil liberty; no society scales were available"}`;
    if (f.radic != null) soc += `; radicality is ${R(f.radic)} on the census's 0-100 scale (${radAdj(f.radic)} — the census rarely exceeds ~51, where ${R(f.radic)} sits at ${R(radPct(f.radic))}% of the observed maximum), from Ideological Radicality`;
    soc += `. The distance from the entity to the label's anchor — X ${R(f.cx)}, Y ${R(f.cy)}, traditionalism ${R(f.tExp)}, radicality ${R(f.rExp)} — is ${R(f.dist)} points in the four-dimensional space used by the classifier.`;
    P.push(soc);

    let why = null;
    if (vetoes.length) {
      const v0 = vetoes[0];
      why = `${v0.name} is the nearest ideology by map distance, but it requires a definitional census signature that is not met (${sigFailReason(p, v0.name)}). Labels contradicted by the census are excluded from consideration; the classification therefore falls to ${winner.name}, the closest ideology whose signature is satisfied.`;
    } else if (mapLeader && winner !== mapLeader) {
      const r = prefsReason(winner.name, p);
      why = `${mapLeader.name} is marginally closer in map distance. Its census profile, however, does not fit the entity${r ? `, whereas the defining traits of ${winner.name} are present (${r})` : ""}. When two labels are nearly equidistant, the census profile is used to decide between them; in this case it selects ${winner.name}.`;
    } else if (rivals.length) {
      const rr = rivals[0];
      if (f.dec) {
        why = `The closest rival is ${rr.name}. The two anchors differ most on ${f.dec.dim}: the entity measures ${R(f.dec.v)}, which is nearer to ${winner.name}'s anchor (${R(f.dec.ew)}) than to ${rr.name}'s (${R(f.dec.er)}). On the remaining dimensions the two labels are comparable, so this dimension determines the choice.`;
      } else {
        why = `The closest rival, ${rr.name}, is farther on every measured dimension and is not selected.`;
      }
    }
    if (why) P.push(why);

    const tail = [];
    if (f.corr) tail.push(`The entity's world percentile ranks corroborate the label: ${f.corr}.`);
    if (f.gap) tail.push(`The classification is not exact — the largest deviation from the anchor is on ${f.gap.dim} (${R(f.gap.v)} points) — but no other ideology reconciles all measured dimensions better.`);
    if (govtSpending && govtSpending.length) {
      const sorted = govtSpending.slice().sort((a, b) => b.value - a.value);
      tail.push(`Budget priorities are consistent with the label: ${sorted[0].label.toLowerCase()} (${sorted[0].value.toFixed(1)}%)${sorted[1] ? `, ${sorted[1].label.toLowerCase()} (${sorted[1].value.toFixed(1)}%)` : ""}${sorted[2] ? ` and ${sorted[2].label.toLowerCase()} (${sorted[2].value.toFixed(1)}%)` : ""} of spending.`);
    }
    if (policies && policies.length) {
      tail.push(`Enshrined policies: ${policies.slice(0, 4).join(", ")}${policies.length > 4 ? ", among others" : ""}.`);
    }
    if (tail.length) P.push(tail.join(" "));

    return P.join("\n\n");
  }

  function ideologyFor(p, govtSpending, policies, sectors) {
    const r = specificIdeology(p, govtSpending, sectors, policies);
    return { quadrant: r.family, name: r.name, desc: r.desc };
  }

  function govtLabelText(key) { return GOVT_LABELS[key] || key; }

  function compassBackdrop(ctx, w, h, cx, cy, rx, ry) {
    const T = [
      { c: "#D21F3C", zone: "authoritarian,left" },
      { c: "#A0315F", zone: "authoritarian,center" },
      { c: "#1F5FA8", zone: "authoritarian,right" },
      { c: "#E68A2E", zone: "centrist,left" },
      { c: "#7A7F84", zone: "centrist,center" },
      { c: "#2E7FB8", zone: "centrist,right" },
      { c: "#57B23F", zone: "libertarian,left" },
      { c: "#3FA88A", zone: "libertarian,center" },
      { c: "#E0B01E", zone: "libertarian,right" }
    ];

    const colW = rx * 2 / 3, rowH = ry * 2 / 3;
    ctx.globalAlpha = 0.85;
    T.forEach((t) => {
      const [yz, xz] = t.zone.split(",");
      const col = { left: 0, center: 1, right: 2 }[xz];
      const row = { authoritarian: 0, centrist: 1, libertarian: 2 }[yz];
      ctx.fillStyle = t.c;
      ctx.fillRect(cx - rx + col * colW, cy - ry + row * rowH, colW, rowH);
    });
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(cx - rx + i * colW, cy - ry); ctx.lineTo(cx - rx + i * colW, cy + ry); ctx.stroke();
    }

    ctx.strokeStyle = "#5b6770"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(cx - rx, cy); ctx.lineTo(cx + rx, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - ry); ctx.lineTo(cx, cy + ry); ctx.stroke();

    ctx.strokeStyle = "#8a97a0"; ctx.lineWidth = 1;
    [-66, -33, 0, 33, 66].forEach((t) => {
      const tx = cx + (t / 100) * rx;
      ctx.beginPath(); ctx.moveTo(tx, cy - 3); ctx.lineTo(tx, cy + 3); ctx.stroke();
      const ty = cy + (t / 100) * ry;
      ctx.beginPath(); ctx.moveTo(cx - 3, ty); ctx.lineTo(cx + 3, ty); ctx.stroke();
    });

    ctx.fillStyle = "rgba(70,78,86,0.8)"; ctx.font = "bold 10px Verdana, sans-serif"; ctx.textAlign = "left";
    ctx.fillText("Authoritarian", cx + 4, cy - ry + 11);
    ctx.fillText("Libertarian", cx + 4, cy + ry - 2);
    ctx.textAlign = "center";
    ctx.fillText("Left", cx - rx + 4, cy - 6);
    ctx.fillText("Right", cx + rx - 14, cy - 6);
  }

  function territoryColor(p) {
    const k = compassTerritory(p).key;
    const map = {
      "authoritarian,left": "#D21F3C", "authoritarian,center": "#A0315F", "authoritarian,right": "#1F5FA8",
      "centrist,left": "#E68A2E", "centrist,center": "#7A7F84", "centrist,right": "#2E7FB8",
      "libertarian,left": "#57B23F", "libertarian,center": "#3FA88A", "libertarian,right": "#E0B01E"
    };
    return map[k] || "#0B3D66";
  }

  function fillProgressive(root, p) {
    const raw = p.progressive;
    const val = Number.isFinite(raw) ? Math.round(Math.max(0, Math.min(100, raw))) : 0;
    const label = val >= 75 ? "Highly progressive" : val >= 55 ? "Progressive" : val >= 40 ? "Centrist" : val >= 25 ? "Traditionalist" : "Strongly traditionalist";
    fill(root, "progressive", `${val}% — ${label}`);
    const f = root.querySelector('[data-f="progressive-fill"]');
    if (f) {
      f.style.width = Math.max(2, Math.min(100, val)) + "%";

      f.style.background = `hsl(${Math.round(120 * val / 100)}, 72%, 45%)`;
    }
  }

  function renderCompassLegend(root) {
    const el = root.querySelector('[data-f="compass-legend"]');
    if (!el) return;
    const items = [
      ["Auth. Left", "#D21F3C"], ["Auth. Right", "#1F5FA8"], ["Centre", "#7A7F84"],
      ["Centre-L", "#E68A2E"], ["Centre-R", "#2E7FB8"], ["Lib. Left", "#57B23F"], ["Lib. Right", "#E0B01E"]
    ];
    el.innerHTML = "";
    items.forEach(([label, col]) => {
      const span = document.createElement("span");
      const sw = document.createElement("i"); sw.style.background = col;
      span.append(sw, document.createTextNode(label));
      el.appendChild(span);
    });
  }

  function drawCompass(canvasId, p, trail) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320, h = canvas.clientHeight || 230;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const pad = 30, labelBand = 20;
    const cx = w / 2, cy = h / 2;
    const rx = (w / 2) - pad, ry = (h / 2) - (pad + labelBand / 2);

    compassBackdrop(ctx, w, h, cx, cy, rx, ry);

    if (trail && trail.length > 1) {
      ctx.strokeStyle = "rgba(96,106,114,0.4)"; ctx.lineWidth = 1.4;
      ctx.beginPath();
      trail.forEach((tp, i) => {
        const tx = cx + (tp.x / 100) * rx;
        const ty = cy + (tp.y / 100) * ry;
        if (i === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
      });
      ctx.stroke();
      ctx.fillStyle = "rgba(96,106,114,0.55)";
      trail.forEach((tp) => {
        const tx = cx + (tp.x / 100) * rx;
        const ty = cy + (tp.y / 100) * ry;
        ctx.beginPath(); ctx.arc(tx, ty, 2.2, 0, Math.PI * 2); ctx.fill();
      });
    }

    const px = cx + (p.x / 100) * rx;
    const py = cy + (p.y / 100) * ry;
    ctx.strokeStyle = "rgba(70,78,86,0.45)"; ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx, py); ctx.stroke();
    ctx.setLineDash([]);

    const col = territoryColor(p);
    ctx.fillStyle = col; ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.arc(px, py, 13, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = "rgba(40,46,52,0.9)"; ctx.font = "bold 9.5px Verdana, sans-serif"; ctx.textAlign = px > cx - rx / 2 ? "left" : "right";
    const label = `${p.x > 0 ? "+" : ""}${Math.round(p.x)} / ${p.y > 0 ? "+" : ""}${Math.round(p.y)}`;
    ctx.fillText(label, px + (px > cx ? 10 : -10), py - 6);
  }

  function drawCompassMini(canvas, p) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 180, h = canvas.clientHeight || 104;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const rx = (w / 2) - 3, ry = (h / 2) - 3;

    const T = [
      { c: "#D21F3C", zone: "authoritarian,left" },
      { c: "#A0315F", zone: "authoritarian,center" },
      { c: "#1F5FA8", zone: "authoritarian,right" },
      { c: "#E68A2E", zone: "centrist,left" },
      { c: "#7A7F84", zone: "centrist,center" },
      { c: "#2E7FB8", zone: "centrist,right" },
      { c: "#57B23F", zone: "libertarian,left" },
      { c: "#3FA88A", zone: "libertarian,center" },
      { c: "#E0B01E", zone: "libertarian,right" }
    ];
    const colW = rx * 2 / 3, rowH = ry * 2 / 3;
    ctx.globalAlpha = 0.9;
    T.forEach((t) => {
      const [yz, xz] = t.zone.split(",");
      const col = { left: 0, center: 1, right: 2 }[xz];
      const row = { authoritarian: 0, centrist: 1, libertarian: 2 }[yz];
      ctx.fillStyle = t.c;
      ctx.fillRect(cx - rx + col * colW, cy - ry + row * rowH, colW, rowH);
    });
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - rx, cy); ctx.lineTo(cx + rx, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - ry); ctx.lineTo(cx, cy + ry); ctx.stroke();

    const px = cx + (p.x / 100) * rx, py = cy + (p.y / 100) * ry;
    const col = territoryColor(p);
    ctx.fillStyle = col; ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
  }

  function drawCompassCmp(canvas, pA, pB, nameA, nameB) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320, h = canvas.clientHeight || 230;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const pad = 30, labelBand = 20;
    const cx = w / 2, cy = h / 2;
    const rx = (w / 2) - pad, ry = (h / 2) - (pad + labelBand / 2);

    compassBackdrop(ctx, w, h, cx, cy, rx, ry);

    const pts = [{ p: pA, c: CMP_COLORS.a }, { p: pB, c: CMP_COLORS.b }];

    ctx.strokeStyle = "rgba(90,100,110,0.55)"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach((o, i) => {
      const x = cx + (o.p.x / 100) * rx;
      const y = cy + (o.p.y / 100) * ry;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    pts.forEach((o) => {
      const x = cx + (o.p.x / 100) * rx;
      const y = cy + (o.p.y / 100) * ry;
      ctx.fillStyle = o.c; ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = o.c; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
    });

    ctx.textAlign = "left"; ctx.font = "bold 10px Verdana, sans-serif";
    let ly = 14;
    [[nameA, CMP_COLORS.a], [nameB, CMP_COLORS.b]].forEach(([nm, col]) => {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(9, ly - 3, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#333"; ctx.fillText((nm || "").slice(0, 18), 17, ly);
      ly += 14;
    });
  }

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

  function nsExchangeRate(gdpCapita, production) {
    return Math.sqrt((gdpCapita * production) / 404000000);
  }

  function fmtBig(n) {
    if (!Number.isFinite(n)) return "—";
    const a = Math.abs(n);
    if (a >= 1e15) return (n / 1e15).toFixed(2) + "Q";
    if (a >= 1e12) return (n / 1e12).toFixed(2) + "T";
    if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return Number(n).toFixed(2);
  }

  function economyReport(doc, pop, tax, govtScores) {
    const econWord = text(doc, "ECONOMY");
    const crWord = text(doc, "CIVILRIGHTS");
    const pfWord = text(doc, "POLITICALFREEDOM");
    const population = Number(pop) * 1e6;

    const eMod = ECON_MOD[econWord] ?? 0;
    const crWE = CR_MOD_WE[crWord] ?? 0;
    const crCC = CR_MOD_CC[crWord] ?? 0;
    const pfWE = PF_MOD_WE[pfWord] ?? 0;
    const pfGE = PF_MOD_GE[pfWord] ?? 0;
    const tMod = taxModifier(tax);
    const production = PRODUCTION[econWord] ?? 7500;

    const workerEnthusiasm = 1 + crWE + pfWE + tMod;
    const consumerConfidence = 1 + eMod + crCC;

    const adminPct = (govtScores.find((s) => s.label === "Administration")?.value || 20);
    const adminBudget = adminPct / 100;
    const govEfficiency = 1 + pfGE / (adminCurve(adminBudget) || 1);

    const output = production * population * workerEnthusiasm * consumerConfidence;
    const consumption = output * (1 - tax / 100);
    const govBudget = output * govEfficiency * (tax / 100 + consumerConfidence / 10 + workerEnthusiasm / 40);
    const govExpend = govBudget * govEfficiency;
    const govWaste = govBudget - govExpend;
    const imports = ((1 / consumerConfidence) / 8) * (consumption + govExpend);

    const netTrade = imports * (consumerConfidence - 1);
    const gdp = consumption + netTrade + govExpend;
    const gdpCapita = gdp / (population || 1);
    const exchangeRate = nsExchangeRate(gdpCapita, production);
    const unemp = Math.pow(gdpCapita - 37500, 2) * 1.25e-10 - 1.5e-6 * Math.abs(gdpCapita - 37500) + 0.03;

    const bmConf = (govEfficiency + workerEnthusiasm + consumerConfidence) / 3;
    const bmGrow = (1 / (bmConf || 1)) * 0.5 * output;
    const bmShrink = (1 / (bmConf || 1)) * 0.75 * govWaste;
    const bmEthics = -(1 / (bmConf || 1)) * 0.75 * govEfficiency;
    const bmTax = output * 3 * (tax / 100) * (1 / (govEfficiency || 1));
    const blackMarket = bmGrow - bmShrink + bmEthics + bmTax + govWaste;

    return { workerEnthusiasm, consumerConfidence, govEfficiency, adminCurveValue: adminCurve(adminBudget), production, output, consumption, govBudget, govExpend, govWaste, imports, netTrade, gdp, gdpCapita, exchangeRate, unemployment: Math.max(0, unemp), blackMarket, govtScores };
  }

  function renderEconomy(root, e) {
    fill(root, "e-gdp", `$${fmtBig(e.gdp)}`);
    fill(root, "e-gdpcapita", `$${fmtBig(e.gdpCapita)}`);
    fill(root, "e-income", `$${fmtBig(e.gdpCapita * 0.8)}`);
    fill(root, "e-tax", e.tax);
    fill(root, "e-output", `$${fmtBig(e.output)}`);
    fill(root, "e-consumption", `$${fmtBig(e.consumption)}`);
    fill(root, "e-govexp", `$${fmtBig(e.govExpend)}`);
    fill(root, "e-imports", `$${fmtBig(e.imports)}`);

    fill(root, "e-exports", Number.isFinite(e.exports) ? `$${fmtBig(e.exports)}` : "—");
    fill(root, "e-nettrade", `$${fmtBig(e.netTrade)}`);
    fill(root, "e-enthusiasm", `${e.workerEnthusiasm.toFixed(2)} ×`);
    fill(root, "e-confidence", `${e.consumerConfidence.toFixed(2)} ×`);
    fill(root, "e-goveff", `${e.govEfficiency.toFixed(2)} ×`);
    fill(root, "e-unemployment", `${(e.unemployment * 100).toFixed(2)}%`);
    renderExchangeRate(root, e.exchangeRate);
    fill(root, "e-blackmarket", `$${fmtBig(e.blackMarket)}`);
  }

  function singularCurrency(s) {
    if (!s) return "";
    s = s.trim();
    if (s.endsWith("s") && !s.endsWith("ss") && !s.endsWith("us") && !s.endsWith("is")) return s.slice(0, -1);
    return s;
  }

  function renderExchangeRate(root, er) {
    const el = root.querySelector('[data-f="e-exchangerate"]');
    if (!el) return;
    if (!Number.isFinite(er) || er <= 0) { el.textContent = "—"; return; }
    const rawCur = (root.querySelector('[data-f="currency"]')?.textContent || "").trim();
    const hasCur = rawCur && rawCur !== "—";
    const cur = hasCur ? rawCur : "local currency";
    const one = hasCur ? singularCurrency(rawCur) : "local";

    el.innerHTML = `<span class="erate-line">1 ${one} = ${fmtBig(er)} $</span>`
      + `<span class="erate-line">1 $ = ${fmtBig(1 / er)} ${cur}</span>`;
  }

  function renderEconomyChart(e) {
    const el = document.getElementById("chart-economy");
    if (!el || !CHART_AVAILABLE) return;
    const prev = activeCharts.find((c) => c.canvas && c.canvas === el);
    if (prev) destroyChart(prev);
    const labels = ["Output", "Consumption", "Gov. Budget", "Gov. Expend."];
    const chart = new Chart(el, {
      type: "bar",
      data: { labels, datasets: [
        { data: [e.output, e.consumption, e.govBudget, e.govExpend], backgroundColor: PALETTE.slice(0, 4), borderRadius: 2, maxBarThickness: 34 }
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `$${fmtBig(c.raw)}` } }
        },
        scales: {
          y: { beginAtZero: true, grid: { color: cssVar("--chart-grid") }, ticks: { callback: (v) => "$" + fmtBig(v) }, title: { display: true, text: "Aggregates ($)" } },
          x: { grid: { display: false } }
        }
      }
    });
    activeCharts.push(chart);
    renderTradeChart(e);
  }

  function renderTradeChart(e) {
    const el = document.getElementById("chart-trade");
    if (!el || !CHART_AVAILABLE) return;
    const prev = activeCharts.find((c) => c.canvas && c.canvas === el);
    if (prev) destroyChart(prev);
    const hasTrade = Number.isFinite(e.exports);
    const labels = ["Exports", "Imports", "Net Trade"];
    const values = hasTrade ? [e.exports, e.imports, e.netTrade] : [null, e.imports, e.netTrade];
    const chart = new Chart(el, {
      type: "bar",
      data: { labels, datasets: [
        { data: values, backgroundColor: [PALETTE[4], PALETTE[1], PALETTE[3]], borderRadius: 2, maxBarThickness: 34 }
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { filter: (item) => item.raw !== null, callbacks: { label: (c) => `$${fmtBig(c.raw)}` } }
        },
        scales: {
          y: { grid: { color: cssVar("--chart-grid") }, ticks: { callback: (v) => "$" + fmtBig(v) }, title: { display: true, text: "Trade ($, absolute scale)" } },
          x: { grid: { display: false } }
        }
      }
    });
    activeCharts.push(chart);
  }

  const TRADE_SHARDS = "freedom+tax+govt+population";
  const tradeTotalsCache = new Map();
  const TRADE_CACHE_TTL_MS = 6 * 3600 * 1000;

  function govtScoresOf(doc) {
    const g = doc.querySelector("GOVT");
    if (!g) return [];
    return Array.from(g.children).map((c) => ({ label: humanizeTag(c.tagName), value: parseFloat(c.textContent) }))
      .filter((s) => Number.isFinite(s.value));
  }

  function tradeNote(root) { return root.querySelector('[data-f="e-tradenote"]'); }

  function setTradeNote(root, html) {
    const el = tradeNote(root);
    if (!el) return;
    el.innerHTML = html;
    el.hidden = false;
  }

  function econGrid(root) { return root.querySelector('[data-f="e-grid"]'); }
  function econLoader(root) { return root.querySelector('[data-f="e-econloading"]'); }

  function setLoader(root, msg, why, pct, count) {
    const loader = econLoader(root);
    if (!loader) return;
    loader.hidden = false;
    const m = loader.querySelector('[data-f="e-loadmsg"]');
    const w = loader.querySelector('[data-f="e-loadwhy"]');
    const pc = loader.querySelector('[data-f="e-loadpct"]');
    const cn = loader.querySelector('[data-f="e-loadcount"]');
    const fl = loader.querySelector('[data-f="e-loadfill"]');
    if (m) m.textContent = msg;
    if (w) w.textContent = why || "";

    if (pc) pc.textContent = Number.isFinite(pct) ? Math.round(Math.max(0, Math.min(100, pct))) + "%" : "…";
    if (cn) cn.textContent = count || "";
    if (fl) {
      if (Number.isFinite(pct)) {
        fl.classList.remove("is-indeterminate");
        fl.style.width = Math.max(0, Math.min(100, pct)) + "%";
      } else {
        fl.classList.add("is-indeterminate");
        fl.style.width = "";
      }
    }
  }

  function scanWhy(regionName, total) {
    return `Exports are referenced to every nation of ${regionName}, so the report needs the export-related fields of all ${enLocale(total)} of its members. Each member contributes one minimal request (paced ~0.7 s apart to stay within the API rate limit), which is why this can take from a few seconds to a few minutes.`;
  }

  async function economyController(root, doc, e) {
    const grid = econGrid(root), loader = econLoader(root);
    if (!grid || !loader) { renderEconomy(root, e); renderEconomyChart(e); return; }
    const seq = openSeq;
    const regionName = text(doc, "REGION");
    if (!regionName) { grid.hidden = false; renderEconomy(root, e); renderEconomyChart(e); return; }
    const regionKey = normalizeName(regionName);

    grid.hidden = true;
    setLoader(root, "Preparing the economy report…", "", null, "");
    let members = [];
    for (let attempt = 0; attempt < 2 && !members.length; attempt++) {
      try {
        const rdoc = await fetchXML(buildUrl({ region: regionKey, q: "nations" }), false);
        if (seq !== openSeq || !root.isConnected) return;
        members = (text(rdoc, "NATIONS") || "").split(":").filter(Boolean);
      } catch (_) {  }
    }

    const cached = tradeTotalsCache.get(regionKey);
    if (cached && cached.at && Date.now() - cached.at < TRADE_CACHE_TTL_MS && members.length === cached.count) {
      finalizeEconomy(root, doc, e, seq, cached.totalOutput, cached.totalImports, members.length);
      return;
    }
    if (members.length === 1) {

      finalizeEconomy(root, doc, e, seq, e.output, e.imports, 1);
      return;
    }
    const renderEstimate = () => {
      if (seq !== openSeq || !root.isConnected) return;
      if (grid) grid.hidden = false;
      if (loader) loader.hidden = true;
      renderEconomy(root, e);
      renderEconomyChart(e);
    };
    if (!members.length) { renderEstimate(); return; }

    setLoader(root, "Computing region-wide trade totals…", "Exports are referenced to every nation of the region. The server reads the official daily census dump once and sums the export-related fields of all " + enLocale(members.length) + " members of " + regionName + ".", null, "");
    const server = await fetchServerTotals(regionKey);
    if (seq !== openSeq || !root.isConnected) return;
    if (server && server.count > 0 && server.totalOutput > 0 && Number.isFinite(server.totalImports)) {
      tradeTotalsCache.set(regionKey, { at: Date.now(), totalOutput: server.totalOutput, totalImports: server.totalImports, count: server.count });
      finalizeEconomy(root, doc, e, seq, server.totalOutput, server.totalImports, server.count);
      return;
    }

    setLoader(root, "Computing the economy report…", scanWhy(regionName, members.length), 0, "0/" + enLocale(members.length));
    runTradeScan(root, doc, e, seq, regionName, regionKey, members);
  }

  async function fetchServerTotals(regionKey) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60000);
      const res = await fetch(`/api/region-totals?region=${encodeURIComponent(regionKey)}`, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !(data.count > 0) || !Number.isFinite(data.totalOutput) || !Number.isFinite(data.totalImports) || data.totalOutput <= 0) return null;
      return data;
    } catch (_) { return null; }
  }

  function runTradeScan(root, doc, e, seq, regionName, regionKey, members) {
    const total = members.length;
    let settled = 0, good = 0;
    let totalOutput = 0, totalImports = 0;
    const show = () => {
      if (seq !== openSeq || !root.isConnected) return;
      setLoader(root, "Computing the economy report…", scanWhy(regionName, total), total ? (settled / total) * 100 : 100, `${enLocale(settled)}/${enLocale(total)}`);
    };
    show();

    const handle = (data) => {
      if (data && data.output > 0 && data.imports > 0) {
        totalOutput += data.output;
        totalImports += data.imports;
        good++;
      }
      settled++;
      if (settled % 10 === 0 || settled >= total) show();
      if (settled >= total) {
        if (seq !== openSeq || !root.isConnected) return;
        if (good && totalOutput > 0) {
          tradeTotalsCache.set(regionKey, { at: Date.now(), totalOutput, totalImports, count: total });
          finalizeEconomy(root, doc, e, seq, totalOutput, totalImports, total);
        } else {
          const grid = econGrid(root), loader = econLoader(root);
          if (grid) grid.hidden = false;
          if (loader) loader.hidden = true;
          renderEconomy(root, e);
          renderEconomyChart(e);
          setTradeNote(root, "Net trade: the region scan could not collect usable data; the local estimate is shown.");
        }
      }
    };

    members.forEach((m) => {
      fetchXML(buildUrl({ nation: m, q: TRADE_SHARDS }), false, "trade" + seq)
        .then((mdoc) => {
          if (!mdoc) return handle(null);
          try {
            const tax = Number(text(mdoc, "TAX"));
            const popRaw = text(mdoc, "POPULATION");
            if (!Number.isFinite(tax) || !popRaw) return handle(null);
            const me = economyReport(mdoc, popRaw, tax, govtScoresOf(mdoc));
            handle(me && Number.isFinite(me.output) && me.output > 0 && Number.isFinite(me.imports) ? me : null);
          } catch (_) { handle(null); }
        }, () => handle(null));
    });
  }

  function finalizeEconomy(root, doc, e, seq, totalOutput, totalImports, count) {
    if (seq !== openSeq || !root.isConnected) return;
    const pop = (Number(text(doc, "POPULATION")) || 0) * 1e6;
    const imports = e.imports;
    const exports = totalOutput > 0 ? totalImports * (e.output / totalOutput) : imports;
    const netTrade = Number.isFinite(exports) ? exports - imports : e.netTrade;
    e.exports = exports;
    e.imports = imports;
    e.netTrade = netTrade;
    e.gdp = e.consumption + netTrade + e.govExpend;
    if (pop > 0) {
      e.gdpCapita = e.gdp / pop;
      e.exchangeRate = nsExchangeRate(e.gdpCapita, e.production);
      const unemp = Math.pow(e.gdpCapita - 37500, 2) * 1.25e-10 - 1.5e-6 * Math.abs(e.gdpCapita - 37500) + 0.03;
      e.unemployment = Math.max(0, unemp);
    }
    const grid = econGrid(root), loader = econLoader(root);
    if (grid) grid.hidden = false;
    if (loader) loader.hidden = true;
    const note = tradeNote(root);
    if (note) note.hidden = true;
    renderEconomy(root, e);
    renderEconomyChart(e);
  }

  function enhanceNation(root, doc, scales, name) {

    const nationName = text(doc, "NAME") || name;
    if (nationName) linkField(root, "name", NS_NATION(nsName(nationName)));
    const region = text(doc, "REGION");
    if (region) linkField(root, "region", NS_REGION(nsName(region)));
    if (region) linkField(root, "side-region", NS_REGION(nsName(region)));

    const nationTax = Number(text(doc, "TAX"));
    const govtShares = parseGovtShares(doc);
    const gameCategory = text(doc, "CATEGORY") || "";
    const p = compassPoint(scales, { entityType: "nation", sectors: sectorSplit(doc), tax: Number.isFinite(nationTax) ? nationTax : undefined, govt: govtShares || undefined, category: gameCategory || undefined });
    const govtSpending = Array.from((doc.querySelector("GOVT")?.children || [])).map((c) => ({ label: humanizeTag(c.tagName), value: parseFloat(c.textContent) })).filter((s) => Number.isFinite(s.value));
    const policies = Array.from(doc.querySelectorAll("POLICIES POLICY NAME")).map((n) => n.textContent.trim()).filter(Boolean);
    const sectors = sectorSplit(doc);
    const ideo = ideologyFor(p, govtSpending, policies, sectors);

    root.__compassLive = { p, ideo, canvasId: "chart-polcompass", extras: { entityType: "nation", sectors: sectors || undefined, tax: Number.isFinite(nationTax) ? nationTax : undefined, govt: govtShares || undefined, category: gameCategory || undefined } };

    try { contributeExampleNation(nsName(name), ideo.name || ideo.quadrant); } catch (_) {}
    drawCompass("chart-polcompass", p);
    drawCompassMini(document.getElementById("chart-polcompass-mini"), p);
    fill(root, "ideology", ideo.name || ideo.quadrant);
    fill(root, "ideology-mini", ideo.name || ideo.quadrant);
    fill(root, "ideology-desc", ideo.desc);
    fillProgressive(root, p);
    renderCompassLegend(root);

    const tax = Number(text(doc, "TAX")) || 0;
    const e = economyReport(doc, text(doc, "POPULATION"), tax, govtSpending);
    e.tax = `${enLocale(tax)}%`;
    economyController(root, doc, e);
  }

  function enhanceRegion(root, doc, scales) {

    const regionName = text(doc, "NAME");
    if (regionName) linkField(root, "name", NS_REGION(nsName(regionName)));
    const founder = text(doc, "FOUNDER");
    if (founder && founder !== "0") linkField(root, "founder", NS_NATION(nsName(founder)));
    const governorName = text(doc, "GOVERNOR");
    if (governorName && governorName !== "0") linkField(root, "governor", NS_NATION(nsName(governorName)));
    const delegate = text(doc, "DELEGATE");
    if (delegate && delegate !== "0") linkField(root, "delegate", NS_NATION(nsName(delegate)));
    linkField(root, "side-delegate", NS_NATION(nsName(delegate)));

    const p = compassPoint(scales, { entityType: "region" });
    const ideo = ideologyFor(p);
    root.__compassLive = { p, ideo, canvasId: "chart-polcompass-region", extras: { entityType: "region" } };
    drawCompass("chart-polcompass-region", p);
    drawCompassMini(document.getElementById("chart-polcompass-region-mini"), p);
    fill(root, "ideology", ideo.name || ideo.quadrant);
    fill(root, "ideology-mini", ideo.name || ideo.quadrant);
    fill(root, "ideology-desc", ideo.desc);
    fillProgressive(root, p);
    renderCompassLegend(root);
  }

  function wireLinks(root) {
    root.querySelectorAll(".chip").forEach((chip) => {
      if (chip.dataset.linked) return;
      const raw = chip.textContent.trim();
      if (!raw || /^(\+|[+]?[0-9]+ more|No |None|Unknown|—)/.test(raw)) return;
      const name = raw.split(" (")[0].replace(/,? more not shown$/, "").trim();
      if (!name) return;
      const container = chip.closest("[data-f]");
      const cf = container ? container.getAttribute("data-f") : "";

      const regionTargets = ["embassies", "delegateauth-list", "policies-list", "delegateauth"];
      const nationTargets = ["roster", "officers-list", "delegateauth"];
      let href = null;
      if (cf === "embassies") href = NS_REGION(nsName(name));
      else if (cf === "roster" || cf === "officers-list") href = NS_NATION(nsName(name));
      else if (cf === "delegateauth-list" || cf === "policies-list") href = null;
      if (!href) return;
      const a = document.createElement("a");
      a.href = href; a.target = "_blank"; a.rel = "noopener"; a.textContent = raw;
      chip.textContent = ""; chip.appendChild(a); chip.dataset.linked = "1";
    });
  }

  const IDEO_HIST_SCALES = "0+1+2+27+8+32+45+62+48+49+28";
  const ideoHistCache = new Map();

  async function fetchIdeoHistory(entityType, entityName) {
    const params = { q: "census", scale: IDEO_HIST_SCALES, mode: "history" };
    if (entityType === "nation") params.nation = entityName;
    else if (entityType === "region") params.region = entityName;

    const doc = await fetchXML(buildUrl(params), false);
    const series = new Map();
    doc.querySelectorAll("SCALE").forEach((s) => {
      const id = Number(s.getAttribute("id"));
      if (!Number.isFinite(id)) return;
      const pts = [];
      s.querySelectorAll("POINT").forEach((p) => {
        const ts = Number(p.querySelector("TIMESTAMP")?.textContent);
        const v = Number(p.querySelector("SCORE")?.textContent);
        if (Number.isFinite(ts) && Number.isFinite(v)) pts.push({ t: ts, v });
      });
      pts.sort((a, b) => a.t - b.t);
      series.set(id, pts);
    });
    return series;
  }

  const ideoMonthKey = (t) => { const d = new Date(t * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
  const fmtMonth = (t) => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  const fmtMonthRange = (a, b) => (a === b ? fmtMonth(a) : `${fmtMonth(a)} – ${fmtMonth(b)}`);

  const IDEO_IDS = [0, 1, 2, 27, 8, 32, 45, 62, 48, 49, 28];

  function ideoTimeline(series, extras, liveP, entityType) {

    let est = null;
    const efSeries = series.get(48) || [];

    const efNowRaw = efSeries.length ? efSeries[efSeries.length - 1].v : liveP && liveP.econFreeRaw;
    if (extras && extras.sectors && liveP && Number.isFinite(efNowRaw) && Math.abs(efNowRaw - 50) > 1e-3) {
      const s = extras.sectors;
      const market = (s.private || 0) + (s.black || 0);
      const state = s.state || 0;
      const total = market + state;
      if (total > 0) est = { leanNow: Math.max(-1, Math.min(1, (market - state) / total)), efNow: efNowRaw };
    }

    const byMonth = new Map();
    IDEO_IDS.forEach((id) => {
      (series.get(id) || []).forEach(({ t, v }) => {
        const k = ideoMonthKey(t);
        let m = byMonth.get(k);
        if (!m) { m = { t, vals: {} }; byMonth.set(k, m); }
        m.vals[id] = v;
        if (t > m.t) m.t = t;
      });
    });
    const months = [...byMonth.values()].sort((a, b) => a.t - b.t);

    const last = {};
    months.forEach((m) => {
      IDEO_IDS.forEach((id) => {
        if (m.vals[id] == null && last[id] != null) m.vals[id] = last[id];
        if (m.vals[id] != null) last[id] = m.vals[id];
      });
    });
    return months.map((m) => {
      const scaleObjs = IDEO_IDS.filter((id) => m.vals[id] != null).map((id) => ({ id, score: m.vals[id] }));
      let extrasM = extras ? { ...extras } : { entityType };

      if (est && Number.isFinite(m.vals[48])) {
        const ratio = (m.vals[48] - 50) / (est.efNow - 50);
        const lean = Math.max(-1, Math.min(1, est.leanNow * ratio));
        extrasM.sectors = { state: (1 - lean) / 2, private: (1 + lean) / 2, black: 0 };
      }
      if (Number.isFinite(m.vals[49])) extrasM.tax = m.vals[49];
      else if (extrasM.tax == null) delete extrasM.tax;
      const p = compassPoint(scaleObjs, extrasM);
      const ideo = ideologyFor(p);
      return { t: m.t, p, name: ideo.name || ideo.quadrant, desc: ideo.desc, color: territoryColor(p) };
    });
  }

  function ideoRuns(months) {
    const runs = [];
    months.forEach((m, i) => {
      const cur = runs[runs.length - 1];
      if (cur && cur.name === m.name) { cur.end = i; cur.to = m.t; }
      else runs.push({ name: m.name, color: m.color, start: i, end: i, from: m.t, to: m.t });
    });
    return runs;
  }

  function paintCompassSnapshot(root, months, idx) {
    const live = root.__compassLive;
    if (!live) return;
    const wrap = root.querySelector("[data-ideo-hist]");
    const curEl = wrap && wrap.querySelector("[data-time-cur]");
    const lastIdx = months.length - 1;
    let p, ideo;
    if (idx == null || idx >= lastIdx) {
      p = live.p; ideo = live.ideo;
      if (curEl) curEl.textContent = `Now · ${fmtMonth(months[lastIdx].t)}`;
    } else {
      const m = months[idx];
      p = m.p;
      ideo = { name: m.name, desc: m.desc };
      if (curEl) curEl.textContent = fmtMonth(m.t);
    }
    drawCompass(live.canvasId, p, months.slice(0, idx + 1).map((m) => m.p));
    fillProgressive(root, p);
    fill(root, "ideology", ideo.name || ideo.quadrant);
    fill(root, "ideology-desc", ideo.desc);
  }

  function buildScrubber(root, months, runs) {
    const wrap = root.querySelector("[data-ideo-hist]");
    const scrub = wrap.querySelector("[data-time-scrub]");
    const range = wrap.querySelector("[data-time-range]");
    const band = wrap.querySelector("[data-time-band]");
    const minEl = wrap.querySelector("[data-time-min]");
    const maxEl = wrap.querySelector("[data-time-max]");
    const note = wrap.querySelector("[data-ideo-note]");
    if (!scrub || !range) return;
    const lastIdx = months.length - 1;
    range.max = String(lastIdx);
    range.value = String(lastIdx);
    minEl.textContent = fmtMonth(months[0].t);
    maxEl.textContent = fmtMonth(months[lastIdx].t);
    note.textContent = "";

    band.innerHTML = "";
    runs.forEach((r) => {
      const seg = document.createElement("button");
      seg.type = "button";
      seg.className = "time-scrub__seg";
      seg.title = `${r.name} — ${fmtMonthRange(r.from, r.to)}`;
      seg.setAttribute("aria-label", `${r.name}, ${fmtMonthRange(r.from, r.to)}`);
      seg.style.width = (((r.end - r.start + 1) / months.length) * 100) + "%";
      seg.style.background = r.color;
      seg.addEventListener("click", () => {
        range.value = String(r.start);
        paintCompassSnapshot(root, months, r.start);
      });
      band.appendChild(seg);
    });

    range.addEventListener("input", () => paintCompassSnapshot(root, months, Number(range.value)));
    scrub.hidden = false;

    const structEl = wrap.querySelector("[data-ideo-struct]");
    const live = root.__compassLive;
    if (structEl && live && live.extras && live.extras.sectors) {
      structEl.textContent = "Economic structure note: the state-owned vs private split of the economy has no census archive, so past months estimate it from this entity's Economic Freedom history, anchored to today's real split. Today's point always uses the real split.";
      structEl.hidden = false;
    }

    paintCompassSnapshot(root, months, lastIdx);
  }

  function initIdeoHistory(root) {
    const wrap = root.querySelector("[data-ideo-hist]");
    const note = wrap && wrap.querySelector("[data-ideo-note]");
    const live = root.__compassLive;
    if (!wrap || !note || !live) return;
    const dossier = root.querySelector(".dossier");
    const entityType = dossier && dossier.classList.contains("dossier--world") ? "world"
      : (dossier && dossier.classList.contains("dossier--region") ? "region" : "nation");
    const entityName = (root.querySelector('[data-f="name"]')?.textContent || "").trim();
    const cacheKey = `${entityType}|${entityName.toLowerCase()}`;

    const cached = ideoHistCache.get(cacheKey);
    if (cached && cached.months && cached.months.length) {
      buildScrubber(root, cached.months, cached.runs);
      return;
    }

    note.textContent = "Fetching the historical census series…";
    fetchIdeoHistory(entityType, entityName).then((series) => {

      if (!root.isConnected) return;
      const months = ideoTimeline(series, live.extras || undefined, live.p, entityType);
      if (months.length < 2) {
        note.textContent = "Not enough census history to rewind the compass yet.";
        return;
      }

      [0, 1, 2, 27].forEach((id) => {
        const pts = series.get(id);
        if (!pts || !pts.length) return;
        const k = histKey(entityType, entityName, id);
        if (!Array.isArray(historyCache.get(k))) historyCache.set(k, pts);
      });
      const runs = ideoRuns(months);
      ideoHistCache.set(cacheKey, { months, runs });
      buildScrubber(root, months, runs);
    }).catch(() => {
      if (root.isConnected) note.textContent = "Could not fetch the historical census series. Please try again.";
    });
  }

  const comparePanel = document.getElementById("compare-panel");
  let compareMode = "nation";
  document.querySelectorAll("#compare-panel .tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#compare-panel .tab").forEach((b) => { b.classList.remove("is-active"); b.setAttribute("aria-selected", "false"); });
      btn.classList.add("is-active"); btn.setAttribute("aria-selected", "true");
      compareMode = btn.dataset.cmpmode;
    });
  });

  const CMP_COLORS = { a: "#2E5C82", b: "#C9A227" };

  function cmpEntity(name, doc, p, side) {
    const el = document.createElement("div");
    el.className = `cmp-entity cmp-entity--${side}`;
    const flag = safeUrl(text(doc, "FLAG") || text(doc, "BANNERURL"));
    const nm = esc(text(doc, "NAME") || name);
    if (flag) el.insertAdjacentHTML("beforeend", `<img src="${esc(flag)}" alt="" />`);
    el.insertAdjacentHTML("beforeend", `<span class="cmp-entity__name">${nm}</span><span class="cmp-entity__quad">${quadrantOf(p)}</span>`);
    return el;
  }

  const CMP_HIST_SCALES = [...new Set(CENSUS_THEMES.flatMap((t) => t.ids))].sort((a, b) => a - b);
  const CMP_HIST_CHUNK = 10;
  function buildCompareHistory(host, entityType, nameA, nameB) {

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cmp-history__toggle";
    btn.textContent = "Show World Census trends";
    btn.setAttribute("aria-expanded", "false");
    const box = document.createElement("div");
    box.className = "cmp-history__panel";
    box.hidden = true;
    host.appendChild(btn); host.appendChild(box);
    const head = document.createElement("div");
    head.className = "cmp-history__head";
    const sel = document.createElement("select");
    sel.className = "cmp-history__select";
    CENSUS_THEMES.forEach((theme) => {
      const ids = theme.ids.filter((id) => CMP_HIST_SCALES.includes(id));
      if (!ids.length) return;
      const og = document.createElement("optgroup");
      og.label = theme.name;
      ids.forEach((id) => {
        const o = document.createElement("option");
        o.value = String(id);
        o.textContent = censusNameCache.get(id) || `World Census Scale #${id}`;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    const legend = document.createElement("span");
    legend.className = "cmp-history__legend";
    legend.innerHTML = `<span class="cmp-history__key"><span style="background:${CMP_COLORS.a}"></span>${esc(nameA)}</span><span class="cmp-history__key"><span style="background:${CMP_COLORS.b}"></span>${esc(nameB)}</span>`;
    head.appendChild(sel); head.appendChild(legend);
    box.appendChild(head);
    const chartWrap = document.createElement("div");
    chartWrap.className = "cmp-history__chart";
    const canvas = document.createElement("canvas");
    chartWrap.appendChild(canvas);
    box.appendChild(chartWrap);
    const status = document.createElement("div");
    status.className = "cmp-history__status";
    box.appendChild(status);

    let current = null;
    let lastSig = null;
    function renderScale(scaleId) {
      const ka = historyCache.get(histKey(entityType, nameA, scaleId));
      const kb = historyCache.get(histKey(entityType, nameB, scaleId));
      if (ka === "loading" || kb === "loading") {
        status.textContent = "Loading trend data…";
        lastSig = null;
        return;
      }
      const pa = Array.isArray(ka) ? ka : [];
      const pb = Array.isArray(kb) ? kb : [];
      if (!pa.length && !pb.length) { status.textContent = "No trend data available for this scale."; lastSig = null; if (current) { destroyChart(current); current = null; } return; }
      status.textContent = "";

      const atA = new Map(pa.map((p) => [p.t, p.v]));
      const atB = new Map(pb.map((p) => [p.t, p.v]));
      const ts = [...new Set([...pa, ...pb].map((p) => p.t))].sort((x, y) => x - y);

      const sig = `${scaleId}|${ts.length}|${pa.length}|${pb.length}|${ts[0]}`;
      if (sig === lastSig && current) return;
      lastSig = sig;
      if (current) destroyChart(current);
      current = new Chart(canvas, {
        type: "line",
        data: { labels: ts.map((t) => new Date(t * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" })), datasets: [
          { label: nameA, data: ts.map((t) => (atA.has(t) ? atA.get(t) : null)), borderColor: CMP_COLORS.a, backgroundColor: "rgba(46,92,130,0.10)", fill: false, tension: 0.25, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2, spanGaps: true },
          { label: nameB, data: ts.map((t) => (atB.has(t) ? atB.get(t) : null)), borderColor: CMP_COLORS.b, backgroundColor: "rgba(201,162,39,0.10)", fill: false, tension: 0.25, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2, spanGaps: true }
        ] },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: { mode: "index", intersect: false, callbacks: {
              title: (items) => (items.length ? new Date(ts[items[0].dataIndex] * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""),
              label: (c) => `${c.dataset.label}: ${c.parsed.y != null ? enLocale(c.parsed.y, { maximumFractionDigits: 2 }) : "—"}`
            } }
          },
          scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 9.5 } } },
            y: { grid: { color: cssVar("--chart-grid") }, ticks: { font: { size: 9.5 } } } }
        }
      });
      activeCharts.push(current);
    }
    sel.addEventListener("change", () => renderScale(Number(sel.value)));

    let started = false;
    function start() {
      if (started) return;
      started = true;

      for (let i = 0; i < CMP_HIST_SCALES.length; i += CMP_HIST_CHUNK) {
        prefetchCensusHistory(entityType, nameA, CMP_HIST_SCALES.slice(i, i + CMP_HIST_CHUNK));
        prefetchCensusHistory(entityType, nameB, CMP_HIST_SCALES.slice(i, i + CMP_HIST_CHUNK));
      }
      renderScale(Number(sel.value));

      const poll = setInterval(() => {
        renderScale(Number(sel.value));
        const stillLoading = CMP_HIST_SCALES.some((id) =>
          historyCache.get(histKey(entityType, nameA, id)) === "loading" ||
          historyCache.get(histKey(entityType, nameB, id)) === "loading");
        if (!stillLoading) clearInterval(poll);
      }, 500);
      setTimeout(() => clearInterval(poll), 60000);
    }
    btn.addEventListener("click", () => {
      const open = box.hidden;
      box.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      btn.textContent = open ? "Hide World Census trends" : "Show World Census trends";
      if (open) start();
      else if (current) { destroyChart(current); current = null; }
    });
  }

  async function compareRun() {
    const a = document.getElementById("cmp-input-a").value.trim();
    const b = document.getElementById("cmp-input-b").value.trim();
    if (!a || !b) { showBanner("Enter two names to compare.", "warn"); return; }
    const seq = ++openSeq;
    bumpTradeGroup();
    hideBanner();
    try {
      const [da, db] = await Promise.all([
        compareMode === "nation" ? fetchNation(a) : fetchRegionMain(a, true),
        compareMode === "nation" ? fetchNation(b) : fetchRegionMain(b, true)
      ]);
      if (seq !== openSeq) return;
      const sa = parseCensusScales(da), sb = parseCensusScales(db);
      const cmpType = compareMode === "nation" ? "nation" : "region";
      const pa = compassPoint(sa, { entityType: cmpType, sectors: sectorSplit(da) });
      const pb = compassPoint(sb, { entityType: cmpType, sectors: sectorSplit(db) });
      const byIdA = Object.fromEntries(sa.map((s) => [s.id, s]));
      const byIdB = Object.fromEntries(sb.map((s) => [s.id, s]));
      const nameA = text(da, "NAME") || a, nameB = text(db, "NAME") || b;

      $root.innerHTML = ""; destroyCharts();
      const wrap = document.createElement("div"); wrap.className = "cmp-result";

      const head = document.createElement("div"); head.className = "cmp-head";
      head.appendChild(cmpEntity(nameA, da, pa, "a"));
      const vs = document.createElement("div"); vs.className = "cmp-vs"; vs.textContent = "VS";
      head.appendChild(vs);
      head.appendChild(cmpEntity(nameB, db, pb, "b"));
      wrap.appendChild(head);

      const grid = document.createElement("div"); grid.className = "cmp-grid2";
      const c1 = document.createElement("div"); c1.className = "chart-box chart-box--square";
      const cv1 = document.createElement("canvas"); cv1.id = "chart-cmp-compass"; c1.appendChild(cv1);
      const c2 = document.createElement("div"); c2.className = "chart-box chart-box--square";
      const cv2 = document.createElement("canvas"); cv2.id = "chart-cmp-radar"; c2.appendChild(cv2);
      grid.appendChild(c1); grid.appendChild(c2);
      wrap.appendChild(grid);

      const cmpCensus = document.createElement("div");
      cmpCensus.className = "cmp-census";
      buildCompareHistory(cmpCensus, cmpType, nameA, nameB);
      wrap.appendChild(cmpCensus);
      $root.appendChild(wrap);

      drawCompassCmp(cv1, pa, pb, nameA, nameB);
      if (CHART_AVAILABLE) {

        const freedomLabels = ["Civil Rights", "Economy", "Political Freedom"];
        const chart = new Chart(cv2, {
          type: "radar",
          data: { labels: freedomLabels, datasets: [
            { label: nameA, data: [byIdA[0]?.score ?? 0, byIdA[1]?.score ?? 0, byIdA[2]?.score ?? 0], backgroundColor: "rgba(46,92,130,0.18)", borderColor: "#2E5C82", pointBackgroundColor: "#2E5C82", borderWidth: 2 },
            { label: nameB, data: [byIdB[0]?.score ?? 0, byIdB[1]?.score ?? 0, byIdB[2]?.score ?? 0], backgroundColor: "rgba(201,162,39,0.18)", borderColor: "#C9A227", pointBackgroundColor: "#C9A227", borderWidth: 2 }
          ] },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } } },
            scales: { r: { min: 0, max: 100, grid: { color: cssVar("--chart-grid") }, angleLines: { color: cssVar("--chart-grid") },
              pointLabels: { font: { size: 10.5 } }, ticks: { display: false } } }
          }
        });
        activeCharts.push(chart);
      }
      hideBanner();
      wrap.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      showBanner(err instanceof NSApiError ? err.message : (err.message || "Compare failed."), "error");
    }
  }
  const cmpRun = document.getElementById("compare-run");
  if (cmpRun) cmpRun.addEventListener("click", compareRun);

  const SPOT_REGIONS = ["The Pacific", "The North Pacific", "The South Pacific", "The East Pacific", "The West Pacific", "The Rejected Realms", "Lazarus", "Osiris", "Balder", "Cascadia", "Europeia", "10000 Islands"];
  function dayIndex() { const now = new Date(); const start = new Date(now.getFullYear(), 0, 0); const diff = now - start; return Math.floor(diff / 86400000); }

  function rosterCount(raw) {
    if (!raw) return 0;
    let c = 0, start = 0;
    for (;;) {
      const end = raw.indexOf(":", start);
      const tok = (end < 0 ? raw.slice(start) : raw.slice(start, end)).trim();
      if (tok) c++;
      if (end < 0) return c;
      start = end + 1;
    }
  }
  function nthRosterName(raw, idx) {
    if (!raw) return "";
    let start = 0, seen = 0;
    for (;;) {
      const end = raw.indexOf(":", start);
      const tok = (end < 0 ? raw.slice(start) : raw.slice(start, end)).trim();
      if (tok && seen++ === idx) return tok;
      if (end < 0) return "";
      start = end + 1;
    }
  }
  function pickDayNation(raw, dayIdx) {
    const count = rosterCount(raw);
    return count ? nthRosterName(raw, dayIdx % count) : "";
  }

  async function loadSpotlights() {
    const regionEl = document.getElementById("spot-region");
    const nationEl = document.getElementById("spot-nation");
    if (!regionEl || !nationEl) return;
    const rName = SPOT_REGIONS[dayIndex() % SPOT_REGIONS.length];

    const cacheKey = "ns_spot_day";
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (cached && cached.r === rName) {
        spotRegion = rName;
        spotNation = cached.nat || null;
        regionEl.innerHTML = `<strong>${esc(cached.rn)}</strong><small>${esc(enLocale(cached.n))} nations</small>`;
        nationEl.innerHTML = cached.nat
          ? `<strong>${esc(cached.nat.replace(/_/g, " "))}</strong><small>from ${esc(cached.rn)}</small>`
          : `<strong>${esc(cached.rn)}</strong><small>browse today's region</small>`;
        setPlaceholder();
        return;
      }
    } catch (_) {  }

    try {
      const rdoc = await fetchRegionMain(rName, false);
      const rn = text(rdoc, "NAME");
      const nNations = text(rdoc, "NUMNATIONS");
      const rosterRaw = text(rdoc, "NATIONS");
      const nName = pickDayNation(rosterRaw, dayIndex());
      spotRegion = rName;
      spotNation = nName || rName;
      regionEl.innerHTML = `<strong>${esc(rn)}</strong><small>${esc(enLocale(nNations))} nations</small>`;
      nationEl.innerHTML = nName
        ? `<strong>${esc(nName.replace(/_/g, " "))}</strong><small>from ${esc(rn)}</small>`
        : `<strong>${esc(rn)}</strong><small>browse today's region</small>`;
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ r: rName, rn, n: nNations, nat: nName }));
      } catch (_) {  }
    } catch (_) {
      regionEl.innerHTML = `<strong>Unavailable</strong>`;
      nationEl.innerHTML = `<strong>Unavailable</strong>`;
    }
    setPlaceholder();
  }

  const spotNationBtn = document.getElementById("spot-nation");
  const spotRegionBtn = document.getElementById("spot-region");
  if (spotNationBtn) spotNationBtn.addEventListener("click", () => { if (spotNation) openDossier("nation", spotNation); });
  if (spotRegionBtn) spotRegionBtn.addEventListener("click", () => { if (spotRegion) openDossier("region", spotRegion); });

  function societyLabel(t) {
    return t < 25 ? "Extremely liberal" : t < 40 ? "Liberal" : t < 55 ? "Mixed"
      : t < 75 ? "Traditional-leaning" : t < 92 ? "Very traditional" : "Extremely traditional";
  }

  function ideoScaleText(kind, id, cond) {
    if (kind === "govt") {
      const name = (GOVT_LABELS[id] || id) + " budget share";
      let c = name;
      if (cond.min != null) c += " ≥ " + cond.min + "%";
      if (cond.max != null) c += (cond.min != null ? " and " : " ") + "≤ " + cond.max + "%";
      return c;
    }
    if (kind === "category") {
      return "game category: " + cond.in.join(" / ");
    }
    const scale = PREF_SCALE[id] || `scale ${id}`;
    let c = scale;
    if (cond.min != null) c += " ≥ " + cond.min;
    if (cond.max != null) c += (cond.min != null ? " and " : " ") + "≤ " + cond.max;
    return c;
  }

  function altText(alt) {
    const parts = [];
    for (const kind of ["rank", "govt", "score", "category"]) {
      const m = alt[kind];
      if (!m) continue;
      if (kind === "category") { parts.push(ideoScaleText("category", null, m)); continue; }
      for (const idStr of Object.keys(m)) {
        parts.push(ideoScaleText(kind, idStr, m[idStr]));
      }
    }
    return parts.join(", ");
  }

  function sigText(name) {
    const alts = SIG[name];
    if (!alts || !alts.length) return "";
    return alts.map(altText).join("  ·  or  ·  ");
  }

  function prefsText(name) {
    const rules = PREFS[name];
    if (!rules) return "";
    const parts = [];
    for (const kind of ["rank", "govt"]) {
      const m = rules[kind];
      if (!m) continue;
      for (const idStr of Object.keys(m)) {
        parts.push(ideoScaleText(kind, idStr, m[idStr]));
      }
    }
    return parts.join(", ");
  }

  let ideoExamples = {
  "Anarcho-Capitalism": ["bane_of_dark_gods","kingdom_of_antarctica","kingdom_of_the_hawaiian_islands","the_cyberium_order","varian_anarchy","heesom-green","distribution","minarchists","nordic_south_africa","brasilienreich","oesterreich","definitely_not_communists","holy_western_cape","libertarian_spain","the_anarcho-monarchy","great_libertarian_union","anarchy_rules","populis_libertaria","jedi_council","the_federal_command_council","fort_utopia","proutopia","the_holy_empire_of_the_peoples_republic","chris-christie","holy_roman_empire_of_the_german_nation"],
  "Libertarianism": ["halsoni","differences-in-differences","grub","onodrin_gates","warzone_switz","inquisitor_iii","the_great_blue_reich","peoples_republic_of_eregion","empire_of_mint_alt","the_libertarian_states_of_xaivaria","distributionbergs","the_social_democratic_party","luminarchy","the_free_scandinavian_republics","nordicaea","reino_unido_nordico","astereich","fascist_fiume","honoured_blood_donor_of_the_ussr","peoples_teacher_of_the_ussr","holya","-the_catholic_kingdoms_of_spain-","cyberheavenland","super_libertarianism","libertarian_stoners","libertarian_freehold_of_mexico","anarchists_of_mars","renascentia_populi","gregman_conservative_party","federal_kingdom_of_yugoslavia","new_yugoslavia_and_bulgaria","huguitito_land","island_utopia","the_revolutionary_republic_of_china","the_people_of_hamilton","paleocrossing","euro_kimberly"],
  "Minarchism": ["the_holy_principality_of_saint_mark","malaxa","cyberpunkio","cyberpunk_dystopia","ecological_america","green_point_lighthouse","peoples_painter_of_the_ussr","swiss_vatican","technocratic_north_america","libertarian_british-african_oceania","ns_korea","swiss_germany"],
  "Paleolibertarianism": ["burjassot","hesperonis","the_alliance_of_conservatives","conservative_frank","dystopian_future_world_era_of_zimbabwae2","the_fourth_communist_lithuania_reich","honoured_military_pilot_of_the_ussr","the_holy_church_of_bridgeville","afton_robotic","anarchic_states_of_fredonia","national_populist_spain","neo_conservatism","etat_paleoconservato-libertaire_occitan","the_conservative_british_union","the_small_council","the_aryan_christianlands","brotherhood_vanguard","the_volkstaad"],
  "Classical Liberalism": ["tepertopia","axecapital","gashia","alduin_7","dhornaper63","leben_distel","earthbenders_peoples_republic","earthbender_peoples_republic","holy_ego","holy_roller-","sovereign_monarch","north_pacific_spy_agent_23","cyber_security","vinland_technocrats","ns_greenland","solidarity","hoh_overflow_population_common_food_but","conservative_league6","conservative_league8","conservative_league0","the_common_sense_conservative","plecotus_taivanus","sireco","reichtangle_or_not_reichtangle","a_grey_reich","kaiserreich_of_germany","the_capitalist_reich_of_sigmatown","communistcanada","holy_goo_phlanopia","holy_satty_koew","catholic_churches","holy_roman_emperor","anarchic_eraver","land_of_libertarians","anarchic_states_of_maldonol","conservative_league5","common_sense_conservative","conservative_league2","conservative_league4","conservative_league9","fiscal_conservative","conservative_dfstricts","biohazard_containment_council","free_nations_council","kline-christiv","the_democratic_republic_of_north_korea","ns_south_korea","volkwyn","ns_germany"],
  "Social Liberalism": ["picairn","drystar","the_republic_of_konsa","hertfordshire_and_jammbo","noton_mast","pantso","comnamao","the_empire_of_tau","dystopian_hegemony","aznazia","cybertronian_community","inevitable_poverty","the_atheists_reality"],
  "Fiscal Conservatism": ["kyorgia","hundermenschen","smargel","petea","fyodor_vladimirovich","the_grey_reich","hunter_colbourne","greenich_bay","christian_conservative_states","oligarch","bonney_corporate_conglomerate","world_lacrosse_communist","islamic_matheo","conservative_league7","conservative_estonia","previously_unaired_christmas","christian_matheo","federation_of_vanguard","south_western_korea_v2","russian_treefolk"],
  "Neoconservatism": ["kingdom_of_romar","byleth_von_hresvelg","the_communist_ottoman_state","oligarchy","holyberg","anarchist_rabbidia"],
  "Anarcho-Communism": ["muspelgard","the_islamic_state","lucian_tribal_union","the_syndicalist_union_of_britain","syndicalist_republic_of_america","syndicalist_republic_of_italy","syndicalist_commonwealth_of_america","combined_communes_of_syndicalia","islamo-anarchist_syndicates","trotskybergs","isc_solidarity","communist_afghanistan","anarchiat","anarchy1234567890","hippy_anarchists","east_northwestern_utopia_of_mr_peckles","south_western_east_utopia_of_mr_peckles"],
  "Anarcho-Syndicalism": ["courania","united_libertarian_federation"],
  "Anarcho-Pacifism": ["pland_adanna","the_soviet_union_of_peoples","proletarian_oblast"],
  "Anarcho-Primitivism": ["welfare_matheo"],
  "Libertarian Socialism": ["anarchadios"],
  "Mutualism": ["pasybfic","neo_populus","paripana_sporting_council","security_council_declaration_board"],
  "Communalism": ["anti-fascist_alliance"],
  "Participatory Socialism": ["karputsk","new_rogernomics","mark","luna_state","yoiiatin","arthropyria","soviet_enclave_of_america","russia_s_greater_soviet_union","soviet_socialist_republic_of_sweden","mao_tse_tung","the_holy_antlers","resurrected_empire_of_rome","hunter_polaris","the_high_wilderness","cybernetic_socialist_republics","syndicalist_commune_of_france","old_anarchisticstan","anarchij","mercian_anarchies","trotskya","co-operatives","esperonia","social_democrats","post_muslim_accepted_populace","perry_conglomerate","reichsbrazil","kaisereichs","soviet_socialist_systems","the_democratic_soviet_republic","dem_communist_socialist_rep_of_vietnam","communist_denmark","communist_freedom","communist_cakeist_party","social_communist_poland","soviet_technocracy_union","technocratic-european_countries","technocratic_israel","technocratic_republic_of_avalon","anarchitza","la_commune_anarchiste_de_france","repluci_popular_de_yukiep","councillor_republics","peoples_councils_of_latin_america","american_peoples_council_republics","patito_de_goma","yugoslav_republics","the_wealthy_federation_of_wake","east_utopia_of_mr_peckles","cearl_utopia","the_democratic_singularity","bolshevik_reassemblance","revolutionary_vanguard","peoples_korea","true_koreas_peoples_nation_of_democracy","sages_and_wisefolk","ekajyotivolke","old_german_owl_pigeon"],
  "Centrism": ["the_grand_dolphin","united_adaikes","noobbia","titopea","vanguardas"],
  "Solidarism": ["gary_the_cryptofascist","anti-communist","north_pacific_spy_agent_2","distributors","greater_belkan_reich","honoured_military_navigator_of_the_ussr","honoured_inventor_of_the_ussr","peoples_doctor_of_the_ussr","holy_lndia","republic_of_the_cyberverse","the_people_of_the_longhouse","kimlip","-german_shipyard-","german_national_team"],
  "Distributism": ["the_daria_hunter","thomas_hunter","grand_popular_reich"],
  "Ecomodernism": ["myehn","ethnoclashia","robotic_arts_center","populous_magnus","soviet_kns","ussr11","cyberegypt","inevitablility","the_devskian_revolutionary_republic","deutsch_volker"],
  "Ordoliberalism": ["onder_kelkia","sovietic_socialist_republics","greenbay_packers","islamic-emirate"],
  "Social Democracy": ["north_pacific_spy_agent_1","albonazia","greenbudcommunism"],
  "Fabian Socialism": ["the_kingdom_of_anthropia","cyberstrom"],
  "Democratic Socialism": ["madjack","crossia","federation_of_the_resentine_kingdom","the_united_royal_islands_of_euramathania","the_new_centro_states_of_china_and_nk","peoples_republic_o","reunified_jucheist_korea","communist_laos","neo_anarchy_togekiss","nordic_royal_state","keinviche_reich","the_prussianist_reich","soviet_chernarus","-the_ussr-","communist_land2","el_holy_salvador","united_technocratia","yugoslavs","southern_yugoslavia","the_people_the_exemplary","the_atheist_socialist_kingdom_of_america","temnivolk"],
  "Eco-Socialism": ["zoran","union_of_syndicalist_american_states","armenia_of_communism","communist_social_kazakhstan","anarchystar","the_hippie_utopia","church_of_tuvalu"],
  "Eurocommunism": ["peoples_republic_of_alistan","juche_corea","north_pacific_spy_agent_7","new_technocracy_incorporated","palestinian_popular_front","terreconia","ukrainian_sovietic_socialist_republic","christian_benford","norfolk_southern_railway"],
  "Religious Socialism": ["dragonian_kazaman","alvalero","eternal_raven","world_7401","north_pacific_spy_agent_22","barco_peronista","the_second_emmanuel","holy_meguca_meduka_empire","holy_aush_sul"],
  "One-Nation Conservatism": ["treekidistan","card_girl_17","juche_socialist_state","the_second_sky","valreisches_kaiserreich","vollereich","popular_islamica_do_wakhistao","popular_islamico_do_wakhistao","volkl_kendo_88"],
  "National Conservatism": ["dakota","the_upper_cilikar","fascistica","fabian_ruiz","freedom_for_populace","consterius_reich","reichengrad","balooseph_stalin","soviet_philippines","communist_state_of_nekotopia","coalition_of_communist_states","holy_matheo","unitedanarchist","republica_popular_do_sul","popular_islamico_de_wakhistao","popular_islamica_do_wakhistaos","conservative_galicia","bag_of_conservativish_words","nova_roma_christiana","the_church_of_matheo","bruderschaft_des_deutsche_volkes"],
  "Religious Nationalism": ["the_emergency_defense_council_of_britain"],
  "Religious Democracy": ["lion1893","greenowia","riemstagrads_second_country","popular_islamico_wakhistao","conservationist_republic","ghost_council_obzedat","christian_eriksen","kimonaj"],
  "Right-Wing Populism": ["the_soviet_republic_of_conservatives"],
  "Timocracy": ["neu-deutsches_reich"],
  "Authoritarianism": ["guhrayen","lionsroar","northern_kolechia","raj7765","reich_von_amerika","dwarf_reich","soviet_socialist_republic","socialists_and_communists","reicheisten","goose_reich","communist_birmingham","cybersun","the_peoples_collective_republic","the_peoples_free_democractic_democracy","united_great_korea"],
  "Technocracy": ["feux","tornagul","the_fascist_state_of_fairly_dupont","the_soviet_falk","liberpopuli"],
  "Constitutional Monarchism": ["earthly_cossack","austro-hungarian-prussia","catalan_popular_front","autonomous_yugoslav_region_of_thracia"],
  "Absolute Monarchism": ["the_yiddish_empire","the_first_grand_reich","patriotic_catholics","ard_al_islam","north_pacific_spy","goirem_dystopia","coc_the_scandinavian_union","enlightened_reich","vaticandome","a_holy_land","national_revolutionary_republic_of_china"],
  "Theocracy": ["ingermanland"],
  "Authoritarian Socialism": ["wang_yao","dragonian_alliance","east_durthang","kaiserreich_rheinpreussen","united_kingdom_of_british_isles","soviet_matheo","islamic_emirate_of_ukraine","world_leader_jerusalem","christian_yelich","angermanland"],
  "Communism": ["saharan_sappho","pierconium","varanius","narilamb","the_austrian_federal_reich","trop_reich","mundo_fascisto","the_fascist_european_territories","the_peoples_fascist_russia","j0eseph_stalin","juche_korea","juche_america","demokratik_juche_turkiye","the_confederate_communist_states","communist_heights","communistic_states_of_ruhland","communist_communist","catholic_scotland","starburst_hunter","ratten_reich","the_fascist_syndicate_of_britain","super_soviet_union","teh_2nd_soviet_union","the_epicmafian_communist_state","catholic_ammon","new_tito_yugoslavia","liberated_china_of_the_people","the_peoples_east_germany","the_peoples_republic_of_the_bahamas","great_proletarian_cultural_revolution","north_korea-chan","the_free_state_north_korea","volkerben","southern_german","germany-italy-japan"],
  "Maoism": ["unified_soviet_state_republic"],
  "Trotskyism": ["new_anarchisticstan","islandwalk","soviet_russia","korean_peoples_republic","north_pacific_spy_agent_8","north_pacific_spy_agent_17","leon_trotsky","dystopian_nuclear_winter","soviet_some","the_neosoviets","the_most_communist_soviets","communist_badgers","anarcho-communist_union","communist_soviet_states","bertangecommunism"],
  "Juche": ["the_people_of_the_withered_empire","the_new_vanguard"],
  "Authoritarian Capitalism": ["hurricane_mcmxciii","the_rhodesian_free_state","our_fascist_america","primitive_zimbabwe","alphabet_conglomerate","industrial_dystopia","dystopian_capitalism","the_conservative_states_of_america","imperial_federation_of_britannia","the_people_of_new_thebes","capitalist_republic_of_gulag","korfolk","german_communities","the_germanic_peoples_of_european_nations"],
  "Plutocracy": ["dyanderna","conservative-europe","conglomerated_tribes","solari_rackham"],
  "State Capitalism": ["ayuzhhhhh","the_fascist_republic_of_spain","dprk_empire","righteous_national_populations","santa_dystopia","the_free_economic_zone_of_new-vegas","holy_protaly"],
  "Fascism": ["an_islamic_world","socialist_communist_states"],
  "Clerical Fascism": ["the_repopulation_project","knowwear_in_youtopia"],
};
  function mergeIdeoExamples(server) {
    if (!server || typeof server !== "object") return;
    for (const k of Object.keys(server)) {
      const add = Array.isArray(server[k]) ? server[k] : null;
      if (!add || !add.length) continue;
      const cur = ideoExamples[k] || [];
      const merged = cur.slice();
      for (const nm of add) if (!merged.includes(nm)) merged.push(nm);
      ideoExamples[k] = merged;
    }
  }

  function applyLocalCorrections() {
    const local = loadLocalExamples();
    let changed = false;
    for (const [nation, ideo] of Object.entries(local)) {
      for (const name of Object.keys(ideoExamples)) {
        const list = ideoExamples[name];
        const idx = list.indexOf(nation);
        if (idx >= 0 && name !== ideo) { list.splice(idx, 1); changed = true; }
      }
      const pool = ideoExamples[ideo] || (ideoExamples[ideo] = []);
      if (!pool.includes(nation)) { pool.unshift(nation); changed = true; }
    }
    return changed;
  }

  let ideoExamplesRequested = false;
  function refreshIdeoExamples() {
    if (ideoExamplesRequested) return;
    ideoExamplesRequested = true;
    const today = dayIndex();
    try {
      const cached = JSON.parse(localStorage.getItem("nsde_ideo_examples") || "null");
      if (cached && cached.d === today && cached.examples) {
        mergeIdeoExamples(cached.examples);
        buildHelpIdeologyTable();
        return;
      }
    } catch (_) {  }
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, 10000);
    fetch("api/ideology-examples", { headers: { Accept: "application/json" }, signal: ctrl ? ctrl.signal : undefined })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unavailable"))))
      .then((d) => {
        if (!d || !d.examples) return;
        mergeIdeoExamples(d.examples);
        try { localStorage.setItem("nsde_ideo_examples", JSON.stringify({ d: today, examples: d.examples })); } catch (_) {}

        if (applyLocalCorrections()) {  }
        buildHelpIdeologyTable();
      })
      .catch(() => {  })
      .finally(() => clearTimeout(timer));
  }
  function exampleNationFor(ideology) {
    const pool = ideoExamples[ideology];
    if (!pool || !pool.length) return null;

    const local = loadLocalExamples();
    const verified = pool.filter((n) => local[n] === ideology);
    const source = verified.length ? verified : pool;
    return source[dayIndex() % source.length];
  }

  const LOCAL_EXAMPLES_KEY = "nsde_ideo_local_examples";
  function loadLocalExamples() {
    try { return JSON.parse(localStorage.getItem(LOCAL_EXAMPLES_KEY) || "{}") || {}; }
    catch (_) { return {}; }
  }
  function saveLocalExamples(local) {
    try { localStorage.setItem(LOCAL_EXAMPLES_KEY, JSON.stringify(local)); } catch (_) {}
  }
  function contributeExampleNation(nsName, ideologyName) {
    if (!nsName || !ideologyName || !IDEOLOGIES.some((r) => r[0] === ideologyName)) return;
    const local = loadLocalExamples();

    local[nsName] = ideologyName;

    for (const k of Object.keys(local)) {
      if (local[k] === nsName && k !== nsName) delete local[k];
    }
    saveLocalExamples(local);

    if (applyLocalCorrections()) buildHelpIdeologyTable();
  }
  function buildHelpIdeologyTable() {
    const countEl = document.getElementById("help-ideology-count");
    if (countEl) countEl.textContent = String(IDEOLOGIES.length);
    const tbody = document.getElementById("help-ideology-body");
    if (!tbody) return;
    tbody.innerHTML = "";
    [...IDEOLOGIES]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([name, family, x, y, tExp, rExp, note]) => {
      const tr = document.createElement("tr");

      const tdName = document.createElement("td");
      const nameLine = document.createElement("div");
      nameLine.className = "help-ideo-name";
      nameLine.textContent = name;
      tdName.appendChild(nameLine);
      const exLine = document.createElement("div");
      exLine.className = "help-ideo-example";
      const ex = exampleNationFor(name);
      if (ex) {
        exLine.textContent = "for example: ";
        const a = document.createElement("a");
        a.href = "#";
        a.textContent = ex.replace(/_/g, " ");
        a.addEventListener("click", (e) => {
          e.preventDefault();
          closeHelpDialog();
          openDossier("nation", ex);
        });
        exLine.appendChild(a);
      } else {
        exLine.textContent = "for example: (we are still searching for an example)";
        exLine.classList.add("muted");
      }
      tdName.appendChild(exLine);
      tr.appendChild(tdName);
      [
        family,
        `${x > 0 ? "+" : ""}${x} / ${y > 0 ? "+" : ""}${y}`,
        `${tExp}/100 — ${societyLabel(tExp)}`,
        rExp == null ? "—" : `${rExp}/100`,
        sigText(name) || "— (definitional label only)",
        prefsText(name) || "—",
        note
      ].forEach((c) => {
        const td = document.createElement("td");
        td.textContent = c;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }
  buildHelpIdeologyTable();
  refreshIdeoExamples();

  if (applyLocalCorrections()) buildHelpIdeologyTable();
  const helpOpen = document.getElementById("help-open");
  const helpDialog = document.getElementById("help-dialog");
  function closeHelpDialog() {
    if (!helpDialog) return;
    if (typeof helpDialog.close === "function") helpDialog.close();
    else helpDialog.removeAttribute("open");
  }
  if (helpOpen && helpDialog) {
    helpOpen.addEventListener("click", () => {
      if (typeof helpDialog.showModal === "function") helpDialog.showModal();
      else helpDialog.setAttribute("open", "");
    });
    helpDialog.querySelectorAll("[data-close-dialog]").forEach((b) => b.addEventListener("click", closeHelpDialog));

    helpDialog.addEventListener("click", (e) => { if (e.target === helpDialog) closeHelpDialog(); });

    helpDialog.addEventListener("keydown", (e) => { if (e.key === "Escape") closeHelpDialog(); });
  }

  function fmtElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 45) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) {
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      return m ? `${h} h ${m} min ago` : `${h} h ago`;
    }
    const d = Math.floor(s / 86400);
    if (d < 30) { const h = Math.floor((s % 86400) / 3600); return h ? `${d} d ${h} h ago` : `${d} d ago`; }
    return `${Math.floor(d / 30.44)} mo ago`;
  }
  function initUpdateTimer() {
    const el = document.getElementById("update-timer");
    const span = document.getElementById("update-elapsed");
    if (!el || !span) return;
    fetch("version.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no version.json"))))
      .then((d) => {
        const built = Number(new Date(d && d.built));
        if (!Number.isFinite(built) || built <= 0) throw new Error("bad built");
        el.hidden = false;
        el.title = "Last deployed " + new Date(built).toISOString();
        const tick = () => { span.textContent = fmtElapsed(Date.now() - built); };
        tick();
        setInterval(tick, 1000);
      })
      .catch(() => {  });
  }

  function applyTheme(dark) {
    document.documentElement.classList.toggle("theme-dark", dark);
    const btn = document.getElementById("theme-toggle");
    if (btn) { btn.textContent = dark ? "☀️" : "🌙"; btn.setAttribute("aria-pressed", String(dark)); }
    Chart.defaults.color = cssVar("--chart-text");
    Chart.defaults.borderColor = cssVar("--chart-border");

    if (window.__redrawOpenDossier) window.__redrawOpenDossier();
  }
  let darkMode = false;
  try { darkMode = localStorage.getItem("nsde_theme") === "dark"; } catch (_) {}
  applyTheme(darkMode);
  const themeBtn = document.getElementById("theme-toggle");
  if (themeBtn) themeBtn.addEventListener("click", () => {
    darkMode = !darkMode;
    try { localStorage.setItem("nsde_theme", darkMode ? "dark" : "light"); } catch (_) {}
    applyTheme(darkMode);
  });

  loadWorldTicker();
  tickClock();
  setInterval(tickClock, 1000);
  loadSpotlights();
  initUpdateTimer();
})();
