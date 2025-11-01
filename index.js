require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// Config vars
const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const REDIRECT_URI = process.env.STRAVA_REDIRECT_URI;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_JSON = (() => {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.error('Missing environment variable');
    process.exit(1);
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', err.message);
    process.exit(1);
  }
})();
const MONGODB_URI = "mongodb://127.0.0.1:27017/strava";

// MongoDB setup
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Schema + Model
const TokenSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  access_token: { type: String, required: true },
  refresh_token: { type: String, required: true },
  expires_at: { type: Number, required: true }
}, { collection: 'strava_tokens' });

const TokenModel = mongoose.model('TokenModel', TokenSchema);
const userTokenSchema = new mongoose.Schema({
  athleteId: { type: String, required: true, unique: true },
  access_token: String,
  refresh_token: String,
  expires_at: Number
});

// Use CommonJS-style model binding (file is CommonJS — package.json has no "type":"module")
const UserToken = mongoose.model('UserToken', userTokenSchema);

const ActivitySchema = new mongoose.Schema({
  userId: { type: String, required: true },
  activity_id: { type: Number, required: true, unique: true },
  name: String,
  distance: Number,
  moving_time: Number,
  elapsed_time: Number,
  start_date: String,
  type: String,
}, { collection: 'strava_activities' });

const ActivityModel = mongoose.model('ActivityModel', ActivitySchema);


// Helper: Google Sheets client
function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_SERVICE_ACCOUNT_JSON,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

// OAuth redirect
app.get('/auth/strava', (req, res) => {
  const scope = 'activity:read_all';
  const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scope}&approval_prompt=force`;
  res.redirect(url);
});


app.get('/auth/strava/callback', async (req, res) => {
  const code = req.query.code;
  try {
    const tokenResponse = await axios.post('https://www.strava.com/oauth/token', null, {
      params: {
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code'
      }
    });

    const { access_token, refresh_token, expires_at, athlete } = tokenResponse.data;

    await UserToken.findOneAndUpdate(
      { athleteId: athlete.id },
      { access_token, refresh_token, expires_at },
      { upsert: true }
    );

    res.send('✅ Strava connected successfully. You can now fetch activities.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to authenticate with Strava');
  }
});


// Fetch + write endpoint
app.post('/fetch-activities', async (req, res) => {
  const { userId, days = 10 } = req.body;
  if (!userId) return res.status(400).send('Missing userId');

  const tokenDoc = await TokenModel.findOne({ userId }).lean();
  if (!tokenDoc) return res.status(400).send('No tokens found for user');

  let accessToken = tokenDoc.access_token;
  const nowSec = Math.floor(Date.now() / 1000);

  if (tokenDoc.expires_at && nowSec >= tokenDoc.expires_at) {
    // refresh
    try {
      const refreshResp = await axios.post('https://www.strava.com/oauth/token', {
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: tokenDoc.refresh_token
      });

      accessToken = refreshResp.data.access_token;
      const newTokens = {
        access_token: refreshResp.data.access_token,
        refresh_token: refreshResp.data.refresh_token,
        expires_at: refreshResp.data.expires_at
      };
      await TokenModel.findOneAndUpdate(
        { userId },
        { $set: newTokens },
        { upsert: true, new: true }
      );
    } catch (refreshErr) {
      console.error('Strava token refresh failed:', refreshErr.response?.data || refreshErr);
      return res.status(500).send('Token refresh failed');
    }
  }

  const after = nowSec - days * 24 * 3600;
  try {
    const actResp = await axios.get('https://www.strava.com/api/v3/athlete/activities', {
      params: { after: after },
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const activities = actResp.data;
//     
for (const act of activities) {
      await ActivityModel.findOneAndUpdate(
        { activity_id: act.id },
        {
          userId,
          activity_id: act.id,
          name: act.name,
          distance: act.distance,
          moving_time: act.moving_time,
          elapsed_time: act.elapsed_time,
          start_date: act.start_date,
          type: act.type,
        },
        { upsert: true }
      );
    }

    return res.send({ inserted: activities.length });
  } catch (err) {
    console.error('Fetch/write failed:', err.response?.data || err);
    return res.status(500).send('Failed to fetch or store activities');
  }
});

app.get('/activities/:athleteId', async (req, res) => {
  const { athleteId } = req.params;
  const tokenData = await UserToken.findOne({ athleteId });
  if (!tokenData) return res.status(404).send('User not authorized');

  let accessToken = tokenData.access_token;

  if (Date.now() / 1000 >= tokenData.expires_at) {
    const refreshResp = await axios.post('https://www.strava.com/oauth/token', null, {
      params: {
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: tokenData.refresh_token
      }
    });

    accessToken = refreshResp.data.access_token;

    await UserToken.findOneAndUpdate(
      { athleteId },
      {
        access_token: refreshResp.data.access_token,
        refresh_token: refreshResp.data.refresh_token,
        expires_at: refreshResp.data.expires_at
      }
    );
  }

  const response = await axios.get('https://www.strava.com/api/v3/athlete/activities', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  res.json(response.data);
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
