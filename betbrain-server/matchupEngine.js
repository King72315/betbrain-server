export function calcMatchupAdjustment({
  last5Overall = [],
  opponentGames = [],
  stat = "Points",
}) {
  const getStatValue = (game) => {
    if (stat === "Points") return Number(game.points || 0);
    if (stat === "Rebounds") return Number(game.rebounds || 0);
    if (stat === "Assists") return Number(game.assists || 0);
    if (stat === "Threes") return Number(game.threes || 0);
    return 0;
  };

  const overallValues = last5Overall
    .map(getStatValue)
    .filter((v) => Number.isFinite(v) && v > 0);

  const matchupValues = opponentGames
    .map(getStatValue)
    .filter((v) => Number.isFinite(v) && v > 0);

  if (overallValues.length < 3 || matchupValues.length < 2) {
  return {
    matchupAverage: 0,
    overallAverage: 0,
    difference: 0,
    projectionAdjustment: null,
    confidenceAdjustment: null,
    reason:
      "No direct matchup history - continue defense engine",
  };
}

  const avg = (arr) =>
    arr.reduce((sum, v) => sum + v, 0) / arr.length;

  const overallAverage = avg(overallValues);
  const matchupAverage = avg(matchupValues);
  const difference = matchupAverage - overallAverage;

  let weight = 0.25;

  if (matchupValues.length >= 5) weight = 0.45;
  else if (matchupValues.length >= 3) weight = 0.35;

  const projectionAdjustment = difference * weight;

  let confidenceAdjustment = 0;

  if (difference >= 5) confidenceAdjustment = 4;
  else if (difference >= 3) confidenceAdjustment = 2;
  else if (difference <= -5) confidenceAdjustment = -5;
  else if (difference <= -3) confidenceAdjustment = -3;

  return {
    matchupAverage: Number(matchupAverage.toFixed(1)),
    overallAverage: Number(overallAverage.toFixed(1)),
    difference: Number(difference.toFixed(1)),
    projectionAdjustment: Number(projectionAdjustment.toFixed(1)),
    confidenceAdjustment,
    reason:
      difference > 0
        ? `Player performs better against this opponent by ${difference.toFixed(1)} ${stat}`
        : `Player performs worse against this opponent by ${Math.abs(difference).toFixed(1)} ${stat}`,
  };
}