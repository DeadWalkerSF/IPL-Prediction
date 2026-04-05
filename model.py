import pandas as pd
from sklearn.ensemble import RandomForestClassifier
import pickle

# Load dataset
df = pd.read_csv("matches.csv")

# Clean data
df = df.dropna(subset=['winner'])
df = df[['team1', 'team2', 'toss_winner', 'winner']]
df = df.dropna()

# Create team mapping
teams = list(set(df['team1']).union(set(df['team2'])))
team_map = {team: i for i, team in enumerate(teams)}

# Convert to numbers
df['team1'] = df['team1'].map(team_map)
df['team2'] = df['team2'].map(team_map)
df['toss_winner'] = df['toss_winner'].map(team_map)
df['winner'] = df['winner'].map(team_map)

# Features & labels
X = df[['team1', 'team2', 'toss_winner']]
y = df['winner']

# Train model
model = RandomForestClassifier(n_estimators=200)
model.fit(X, y)

# Save model
pickle.dump(model, open("model.pkl", "wb"))
pickle.dump(team_map, open("teams.pkl", "wb"))

print("Model trained successfully!")