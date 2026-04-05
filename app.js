const TEAM_THEMES = {
  "Chennai Super Kings": { accent: "#f1be48", soft: "rgba(241, 190, 72, 0.22)" },
  "Mumbai Indians": { accent: "#3ea6ff", soft: "rgba(62, 166, 255, 0.2)" },
  "Royal Challengers Bengaluru": { accent: "#ff646d", soft: "rgba(255, 100, 109, 0.22)" },
  "Kolkata Knight Riders": { accent: "#a871ff", soft: "rgba(168, 113, 255, 0.2)" },
  "Sunrisers Hyderabad": { accent: "#ff9758", soft: "rgba(255, 151, 88, 0.2)" },
  "Rajasthan Royals": { accent: "#ff86bd", soft: "rgba(255, 134, 189, 0.2)" },
  "Delhi Capitals": { accent: "#61d4ff", soft: "rgba(97, 212, 255, 0.2)" },
  "Punjab Kings": { accent: "#ff6b78", soft: "rgba(255, 107, 120, 0.2)" },
  "Lucknow Super Giants": { accent: "#4ecdd0", soft: "rgba(78, 205, 208, 0.2)" },
  "Gujarat Titans": { accent: "#86e0d1", soft: "rgba(134, 224, 209, 0.2)" }
};

function teamTheme(teamName) {
  return TEAM_THEMES[teamName] || { accent: "#58c2e0", soft: "rgba(88, 194, 224, 0.18)" };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function formatPercent(value) {
  return `${Math.round(Number(value) || 0)}%`;
}

function formatNumber(value, decimals = 1) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric.toFixed(decimals) : Number(0).toFixed(decimals);
}

function buildStyle(theme, confidence = 0) {
  return `--team-accent:${theme.accent};--team-soft:${theme.soft};--dial-angle:${confidence}%`;
}

