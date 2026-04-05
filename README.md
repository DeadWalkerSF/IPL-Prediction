# 🏏 IPL Match Studio

An advanced IPL (Indian Premier League) match prediction and intelligence platform. Combining historical match data, player performance metrics, and a **Random Forest Classifier** to provide real-time win probabilities and deep-dive team analytics.

![Aesthetic Dashboard Preview](https://via.placeholder.com/1200x600/08131d/f5efe2?text=IPL+Match+Studio+Dashboard)

## ✨ Key Features

-   **🔮 Win Probability Engine**: Leverages a Machine Learning model (Random Forest) trained on over 15 years of IPL history.
-   **📊 Dynamic Team Dashboards**: In-depth analysis of team momentum, venue success rates, and head-to-head records.
-   **📈 Momentum Tracking**: Visualize team performance over the last 5 seasons with interactive SVG charts.
-   **🏟️ Venue Intelligence**: Understand how different pitches influence match outcomes (First vs. Second innings bias).
-   **🛡️ Backtesting Framework**: Validate the prediction engine against historical results to measure accuracy.
-   **⚡ High Performance**: Native Node.js backend (no heavy frameworks) and a glassmorphic Vanilla JS frontend for a premium, snappy feel.

## 🛠️ Tech Stack

-   **Backend**: Node.js (Vanilla HTTP, Core FS)
-   **ML Layer**: `ml-random-forest` (Random Forest Classifier)
-   **Frontend**: HTML5, Vanilla CSS3 (Custom Design System with Glassmorphism), JavaScript (ES6+)
-   **Data Storage**: Flat CSV (Deliveries & Matches)

## 🚀 Getting Started

### Prerequisites

-   [Node.js](https://nodejs.org/) (v16+ recommended)
-   `npm` or `yarn`

### Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/DeadWalkerSF/IPL-Prediction.git
    cd IPL-Prediction
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

### Running the App

1.  **Start the server**:
    ```bash
    npm start
    ```
2.  **Open in browser**:
    Navigate to `http://127.0.0.1:5000`

### Running Backtests

To evaluate the model's performance against the historical dataset:
```bash
npm run backtest
```

## 📂 Project Structure

-   `analytics.js`: Core ML logic, feature extraction, and data processing.
-   `app.js`: Frontend application logic and UI rendering.
-   `server.js`: Lightweight Node.js backend server.
-   `backtest.js`: Model validation and accuracy benchmarking script.
-   `index.html`: Main application entry point.
-   `styles.css`: Premium aesthetics and responsive layout system.
-   `matches.csv`: Historical match records (2008-Present).
-   `deliveries.csv`: Ball-by-ball match data.

## 🧠 Prediction Model

The engine extracts several feature vectors to calculate win probability:
-   **Head-to-Head**: Historical record between the two specific teams.
-   **Recent Form**: Exponentially weighted performance from the last 10 matches.
-   **Venue Performance**: Team success rate at the specific match location.
-   **Phase Breakdown**: Powerplay vs Death Overs efficiency.
-   **Player Impact**: Aggregate contribution scores for selected squads.

---

*Made for IPL Fans and Data Enthusiasts.*
