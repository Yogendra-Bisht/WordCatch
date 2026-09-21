const mongoose = require('mongoose');

/**
 * Connect to MongoDB using the MONGO_URI environment variable.
 * Exported so index.js can await it before starting the HTTP server.
 */
async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not defined in environment variables');
  }

  await mongoose.connect(uri, {
    // Mongoose 8 defaults are fine; no extra options needed
  });

  console.log(`MongoDB connected: ${mongoose.connection.host}`);
}

module.exports = connectDB;