function uniqueValues(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function renderOptions(options, selectedValue) {
  return (options || []).map(option => {
    const nextValue = typeof option === "string" ? option : option.value;
    const nextLabel = typeof option === "string" ? option : option.label;
    const isSelected = String(selectedValue ?? "") === String(nextValue ?? "");
    return `<option value="${escapeHtml(nextValue)}"${isSelected ? " selected" : ""}>${escapeHtml(nextLabel)}</option>`;
  }).join("");
}

async function fetchJson(url, options = {}) {
  const config = { ...options };

  if (config.body && !config.headers) {
    config.headers = { "Content-Type": "application/json" };
  }

  const response = await fetch(url, config);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

(function bootstrap() {
  const root = document.getElementById("root");

  if (!root) {
    return;
  }

  const state = {
    meta: null,
    metaError: "",
    view: "predictor",
    prediction: null,
    predictionError: "",
    predictionLoading: false,
    dashboard: null,
    dashboardLoading: false,
    form: { team1: "", team2: "", venue: "", tossWinner: "", player1: "", player2: "" },
    dashboardTeam: ""
  };

  let dashboardRequestId = 0;
  let predictionRequestId = 0;

  function getTeamPlayerOptions(team) {
    return [{ value: "", label: "Auto select top player" }].concat(state.meta?.playersByTeam?.[team] || []);
  }

  function syncFormSelections() {
    if (!state.meta) {
      return;
    }

    const team1Players = (state.meta.playersByTeam[state.form.team1] || []).map(player => player.value);
    const team2Players = (state.meta.playersByTeam[state.form.team2] || []).map(player => player.value);

    if (!team1Players.includes(state.form.player1)) {
      state.form.player1 = team1Players[0] || "";
    }

    if (!team2Players.includes(state.form.player2)) {
      state.form.player2 = team2Players[0] || "";
    }

    const tossOptions = uniqueValues([state.form.team1, state.form.team2]);

    if (!tossOptions.includes(state.form.tossWinner)) {
      state.form.tossWinner = tossOptions[0] || "";
    }
  }

  function snapshotsByTeam() {
    return (state.meta?.teamSnapshots || []).reduce((accumulator, snapshot) => {
      accumulator[snapshot.team] = snapshot;
      return accumulator;
    }, {});
  }

  function renderSelectField({ label, field, value, options, full = false, scope = "form" }) {
    return `
      <label class="field${full ? " full" : ""}">
        <span class="field-label">${escapeHtml(label)}</span>
        <select data-field="${escapeHtml(field)}" data-scope="${escapeHtml(scope)}">
          ${renderOptions(options, value)}
        </select>
      </label>
    `;
  }

  function renderFormStrip(values) {
    if (!values || values.length === 0) {
      return `<span class="label">No recent form</span>`;
    }

    return `<div class="form-strip">${values.map(value => `<span class="form-pill ${value === "W" ? "win" : "loss"}">${escapeHtml(value)}</span>`).join("")}</div>`;
  }

  function renderMetricBars({ items, accent, labelKey, valueKey, caption, displayValue }) {
    if (!items || items.length === 0) {
      return `<div class="empty-state"><p class="muted">Nothing to chart yet.</p></div>`;
    }

    const maxValue = Math.max(...items.map(item => Number(item[valueKey]) || 0), 1);

    return `<div class="bar-list">${items.map(item => {
      const rawValue = Number(item[valueKey]) || 0;
      const width = Math.max((rawValue / maxValue) * 100, rawValue > 0 ? 8 : 0);
      const valueText = displayValue ? displayValue(item) : rawValue;
      const captionText = caption ? caption(item) : "";

      return `
        <div class="bar-row">
          <div class="bar-top">
            <strong>${escapeHtml(item[labelKey])}</strong>
            <span class="bar-caption">${escapeHtml(valueText)}</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${width}%;background:linear-gradient(90deg, ${accent}, rgba(255,255,255,0.94));"></div>
          </div>
          ${caption ? `<span class="bar-caption">${escapeHtml(captionText)}</span>` : ""}
        </div>
      `;
    }).join("")}</div>`;
  }

  function renderTrendChart(data, accent) {
    if (!data || data.length === 0) {
      return `<div class="empty-state"><p class="muted">No season trend available.</p></div>`;
    }

    const width = 640;
    const height = 240;
    const paddingX = 28;
    const paddingY = 24;
    const chartHeight = height - (paddingY * 2);
    const chartWidth = width - (paddingX * 2);
    const points = data.map((item, index) => {
      const x = data.length === 1 ? width / 2 : paddingX + ((chartWidth / (data.length - 1)) * index);
      const y = height - paddingY - ((item.winRate / 100) * chartHeight);
      return { ...item, x, y };
    });
    const areaPoints = [
      `${points[0].x},${height - paddingY}`,
      ...points.map(point => `${point.x},${point.y}`),
      `${points[points.length - 1].x},${height - paddingY}`
    ].join(" ");

    return `
      <div class="line-chart">
        <div class="chart-shell">
          <svg viewBox="0 0 ${width} ${height}" aria-label="Season trend">
            <defs>
              <linearGradient id="trend-area" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="${accent}" stop-opacity="0.45"></stop>
                <stop offset="100%" stop-color="${accent}" stop-opacity="0.03"></stop>
              </linearGradient>
            </defs>
            ${[25, 50, 75].map(level => {
              const y = height - paddingY - ((level / 100) * chartHeight);
              return `<line x1="${paddingX}" y1="${y}" x2="${width - paddingX}" y2="${y}" stroke="rgba(255,255,255,0.08)" stroke-width="1" stroke-dasharray="4 6"></line>`;
            }).join("")}
            <polygon fill="url(#trend-area)" points="${areaPoints}"></polygon>
            <polyline fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="${points.map(point => `${point.x},${point.y}`).join(" ")}"></polyline>
            ${points.map(point => `<circle cx="${point.x}" cy="${point.y}" r="5" fill="#08131d" stroke="${accent}" stroke-width="3"></circle>`).join("")}
          </svg>
        </div>
        <div class="line-labels">${points.map(point => `<span>${escapeHtml(point.season)} ${formatPercent(point.winRate)}</span>`).join("")}</div>
      </div>
    `;
  }

  function renderTeamSnapshotCard(snapshot) {
    if (!snapshot) {
      return `
        <div class="team-card" style="${buildStyle(teamTheme(""), 0)}">
          <div class="team-card-body"><span class="label">Select a team to inspect its profile.</span></div>
        </div>
      `;
    }

    const theme = teamTheme(snapshot.team);
    const topPlayerRole = snapshot.topPlayer?.role ? snapshot.topPlayer.role.toLowerCase() : "player";

    return `
      <article class="team-card" style="${buildStyle(theme, 0)}">
        <div class="team-card-head">
          <span class="tag"><span class="status-dot"></span>${escapeHtml(`${snapshot.wins} wins`)}</span>
          <h3>${escapeHtml(snapshot.team)}</h3>
        </div>
        <div class="team-card-body">
          <div class="metric-grid">
            <div class="metric-block"><span class="label">Win rate</span><strong>${formatPercent(snapshot.winRate)}</strong></div>
            <div class="metric-block"><span class="label">Recent form</span><strong>${formatPercent(snapshot.recentForm)}</strong></div>
          </div>
          <div><span class="label">Last five</span>${renderFormStrip(snapshot.recentStreak)}</div>
          ${snapshot.topPlayer ? `<div class="mini-card"><span>Top ${escapeHtml(topPlayerRole)}</span><strong>${escapeHtml(snapshot.topPlayer.player)}</strong><span>${escapeHtml(snapshot.topPlayer.stat)}</span></div>` : ""}
          ${snapshot.topBowler ? `<div class="mini-card"><span>Strike bowler</span><strong>${escapeHtml(snapshot.topBowler.player)}</strong><span>${escapeHtml(`${snapshot.topBowler.wickets} wickets, eco ${formatNumber(snapshot.topBowler.economy, 2)}`)}</span></div>` : ""}
        </div>
      </article>
    `;
  }

  function renderKeyPlayerDetail(player) {
    if (!player?.name) {
      return "No standout player";
    }

    if (player.batting) {
      return `${player.batting.runs} runs | SR ${formatNumber(player.batting.strikeRate, 1)}`;
    }

    if (player.bowling) {
      return `${player.bowling.wickets} wickets | Eco ${formatNumber(player.bowling.economy, 2)}`;
    }

    return `${player.impact || 0}% impact score`;
  }

  function renderPredictionResult(prediction) {
    if (!prediction) {
      return `<div class="empty-state"><div><h3>Run a match simulation</h3><p class="muted">Pick two teams, set the venue and toss winner, then generate a prediction with form, venue, head-to-head, and player context.</p></div></div>`;
    }

    const winnerTheme = teamTheme(prediction.winner);
    const team1Accent = teamTheme(prediction.teams[0]?.name).accent;
    const team2Accent = teamTheme(prediction.teams[1]?.name).accent;

    return `
      <div class="result-shell">
        <div class="result-highlight" style="${buildStyle(winnerTheme, prediction.confidence)}">
          <div class="dial"><strong>${formatPercent(prediction.confidence)}</strong></div>
          <div>
            <span class="kicker">Predicted winner</span>
            <h2 class="panel-title">${escapeHtml(prediction.winner)}</h2>
            <p class="panel-copy">${escapeHtml(prediction.summary)}</p>
          </div>
        </div>
        <div class="stack">${prediction.teams.map((team, index) => {
          const theme = teamTheme(team.name);
          const probability = index === 0 ? prediction.probability.team1 : prediction.probability.team2;
          return `
            <div class="team-card" style="${buildStyle(theme, prediction.confidence)}">
              <div class="team-card-head">
                <span class="tag"><span class="status-dot"></span>${escapeHtml(`${formatPercent(probability)} win chance`)}</span>
                <h3>${escapeHtml(team.name)}</h3>
              </div>
              <div class="team-card-body">
                <div class="metric-grid">
                  <div class="metric-block"><span class="label">Overall</span><strong>${formatPercent(team.overallWinRate)}</strong></div>
                  <div class="metric-block"><span class="label">Recent</span><strong>${formatPercent(team.recentForm)}</strong></div>
                </div>
                <div><span class="label">Recent streak</span>${renderFormStrip(team.recentStreak)}</div>
                <div class="mini-card"><span>Batting profile</span><strong>${escapeHtml(`${formatNumber(team.batting.runRate, 2)} rpo`)}</strong><span>${escapeHtml(`${formatNumber(team.batting.avgScore, 1)} avg score | ${formatPercent((team.batting.boundaryRate || 0) * 100)} boundary rate`)}</span></div>
                <div class="mini-card"><span>Bowling profile</span><strong>${escapeHtml(`${formatNumber(team.bowling.economy, 2)} economy`)}</strong><span>${escapeHtml(`${formatNumber(team.bowling.wicketsPerMatch, 2)} wkts/match | ${formatPercent((team.bowling.dotRate || 0) * 100)} dots`)}</span></div>
                <div class="mini-card"><span>${escapeHtml(`Venue record at ${team.venueRecord.venue}`)}</span><strong>${escapeHtml(`${team.venueRecord.wins} wins in ${team.venueRecord.matches} matches`)}</strong><span>${escapeHtml(`${formatNumber(team.venueRecord.avgScore, 1)} avg score | ${formatNumber(team.venueRecord.economy, 2)} economy`)}</span></div>
                <div class="mini-card"><span>${escapeHtml(`Key player${team.player.role ? ` (${team.player.role})` : ""}`)}</span><strong>${escapeHtml(team.player.name || "No standout player")}</strong><span>${escapeHtml(renderKeyPlayerDetail(team.player))}</span></div>
              </div>
            </div>
          `;
        }).join("")}</div>
        <div class="probability-row">
          <div class="split-row">
            <strong>${escapeHtml(`${prediction.teams[0].name} ${formatPercent(prediction.probability.team1)}`)}</strong>
            <strong>${escapeHtml(`${prediction.teams[1].name} ${formatPercent(prediction.probability.team2)}`)}</strong>
          </div>
          <div class="probability-track"><div class="probability-fill" style="width:${prediction.probability.team1}%;background:linear-gradient(90deg, ${team1Accent}, ${team2Accent});"></div></div>
        </div>
        <div class="factor-list">${prediction.factors.map(factor => `
          <div class="factor-card">
            <div class="bar-top"><strong>${escapeHtml(factor.label)}</strong><span class="bar-caption">${escapeHtml(`${factor.team1} vs ${factor.team2}`)}</span></div>
            <div class="probability-track"><div class="probability-fill" style="width:${factor.team1}%;background:linear-gradient(90deg, ${team1Accent}, ${team2Accent});"></div></div>
            <p>${escapeHtml(factor.detail)}</p>
          </div>
        `).join("")}</div>
        <div class="info-banner">Projection blends form, venue behaviour, phase pressure, and player quality, then calibrates the final probability against historical replay results.</div>
      </div>
    `;
  }

  function renderRecentMatches(items) {
    if (!items || items.length === 0) {
      return `<div class="empty-state"><p class="muted">No recent matches available.</p></div>`;
    }

    return `<div class="table-list">${items.map(match => `
      <div class="table-row">
        <div>
          <strong>${escapeHtml(`vs ${match.opponent}`)}</strong>
          <span>${escapeHtml(`${match.date} at ${match.venue}`)}</span>
          ${match.teamScore !== undefined ? `<span class="table-caption">${escapeHtml(`${match.teamScore}/${match.opponentScore}`)}</span>` : ""}
        </div>
        <span class="tag"><span class="status-dot" style="background:${match.result === "Won" ? "#4ed3a2" : "#ff7d86"};"></span>${escapeHtml(match.result)}</span>
        <span class="table-caption">Recent</span>
      </div>
    `).join("")}</div>`;
  }

  function renderLeagueTable(rows) {
    return `<div class="league-table">${(rows || []).map((row, index) => `
      <div class="league-row">
        <div class="rank-badge">${index + 1}</div>
        <div><strong>${escapeHtml(row.team)}</strong><span class="table-caption">${escapeHtml(row.topPlayer ? row.topPlayer.player : "Balanced squad")}</span></div>
        <strong>${formatPercent(row.winRate)}</strong>
        <span class="table-caption">${escapeHtml(`${row.wins}-${row.losses}`)}</span>
      </div>
    `).join("")}</div>`;
  }

  function renderCalibrationRows(items, accent) {
    if (!items || items.length === 0) {
      return `<div class="empty-state"><p class="muted">Calibration data will appear once the replay has enough matches.</p></div>`;
    }

    return `<div class="calibration-list">${items.map(item => `
      <div class="calibration-row">
        <div class="bar-top">
          <strong>${escapeHtml(item.label)}</strong>
          <span class="bar-caption">${escapeHtml(`${item.count} matches`)}</span>
        </div>
        <div class="calibration-track">
          <div class="calibration-fill" style="width:${item.actualRate}%;background:linear-gradient(90deg, ${accent}, rgba(255,255,255,0.92));"></div>
          <span class="calibration-marker" style="left:${item.avgPredicted}%;"></span>
        </div>
        <div class="split-row calibration-meta">
          <span class="bar-caption">${escapeHtml(`Actual ${formatNumber(item.actualRate, 1)}%`)}</span>
          <span class="bar-caption">${escapeHtml(`Predicted ${formatNumber(item.avgPredicted, 1)}% | Gap ${formatNumber(item.gap, 1)} pts`)}</span>
        </div>
      </div>
    `).join("")}</div>`;
  }

  function renderBacktestRecent(items) {
    if (!items || items.length === 0) {
      return `<div class="empty-state"><p class="muted">Recent backtest calls will appear here once replay data is available.</p></div>`;
    }

    return `<div class="prediction-list">${items.map(item => `
      <div class="prediction-row">
        <div>
          <strong>${escapeHtml(item.match)}</strong>
          <span>${escapeHtml(`${item.date} at ${item.venue}`)}</span>
        </div>
        <div>
          <span class="label">Predicted</span>
          <strong>${escapeHtml(item.predictedWinner)}</strong>
        </div>
        <div>
          <span class="label">Actual</span>
          <strong>${escapeHtml(item.actualWinner)}</strong>
        </div>
        <strong>${escapeHtml(`${item.confidence}%`)}</strong>
        <span class="tag ${item.result === "Hit" ? "tag-success" : "tag-danger"}">
          <span class="status-dot" style="background:${item.result === "Hit" ? "#4ed3a2" : "#ff7d86"};"></span>
          ${escapeHtml(item.result)}
        </span>
      </div>
    `).join("")}</div>`;
  }

  function renderModelEvaluation(evaluation, accent) {
    if (!evaluation) {
      return "";
    }

    const seasonTrend = (evaluation.seasonBreakdown || []).map(item => ({
      season: item.season,
      winRate: item.accuracy
    }));
    const reliabilityNote = evaluation.summary.rawCalibrationGap > evaluation.summary.calibrationGap
      ? `Calibration tightened the reliability gap from ${formatNumber(evaluation.summary.rawCalibrationGap, 1)} to ${formatNumber(evaluation.summary.calibrationGap, 1)} points, and brought average confidence down from ${formatNumber(evaluation.summary.rawAverageConfidence, 1)}% to ${formatNumber(evaluation.summary.averageConfidence, 1)}%.`
      : `The replay suggests the current probability curve is reasonably aligned, with ${evaluation.summary.accuracy}% accuracy across evaluated matches.`;

    return `
      <section class="panel wide-panel">
        <div class="panel-header">
          <div>
            <span class="kicker">Model evaluation</span>
            <h2 class="panel-title">Probability backtest</h2>
            <p class="panel-copy">This replay walks through the archive in date order, uses the real toss winner, and scores each prediction using only matches that happened earlier.</p>
          </div>
        </div>
        <div class="evaluation-grid">
          <div class="metric-card"><span>Accuracy</span><strong>${formatPercent(evaluation.summary.accuracy)}</strong></div>
          <div class="metric-card"><span>Brier score</span><strong>${formatNumber(evaluation.summary.brierScore, 3)}</strong></div>
          <div class="metric-card"><span>Log loss</span><strong>${formatNumber(evaluation.summary.logLoss, 3)}</strong></div>
          <div class="metric-card"><span>Calibration gap</span><strong>${escapeHtml(`${formatNumber(evaluation.summary.calibrationGap, 1)} pts`)}</strong></div>
          <div class="metric-card"><span>Coverage</span><strong>${escapeHtml(`${formatNumber(evaluation.summary.coverage, 1)}%`)}</strong></div>
          <div class="metric-card"><span>Avg confidence</span><strong>${escapeHtml(`${formatNumber(evaluation.summary.averageConfidence, 1)}%`)}</strong></div>
        </div>
        <div class="evaluation-layout">
          <div class="stack">
            <div class="info-banner">${escapeHtml(reliabilityNote)}</div>
            <div class="info-banner">Matches are skipped until both sides have at least ${escapeHtml(evaluation.summary.minimumMatchesPerTeam)} prior games, which helps keep the replay fair and avoids early-season noise.</div>
            <div class="evaluation-block">
              <div class="bar-top">
                <strong>Calibration buckets</strong>
                <span class="bar-caption">${escapeHtml(`${evaluation.summary.evaluatedMatches} evaluated | ${evaluation.summary.skippedMatches} skipped`)}</span>
              </div>
              ${renderCalibrationRows(evaluation.calibration, accent)}
            </div>
          </div>
          <div class="evaluation-block">
            <div class="bar-top">
              <strong>Accuracy by season</strong>
              <span class="bar-caption">Walk-forward replay</span>
            </div>
            ${renderTrendChart(seasonTrend, accent)}
          </div>
        </div>
        <div class="evaluation-block">
          <div class="bar-top">
            <strong>Recent backtest calls</strong>
            <span class="bar-caption">Latest replayed predictions</span>
          </div>
          ${renderBacktestRecent(evaluation.recentPredictions)}
        </div>
      </section>
    `;
  }

  function renderHero(meta) {
    const featuredTeams = (meta.teamSnapshots || []).slice(0, 3);

    return `
      <section class="hero">
        <div class="hero-card hero-copy">
          <p class="eyebrow">IPL Match Studio</p>
          <h1 class="hero-title">Sharper match calls and a cleaner way to read team momentum.</h1>
          <p class="hero-subtitle">Compare teams through form, venue rhythm, matchup history, and player quality in a release-ready IPL experience built for fans.</p>
          <div class="hero-actions">
            <button class="nav-pill ${state.view === "predictor" ? "active" : ""}" type="button" data-view="predictor">Predictor</button>
            <button class="nav-pill ${state.view === "dashboard" ? "active" : ""}" type="button" data-view="dashboard">Stats Dashboard</button>
          </div>
        </div>
        <div class="hero-side">
          <div class="hero-card">
            <div class="summary-grid">
              <div class="summary-card"><span>Archive matches</span><strong>${escapeHtml(meta.summary.totalMatches)}</strong></div>
              <div class="summary-card"><span>Seasons</span><strong>${escapeHtml(meta.seasons.length)}</strong></div>
              <div class="summary-card"><span>Venues</span><strong>${escapeHtml(meta.summary.totalVenues)}</strong></div>
            </div>
          </div>
          <div class="hero-note">
            <h3>League pulse</h3>
            <div class="feature-stack">${featuredTeams.map(team => `<div class="feature-chip">${escapeHtml(`${team.team}: ${formatPercent(team.winRate)} win rate, ${formatPercent(team.recentForm)} recent form`)}</div>`).join("")}</div>
          </div>
        </div>
      </section>
    `;
  }

  function renderPredictorView(meta, snapshots) {
    const team1Players = getTeamPlayerOptions(state.form.team1);
    const team2Players = getTeamPlayerOptions(state.form.team2);
    const tossOptions = uniqueValues([state.form.team1, state.form.team2]);

    return `
      <div class="predictor-layout">
        <section class="panel">
          <div class="panel-header">
            <div>
              <span class="kicker">Predictor</span>
              <h2 class="panel-title">Build a smarter match scenario</h2>
              <p class="panel-copy">Set the venue, toss, and key names on each side to see how the matchup tilts.</p>
            </div>
          </div>
          <div class="info-banner">Player selections are ranked from historic scoring, wicket-taking, control, and finishing impact.</div>
          <form class="stack" data-form="predictor">
            <div class="form-grid">
              ${renderSelectField({ label: "Team 1", field: "team1", value: state.form.team1, options: meta.teams })}
              ${renderSelectField({ label: "Team 2", field: "team2", value: state.form.team2, options: meta.teams })}
              ${renderSelectField({ label: "Venue", field: "venue", value: state.form.venue, options: meta.venues, full: true })}
              ${renderSelectField({ label: "Toss winner", field: "tossWinner", value: state.form.tossWinner, options: tossOptions })}
              ${renderSelectField({ label: "Key player for team 1", field: "player1", value: state.form.player1, options: team1Players })}
              ${renderSelectField({ label: "Key player for team 2", field: "player2", value: state.form.player2, options: team2Players })}
            </div>
            <div class="action-row">
              <button class="cta-button" type="submit"${state.predictionLoading ? " disabled" : ""}>${state.predictionLoading ? "Calculating..." : "Generate prediction"}</button>
            </div>
            ${state.predictionError ? `<div class="error-banner">${escapeHtml(state.predictionError)}</div>` : ""}
          </form>
          <div class="duel-grid">
            ${renderTeamSnapshotCard(snapshots[state.form.team1])}
            ${renderTeamSnapshotCard(snapshots[state.form.team2])}
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <span class="kicker">Decision</span>
              <h2 class="panel-title">Prediction output</h2>
              <p class="panel-copy">Confidence score, factor breakdown, and both team profiles update after every run.</p>
            </div>
          </div>
          ${renderPredictionResult(state.prediction)}
        </section>
      </div>
    `;
  }

  function renderDashboardStoryCards(selectedTeam, meta) {
    const featuredBatter = selectedTeam?.topBatters?.[0];
    const featuredBowler = selectedTeam?.topBowlers?.[0];
    const featuredPhase = selectedTeam?.phasePerformance?.slice().sort((left, right) => (
      (right.battingRunRate - right.bowlingEconomy) - (left.battingRunRate - left.bowlingEconomy)
    ))[0];
    const featuredVenue = selectedTeam?.venuePerformance?.[0];
    const latestSeason = state.dashboard?.leagueSummary?.latestSeason || meta.latestSeason;

    return `
      <section class="panel">
        <div class="panel-header">
          <div>
            <span class="kicker">League context</span>
            <h2 class="panel-title">What stands out right now</h2>
            <p class="panel-copy">The archive currently runs through ${escapeHtml(latestSeason)}.</p>
          </div>
        </div>
        <div class="story-grid">
          <div class="story-card"><span class="label">Top batter</span><strong>${escapeHtml(featuredBatter ? featuredBatter.player : "No standout yet")}</strong><span>${escapeHtml(featuredBatter ? `${featuredBatter.runs} runs at SR ${formatNumber(featuredBatter.strikeRate, 1)}` : "Waiting on enough innings")}</span></div>
          <div class="story-card"><span class="label">Top bowler</span><strong>${escapeHtml(featuredBowler ? featuredBowler.player : "No standout yet")}</strong><span>${escapeHtml(featuredBowler ? `${featuredBowler.wickets} wickets at ${formatNumber(featuredBowler.economy, 2)}` : "Waiting on enough overs")}</span></div>
          <div class="story-card"><span class="label">Best phase</span><strong>${escapeHtml(featuredPhase ? featuredPhase.phase : "Balanced across phases")}</strong><span>${escapeHtml(featuredPhase ? `${formatNumber(featuredPhase.battingRunRate, 2)} rpo batting and ${formatNumber(featuredPhase.bowlingEconomy, 2)} economy` : "Phase profile unavailable")}</span></div>
          <div class="story-card"><span class="label">Comfort venue</span><strong>${escapeHtml(featuredVenue ? featuredVenue.venue : "Still balancing")}</strong><span>${escapeHtml(featuredVenue ? `${formatPercent(featuredVenue.winRate)} wins there with ${formatNumber(featuredVenue.avgScore, 1)} average runs` : "Venue profile unavailable")}</span></div>
        </div>
      </section>
    `;
  }

  function renderDashboardTop(meta) {
    const selectedTeam = state.dashboard?.selectedTeam;
    const theme = teamTheme(selectedTeam?.team || state.dashboardTeam);
    let overviewMarkup = `<div class="loading-card"><p class="muted">Dashboard unavailable right now.</p></div>`;

    if (state.dashboardLoading) {
      overviewMarkup = `<div class="loading-card"><p class="muted">Loading dashboard...</p></div>`;
    } else if (selectedTeam) {
      overviewMarkup = `
        <div class="stack">
          <div class="dashboard-spotlight" style="${buildStyle(theme, 72)}">
            <div class="spotlight-copy">
              <span class="tag">Team spotlight</span>
              <h3 class="spotlight-title">${escapeHtml(selectedTeam.team)}</h3>
              <p class="panel-copy">${escapeHtml(`${selectedTeam.overview.wins} wins, ${selectedTeam.overview.losses} losses, and a side built on ${formatNumber(selectedTeam.overview.battingRunRate, 2)} rpo batting with ${formatNumber(selectedTeam.overview.bowlingEconomy, 2)} bowling control.`)}</p>
            </div>
            <div class="spotlight-grid">
              <div class="spotlight-stat"><span>Win rate</span><strong>${formatPercent(selectedTeam.overview.winRate)}</strong></div>
              <div class="spotlight-stat"><span>Recent form</span><strong>${formatPercent(selectedTeam.overview.recentForm)}</strong></div>
              <div class="spotlight-stat"><span>Dot-ball pressure</span><strong>${formatPercent(selectedTeam.overview.dotRate)}</strong></div>
            </div>
          </div>
          <div class="summary-grid">
            <div class="metric-card"><span>Matches</span><strong>${escapeHtml(selectedTeam.overview.matches)}</strong></div>
            <div class="metric-card"><span>Win rate</span><strong>${formatPercent(selectedTeam.overview.winRate)}</strong></div>
            <div class="metric-card"><span>Recent form</span><strong>${formatPercent(selectedTeam.overview.recentForm)}</strong></div>
            <div class="metric-card"><span>Batting rate</span><strong>${escapeHtml(`${formatNumber(selectedTeam.overview.battingRunRate, 2)} rpo`)}</strong></div>
            <div class="metric-card"><span>Bowling econ</span><strong>${formatNumber(selectedTeam.overview.bowlingEconomy, 2)}</strong></div>
          </div>
          <div class="mini-card">
            <span>${escapeHtml(`${selectedTeam.team} toss conversion`)}</span>
            <strong>${formatPercent(selectedTeam.overview.tossConversion)}</strong>
            <span>${escapeHtml(`${selectedTeam.overview.wins} wins, ${selectedTeam.overview.losses} losses | ${formatPercent(selectedTeam.overview.dotRate)} dot-ball rate`)}</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="dashboard-top">
        <section class="panel">
          <div class="panel-header">
            <div>
              <span class="kicker">Dashboard</span>
              <h2 class="panel-title">Track a franchise story</h2>
              <p class="panel-copy">Read the side through season shape, venue confidence, phase tempo, and standout names.</p>
            </div>
          </div>
          ${renderSelectField({ label: "Team view", field: "dashboardTeam", value: state.dashboardTeam, options: meta.teams, full: true, scope: "dashboard" })}
          ${overviewMarkup}
        </section>
        ${renderDashboardStoryCards(selectedTeam, meta)}
      </div>
    `;
  }

  function renderDashboardGrid() {
    const selectedTeam = state.dashboard?.selectedTeam;
    const modelEvaluation = state.dashboard?.modelEvaluation;

    if (state.dashboardLoading) {
      return `<div class="loading-card"><p class="muted">Loading charts and leaderboards...</p></div>`;
    }

    if (!selectedTeam) {
      return `<div class="loading-card"><p class="muted">We could not load the dashboard details right now.</p></div>`;
    }

    const theme = teamTheme(selectedTeam.team);

    return `
      <div class="dashboard-grid">
        ${renderModelEvaluation(modelEvaluation, theme.accent)}
        <section class="panel">
          <div class="panel-header"><div><span class="kicker">Season trend</span><h2 class="panel-title">${escapeHtml(`${selectedTeam.team} by season`)}</h2></div></div>
          ${renderTrendChart(selectedTeam.seasonTrend, theme.accent)}
        </section>
        <section class="panel">
          <div class="panel-header"><div><span class="kicker">Venue performance</span><h2 class="panel-title">Where they travel best</h2></div></div>
          ${renderMetricBars({ items: selectedTeam.venuePerformance, accent: theme.accent, labelKey: "venue", valueKey: "winRate", displayValue: item => formatPercent(item.winRate), caption: item => `${item.wins} wins from ${item.matches} matches | avg ${formatNumber(item.avgScore, 1)}` })}
        </section>
        <section class="panel">
          <div class="panel-header"><div><span class="kicker">Rivalries</span><h2 class="panel-title">Head-to-head pressure points</h2></div></div>
          ${renderMetricBars({ items: selectedTeam.rivalries, accent: theme.accent, labelKey: "opponent", valueKey: "winRate", displayValue: item => formatPercent(item.winRate), caption: item => `${item.wins} wins in ${item.matches} meetings` })}
        </section>
        <section class="panel">
          <div class="panel-header"><div><span class="kicker">Phases</span><h2 class="panel-title">Powerplay to death profile</h2></div></div>
          ${renderMetricBars({ items: selectedTeam.phasePerformance, accent: theme.accent, labelKey: "phase", valueKey: "battingRunRate", displayValue: item => `${formatNumber(item.battingRunRate, 2)} rpo`, caption: item => `Bowling economy ${formatNumber(item.bowlingEconomy, 2)}` })}
        </section>
        <section class="panel">
          <div class="panel-header"><div><span class="kicker">Batters</span><h2 class="panel-title">Top run makers</h2></div></div>
          ${renderMetricBars({ items: selectedTeam.topBatters, accent: theme.accent, labelKey: "player", valueKey: "runs", displayValue: item => `${item.runs} runs`, caption: item => `SR ${formatNumber(item.strikeRate, 1)} | Avg ${formatNumber(item.average, 1)}` })}
        </section>
        <section class="panel">
          <div class="panel-header"><div><span class="kicker">Bowlers</span><h2 class="panel-title">Top wicket takers</h2></div></div>
          ${renderMetricBars({ items: selectedTeam.topBowlers, accent: theme.accent, labelKey: "player", valueKey: "wickets", displayValue: item => `${item.wickets} wickets`, caption: item => `Eco ${formatNumber(item.economy, 2)} | Dot ${formatPercent((item.dotRate || 0) * 100)}` })}
        </section>
        <section class="panel">
          <div class="panel-header"><div><span class="kicker">Recent matches</span><h2 class="panel-title">Latest six outings</h2></div></div>
          ${renderRecentMatches(selectedTeam.recentMatches)}
        </section>
        <section class="panel">
          <div class="panel-header"><div><span class="kicker">League leaders</span><h2 class="panel-title">Top run scorers overall</h2></div></div>
          <div class="table-list">${(state.dashboard.topBattersOverall || []).map(player => `
            <div class="table-row">
              <div><strong>${escapeHtml(player.player)}</strong><span>${escapeHtml(player.team)}</span></div>
              <strong>${escapeHtml(player.runs)}</strong>
              <span class="table-caption">${escapeHtml(`SR ${formatNumber(player.strikeRate, 1)}`)}</span>
            </div>
          `).join("")}</div>
        </section>
        <section class="panel">
          <div class="panel-header"><div><span class="kicker">League leaders</span><h2 class="panel-title">Top wicket takers overall</h2></div></div>
          <div class="table-list">${(state.dashboard.topBowlersOverall || []).map(player => `
            <div class="table-row">
              <div><strong>${escapeHtml(player.player)}</strong><span>${escapeHtml(player.team)}</span></div>
              <strong>${escapeHtml(player.wickets)}</strong>
              <span class="table-caption">${escapeHtml(`Eco ${formatNumber(player.economy, 2)}`)}</span>
            </div>
          `).join("")}</div>
        </section>
        <section class="panel wide-panel">
          <div class="panel-header"><div><span class="kicker">League table</span><h2 class="panel-title">Best win rates across the archive</h2></div></div>
          ${renderLeagueTable(state.dashboard.leagueTable)}
        </section>
      </div>
    `;
  }

  function renderDashboardView(meta) {
    return `<div class="main-layout">${renderDashboardTop(meta)}${renderDashboardGrid()}</div>`;
  }

  function renderLoadingState({ eyebrow, title, copy }) {
    return `
      <div class="loading-state">
        <div class="loading-card">
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h1>${escapeHtml(title)}</h1>
          <p class="muted">${escapeHtml(copy)}</p>
        </div>
      </div>
    `;
  }

  function renderApp() {
    if (state.metaError) {
      return renderLoadingState({
        eyebrow: "App error",
        title: "We could not load the match centre",
        copy: "Please refresh or try again in a moment."
      });
    }

    if (!state.meta) {
      return renderLoadingState({
        eyebrow: "Loading",
        title: "Preparing the match centre",
        copy: "Pulling together form, venue trends, and player profiles."
      });
    }

    const snapshots = snapshotsByTeam();
    return `<div class="app-shell">${renderHero(state.meta)}${state.view === "predictor" ? renderPredictorView(state.meta, snapshots) : renderDashboardView(state.meta)}</div>`;
  }

  function render() {
    root.innerHTML = renderApp();
  }

  async function loadMeta() {
    try {
      const nextMeta = await fetchJson("/api/meta");

      state.meta = nextMeta;
      state.metaError = "";
      state.form = {
        team1: nextMeta.defaults.team1,
        team2: nextMeta.defaults.team2,
        venue: nextMeta.defaults.venue,
        tossWinner: nextMeta.defaults.team1,
        player1: nextMeta.playersByTeam[nextMeta.defaults.team1]?.[0]?.value || "",
        player2: nextMeta.playersByTeam[nextMeta.defaults.team2]?.[0]?.value || ""
      };
      state.dashboardTeam = nextMeta.defaults.dashboardTeam;
      syncFormSelections();
      render();
      loadDashboard();
    } catch (error) {
      state.metaError = error.message || "Request failed.";
      render();
    }
  }

  async function loadDashboard() {
    if (!state.dashboardTeam) {
      return;
    }

    const requestId = ++dashboardRequestId;
    state.dashboardLoading = true;
    render();

    try {
      const data = await fetchJson(`/api/dashboard?team=${encodeURIComponent(state.dashboardTeam)}`);

      if (requestId !== dashboardRequestId) {
        return;
      }

      state.dashboard = data;
    } catch (error) {
      if (requestId !== dashboardRequestId) {
        return;
      }

      state.dashboard = null;
    } finally {
      if (requestId !== dashboardRequestId) {
        return;
      }

      state.dashboardLoading = false;
      render();
    }
  }

  async function handlePredict() {
    state.predictionError = "";
    state.predictionLoading = true;
    render();

    const requestId = ++predictionRequestId;

    try {
      const nextPrediction = await fetchJson("/api/predict", {
        method: "POST",
        body: JSON.stringify(state.form)
      });

      if (requestId !== predictionRequestId) {
        return;
      }

      state.prediction = nextPrediction;
    } catch (error) {
      if (requestId !== predictionRequestId) {
        return;
      }

      state.prediction = null;
      state.predictionError = error.message || "We could not complete that prediction right now.";
    } finally {
      if (requestId !== predictionRequestId) {
        return;
      }

      state.predictionLoading = false;
      render();
    }
  }

  root.addEventListener("click", event => {
    const button = event.target.closest("[data-view]");

    if (!button) {
      return;
    }

    state.view = button.dataset.view;
    render();
  });

  root.addEventListener("change", event => {
    const select = event.target.closest("select[data-field]");

    if (!select) {
      return;
    }

    const field = select.dataset.field;
    const scope = select.dataset.scope;

    if (scope === "dashboard") {
      state.dashboardTeam = select.value;
      loadDashboard();
      return;
    }

    if (!(field in state.form)) {
      return;
    }

    state.form[field] = select.value;
    syncFormSelections();
    render();
  });

  root.addEventListener("submit", event => {
    const form = event.target.closest("form[data-form='predictor']");

    if (!form) {
      return;
    }

    event.preventDefault();
    handlePredict();
  });

  render();
  loadMeta();
})();
