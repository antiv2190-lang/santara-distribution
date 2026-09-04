// Santara Distribution — serveur central
// Sert l'application web ET stocke les données dans une base MongoDB partagée,
// afin que le PC et les téléphones voient toujours les mêmes informations.

const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Base de données ----------
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('ERREUR : la variable d\'environnement MONGODB_URI est manquante. Voir README.md.');
  process.exit(1);
}

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connecté à la base de données.'))
  .catch(err => {
    console.error('Impossible de se connecter à la base de données :', err.message);
    process.exit(1);
  });

// Toute l'application partage un seul document d'état (comme avant, mais côté serveur).
const StateSchema = new mongoose.Schema({
  singleton: { type: String, default: 'santara', unique: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now }
});
const StateModel = mongoose.model('AppState', StateSchema);

// ---------- API : lecture / écriture des données ----------
app.get('/api/state', async (req, res) => {
  try {
    const doc = await StateModel.findOne({ singleton: 'santara' });
    res.json(doc ? doc.data : null);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur de lecture des données.' });
  }
});

app.post('/api/state', async (req, res) => {
  try {
    await StateModel.findOneAndUpdate(
      { singleton: 'santara' },
      { data: req.body, updatedAt: new Date() },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur d\'enregistrement des données.' });
  }
});

// ---------- API : Assistant IA (relais sécurisé vers Claude) ----------
app.post('/api/ai', async (req, res) => {
  const { question, context } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Clé ANTHROPIC_API_KEY non configurée sur le serveur. Voir README.md." });
  }
  if (!question) {
    return res.status(400).json({ error: 'Question manquante.' });
  }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content:
            "Tu es l'assistant de gestion d'Etablissement Santara Distribution (grossiste en riz, huile, produits de première nécessité au Mali). " +
            "Voici les données actuelles de l'entreprise au format JSON :\n\n" + (context || '{}') +
            "\n\nQuestion du gérant : " + question +
            "\n\nRéponds en français, de façon concise et concrète, en t'appuyant sur les chiffres réels fournis. " +
            "Structure ta réponse avec des puces si utile. Ne donne pas de conseils génériques sans lien avec les données."
        }]
      })
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: data.error?.message || 'Erreur de l\'API IA.' });
    }
    const answer = (data.content || []).map(c => c.text || '').join('\n').trim();
    res.json({ answer });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la requête à l\'assistant IA.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Santara Distribution en écoute sur le port ${PORT}`));
