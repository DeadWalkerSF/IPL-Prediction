const fs = require("fs");

const TEAM_ALIASES = {
  "Delhi Daredevils": "Delhi Capitals",
  "Kings XI Punjab": "Punjab Kings",
  "Royal Challengers Bangalore": "Royal Challengers Bengaluru",
  "Rising Pune Supergiant": "Rising Pune Supergiants"
};

const NON_BOWLER_DISMISSALS = new Set([
  "run out",
  "retired hurt",
  "retired out",
  "obstructing the field"
]);

function canonicalizeTeam(team) {
  return TEAM_ALIASES[team] || team;
}

function seasonSortValue(season) {
  const match = String(season || "").match(/\d{4}/);
  return match ? Number(match[0]) : 0;
}

function parseDateValue(dateString) {
  const value = Date.parse(dateString);
  return Number.isNaN(value) ? 0 : value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function logit(probability) {
  const clipped = clamp(probability, 1e-6, 1 - 1e-6);
  return Math.log(clipped / (1 - clipped));
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toPercent(value) {
  return Math.round(clamp(value, 0, 1) * 100);
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function safeDivide(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function ensureMapEntry(map, key, createValue) {
  if (!map.has(key)) {
    map.set(key, createValue());
  }
  return map.get(key);
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
}

function parseCsv(content) {
  const lines = content
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.length > 0);

  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    return row;
  });
}

function createPhaseRecord() {
  return {
    runs: 0,
    balls: 0,
    wickets: 0,
    dotBalls: 0,
    boundaries: 0
  };
}

function createAggregateRecord() {
  return {
    runs: 0,
    balls: 0,
    wickets: 0,
    dotBalls: 0,
    boundaries: 0,
    fours: 0,
    sixes: 0,
    phases: {
      powerplay: createPhaseRecord(),
      middle: createPhaseRecord(),
      death: createPhaseRecord()
    }
  };
}

function createVenueTeamRecord() {
  return {
    matches: 0,
    wins: 0,
    runsFor: 0,
    ballsFor: 0,
    wicketsLost: 0,
    runsAgainst: 0,
    ballsAgainst: 0,
    wicketsTaken: 0
  };
}

function createSeasonRecord() {
  return {
    matches: 0,
    wins: 0,
    runsFor: 0,
    runsAgainst: 0
  };
}

function createRivalryRecord() {
  return {
    matches: 0,
    wins: 0,
    runsFor: 0,
    runsAgainst: 0
  };
}

function createBatterRecord(name) {
  return {
    player: name,
    runs: 0,
    balls: 0,
    outs: 0,
    fours: 0,
    sixes: 0,
    matches: new Set()
  };
}

function createBowlerRecord(name) {
  return {
    player: name,
    balls: 0,
    runsConceded: 0,
    wickets: 0,
    dotBalls: 0,
    matches: new Set()
  };
}

function createPlayerRecord(name) {
  return {
    name,
    batting: createBatterRecord(name),
    bowling: createBowlerRecord(name),
    teams: new Map(),
    awards: 0
  };
}

function createTeamContributionRecord() {
  return {
    battingRuns: 0,
    bowlingWickets: 0,
    matches: new Set()
  };
}

function createVenueRecord(name) {
  return {
    name,
    matches: 0,
    totalRuns: 0,
    firstInningsRuns: 0,
    teamWins: new Map()
  };
}

function createTeamRecord(name) {
  return {
    name,
    matches: 0,
    wins: 0,
    losses: 0,
    tossesWon: 0,
    tossConversions: 0,
    venues: new Map(),
    seasons: new Map(),
    headToHead: new Map(),
    recentMatches: [],
    battingTotals: createAggregateRecord(),
    bowlingTotals: createAggregateRecord(),
    batters: new Map(),
    bowlers: new Map()
  };
}

function createMatchTeamState(teamName) {
  return {
    team: teamName,
    batting: createAggregateRecord(),
    bowling: createAggregateRecord()
  };
}

function createMatchState(match) {
  return {
    match,
    teams: new Map([
      [match.team1, createMatchTeamState(match.team1)],
      [match.team2, createMatchTeamState(match.team2)]
    ])
  };
}

function getPhase(overNumber) {
  if (overNumber < 6) {
    return "powerplay";
  }

  if (overNumber < 15) {
    return "middle";
  }

  return "death";
}

function countsAsLegalBall(delivery) {
  return delivery.extrasType !== "wides" && delivery.extrasType !== "noballs";
}

function countsAsBatterBall(delivery) {
  return delivery.extrasType !== "wides";
}

function getBowlerRuns(delivery) {
  if (delivery.extrasType === "byes" || delivery.extrasType === "legbyes") {
    return delivery.totalRuns - delivery.extraRuns;
  }

  return delivery.totalRuns;
}

function isBowlerWicket(delivery) {
  return delivery.isWicket && !NON_BOWLER_DISMISSALS.has(delivery.dismissalKind);
}

function updateAggregateRecord(record, payload) {
  record.runs += payload.runs;
  record.balls += payload.balls;
  record.wickets += payload.wickets;
  record.dotBalls += payload.dotBalls;
  record.boundaries += payload.boundaries;
  record.fours += payload.fours;
  record.sixes += payload.sixes;

  const phaseRecord = record.phases[payload.phase];
  phaseRecord.runs += payload.runs;
  phaseRecord.balls += payload.balls;
  phaseRecord.wickets += payload.wickets;
  phaseRecord.dotBalls += payload.dotBalls;
  phaseRecord.boundaries += payload.boundaries;
}

function addBattingContribution(record, delivery) {
  record.runs += delivery.batsmanRuns;
  record.balls += delivery.batterBall ? 1 : 0;
  record.fours += delivery.batsmanRuns === 4 ? 1 : 0;
  record.sixes += delivery.batsmanRuns === 6 ? 1 : 0;
  record.matches.add(delivery.matchId);
}

function addBowlingContribution(record, delivery) {
  record.balls += delivery.legalBall ? 1 : 0;
  record.runsConceded += delivery.bowlerRuns;
  record.wickets += delivery.bowlerWicket ? 1 : 0;
  record.dotBalls += delivery.legalBall && delivery.totalRuns === 0 ? 1 : 0;
  record.matches.add(delivery.matchId);
}

function addDismissal(record, matchId) {
  record.outs += 1;
  record.matches.add(matchId);
}

function getRunRate(runs, balls) {
  return balls ? runs / (balls / 6) : 0;
}

function getStrikeRate(runs, balls) {
  return balls ? (runs / balls) * 100 : 0;
}

function getAverage(runs, outs) {
  return outs ? runs / outs : runs;
}

function getDotRate(dotBalls, balls) {
  return safeDivide(dotBalls, balls);
}

function getBoundaryRate(boundaries, balls) {
  return safeDivide(boundaries, balls);
}

function getPhaseRunRate(aggregate, phaseName) {
  const phase = aggregate.phases[phaseName];
  return getRunRate(phase.runs, phase.balls);
}

function getPhaseDotRate(aggregate, phaseName) {
  const phase = aggregate.phases[phaseName];
  return getDotRate(phase.dotBalls, phase.balls);
}

function buildRange(values) {
  const filtered = values.filter(value => Number.isFinite(value));
  if (filtered.length === 0) {
    return { min: 0, max: 1 };
  }

  return {
    min: Math.min(...filtered),
    max: Math.max(...filtered)
  };
}

function normalizeFromRange(value, range, invert = false) {
  if (!range || range.max === range.min) {
    return 0.5;
  }

  const ratio = clamp((value - range.min) / (range.max - range.min), 0, 1);
  return invert ? 1 - ratio : ratio;
}

function average(values) {
  const filtered = values.filter(value => Number.isFinite(value));
  if (filtered.length === 0) {
    return 0;
  }

  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function fitProbabilityCalibrator(samples) {
  const usableSamples = samples.filter(sample =>
    Number.isFinite(sample.probability) &&
    Number.isFinite(sample.actual)
  );

  if (usableSamples.length === 0) {
    return { method: "identity", slope: 1, intercept: 0 };
  }

  let slope = 1;
  let intercept = 0;
  const iterations = 1800;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const learningRate = 0.08 / Math.sqrt(iteration + 1);
    let gradientSlope = 0;
    let gradientIntercept = 0;

    usableSamples.forEach(sample => {
      const prediction = sigmoid((logit(sample.probability) * slope) + intercept);
      const error = prediction - sample.actual;
      gradientSlope += error * logit(sample.probability);
      gradientIntercept += error;
    });

    gradientSlope /= usableSamples.length;
    gradientIntercept /= usableSamples.length;
    slope -= learningRate * gradientSlope;
    intercept -= learningRate * gradientIntercept;
  }

  return {
    method: "platt",
    slope: round(slope, 4),
    intercept: round(intercept, 4)
  };
}

function applyProbabilityCalibrator(probability, calibrator) {
  if (!calibrator || calibrator.method === "identity") {
    return clamp(probability, 1e-6, 1 - 1e-6);
  }

  return clamp(sigmoid((logit(probability) * calibrator.slope) + calibrator.intercept), 1e-6, 1 - 1e-6);
}

function appendRecentMatchSummary(teamRecord, match, state, oppositionState, won, opponent) {
  teamRecord.recentMatches.push({
    date: match.date,
    dateValue: match.dateValue,
    season: match.season,
    venue: match.venue,
    opponent,
    won,
    batting: {
      runs: state.batting.runs,
      balls: state.batting.balls,
      wickets: state.batting.wickets,
      runRate: round(getRunRate(state.batting.runs, state.batting.balls), 2),
      powerplayRunRate: round(getPhaseRunRate(state.batting, "powerplay"), 2),
      deathRunRate: round(getPhaseRunRate(state.batting, "death"), 2)
    },
    bowling: {
      runs: state.bowling.runs,
      balls: state.bowling.balls,
      wickets: state.bowling.wickets,
      economy: round(getRunRate(state.bowling.runs, state.bowling.balls), 2),
      dotRate: round(getDotRate(state.bowling.dotBalls, state.bowling.balls), 3),
      deathEconomy: round(getPhaseRunRate(state.bowling, "death"), 2)
    },
    scoreline: {
      team: state.batting.runs,
      opponent: oppositionState.batting.runs
    }
  });
}

function loadMatches(matchesPath) {
  const content = fs.readFileSync(matchesPath, "utf8");
  const rows = parseCsv(content);

  return rows
    .map(row => {
      const team1 = canonicalizeTeam(row.team1.trim());
      const team2 = canonicalizeTeam(row.team2.trim());
      const winner = canonicalizeTeam((row.winner || "").trim());
      const tossWinner = canonicalizeTeam((row.toss_winner || "").trim());
      const venue = (row.venue || row.city || "Unknown venue").trim();
      const playerOfMatch = (row.player_of_match || "").trim();

      if (!team1 || !team2 || !winner || winner === "NA") {
        return null;
      }

      if (winner !== team1 && winner !== team2) {
        return null;
      }

      return {
        id: row.id,
        season: row.season.trim(),
        city: (row.city || "").trim(),
        date: row.date.trim(),
        dateValue: parseDateValue(row.date.trim()),
        matchType: row.match_type.trim(),
        venue,
        team1,
        team2,
        tossWinner,
        tossDecision: (row.toss_decision || "").trim(),
        winner,
        playerOfMatch: playerOfMatch && playerOfMatch !== "NA" ? playerOfMatch : null
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.dateValue !== right.dateValue) {
        return left.dateValue - right.dateValue;
      }
      return Number(left.id) - Number(right.id);
    });
}

function loadDeliveries(deliveriesPath) {
  const content = fs.readFileSync(deliveriesPath, "utf8");
  const rows = parseCsv(content);

  return rows.map(row => {
    const extrasType = (row.extras_type || "").trim();
    const batsmanRuns = toNumber(row.batsman_runs);
    const totalRuns = toNumber(row.total_runs);
    const extraRuns = toNumber(row.extra_runs);
    const dismissalKind = (row.dismissal_kind || "").trim().toLowerCase();

    const delivery = {
      matchId: row.match_id,
      inning: toNumber(row.inning),
      battingTeam: canonicalizeTeam((row.batting_team || "").trim()),
      bowlingTeam: canonicalizeTeam((row.bowling_team || "").trim()),
      over: toNumber(row.over),
      batter: (row.batter || "").trim(),
      bowler: (row.bowler || "").trim(),
      batsmanRuns,
      extraRuns,
      totalRuns,
      extrasType,
      isWicket: row.is_wicket === "1",
      playerDismissed: row.player_dismissed && row.player_dismissed !== "NA" ? row.player_dismissed.trim() : "",
      dismissalKind
    };

    delivery.legalBall = countsAsLegalBall(delivery);
    delivery.batterBall = countsAsBatterBall(delivery);
    delivery.bowlerRuns = getBowlerRuns(delivery);
    delivery.bowlerWicket = isBowlerWicket(delivery);
    delivery.phase = getPhase(delivery.over);
    return delivery;
  });
}

function createAnalytics({ matchesPath, deliveriesPath }) {
  const matches = loadMatches(matchesPath);
  const deliveries = loadDeliveries(deliveriesPath);

  const teams = new Map();
  const players = new Map();
  const venues = new Map();
  const seasons = new Set();
  const matchLookup = new Map(matches.map(match => [match.id, match]));
  const matchStates = new Map(matches.map(match => [match.id, createMatchState(match)]));
  const deliveriesByMatch = new Map();

  deliveries.forEach(delivery => {
    ensureMapEntry(deliveriesByMatch, delivery.matchId, () => []).push(delivery);
  });

  matches.forEach(match => {
    seasons.add(match.season);

    const team1Record = ensureMapEntry(teams, match.team1, () => createTeamRecord(match.team1));
    const team2Record = ensureMapEntry(teams, match.team2, () => createTeamRecord(match.team2));
    const venueRecord = ensureMapEntry(venues, match.venue, () => createVenueRecord(match.venue));

    [team1Record, team2Record].forEach(teamRecord => {
      teamRecord.matches += 1;

      if (teamRecord.name === match.winner) {
        teamRecord.wins += 1;
      } else {
        teamRecord.losses += 1;
      }

      if (teamRecord.name === match.tossWinner) {
        teamRecord.tossesWon += 1;
        if (teamRecord.name === match.winner) {
          teamRecord.tossConversions += 1;
        }
      }

      const venueStats = ensureMapEntry(teamRecord.venues, match.venue, createVenueTeamRecord);
      venueStats.matches += 1;
      if (teamRecord.name === match.winner) {
        venueStats.wins += 1;
      }

      const seasonStats = ensureMapEntry(teamRecord.seasons, match.season, createSeasonRecord);
      seasonStats.matches += 1;
      if (teamRecord.name === match.winner) {
        seasonStats.wins += 1;
      }

      const opponent = teamRecord.name === match.team1 ? match.team2 : match.team1;
      const rivalryStats = ensureMapEntry(teamRecord.headToHead, opponent, createRivalryRecord);
      rivalryStats.matches += 1;
      if (teamRecord.name === match.winner) {
        rivalryStats.wins += 1;
      }
    });

    venueRecord.matches += 1;
    ensureMapEntry(venueRecord.teamWins, match.winner, () => ({ wins: 0 })).wins += 1;

    if (match.playerOfMatch) {
      const playerRecord = ensureMapEntry(players, match.playerOfMatch, () => createPlayerRecord(match.playerOfMatch));
      playerRecord.awards += 1;
    }
  });

  deliveries.forEach(delivery => {
    const match = matchLookup.get(delivery.matchId);
    if (!match) {
      return;
    }

    if (!teams.has(delivery.battingTeam) || !teams.has(delivery.bowlingTeam)) {
      return;
    }

    const battingTeamRecord = teams.get(delivery.battingTeam);
    const bowlingTeamRecord = teams.get(delivery.bowlingTeam);
    const battingVenueRecord = battingTeamRecord.venues.get(match.venue);
    const bowlingVenueRecord = bowlingTeamRecord.venues.get(match.venue);
    const battingSeasonRecord = battingTeamRecord.seasons.get(match.season);
    const bowlingSeasonRecord = bowlingTeamRecord.seasons.get(match.season);
    const battingRivalryRecord = battingTeamRecord.headToHead.get(delivery.bowlingTeam);
    const bowlingRivalryRecord = bowlingTeamRecord.headToHead.get(delivery.battingTeam);
    const venueRecord = venues.get(match.venue);
    const matchState = matchStates.get(match.id);
    const battingState = ensureMapEntry(matchState.teams, delivery.battingTeam, () => createMatchTeamState(delivery.battingTeam));
    const bowlingState = ensureMapEntry(matchState.teams, delivery.bowlingTeam, () => createMatchTeamState(delivery.bowlingTeam));
    const boundaryCount = delivery.batsmanRuns === 4 || delivery.batsmanRuns === 6 ? 1 : 0;

    const battingPayload = {
      runs: delivery.totalRuns,
      balls: delivery.legalBall ? 1 : 0,
      wickets: delivery.isWicket ? 1 : 0,
      dotBalls: delivery.legalBall && delivery.totalRuns === 0 ? 1 : 0,
      boundaries: boundaryCount,
      fours: delivery.batsmanRuns === 4 ? 1 : 0,
      sixes: delivery.batsmanRuns === 6 ? 1 : 0,
      phase: delivery.phase
    };

    const bowlingPayload = {
      runs: delivery.totalRuns,
      balls: delivery.legalBall ? 1 : 0,
      wickets: delivery.isWicket ? 1 : 0,
      dotBalls: delivery.legalBall && delivery.totalRuns === 0 ? 1 : 0,
      boundaries: boundaryCount,
      fours: delivery.batsmanRuns === 4 ? 1 : 0,
      sixes: delivery.batsmanRuns === 6 ? 1 : 0,
      phase: delivery.phase
    };

    updateAggregateRecord(battingTeamRecord.battingTotals, battingPayload);
    updateAggregateRecord(bowlingTeamRecord.bowlingTotals, bowlingPayload);
    updateAggregateRecord(battingState.batting, battingPayload);
    updateAggregateRecord(bowlingState.bowling, bowlingPayload);

    battingVenueRecord.runsFor += delivery.totalRuns;
    battingVenueRecord.ballsFor += delivery.legalBall ? 1 : 0;
    battingVenueRecord.wicketsLost += delivery.isWicket ? 1 : 0;
    battingVenueRecord.runsAgainst += 0;
    battingVenueRecord.ballsAgainst += 0;

    bowlingVenueRecord.runsAgainst += delivery.totalRuns;
    bowlingVenueRecord.ballsAgainst += delivery.legalBall ? 1 : 0;
    bowlingVenueRecord.wicketsTaken += delivery.isWicket ? 1 : 0;

    battingSeasonRecord.runsFor += delivery.totalRuns;
    bowlingSeasonRecord.runsAgainst += delivery.totalRuns;
    battingRivalryRecord.runsFor += delivery.totalRuns;
    bowlingRivalryRecord.runsAgainst += delivery.totalRuns;

    venueRecord.totalRuns += delivery.totalRuns;
    if (delivery.inning === 1) {
      venueRecord.firstInningsRuns += delivery.totalRuns;
    }

    if (delivery.batter) {
      const teamBatter = ensureMapEntry(battingTeamRecord.batters, delivery.batter, () => createBatterRecord(delivery.batter));
      addBattingContribution(teamBatter, delivery);

      const playerRecord = ensureMapEntry(players, delivery.batter, () => createPlayerRecord(delivery.batter));
      addBattingContribution(playerRecord.batting, delivery);

      const teamContribution = ensureMapEntry(playerRecord.teams, delivery.battingTeam, () => ({
        battingRuns: 0,
        bowlingWickets: 0,
        matches: new Set()
      }));
      teamContribution.battingRuns += delivery.batsmanRuns;
      teamContribution.matches.add(match.id);
    }

    if (delivery.playerDismissed) {
      const teamBatter = ensureMapEntry(battingTeamRecord.batters, delivery.playerDismissed, () => createBatterRecord(delivery.playerDismissed));
      addDismissal(teamBatter, match.id);

      const playerRecord = ensureMapEntry(players, delivery.playerDismissed, () => createPlayerRecord(delivery.playerDismissed));
      addDismissal(playerRecord.batting, match.id);

      const teamContribution = ensureMapEntry(playerRecord.teams, delivery.battingTeam, () => ({
        battingRuns: 0,
        bowlingWickets: 0,
        matches: new Set()
      }));
      teamContribution.matches.add(match.id);
    }

    if (delivery.bowler) {
      const teamBowler = ensureMapEntry(bowlingTeamRecord.bowlers, delivery.bowler, () => createBowlerRecord(delivery.bowler));
      addBowlingContribution(teamBowler, delivery);

      const playerRecord = ensureMapEntry(players, delivery.bowler, () => createPlayerRecord(delivery.bowler));
      addBowlingContribution(playerRecord.bowling, delivery);

      const teamContribution = ensureMapEntry(playerRecord.teams, delivery.bowlingTeam, () => ({
        battingRuns: 0,
        bowlingWickets: 0,
        matches: new Set()
      }));
      teamContribution.bowlingWickets += delivery.bowlerWicket ? 1 : 0;
      teamContribution.matches.add(match.id);
    }
  });

  matches.forEach(match => {
    const matchState = matchStates.get(match.id);
    const team1State = matchState.teams.get(match.team1) || createMatchTeamState(match.team1);
    const team2State = matchState.teams.get(match.team2) || createMatchTeamState(match.team2);

    [
      {
        team: match.team1,
        opponent: match.team2,
        state: team1State,
        oppositionState: team2State,
        won: match.winner === match.team1
      },
      {
        team: match.team2,
        opponent: match.team1,
        state: team2State,
        oppositionState: team1State,
        won: match.winner === match.team2
      }
    ].forEach(entry => {
      const teamRecord = teams.get(entry.team);
      appendRecentMatchSummary(teamRecord, match, entry.state, entry.oppositionState, entry.won, entry.opponent);
    });
  });

  const seasonList = Array.from(seasons).sort((left, right) => seasonSortValue(left) - seasonSortValue(right));
  const latestSeason = seasonList[seasonList.length - 1];

  function getOverallRate(teamRecord) {
    return safeDivide(teamRecord.wins, teamRecord.matches);
  }

  function getTossConversion(teamRecord) {
    return {
      tossesWon: teamRecord.tossesWon,
      winsAfterToss: teamRecord.tossConversions,
      rate: teamRecord.tossesWon ? teamRecord.tossConversions / teamRecord.tossesWon : 0.5
    };
  }

  function summarizeBattingAggregate(aggregate, matchesCount = 1) {
    return {
      matches: matchesCount,
      runs: aggregate.runs,
      balls: aggregate.balls,
      wickets: aggregate.wickets,
      runRate: round(getRunRate(aggregate.runs, aggregate.balls), 2),
      avgScore: round(safeDivide(aggregate.runs, matchesCount), 1),
      boundaryRate: round(getBoundaryRate(aggregate.boundaries, aggregate.balls), 3),
      dotRate: round(getDotRate(aggregate.dotBalls, aggregate.balls), 3),
      powerplayRunRate: round(getPhaseRunRate(aggregate, "powerplay"), 2),
      deathRunRate: round(getPhaseRunRate(aggregate, "death"), 2)
    };
  }

  function summarizeBowlingAggregate(aggregate, matchesCount = 1) {
    return {
      matches: matchesCount,
      runs: aggregate.runs,
      balls: aggregate.balls,
      wickets: aggregate.wickets,
      economy: round(getRunRate(aggregate.runs, aggregate.balls), 2),
      wicketsPerMatch: round(safeDivide(aggregate.wickets, matchesCount), 2),
      dotRate: round(getDotRate(aggregate.dotBalls, aggregate.balls), 3),
      deathEconomy: round(getPhaseRunRate(aggregate, "death"), 2),
      powerplayEconomy: round(getPhaseRunRate(aggregate, "powerplay"), 2)
    };
  }

  function summarizeBatter(record) {
    return {
      player: record.player,
      runs: record.runs,
      balls: record.balls,
      outs: record.outs,
      matches: record.matches.size,
      fours: record.fours,
      sixes: record.sixes,
      strikeRate: round(getStrikeRate(record.runs, record.balls), 1),
      average: round(getAverage(record.runs, record.outs), 1),
      boundaryRate: round(getBoundaryRate(record.fours + record.sixes, record.balls), 3)
    };
  }

  function summarizeBowler(record) {
    return {
      player: record.player,
      balls: record.balls,
      runsConceded: record.runsConceded,
      wickets: record.wickets,
      matches: record.matches.size,
      dotBalls: record.dotBalls,
      economy: round(getRunRate(record.runsConceded, record.balls), 2),
      dotRate: round(getDotRate(record.dotBalls, record.balls), 3),
      strikeRate: round(safeDivide(record.balls, record.wickets), 1)
    };
  }

  const teamRangeSource = Array.from(teams.values()).map(teamRecord => ({
    battingRunRate: getRunRate(teamRecord.battingTotals.runs, teamRecord.battingTotals.balls),
    avgScore: safeDivide(teamRecord.battingTotals.runs, teamRecord.matches),
    boundaryRate: getBoundaryRate(teamRecord.battingTotals.boundaries, teamRecord.battingTotals.balls),
    bowlingEconomy: getRunRate(teamRecord.bowlingTotals.runs, teamRecord.bowlingTotals.balls),
    dotRate: getDotRate(teamRecord.bowlingTotals.dotBalls, teamRecord.bowlingTotals.balls),
    wicketsPerMatch: safeDivide(teamRecord.bowlingTotals.wickets, teamRecord.matches),
    powerplayRunRate: getPhaseRunRate(teamRecord.battingTotals, "powerplay"),
    deathRunRate: getPhaseRunRate(teamRecord.battingTotals, "death"),
    deathEconomy: getPhaseRunRate(teamRecord.bowlingTotals, "death")
  }));

  const playerSummaries = Array.from(players.values()).map(playerRecord => ({
    name: playerRecord.name,
    batting: summarizeBatter(playerRecord.batting),
    bowling: summarizeBowler(playerRecord.bowling),
    awards: playerRecord.awards,
    strongestTeam: Array.from(playerRecord.teams.entries())
      .map(([team, stats]) => ({
        team,
        contribution: stats.battingRuns + (stats.bowlingWickets * 24)
      }))
      .sort((left, right) => right.contribution - left.contribution)[0]
  }));

  const teamRanges = {
    battingRunRate: buildRange(teamRangeSource.map(item => item.battingRunRate)),
    avgScore: buildRange(teamRangeSource.map(item => item.avgScore)),
    boundaryRate: buildRange(teamRangeSource.map(item => item.boundaryRate)),
    bowlingEconomy: buildRange(teamRangeSource.map(item => item.bowlingEconomy)),
    dotRate: buildRange(teamRangeSource.map(item => item.dotRate)),
    wicketsPerMatch: buildRange(teamRangeSource.map(item => item.wicketsPerMatch)),
    powerplayRunRate: buildRange(teamRangeSource.map(item => item.powerplayRunRate)),
    deathRunRate: buildRange(teamRangeSource.map(item => item.deathRunRate)),
    deathEconomy: buildRange(teamRangeSource.map(item => item.deathEconomy))
  };

  const batterPool = playerSummaries.filter(player => player.batting.balls >= 30);
  const bowlerPool = playerSummaries.filter(player => player.bowling.balls >= 24);

  const playerRanges = {
    batterRuns: buildRange(batterPool.map(player => player.batting.runs)),
    batterStrikeRate: buildRange(batterPool.map(player => player.batting.strikeRate)),
    batterAverage: buildRange(batterPool.map(player => player.batting.average)),
    batterBoundaryRate: buildRange(batterPool.map(player => player.batting.boundaryRate)),
    bowlerWickets: buildRange(bowlerPool.map(player => player.bowling.wickets)),
    bowlerEconomy: buildRange(bowlerPool.map(player => player.bowling.economy)),
    bowlerDotRate: buildRange(bowlerPool.map(player => player.bowling.dotRate))
  };

  function buildTeamRangesFor(sourceTeams) {
    const rangeSource = Array.from(sourceTeams.values()).map(teamRecord => ({
      battingRunRate: getRunRate(teamRecord.battingTotals.runs, teamRecord.battingTotals.balls),
      avgScore: safeDivide(teamRecord.battingTotals.runs, teamRecord.matches),
      boundaryRate: getBoundaryRate(teamRecord.battingTotals.boundaries, teamRecord.battingTotals.balls),
      bowlingEconomy: getRunRate(teamRecord.bowlingTotals.runs, teamRecord.bowlingTotals.balls),
      dotRate: getDotRate(teamRecord.bowlingTotals.dotBalls, teamRecord.bowlingTotals.balls),
      wicketsPerMatch: safeDivide(teamRecord.bowlingTotals.wickets, teamRecord.matches),
      powerplayRunRate: getPhaseRunRate(teamRecord.battingTotals, "powerplay"),
      deathRunRate: getPhaseRunRate(teamRecord.battingTotals, "death"),
      deathEconomy: getPhaseRunRate(teamRecord.bowlingTotals, "death")
    }));

    return {
      battingRunRate: buildRange(rangeSource.map(item => item.battingRunRate)),
      avgScore: buildRange(rangeSource.map(item => item.avgScore)),
      boundaryRate: buildRange(rangeSource.map(item => item.boundaryRate)),
      bowlingEconomy: buildRange(rangeSource.map(item => item.bowlingEconomy)),
      dotRate: buildRange(rangeSource.map(item => item.dotRate)),
      wicketsPerMatch: buildRange(rangeSource.map(item => item.wicketsPerMatch)),
      powerplayRunRate: buildRange(rangeSource.map(item => item.powerplayRunRate)),
      deathRunRate: buildRange(rangeSource.map(item => item.deathRunRate)),
      deathEconomy: buildRange(rangeSource.map(item => item.deathEconomy))
    };
  }

  function buildPlayerRangesFor(sourcePlayers) {
    const sourceSummaries = Array.from(sourcePlayers.values()).map(playerRecord => ({
      name: playerRecord.name,
      batting: summarizeBatter(playerRecord.batting),
      bowling: summarizeBowler(playerRecord.bowling)
    }));
    const sourceBatters = sourceSummaries.filter(player => player.batting.balls >= 30);
    const sourceBowlers = sourceSummaries.filter(player => player.bowling.balls >= 24);

    return {
      batterRuns: buildRange(sourceBatters.map(player => player.batting.runs)),
      batterStrikeRate: buildRange(sourceBatters.map(player => player.batting.strikeRate)),
      batterAverage: buildRange(sourceBatters.map(player => player.batting.average)),
      batterBoundaryRate: buildRange(sourceBatters.map(player => player.batting.boundaryRate)),
      bowlerWickets: buildRange(sourceBowlers.map(player => player.bowling.wickets)),
      bowlerEconomy: buildRange(sourceBowlers.map(player => player.bowling.economy)),
      bowlerDotRate: buildRange(sourceBowlers.map(player => player.bowling.dotRate))
    };
  }

  function getRecentSummary(teamRecord, sampleSize = 5) {
    const recentMatches = teamRecord.recentMatches.slice(-sampleSize);
    return {
      sampleSize: recentMatches.length,
      wins: recentMatches.filter(match => match.won).length,
      rate: safeDivide(recentMatches.filter(match => match.won).length, recentMatches.length),
      streak: recentMatches.map(match => (match.won ? "W" : "L")),
      battingRunRate: average(recentMatches.map(match => match.batting.runRate)),
      avgScore: average(recentMatches.map(match => match.batting.runs)),
      bowlingEconomy: average(recentMatches.map(match => match.bowling.economy)),
      dotRate: average(recentMatches.map(match => match.bowling.dotRate)),
      wicketsPerMatch: average(recentMatches.map(match => match.bowling.wickets)),
      powerplayRunRate: average(recentMatches.map(match => match.batting.powerplayRunRate)),
      deathRunRate: average(recentMatches.map(match => match.batting.deathRunRate)),
      deathEconomy: average(recentMatches.map(match => match.bowling.deathEconomy))
    };
  }

  function getVenueSummary(teamRecord, venue) {
    const venueStats = teamRecord.venues.get(venue);
    if (!venueStats || venueStats.matches === 0) {
      return {
        matches: 0,
        wins: 0,
        rate: getOverallRate(teamRecord),
        runRate: getRunRate(teamRecord.battingTotals.runs, teamRecord.battingTotals.balls),
        avgScore: safeDivide(teamRecord.battingTotals.runs, teamRecord.matches),
        economy: getRunRate(teamRecord.bowlingTotals.runs, teamRecord.bowlingTotals.balls)
      };
    }

    return {
      matches: venueStats.matches,
      wins: venueStats.wins,
      rate: safeDivide(venueStats.wins, venueStats.matches),
      runRate: round(getRunRate(venueStats.runsFor, venueStats.ballsFor), 2),
      avgScore: round(safeDivide(venueStats.runsFor, venueStats.matches), 1),
      economy: round(getRunRate(venueStats.runsAgainst, venueStats.ballsAgainst), 2)
    };
  }

  function getHeadToHeadSummary(teamRecord, opponent) {
    const rivalry = teamRecord.headToHead.get(opponent);
    if (!rivalry || rivalry.matches === 0) {
      return {
        matches: 0,
        wins: 0,
        rate: getOverallRate(teamRecord)
      };
    }

    return {
      matches: rivalry.matches,
      wins: rivalry.wins,
      rate: safeDivide(rivalry.wins, rivalry.matches)
    };
  }

  function getBatterScoreForRanges(summary, currentPlayerRanges) {
    return average([
      normalizeFromRange(summary.runs, currentPlayerRanges.batterRuns),
      normalizeFromRange(summary.strikeRate, currentPlayerRanges.batterStrikeRate),
      normalizeFromRange(summary.average, currentPlayerRanges.batterAverage),
      normalizeFromRange(summary.boundaryRate, currentPlayerRanges.batterBoundaryRate)
    ]);
  }

  function getBowlerScore(summary) {
    return getBowlerScoreForRanges(summary, playerRanges);
  }

  function getBatterScore(summary) {
    return getBatterScoreForRanges(summary, playerRanges);
  }

  function getBowlerScoreForRanges(summary, currentPlayerRanges) {
    return average([
      normalizeFromRange(summary.wickets, currentPlayerRanges.bowlerWickets),
      normalizeFromRange(summary.economy, currentPlayerRanges.bowlerEconomy, true),
      normalizeFromRange(summary.dotRate, currentPlayerRanges.bowlerDotRate)
    ]);
  }

  function getPlayerChoicesForRanges(teamRecord, currentPlayerRanges, limit = 8) {
    const playerNames = new Set([...teamRecord.batters.keys(), ...teamRecord.bowlers.keys()]);

    return Array.from(playerNames)
      .map(playerName => {
        const batterRecord = teamRecord.batters.get(playerName);
        const bowlerRecord = teamRecord.bowlers.get(playerName);
        const batterSummary = batterRecord ? summarizeBatter(batterRecord) : null;
        const bowlerSummary = bowlerRecord ? summarizeBowler(bowlerRecord) : null;
        const battingScore = batterSummary && batterSummary.balls >= 12 ? getBatterScoreForRanges(batterSummary, currentPlayerRanges) : 0;
        const bowlingScore = bowlerSummary && bowlerSummary.balls >= 12 ? getBowlerScoreForRanges(bowlerSummary, currentPlayerRanges) : 0;
        const score = battingScore && bowlingScore
          ? Math.max((battingScore + bowlingScore) / 2, battingScore, bowlingScore)
          : Math.max(battingScore, bowlingScore);

        const role = battingScore >= bowlingScore
          ? (bowlingScore >= 0.32 ? "All-rounder" : "Batter")
          : (battingScore >= 0.32 ? "All-rounder" : "Bowler");

        const label = batterSummary
          ? `${playerName} | ${role} | ${batterSummary.runs} runs | SR ${batterSummary.strikeRate}`
          : `${playerName} | ${role} | ${bowlerSummary.wickets} wickets | Eco ${bowlerSummary.economy}`;

        return {
          value: playerName,
          label,
          player: playerName,
          role,
          score,
          batting: batterSummary,
          bowling: bowlerSummary
        };
      })
      .sort((left, right) => right.score - left.score || left.player.localeCompare(right.player))
      .slice(0, limit);
  }

  function getPlayerChoices(teamRecord, limit = 8) {
    return getPlayerChoicesForRanges(teamRecord, playerRanges, limit);
  }

  function getSelectedPlayerForRanges(teamRecord, currentPlayerRanges, playerName) {
    const options = getPlayerChoicesForRanges(teamRecord, currentPlayerRanges, 12);
    return options.find(option => option.player === playerName) || options[0] || {
      player: null,
      role: "Unknown",
      score: 0,
      batting: null,
      bowling: null
    };
  }

  function getSelectedPlayer(teamRecord, playerName) {
    return getSelectedPlayerForRanges(teamRecord, playerRanges, playerName);
  }

  function serializeTeam(teamRecord) {
    const recent = getRecentSummary(teamRecord, 5);
    const topPlayer = getPlayerChoices(teamRecord, 1)[0] || null;
    const topBowler = Array.from(teamRecord.bowlers.values())
      .map(summarizeBowler)
      .sort((left, right) => right.wickets - left.wickets || left.economy - right.economy)[0];

    return {
      team: teamRecord.name,
      matches: teamRecord.matches,
      wins: teamRecord.wins,
      losses: teamRecord.losses,
      winRate: toPercent(getOverallRate(teamRecord)),
      recentForm: toPercent(recent.rate),
      recentStreak: recent.streak,
      battingRunRate: round(getRunRate(teamRecord.battingTotals.runs, teamRecord.battingTotals.balls), 2),
      bowlingEconomy: round(getRunRate(teamRecord.bowlingTotals.runs, teamRecord.bowlingTotals.balls), 2),
      topPlayer: topPlayer
        ? {
            player: topPlayer.player,
            role: topPlayer.role,
            stat: topPlayer.batting
              ? `${topPlayer.batting.runs} runs, SR ${topPlayer.batting.strikeRate}`
              : `${topPlayer.bowling.wickets} wickets, Eco ${topPlayer.bowling.economy}`
          }
        : null,
      topBowler: topBowler
        ? {
            player: topBowler.player,
            wickets: topBowler.wickets,
            economy: topBowler.economy
          }
        : null,
      tossConversion: toPercent(getTossConversion(teamRecord).rate)
    };
  }

  function buildMeta() {
    const teamList = Array.from(teams.keys()).sort((left, right) => left.localeCompare(right));
    const venueList = Array.from(venues.keys()).sort((left, right) => left.localeCompare(right));
    const teamSnapshots = Array.from(teams.values())
      .map(serializeTeam)
      .sort((left, right) => right.wins - left.wins || left.team.localeCompare(right.team));

    const playersByTeam = {};
    Array.from(teams.values()).forEach(teamRecord => {
      playersByTeam[teamRecord.name] = getPlayerChoices(teamRecord, 8).map(player => ({
        value: player.value,
        label: player.label
      }));
    });

    return {
      teams: teamList,
      venues: venueList,
      seasons: seasonList,
      latestSeason,
      summary: {
        totalMatches: matches.length,
        totalTeams: teamList.length,
        totalVenues: venueList.length
      },
      defaults: {
        team1: teamList.includes("Mumbai Indians") ? "Mumbai Indians" : teamList[0],
        team2: teamList.includes("Chennai Super Kings") ? "Chennai Super Kings" : teamList[1] || teamList[0],
        venue: venueList.includes("Wankhede Stadium") ? "Wankhede Stadium" : venueList[0],
        dashboardTeam: teamList.includes("Mumbai Indians") ? "Mumbai Indians" : teamList[0]
      },
      playersByTeam,
      teamSnapshots
    };
  }

  function getTeamBattingScoreForRanges(teamRecord, currentTeamRanges) {
    return average([
      normalizeFromRange(getRunRate(teamRecord.battingTotals.runs, teamRecord.battingTotals.balls), currentTeamRanges.battingRunRate),
      normalizeFromRange(safeDivide(teamRecord.battingTotals.runs, teamRecord.matches), currentTeamRanges.avgScore),
      normalizeFromRange(getBoundaryRate(teamRecord.battingTotals.boundaries, teamRecord.battingTotals.balls), currentTeamRanges.boundaryRate)
    ]);
  }

  function getTeamBattingScore(teamRecord) {
    return getTeamBattingScoreForRanges(teamRecord, teamRanges);
  }

  function getTeamBowlingScoreForRanges(teamRecord, currentTeamRanges) {
    return average([
      normalizeFromRange(getRunRate(teamRecord.bowlingTotals.runs, teamRecord.bowlingTotals.balls), currentTeamRanges.bowlingEconomy, true),
      normalizeFromRange(getDotRate(teamRecord.bowlingTotals.dotBalls, teamRecord.bowlingTotals.balls), currentTeamRanges.dotRate),
      normalizeFromRange(safeDivide(teamRecord.bowlingTotals.wickets, teamRecord.matches), currentTeamRanges.wicketsPerMatch)
    ]);
  }

  function getTeamBowlingScore(teamRecord) {
    return getTeamBowlingScoreForRanges(teamRecord, teamRanges);
  }

  function getPhaseScoreForRanges(teamRecord, currentTeamRanges) {
    return average([
      normalizeFromRange(getPhaseRunRate(teamRecord.battingTotals, "powerplay"), currentTeamRanges.powerplayRunRate),
      normalizeFromRange(getPhaseRunRate(teamRecord.battingTotals, "death"), currentTeamRanges.deathRunRate),
      normalizeFromRange(getPhaseRunRate(teamRecord.bowlingTotals, "death"), currentTeamRanges.deathEconomy, true)
    ]);
  }

  function getPhaseScore(teamRecord) {
    return getPhaseScoreForRanges(teamRecord, teamRanges);
  }

  function getRecentStrengthForRanges(recentSummary, currentTeamRanges) {
    return average([
      recentSummary.rate,
      normalizeFromRange(recentSummary.battingRunRate, currentTeamRanges.battingRunRate),
      normalizeFromRange(recentSummary.bowlingEconomy, currentTeamRanges.bowlingEconomy, true),
      normalizeFromRange(recentSummary.dotRate, currentTeamRanges.dotRate)
    ]);
  }

  function getRecentStrength(recentSummary) {
    return getRecentStrengthForRanges(recentSummary, teamRanges);
  }

  function computePredictionState({
    team1,
    team2,
    tossWinner,
    venue,
    player1Name = "",
    player2Name = "",
    team1Record,
    team2Record,
    currentTeamRanges = teamRanges,
    currentPlayerRanges = playerRanges
  }) {
    const team1Recent = getRecentSummary(team1Record, 5);
    const team2Recent = getRecentSummary(team2Record, 5);
    const team1Venue = getVenueSummary(team1Record, venue);
    const team2Venue = getVenueSummary(team2Record, venue);
    const team1HeadToHead = getHeadToHeadSummary(team1Record, team2);
    const team2HeadToHead = getHeadToHeadSummary(team2Record, team1);
    const team1Player = getSelectedPlayerForRanges(team1Record, currentPlayerRanges, player1Name);
    const team2Player = getSelectedPlayerForRanges(team2Record, currentPlayerRanges, player2Name);

    const scoreParts = {
      overall: { team1: getOverallRate(team1Record), team2: getOverallRate(team2Record), weight: 0.12 },
      recent: { team1: getRecentStrengthForRanges(team1Recent, currentTeamRanges), team2: getRecentStrengthForRanges(team2Recent, currentTeamRanges), weight: 0.14 },
      batting: {
        team1: average([getTeamBattingScoreForRanges(team1Record, currentTeamRanges), 1 - getTeamBowlingScoreForRanges(team2Record, currentTeamRanges)]),
        team2: average([getTeamBattingScoreForRanges(team2Record, currentTeamRanges), 1 - getTeamBowlingScoreForRanges(team1Record, currentTeamRanges)]),
        weight: 0.16
      },
      bowling: {
        team1: average([getTeamBowlingScoreForRanges(team1Record, currentTeamRanges), 1 - getTeamBattingScoreForRanges(team2Record, currentTeamRanges)]),
        team2: average([getTeamBowlingScoreForRanges(team2Record, currentTeamRanges), 1 - getTeamBattingScoreForRanges(team1Record, currentTeamRanges)]),
        weight: 0.16
      },
      venue: {
        team1: average([
          team1Venue.rate,
          normalizeFromRange(team1Venue.runRate, currentTeamRanges.battingRunRate),
          normalizeFromRange(team1Venue.economy, currentTeamRanges.bowlingEconomy, true)
        ]),
        team2: average([
          team2Venue.rate,
          normalizeFromRange(team2Venue.runRate, currentTeamRanges.battingRunRate),
          normalizeFromRange(team2Venue.economy, currentTeamRanges.bowlingEconomy, true)
        ]),
        weight: 0.12
      },
      headToHead: { team1: team1HeadToHead.rate, team2: team2HeadToHead.rate, weight: 0.1 },
      phases: { team1: getPhaseScoreForRanges(team1Record, currentTeamRanges), team2: getPhaseScoreForRanges(team2Record, currentTeamRanges), weight: 0.08 },
      toss: {
        team1: tossWinner === team1 ? clamp(getTossConversion(team1Record).rate + 0.12, 0, 1) : getTossConversion(team1Record).rate * 0.55,
        team2: tossWinner === team2 ? clamp(getTossConversion(team2Record).rate + 0.12, 0, 1) : getTossConversion(team2Record).rate * 0.55,
        weight: 0.04
      },
      playerImpact: { team1: team1Player.score, team2: team2Player.score, weight: 0.08 }
    };

    const team1Score = Object.values(scoreParts).reduce((total, part) => total + (part.team1 * part.weight), 0);
    const team2Score = Object.values(scoreParts).reduce((total, part) => total + (part.team2 * part.weight), 0);
    const team1Probability = sigmoid((team1Score - team2Score) * 9);
    const team2Probability = 1 - team1Probability;
    const winner = team1Probability >= team2Probability ? team1 : team2;
    const confidence = Math.round(Math.max(team1Probability, team2Probability) * 100);

    return {
      team1Recent,
      team2Recent,
      team1Venue,
      team2Venue,
      team1HeadToHead,
      team2HeadToHead,
      team1Player,
      team2Player,
      scoreParts,
      team1Score,
      team2Score,
      team1Probability,
      team2Probability,
      winner,
      confidence
    };
  }

  function buildPrediction(payload) {
    const team1 = canonicalizeTeam(String(payload.team1 || "").trim());
    const team2 = canonicalizeTeam(String(payload.team2 || "").trim());
    const tossWinner = canonicalizeTeam(String(payload.tossWinner || "").trim());
    const venue = String(payload.venue || "").trim();
    const player1Name = String(payload.player1 || "").trim();
    const player2Name = String(payload.player2 || "").trim();

    if (!team1 || !team2) {
      return { error: "Please choose both teams." };
    }

    if (team1 === team2) {
      return { error: "Choose two different teams to compare." };
    }

    if (!teams.has(team1) || !teams.has(team2)) {
      return { error: "One of the selected teams is not available in the dataset." };
    }

    if (!venue || !venues.has(venue)) {
      return { error: "Choose a valid venue." };
    }

    if (tossWinner !== team1 && tossWinner !== team2) {
      return { error: "Toss winner must be one of the selected teams." };
    }

    const team1Record = teams.get(team1);
    const team2Record = teams.get(team2);
    const {
      team1Recent,
      team2Recent,
      team1Venue,
      team2Venue,
      team1Player,
      team2Player,
      scoreParts,
      team1Score,
      team2Score,
      team1Probability: rawTeam1Probability,
      team2Probability: rawTeam2Probability
    } = computePredictionState({
      team1,
      team2,
      tossWinner,
      venue,
      player1Name,
      player2Name,
      team1Record,
      team2Record
    });
    const probabilityCalibrator = getProbabilityCalibrator();
    const team1Probability = applyProbabilityCalibrator(rawTeam1Probability, probabilityCalibrator);
    const team2Probability = 1 - team1Probability;
    const winner = team1Probability >= team2Probability ? team1 : team2;
    const confidence = Math.round(Math.max(team1Probability, team2Probability) * 100);

    const factors = [
      {
        key: "overall",
        label: "Overall record",
        team1: toPercent(scoreParts.overall.team1),
        team2: toPercent(scoreParts.overall.team2),
        detail: `${team1} has ${team1Record.wins} wins from ${team1Record.matches} matches. ${team2} has ${team2Record.wins} from ${team2Record.matches}.`
      },
      {
        key: "recent",
        label: "Recent form",
        team1: toPercent(scoreParts.recent.team1),
        team2: toPercent(scoreParts.recent.team2),
        detail: `${team1Recent.wins}/${team1Recent.sampleSize} wins recently with ${team1Recent.battingRunRate.toFixed(2)} rpo. ${team2Recent.wins}/${team2Recent.sampleSize} for ${team2}.`
      },
      {
        key: "batting",
        label: "Batting pressure",
        team1: toPercent(scoreParts.batting.team1),
        team2: toPercent(scoreParts.batting.team2),
        detail: `${team1} scores ${getRunRate(team1Record.battingTotals.runs, team1Record.battingTotals.balls).toFixed(2)} rpo overall. ${team2} scores ${getRunRate(team2Record.battingTotals.runs, team2Record.battingTotals.balls).toFixed(2)} rpo.`
      },
      {
        key: "bowling",
        label: "Bowling control",
        team1: toPercent(scoreParts.bowling.team1),
        team2: toPercent(scoreParts.bowling.team2),
        detail: `${team1} concedes ${getRunRate(team1Record.bowlingTotals.runs, team1Record.bowlingTotals.balls).toFixed(2)} rpo with ${safeDivide(team1Record.bowlingTotals.wickets, team1Record.matches).toFixed(2)} wickets per match.`
      },
      {
        key: "venue",
        label: "Venue fit",
        team1: toPercent(scoreParts.venue.team1),
        team2: toPercent(scoreParts.venue.team2),
        detail: `${team1} averages ${team1Venue.avgScore} runs at ${venue}; ${team2} averages ${team2Venue.avgScore}.`
      },
      {
        key: "playerImpact",
        label: "Selected player edge",
        team1: toPercent(scoreParts.playerImpact.team1),
        team2: toPercent(scoreParts.playerImpact.team2),
        detail: `${team1Player.player || "No player"} vs ${team2Player.player || "No player"} using real batting and bowling stats from deliveries.csv.`
      }
    ];

    const summary = winner === team1
      ? `${team1} gets the edge from stronger ${scoreParts.batting.team1 >= scoreParts.batting.team2 ? "batting pressure" : "bowling control"} plus a delivery-based form profile that stays slightly ahead at ${venue}.`
      : `${team2} projects better because its ${scoreParts.bowling.team2 >= scoreParts.bowling.team1 ? "bowling control" : "batting pressure"} and recent delivery form are a touch stronger at ${venue}.`;

    return {
      winner,
      confidence,
      summary,
      calibration: {
        method: probabilityCalibrator.method,
        calibrated: true
      },
      probability: {
        team1: Math.round(team1Probability * 100),
        team2: Math.round(team2Probability * 100)
      },
      teams: [
        {
          name: team1,
          score: round(team1Score, 3),
          overallWinRate: toPercent(getOverallRate(team1Record)),
          recentForm: toPercent(team1Recent.rate),
          recentStreak: team1Recent.streak,
          batting: summarizeBattingAggregate(team1Record.battingTotals, team1Record.matches),
          bowling: summarizeBowlingAggregate(team1Record.bowlingTotals, team1Record.matches),
          venueRecord: {
            venue,
            matches: team1Venue.matches,
            wins: team1Venue.wins,
            winRate: toPercent(team1Venue.rate),
            avgScore: team1Venue.avgScore,
            economy: team1Venue.economy
          },
          player: {
            name: team1Player.player,
            role: team1Player.role,
            impact: toPercent(team1Player.score),
            batting: team1Player.batting,
            bowling: team1Player.bowling
          }
        },
        {
          name: team2,
          score: round(team2Score, 3),
          overallWinRate: toPercent(getOverallRate(team2Record)),
          recentForm: toPercent(team2Recent.rate),
          recentStreak: team2Recent.streak,
          batting: summarizeBattingAggregate(team2Record.battingTotals, team2Record.matches),
          bowling: summarizeBowlingAggregate(team2Record.bowlingTotals, team2Record.matches),
          venueRecord: {
            venue,
            matches: team2Venue.matches,
            wins: team2Venue.wins,
            winRate: toPercent(team2Venue.rate),
            avgScore: team2Venue.avgScore,
            economy: team2Venue.economy
          },
          player: {
            name: team2Player.player,
            role: team2Player.role,
            impact: toPercent(team2Player.score),
            batting: team2Player.batting,
            bowling: team2Player.bowling
          }
        }
      ],
      factors
    };
  }

  let cachedBacktest = null;
  let cachedCalibrator = null;

  function getProbabilityCalibrator() {
    if (cachedCalibrator) {
      return cachedCalibrator;
    }

    cachedCalibrator = buildBacktest().calibrationModel;
    return cachedCalibrator;
  }

  function applyHistoricalMatch(match, historicalTeams, historicalPlayers, historicalVenues, historicalSeasons) {
    historicalSeasons.add(match.season);

    const team1Record = ensureMapEntry(historicalTeams, match.team1, () => createTeamRecord(match.team1));
    const team2Record = ensureMapEntry(historicalTeams, match.team2, () => createTeamRecord(match.team2));
    const venueRecord = ensureMapEntry(historicalVenues, match.venue, () => createVenueRecord(match.venue));

    [team1Record, team2Record].forEach(teamRecord => {
      teamRecord.matches += 1;

      if (teamRecord.name === match.winner) {
        teamRecord.wins += 1;
      } else {
        teamRecord.losses += 1;
      }

      if (teamRecord.name === match.tossWinner) {
        teamRecord.tossesWon += 1;
        if (teamRecord.name === match.winner) {
          teamRecord.tossConversions += 1;
        }
      }

      const venueStats = ensureMapEntry(teamRecord.venues, match.venue, createVenueTeamRecord);
      venueStats.matches += 1;
      if (teamRecord.name === match.winner) {
        venueStats.wins += 1;
      }

      const seasonStats = ensureMapEntry(teamRecord.seasons, match.season, createSeasonRecord);
      seasonStats.matches += 1;
      if (teamRecord.name === match.winner) {
        seasonStats.wins += 1;
      }

      const opponent = teamRecord.name === match.team1 ? match.team2 : match.team1;
      const rivalryStats = ensureMapEntry(teamRecord.headToHead, opponent, createRivalryRecord);
      rivalryStats.matches += 1;
      if (teamRecord.name === match.winner) {
        rivalryStats.wins += 1;
      }
    });

    venueRecord.matches += 1;
    ensureMapEntry(venueRecord.teamWins, match.winner, () => ({ wins: 0 })).wins += 1;

    if (match.playerOfMatch) {
      const playerRecord = ensureMapEntry(historicalPlayers, match.playerOfMatch, () => createPlayerRecord(match.playerOfMatch));
      playerRecord.awards += 1;
    }

    const matchState = createMatchState(match);
    const matchDeliveries = deliveriesByMatch.get(match.id) || [];

    matchDeliveries.forEach(delivery => {
      const battingTeamRecord = historicalTeams.get(delivery.battingTeam);
      const bowlingTeamRecord = historicalTeams.get(delivery.bowlingTeam);

      if (!battingTeamRecord || !bowlingTeamRecord) {
        return;
      }

      const battingVenueRecord = battingTeamRecord.venues.get(match.venue);
      const bowlingVenueRecord = bowlingTeamRecord.venues.get(match.venue);
      const battingSeasonRecord = battingTeamRecord.seasons.get(match.season);
      const bowlingSeasonRecord = bowlingTeamRecord.seasons.get(match.season);
      const battingRivalryRecord = battingTeamRecord.headToHead.get(delivery.bowlingTeam);
      const bowlingRivalryRecord = bowlingTeamRecord.headToHead.get(delivery.battingTeam);
      const currentVenueRecord = historicalVenues.get(match.venue);
      const battingState = ensureMapEntry(matchState.teams, delivery.battingTeam, () => createMatchTeamState(delivery.battingTeam));
      const bowlingState = ensureMapEntry(matchState.teams, delivery.bowlingTeam, () => createMatchTeamState(delivery.bowlingTeam));
      const boundaryCount = delivery.batsmanRuns === 4 || delivery.batsmanRuns === 6 ? 1 : 0;

      const battingPayload = {
        runs: delivery.totalRuns,
        balls: delivery.legalBall ? 1 : 0,
        wickets: delivery.isWicket ? 1 : 0,
        dotBalls: delivery.legalBall && delivery.totalRuns === 0 ? 1 : 0,
        boundaries: boundaryCount,
        fours: delivery.batsmanRuns === 4 ? 1 : 0,
        sixes: delivery.batsmanRuns === 6 ? 1 : 0,
        phase: delivery.phase
      };

      const bowlingPayload = {
        runs: delivery.totalRuns,
        balls: delivery.legalBall ? 1 : 0,
        wickets: delivery.isWicket ? 1 : 0,
        dotBalls: delivery.legalBall && delivery.totalRuns === 0 ? 1 : 0,
        boundaries: boundaryCount,
        fours: delivery.batsmanRuns === 4 ? 1 : 0,
        sixes: delivery.batsmanRuns === 6 ? 1 : 0,
        phase: delivery.phase
      };

      updateAggregateRecord(battingTeamRecord.battingTotals, battingPayload);
      updateAggregateRecord(bowlingTeamRecord.bowlingTotals, bowlingPayload);
      updateAggregateRecord(battingState.batting, battingPayload);
      updateAggregateRecord(bowlingState.bowling, bowlingPayload);

      battingVenueRecord.runsFor += delivery.totalRuns;
      battingVenueRecord.ballsFor += delivery.legalBall ? 1 : 0;
      battingVenueRecord.wicketsLost += delivery.isWicket ? 1 : 0;

      bowlingVenueRecord.runsAgainst += delivery.totalRuns;
      bowlingVenueRecord.ballsAgainst += delivery.legalBall ? 1 : 0;
      bowlingVenueRecord.wicketsTaken += delivery.isWicket ? 1 : 0;

      battingSeasonRecord.runsFor += delivery.totalRuns;
      bowlingSeasonRecord.runsAgainst += delivery.totalRuns;
      battingRivalryRecord.runsFor += delivery.totalRuns;
      bowlingRivalryRecord.runsAgainst += delivery.totalRuns;

      currentVenueRecord.totalRuns += delivery.totalRuns;
      if (delivery.inning === 1) {
        currentVenueRecord.firstInningsRuns += delivery.totalRuns;
      }

      if (delivery.batter) {
        const teamBatter = ensureMapEntry(battingTeamRecord.batters, delivery.batter, () => createBatterRecord(delivery.batter));
        addBattingContribution(teamBatter, delivery);

        const playerRecord = ensureMapEntry(historicalPlayers, delivery.batter, () => createPlayerRecord(delivery.batter));
        addBattingContribution(playerRecord.batting, delivery);

        const teamContribution = ensureMapEntry(playerRecord.teams, delivery.battingTeam, createTeamContributionRecord);
        teamContribution.battingRuns += delivery.batsmanRuns;
        teamContribution.matches.add(match.id);
      }

      if (delivery.playerDismissed) {
        const teamBatter = ensureMapEntry(battingTeamRecord.batters, delivery.playerDismissed, () => createBatterRecord(delivery.playerDismissed));
        addDismissal(teamBatter, match.id);

        const playerRecord = ensureMapEntry(historicalPlayers, delivery.playerDismissed, () => createPlayerRecord(delivery.playerDismissed));
        addDismissal(playerRecord.batting, match.id);

        const teamContribution = ensureMapEntry(playerRecord.teams, delivery.battingTeam, createTeamContributionRecord);
        teamContribution.matches.add(match.id);
      }

      if (delivery.bowler) {
        const teamBowler = ensureMapEntry(bowlingTeamRecord.bowlers, delivery.bowler, () => createBowlerRecord(delivery.bowler));
        addBowlingContribution(teamBowler, delivery);

        const playerRecord = ensureMapEntry(historicalPlayers, delivery.bowler, () => createPlayerRecord(delivery.bowler));
        addBowlingContribution(playerRecord.bowling, delivery);

        const teamContribution = ensureMapEntry(playerRecord.teams, delivery.bowlingTeam, createTeamContributionRecord);
        teamContribution.bowlingWickets += delivery.bowlerWicket ? 1 : 0;
        teamContribution.matches.add(match.id);
      }
    });

    const team1State = matchState.teams.get(match.team1) || createMatchTeamState(match.team1);
    const team2State = matchState.teams.get(match.team2) || createMatchTeamState(match.team2);

    appendRecentMatchSummary(team1Record, match, team1State, team2State, match.winner === match.team1, match.team2);
    appendRecentMatchSummary(team2Record, match, team2State, team1State, match.winner === match.team2, match.team1);
  }

  function buildBacktest(options = {}) {
    const minimumMatchesPerTeam = Math.max(1, Math.round(toNumber(options.minimumMatchesPerTeam || 5)));

    if (minimumMatchesPerTeam === 5 && cachedBacktest) {
      return cachedBacktest;
    }

    const historicalTeams = new Map();
    const historicalPlayers = new Map();
    const historicalVenues = new Map();
    const historicalSeasons = new Set();
    const predictions = [];
    const seasonBuckets = new Map();
    const epsilon = 1e-15;

    matches.forEach(match => {
      const team1Record = historicalTeams.get(match.team1);
      const team2Record = historicalTeams.get(match.team2);

      if (
        team1Record &&
        team2Record &&
        team1Record.matches >= minimumMatchesPerTeam &&
        team2Record.matches >= minimumMatchesPerTeam
      ) {
        const currentTeamRanges = buildTeamRangesFor(historicalTeams);
        const currentPlayerRanges = buildPlayerRangesFor(historicalPlayers);
        const predictionState = computePredictionState({
          team1: match.team1,
          team2: match.team2,
          tossWinner: match.tossWinner,
          venue: match.venue,
          team1Record,
          team2Record,
          currentTeamRanges,
          currentPlayerRanges
        });

        const actualTeam1Win = match.winner === match.team1 ? 1 : 0;
        const favoriteProbability = predictionState.winner === match.team1 ? predictionState.team1Probability : predictionState.team2Probability;
        const clippedTeam1Probability = clamp(predictionState.team1Probability, epsilon, 1 - epsilon);
        const brier = (clippedTeam1Probability - actualTeam1Win) ** 2;
        const logLoss = -((actualTeam1Win * Math.log(clippedTeam1Probability)) + ((1 - actualTeam1Win) * Math.log(1 - clippedTeam1Probability)));
        const correct = predictionState.winner === match.winner;

        predictions.push({
          season: match.season,
          date: match.date,
          venue: match.venue,
          team1: match.team1,
          team2: match.team2,
          tossWinner: match.tossWinner,
          actualTeam1Win,
          actualWinner: match.winner,
          rawPredictedWinner: predictionState.winner,
          rawTeam1Probability: predictionState.team1Probability,
          rawTeam2Probability: predictionState.team2Probability,
          rawFavoriteProbability: favoriteProbability,
          rawConfidence: Math.round(favoriteProbability * 100),
          rawCorrect: correct,
          rawBrier: brier,
          rawLogLoss: logLoss
        });

      }

      applyHistoricalMatch(match, historicalTeams, historicalPlayers, historicalVenues, historicalSeasons);
    });

    const evaluatedMatches = predictions.length;
    const skippedMatches = matches.length - evaluatedMatches;
    const probabilityCalibrator = fitProbabilityCalibrator(predictions.map(item => ({
      probability: item.rawTeam1Probability,
      actual: item.actualTeam1Win
    })));

    predictions.forEach(item => {
      item.team1Probability = applyProbabilityCalibrator(item.rawTeam1Probability, probabilityCalibrator);
      item.team2Probability = 1 - item.team1Probability;
      item.predictedWinner = item.team1Probability >= item.team2Probability ? item.team1 : item.team2;
      item.favoriteProbability = item.predictedWinner === item.team1 ? item.team1Probability : item.team2Probability;
      item.confidence = Math.round(item.favoriteProbability * 100);
      item.correct = item.predictedWinner === item.actualWinner;
      item.brier = (item.team1Probability - item.actualTeam1Win) ** 2;
      item.logLoss = -((item.actualTeam1Win * Math.log(item.team1Probability)) + ((1 - item.actualTeam1Win) * Math.log(1 - item.team1Probability)));
    });

    function buildCalibrationBuckets(sourceItems, probabilityKey, correctKey) {
      return Array.from({ length: 5 }, (_, index) => {
        const start = 0.5 + (index * 0.1);
        const end = index === 4 ? 1.000001 : start + 0.1;
        const bucketItems = sourceItems.filter(item => item[probabilityKey] >= start && item[probabilityKey] < end);
        const predicted = safeDivide(bucketItems.reduce((sum, item) => sum + item[probabilityKey], 0), bucketItems.length) * 100;
        const actual = safeDivide(bucketItems.filter(item => item[correctKey]).length, bucketItems.length) * 100;

        return {
          label: `${Math.round(start * 100)}-${index === 4 ? 100 : Math.round((start + 0.1) * 100) - 1}%`,
          count: bucketItems.length,
          avgPredicted: round(predicted, 1),
          actualRate: round(actual, 1),
          gap: round(actual - predicted, 1)
        };
      }).filter(bucket => bucket.count > 0);
    }

    function summarizeMetrics(sourceItems, probabilityKey, correctKey, brierKey, logLossKey) {
      return {
        accuracy: toPercent(safeDivide(sourceItems.filter(item => item[correctKey]).length, sourceItems.length)),
        averageConfidence: round(safeDivide(sourceItems.reduce((sum, item) => sum + item[probabilityKey], 0), sourceItems.length) * 100, 1),
        brierScore: round(safeDivide(sourceItems.reduce((sum, item) => sum + item[brierKey], 0), sourceItems.length), 3),
        logLoss: round(safeDivide(sourceItems.reduce((sum, item) => sum + item[logLossKey], 0), sourceItems.length), 3)
      };
    }

    const rawCalibration = buildCalibrationBuckets(predictions, "rawFavoriteProbability", "rawCorrect");
    const calibration = buildCalibrationBuckets(predictions, "favoriteProbability", "correct");
    const rawMetrics = summarizeMetrics(predictions, "rawFavoriteProbability", "rawCorrect", "rawBrier", "rawLogLoss");
    const calibratedMetrics = summarizeMetrics(predictions, "favoriteProbability", "correct", "brier", "logLoss");

    predictions.forEach(item => {
      const seasonBucket = ensureMapEntry(seasonBuckets, item.season, () => ({
        matches: 0,
        correct: 0,
        confidenceTotal: 0,
        brierTotal: 0,
        logLossTotal: 0,
        rawCorrect: 0,
        rawConfidenceTotal: 0,
        rawBrierTotal: 0,
        rawLogLossTotal: 0
      }));
      seasonBucket.matches += 1;
      seasonBucket.correct += item.correct ? 1 : 0;
      seasonBucket.confidenceTotal += item.favoriteProbability;
      seasonBucket.brierTotal += item.brier;
      seasonBucket.logLossTotal += item.logLoss;
      seasonBucket.rawCorrect += item.rawCorrect ? 1 : 0;
      seasonBucket.rawConfidenceTotal += item.rawFavoriteProbability;
      seasonBucket.rawBrierTotal += item.rawBrier;
      seasonBucket.rawLogLossTotal += item.rawLogLoss;
    });

    const seasonBreakdown = Array.from(seasonBuckets.entries())
      .map(([season, bucket]) => ({
        season,
        matches: bucket.matches,
        accuracy: toPercent(safeDivide(bucket.correct, bucket.matches)),
        avgConfidence: round(safeDivide(bucket.confidenceTotal, bucket.matches) * 100, 1),
        brierScore: round(safeDivide(bucket.brierTotal, bucket.matches), 3),
        logLoss: round(safeDivide(bucket.logLossTotal, bucket.matches), 3),
        rawAccuracy: toPercent(safeDivide(bucket.rawCorrect, bucket.matches)),
        rawAvgConfidence: round(safeDivide(bucket.rawConfidenceTotal, bucket.matches) * 100, 1),
        rawBrierScore: round(safeDivide(bucket.rawBrierTotal, bucket.matches), 3),
        rawLogLoss: round(safeDivide(bucket.rawLogLossTotal, bucket.matches), 3)
      }))
      .sort((left, right) => seasonSortValue(left.season) - seasonSortValue(right.season));

    const report = {
      summary: {
        evaluationType: "walk-forward",
        usesActualTossWinner: true,
        minimumMatchesPerTeam,
        totalMatches: matches.length,
        evaluatedMatches,
        skippedMatches,
        coverage: round(safeDivide(evaluatedMatches, matches.length) * 100, 1),
        accuracy: calibratedMetrics.accuracy,
        averageConfidence: calibratedMetrics.averageConfidence,
        brierScore: calibratedMetrics.brierScore,
        logLoss: calibratedMetrics.logLoss,
        calibrationGap: round(safeDivide(calibration.reduce((sum, bucket) => sum + (Math.abs(bucket.gap) * bucket.count), 0), evaluatedMatches), 1),
        rawAccuracy: rawMetrics.accuracy,
        rawAverageConfidence: rawMetrics.averageConfidence,
        rawBrierScore: rawMetrics.brierScore,
        rawLogLoss: rawMetrics.logLoss,
        rawCalibrationGap: round(safeDivide(rawCalibration.reduce((sum, bucket) => sum + (Math.abs(bucket.gap) * bucket.count), 0), evaluatedMatches), 1)
      },
      calibrationModel: probabilityCalibrator,
      rawCalibration,
      calibration,
      seasonBreakdown,
      recentPredictions: predictions
        .slice(-10)
        .reverse()
        .map(item => ({
          date: item.date,
          season: item.season,
          venue: item.venue,
          match: `${item.team1} vs ${item.team2}`,
          predictedWinner: item.predictedWinner,
          actualWinner: item.actualWinner,
          confidence: item.confidence,
          rawConfidence: item.rawConfidence,
          result: item.correct ? "Hit" : "Miss"
        }))
    };

    if (minimumMatchesPerTeam === 5) {
      cachedBacktest = report;
      cachedCalibrator = probabilityCalibrator;
    }

    return report;
  }

  function buildDashboard(selectedTeam) {
    const teamName = canonicalizeTeam(String(selectedTeam || "").trim());
    const teamRecord = teams.get(teamName) || Array.from(teams.values())[0];
    const recent = getRecentSummary(teamRecord, 5);
    const toss = getTossConversion(teamRecord);

    const seasonTrend = Array.from(teamRecord.seasons.entries())
      .map(([season, stats]) => ({
        season,
        matches: stats.matches,
        wins: stats.wins,
        winRate: toPercent(safeDivide(stats.wins, stats.matches)),
        avgScore: round(safeDivide(stats.runsFor, stats.matches), 1)
      }))
      .sort((left, right) => seasonSortValue(left.season) - seasonSortValue(right.season));

    const venuePerformance = Array.from(teamRecord.venues.entries())
      .map(([venue, stats]) => ({
        venue,
        matches: stats.matches,
        wins: stats.wins,
        winRate: toPercent(safeDivide(stats.wins, stats.matches)),
        avgScore: round(safeDivide(stats.runsFor, stats.matches), 1),
        economy: round(getRunRate(stats.runsAgainst, stats.ballsAgainst), 2)
      }))
      .sort((left, right) => right.matches - left.matches || right.winRate - left.winRate)
      .slice(0, 8);

    const rivalries = Array.from(teamRecord.headToHead.entries())
      .map(([opponent, stats]) => ({
        opponent,
        matches: stats.matches,
        wins: stats.wins,
        winRate: toPercent(safeDivide(stats.wins, stats.matches))
      }))
      .sort((left, right) => right.matches - left.matches || right.winRate - left.winRate)
      .slice(0, 6);

    const topBatters = Array.from(teamRecord.batters.values())
      .map(summarizeBatter)
      .sort((left, right) => right.runs - left.runs || right.strikeRate - left.strikeRate)
      .slice(0, 6);

    const topBowlers = Array.from(teamRecord.bowlers.values())
      .map(summarizeBowler)
      .sort((left, right) => right.wickets - left.wickets || left.economy - right.economy)
      .slice(0, 6);

    const phasePerformance = [
      {
        phase: "Powerplay",
        battingRunRate: round(getPhaseRunRate(teamRecord.battingTotals, "powerplay"), 2),
        bowlingEconomy: round(getPhaseRunRate(teamRecord.bowlingTotals, "powerplay"), 2)
      },
      {
        phase: "Middle Overs",
        battingRunRate: round(getPhaseRunRate(teamRecord.battingTotals, "middle"), 2),
        bowlingEconomy: round(getPhaseRunRate(teamRecord.bowlingTotals, "middle"), 2)
      },
      {
        phase: "Death Overs",
        battingRunRate: round(getPhaseRunRate(teamRecord.battingTotals, "death"), 2),
        bowlingEconomy: round(getPhaseRunRate(teamRecord.bowlingTotals, "death"), 2)
      }
    ];

    const recentMatches = teamRecord.recentMatches
      .slice(-6)
      .reverse()
      .map(match => ({
        date: match.date,
        opponent: match.opponent,
        venue: match.venue,
        result: match.won ? "Won" : "Lost",
        teamScore: match.scoreline.team,
        opponentScore: match.scoreline.opponent
      }));

    const leagueTable = Array.from(teams.values())
      .map(serializeTeam)
      .sort((left, right) => right.winRate - left.winRate || right.wins - left.wins)
      .slice(0, 10);

    const topBattersOverall = playerSummaries
      .filter(player => player.batting.runs > 0)
      .sort((left, right) => right.batting.runs - left.batting.runs || right.batting.strikeRate - left.batting.strikeRate)
      .slice(0, 8)
      .map(player => ({
        player: player.name,
        team: player.strongestTeam ? player.strongestTeam.team : "Unknown",
        runs: player.batting.runs,
        strikeRate: player.batting.strikeRate
      }));

    const topBowlersOverall = playerSummaries
      .filter(player => player.bowling.wickets > 0)
      .sort((left, right) => right.bowling.wickets - left.bowling.wickets || left.bowling.economy - right.bowling.economy)
      .slice(0, 8)
      .map(player => ({
        player: player.name,
        team: player.strongestTeam ? player.strongestTeam.team : "Unknown",
        wickets: player.bowling.wickets,
        economy: player.bowling.economy
      }));

    return {
      leagueSummary: {
        totalMatches: matches.length,
        totalTeams: teams.size,
        totalVenues: venues.size,
        latestSeason
      },
      selectedTeam: {
        team: teamRecord.name,
        overview: {
          matches: teamRecord.matches,
          wins: teamRecord.wins,
          losses: teamRecord.losses,
          winRate: toPercent(getOverallRate(teamRecord)),
          recentForm: toPercent(recent.rate),
          tossConversion: toPercent(toss.rate),
          battingRunRate: round(getRunRate(teamRecord.battingTotals.runs, teamRecord.battingTotals.balls), 2),
          bowlingEconomy: round(getRunRate(teamRecord.bowlingTotals.runs, teamRecord.bowlingTotals.balls), 2),
          dotRate: toPercent(getDotRate(teamRecord.bowlingTotals.dotBalls, teamRecord.bowlingTotals.balls))
        },
        seasonTrend,
        venuePerformance,
        rivalries,
        topBatters,
        topBowlers,
        phasePerformance,
        recentMatches
      },
      modelEvaluation: buildBacktest(),
      leagueTable,
      topBattersOverall,
      topBowlersOverall
    };
  }

  return {
    buildMeta,
    buildPrediction,
    buildDashboard,
    buildBacktest
  };
}

module.exports = {
  createAnalytics
};
