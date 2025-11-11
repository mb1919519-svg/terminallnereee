const { createClient } = require('redis');

let redisClient;
let isRedisConnected = false;

const connectRedis = async () => {
  try {
    redisClient = createClient({
      url: process.env.REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            console.log('❌ Redis reconnection failed');
            return new Error('Redis reconnection limit exceeded');
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    redisClient.on('error', (err) => {
      console.log('❌ Redis Client Error:', err.message);
      isRedisConnected = false;
    });

    redisClient.on('connect', () => {
      console.log('✅ Redis Client Connected');
      isRedisConnected = true;
    });

    await redisClient.connect();
  } catch (error) {
    console.log('⚠️  Redis not available, running without cache');
    isRedisConnected = false;
  }
};

const getRedisClient = () => redisClient;
const isConnected = () => isRedisConnected;

module.exports = { connectRedis, redisClient: getRedisClient, isRedisConnected: isConnected };
