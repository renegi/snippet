const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { errorHandler } = require('./middleware/errorHandler');
const extractRouter = require('./api/extractRouter');
const transcriptRouter = require('./api/transcriptRouter');
const searchRouter = require('./api/searchRouter');

// The Express app shared by the local dev server (server.js) and the
// Vercel serverless function (api/index.js at the repo root).
const app = express();

// Vercel sits behind a proxy; trust it so req.ip is the real client
app.set('trust proxy', 1);

// In production the client is served from the same origin, so CORS is only
// needed for local development (React dev server on another port)
if (process.env.NODE_ENV !== 'production') {
  app.use(cors());
}
app.use(express.json());

// Basic per-IP limits on the endpoints that call paid APIs
const limitMessage = { success: false, error: { message: 'Too many requests, please try again in a few minutes' } };
const extractLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: limitMessage });
const transcriptLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: limitMessage });

app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.use('/api/extract', extractLimiter, extractRouter);
app.use('/api/transcript', transcriptLimiter, transcriptRouter);
app.use('/api', searchRouter);

module.exports = { app, errorHandler };
