// Vercel serverless entry point: every /api/* request is routed here (see vercel.json)
const { app, errorHandler } = require('../snippet/server/app');

app.use(errorHandler);

module.exports = app;
