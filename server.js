require('dotenv').config();
require('express-async-errors');
const app = require('./src/app');
const connectDB = require('./src/config/db');
const logger = require('./src/utils/logger');
const { startCronJobs } = require('./src/jobs/cron');

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await connectDB();
    logger.info('✅ MongoDB Atlas connected');

    app.listen(PORT, () => {
      logger.info(`🚀 EscrowPK Server running on port ${PORT} [${process.env.NODE_ENV}]`);
    });

    startCronJobs();
    logger.info('⏰ Cron jobs started');

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received. Shutting down gracefully...');
      process.exit(0);
    });
  } catch (error) {
    logger.error('❌ Server startup failed:', error);
    process.exit(1);
  }
}

startServer();
