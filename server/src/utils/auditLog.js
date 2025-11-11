const AuditLog = require('../models/AuditLog');
const logger = require('./logger');

const createAuditLog = async (userId, action, resource, resourceId, details, req) => {
  try {
    await AuditLog.create({
      userId,
      action,
      resource,
      resourceId,
      details,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent') || 'Unknown'
    });
    logger.info(`Audit: ${action} on ${resource} by user ${userId}`);
  } catch (error) {
    logger.error('Audit log creation failed:', error);
  }
};

module.exports = { createAuditLog };