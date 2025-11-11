const { Queue, Worker } = require('bullmq');

let transactionQueue;
let isQueueAvailable = false;

const initQueue = async () => {
  try {
    const connection = {
      host: process.env.REDIS_URL ? new URL(process.env.REDIS_URL).hostname : 'localhost',
      port: process.env.REDIS_URL ? new URL(process.env.REDIS_URL).port : 6379
    };

    transactionQueue = new Queue('transactions', { connection });
    isQueueAvailable = true;
    console.log('✅ BullMQ Queue initialized');
  } catch (error) {
    console.log('⚠️  Queue not available, using direct processing');
    isQueueAvailable = false;
  }
};

const createTransactionWorker = (processFunction) => {
  if (!isQueueAvailable) return null;
  
  try {
    const connection = {
      host: process.env.REDIS_URL ? new URL(process.env.REDIS_URL).hostname : 'localhost',
      port: process.env.REDIS_URL ? new URL(process.env.REDIS_URL).port : 6379
    };

    return new Worker('transactions', processFunction, {
      connection,
      concurrency: 10
    });
  } catch (error) {
    console.log('⚠️  Worker creation failed');
    return null;
  }
};

module.exports = { transactionQueue: () => transactionQueue, createTransactionWorker, initQueue };
