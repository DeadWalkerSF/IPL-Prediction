const { createAnalytics } = require('./analytics');
const path = require('path');

const db = createAnalytics({
  matchesPath: path.join(__dirname, 'matches.csv'),
  deliveriesPath: path.join(__dirname, 'deliveries.csv')
});

const report = db.buildBacktest();
console.log(`Current Architecture`);
console.log(`Accuracy: ${report.summary.rawAccuracy}% -> ${report.summary.accuracy}%`);
console.log(`Log Loss: ${report.summary.rawLogLoss} -> ${report.summary.logLoss}`);
console.log(`Brier Score: ${report.summary.rawBrierScore} -> ${report.summary.brierScore}`);
