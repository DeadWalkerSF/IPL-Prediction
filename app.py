from flask_cors import CORS
from flask import Flask, request, jsonify, send_file
import pickle

app = Flask(__name__)
CORS(app)

model = pickle.load(open("model.pkl", "rb"))
team_map = pickle.load(open("teams.pkl", "rb"))

@app.route('/')
def home():
    return send_file("index.html")

@app.route('/predict', methods=['POST'])
def predict():
    data = request.get_json()

    try:
        team1 = team_map[data['team1']]
        team2 = team_map[data['team2']]
        toss = team_map[data['toss_winner']]
    except:
        return jsonify({"error": "Invalid team name"})

    prediction = model.predict([[team1, team2, toss]])[0]

    inv_map = {v: k for k, v in team_map.items()}
    winner = inv_map[prediction]

    return jsonify({"winner": winner})

if __name__ == '__main__':
    app.run(debug=True)
