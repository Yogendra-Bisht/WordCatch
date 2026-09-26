const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

// Start in-memory Mongo & connect Mongoose before all tests
module.exports.connect = async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGO_URI = uri;
  process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing';
  process.env.JWT_EXPIRES_IN = '1h';
  await mongoose.connect(uri);
};

// Drop all collections between test suites (isolation)
module.exports.clearDB = async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
};

// Disconnect & stop in-memory Mongo after all tests
module.exports.closeDB = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
};
