const rateLimit = require('express-rate-limit');

const createRateLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: { success: false, message: message || 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    // Uses in-memory store by default (no Redis needed)
  });
};

const authLimiter = createRateLimiter(
  15 * 60 * 1000, 
  5, 
  'Too many login attempts, please try again after 15 minutes'
);

const apiLimiter = createRateLimiter(
  1 * 60 * 1000, 
  100, 
  'Too many requests, please try again later'
);

module.exports = { authLimiter, apiLimiter };