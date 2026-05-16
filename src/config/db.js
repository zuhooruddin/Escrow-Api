require('./patchMongoDns');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      family: 4,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    logger.info(`MongoDB Connected: ${conn.connection.host}`);

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
    });

    return conn;
  } catch (err) {
    if (err.name === 'MongooseServerSelectionError' || /Server selection timed out|connect to any servers/i.test(err.message || '')) {
      logger.error(
        'MongoDB Atlas: add your public IP (or 0.0.0.0/0 for local dev only) under Atlas → Network Access → IP Access List. ' +
          'https://www.mongodb.com/docs/atlas/security-whitelist/',
      );
    }
    throw err;
  }
};

module.exports = connectDB;
