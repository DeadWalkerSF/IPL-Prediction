const path = require("path");
const { createAnalytics } = require("./analytics");

function formatPercent(value, decimals = 1) {
  return `${Number(value || 0).toFixed(decimals)}%`;
}

const database = createAnalytics({
  matchesPath: path.join(__dirname, "matches.csv"),
  deliveriesPath: path.join(__dirname, "deliveries.csv")
});

const report = database.buildBacktest();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log("IPL Match Studio Probability Backtest");
console.log("");
console.log(`Type: ${report.summary.evaluationType}`);
console.log(`Coverage: ${formatPercent(report.summary.coverage)} (${report.summary.evaluatedMatches}/${report.summary.totalMatches} matches)`);
console.log(`Accuracy: ${report.summary.rawAccuracy}% -> ${report.summary.accuracy}%`);
console.log(`Average confidence: ${formatPercent(report.summary.rawAverageConfidence)} -> ${formatPercent(report.summary.averageConfidence)}`);
console.log(`Brier score: ${report.summary.rawBrierScore} -> ${report.summary.brierScore}`);
console.log(`Log loss: ${report.summary.rawLogLoss} -> ${report.summary.logLoss}`);
console.log(`Calibration gap: ${report.summary.rawCalibrationGap} pts -> ${report.summary.calibrationGap} pts`);
console.log(`Minimum prior matches per team: ${report.summary.minimumMatchesPerTeam}`);
console.log(`Uses actual toss winner: ${report.summary.usesActualTossWinner ? "yes" : "no"}`);
console.log(`Calibrator: ${report.calibrationModel.method} (slope ${report.calibrationModel.slope}, intercept ${report.calibrationModel.intercept})`);
console.log("");
console.log("Calibration");
console.table(report.calibration.map(bucket => ({
  Bucket: bucket.label,
  Matches: bucket.count,
  Predicted: formatPercent(bucket.avgPredicted),
  Actual: formatPercent(bucket.actualRate),
  Gap: `${bucket.gap.toFixed(1)} pts`
})));
console.log("Recent replayed predictions");
console.table(report.recentPredictions.map(item => ({
  Date: item.date,
  Match: item.match,
  Predicted: item.predictedWinner,
  Actual: item.actualWinner,
  Confidence: `${item.confidence}%`,
  Result: item.result
})));
