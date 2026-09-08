"use strict";

const CATEGORY_IDEO = {
  "Anarchy":                         ["Anarcho-Capitalism", "Libertarianism"],
  "Libertarian Police State":        [],
  "Democratic Socialists":           ["Democratic Socialism", "Market Socialism"],
  "Iron Fist Socialists":            ["Stalinism", "State Atheism"],
  "Corrupt Dictatorship":            ["Stalinism"],
  "Authoritarian Democracy":         ["Jacobinism", "Constitutional Monarchism"],
  "Left-wing Utopia":                ["Council Communism", "Luxemburgism"],
  "Civil Rights Lovefest":           ["Anarcho-Communism", "Libertarian Socialism"],
  "Scandinavian Liberal Paradise":   ["Social Democracy"],
  "Liberal Democratic Socialists":   ["Left-Wing Populism", "Democratic Socialism"],
  "Father Knows Best State":         ["Paleoconservatism", "Religious Nationalism"],
  "Moralistic Democracy":            ["Religious Democracy"],
  "Conservative Democracy":          ["Paleoconservatism", "National Conservatism"],
  "Right-wing Utopia":               ["Fiscal Conservatism", "Neoconservatism"],
  "Capitalist Paradise":             ["Libertarianism", "Minarchism"],
  "Compulsory Consumerist State":    ["State Capitalism"],
  "Corporate Bordello":              ["Plutocracy", "Anarcho-Capitalism"],
  "Capitalizt":                      ["Anarcho-Capitalism"],
  "Psychotic Dictatorship":          ["Neo-Fascism", "Nazism", "Stalinism"],
  "Benevolent Dictatorship":         [],
  "Constitutional Monarchy":         ["Constitutional Monarchism"],
  "Absolute Monarchy":               ["Absolute Monarchism"],
  "Corporate Police State":          ["Authoritarian Capitalism", "Plutocracy"],
  "New York Times Democracy":        ["Social Liberalism"],
  "Liberal Democratic Socialists":   ["Left-Wing Populism"],
  "Tyrannic Police State":           ["Neo-Fascism", "Stalinism"]
};

const MAX_CANDIDATES_PER_IDEOLOGY = 25;

function norm(s) {
  return String(s || "").toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

function field(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : "";
}

function freedomScore(block, tag) {
  const wrap = block.match(/<FREEDOMSCORES>([\s\S]*?)<\/FREEDOMSCORES>/);
  if (!wrap) return NaN;
  const m = wrap[1].match(new RegExp(`<${tag}>(-?\\d+(?:\\.\\d+)?)<\\/${tag}>`));
  return m ? parseFloat(m[1]) : NaN;
}

function mineScore(ideo, block) {
  const name = norm(field(block, "NAME"));
  const category = field(block, "CATEGORY");
  const cr = freedomScore(block, "CIVILRIGHTS");
  const econ = freedomScore(block, "ECONOMY");
  const pf = freedomScore(block, "POLITICALFREEDOM");
  const crN = Number.isFinite(cr) ? cr : 50;
  const econN = Number.isFinite(econ) ? econ : 50;
  const pfN = Number.isFinite(pf) ? pf : 50;

  const catIdeos = CATEGORY_IDEO[category] || [];
  if (!catIdeos.includes(ideo)) return 0;

  if (ideo === "Council Communism" || ideo === "Luxemburgism") {
    if (crN < 40 || pfN < 40) return 0;
  }
  if (ideo === "Market Socialism" && crN < 45) return 0;
  if (ideo === "Jacobinism" && (crN < 20 || pfN < 30)) return 0;
  return sortScore(ideo, crN, econN, pfN);
}

function sortScore(ideo, cr, econ, pf) {
  const auth = (ideo === "Stalinism" || ideo === "State Atheism" || ideo === "Neo-Fascism"
    || ideo === "Nazism" || ideo === "Jacobinism" || ideo === "Paleoconservatism" || ideo === "Peronism");
  const collect = (ideo === "Council Communism" || ideo === "Luxemburgism" || ideo === "Market Socialism"
    || ideo === "Degrowth" || ideo === "Left-Wing Populism");
  const liberty = collect ? (cr + pf) / 2 : 100 - (cr + pf) / 2;
  return liberty * 1.0 + (auth ? econ * 0.2 : (100 - econ) * 0.1);
}

function mineBlock(block) {
  const out = [];
  const category = field(block, "CATEGORY");
  const catIdeos = CATEGORY_IDEO[category] || [];
  for (const ideo of catIdeos) {
    if (mineScore(ideo, block) > 0) out.push(ideo);
  }
  return out;
}

function capCandidates(mined) {
  const out = {};
  for (const [ideo, pairs] of Object.entries(mined)) {
    const best = new Map();
    for (const [name, score] of pairs) {
      const prev = best.get(name) || 0;
      if (score > prev) best.set(name, score);
    }
    out[ideo] = [...best.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CANDIDATES_PER_IDEOLOGY)
      .map(([name]) => name);
  }
  return out;
}

module.exports = { mineBlock, mineScore, capCandidates, CATEGORY_IDEO, MAX_CANDIDATES_PER_IDEOLOGY };
