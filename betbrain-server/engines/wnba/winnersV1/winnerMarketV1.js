import {
  americanToImplied,
  noVigPair,
  normalizeBookId,
  normalizeWnbaTeam,
} from "./constants.js";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickAmerican(odd) {
  return num(odd?.bookOdds ?? odd?.odds ?? odd?.price ?? odd?.americanOdds);
}

function scanSgoOdds(event = {}) {
  const odds = event?.odds && typeof event.odds === "object" ? event.odds : {};
  const books = new Set();
  let homeMl = null;
  let awayMl = null;
  let sgoFairHome = null;
  let sgoFairAway = null;
  let spread = null;
  let total = null;
  for (const [oddId, odd] of Object.entries(odds)) {
    const id = String(oddId || odd?.oddID || "").toLowerCase();
    const stat = String(odd?.statID || "").toLowerCase();
    const side = String(odd?.sideID || odd?.statEntityID || "").toLowerCase();
    const byBook = odd?.byBookmaker && typeof odd.byBookmaker === "object" ? odd.byBookmaker : {};
    for (const bookId of Object.keys(byBook)) {
      const norm = normalizeBookId(bookId);
      if (norm && norm !== "prizepicks" && norm !== "underdog") books.add(norm);
    }
    const isMl = /moneyline|ml_|_ml|win-/.test(`${id} ${stat}`);
    if (isMl) {
      const price = pickAmerican(odd);
      if (side.includes("home") || id.includes("home")) homeMl = homeMl ?? price;
      if (side.includes("away") || id.includes("away")) awayMl = awayMl ?? price;
      const fair = num(odd?.fairOdds);
      if (fair != null) {
        if (side.includes("home") || id.includes("home")) sgoFairHome = sgoFairHome ?? americanToImplied(fair);
        if (side.includes("away") || id.includes("away")) sgoFairAway = sgoFairAway ?? americanToImplied(fair);
      }
    }
    if (/spread|handicap/.test(`${id} ${stat}`) && (side.includes("home") || id.includes("home"))) {
      spread = spread ?? num(odd?.bookOverUnder ?? odd?.overUnder ?? odd?.spread);
    }
    if (/total|overunder/.test(`${id} ${stat}`) && !/player/.test(`${id} ${stat}`)) {
      total = total ?? num(odd?.bookOverUnder ?? odd?.overUnder);
    }
  }
  return { homeMl, awayMl, sgoFairHome, sgoFairAway, spread, total, books: [...books] };
}

export function normalizeOddsApiH2h(event = {}, leagueBooks = []) {
  const books = new Set();
  const homePrices = [];
  const awayPrices = [];
  const homeName = event?.home_team || event?.homeTeam;
  const awayName = event?.away_team || event?.awayTeam;
  for (const book of event?.bookmakers || leagueBooks || []) {
    const nid = normalizeBookId(book?.key || book?.title);
    if (nid) books.add(nid);
    const market = (book?.markets || []).find((m) => String(m.key).toLowerCase() === "h2h");
    for (const out of market?.outcomes || []) {
      const name = String(out.name || "");
      if (homeName && name === homeName) homePrices.push(num(out.price));
      else if (awayName && name === awayName) awayPrices.push(num(out.price));
    }
  }
  const median = (arr) => {
    const xs = arr.filter((n) => n != null).sort((a, b) => a - b);
    if (!xs.length) return null;
    return xs[Math.floor(xs.length / 2)];
  };
  return {
    homeMoneyline: median(homePrices),
    awayMoneyline: median(awayPrices),
    books: [...books],
    homeTeam: normalizeWnbaTeam(homeName),
    awayTeam: normalizeWnbaTeam(awayName),
    commenceTime: event?.commence_time || event?.commenceTime || null,
    providerEventId: event?.id || null,
  };
}

export function mergeWinnerMarket({ oddsApi = null, sgo = null, fetchedAt = null } = {}) {
  const oddsScan = oddsApi ? normalizeOddsApiH2h(oddsApi) : null;
  const sgoScan = sgo ? scanSgoOdds(sgo) : null;
  const bookSet = new Set([...(oddsScan?.books || []), ...(sgoScan?.books || [])]);
  const oddsHealthy = Boolean(oddsScan?.homeMoneyline && oddsScan?.awayMoneyline);
  const sgoHealthy = Boolean(sgoScan?.homeMl && sgoScan?.awayMl);
  let moneylineSource = null;
  let eventSource = null;
  let marketFailoverUsed = false;
  if (oddsHealthy) {
    moneylineSource = "ODDS_API";
    eventSource = "ODDS_API";
  } else if (sgoHealthy) {
    moneylineSource = "SPORTSGAMEODDS";
    eventSource = sgo?.eventID ? "SPORTSGAMEODDS" : eventSource;
    marketFailoverUsed = true;
  }
  if (sgo?.eventID && !eventSource) eventSource = "SPORTSGAMEODDS";
  if (oddsApi?.id && !eventSource) eventSource = "ODDS_API";

  const homeMoneyline = oddsHealthy ? oddsScan.homeMoneyline : sgoScan?.homeMl ?? null;
  const awayMoneyline = oddsHealthy ? oddsScan.awayMoneyline : sgoScan?.awayMl ?? null;
  const impliedHome = americanToImplied(homeMoneyline);
  const impliedAway = americanToImplied(awayMoneyline);
  const vig = noVigPair(impliedHome, impliedAway);

  return {
    homeMoneyline,
    awayMoneyline,
    impliedHome,
    impliedAway,
    noVigHome: vig.a,
    noVigAway: vig.b,
    spread: sgoScan?.spread ?? null,
    total: sgoScan?.total ?? null,
    sgoFairHome: sgoScan?.sgoFairHome ?? null,
    sgoFairAway: sgoScan?.sgoFairAway ?? null,
    books: [...bookSet],
    bookCount: bookSet.size,
    bookSources: [...bookSet],
    providerSources: [oddsHealthy && "ODDS_API", sgo && "SPORTSGAMEODDS"].filter(Boolean),
    eventSource: eventSource || "ESPN",
    moneylineSource,
    secondaryMarketSources: [oddsHealthy && sgo ? "SPORTSGAMEODDS" : null, !oddsHealthy && oddsApi ? "ODDS_API" : null].filter(Boolean),
    providerEventIds: {
      oddsApi: oddsApi?.id || null,
      sgo: sgo?.eventID || null,
    },
    providerFetchedAt: fetchedAt,
    marketFailoverUsed,
    marketQuality: bookSet.size >= 4 ? 80 : bookSet.size >= 2 ? 60 : bookSet.size === 1 ? 40 : 0,
    fetchedAt,
  };
}
