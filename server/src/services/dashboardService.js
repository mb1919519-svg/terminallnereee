// server/src/services/dashboardService.js - UPDATED for staff balance
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const logger = require('../utils/logger');

class DashboardService {
  async getAdminDashboard(filters = {}) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const matchStage = {
        createdAt: { $gte: today },
        status: 'completed',
        ...filters
      };

      const summary = await Transaction.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalCredits: {
              $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$finalAmount', 0] }
            },
            totalDebits: {
              $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$finalAmount', 0] }
            },
            commission: { $sum: '$commission' },
            transactionCount: { $sum: 1 }
          }
        }
      ]);

      return summary[0] || {
        totalCredits: 0,
        totalDebits: 0,
        commission: 0,
        transactionCount: 0
      };
    } catch (error) {
      logger.error('Admin dashboard error:', error);
      throw error;
    }
  }

  async getClientDashboard(clientId) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const clientObjectId = clientId instanceof mongoose.Types.ObjectId 
        ? clientId 
        : new mongoose.Types.ObjectId(clientId);

      const matchStage = {
        clientId: clientObjectId,
        createdAt: { $gte: today },
        status: 'completed'
      };

      const summary = await Transaction.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalCredits: {
              $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$finalAmount', 0] }
            },
            totalDebits: {
              $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$finalAmount', 0] }
            },
            commission: { $sum: '$commission' },
            transactionCount: { $sum: 1 }
          }
        }
      ]);

      return summary[0] || {
        totalCredits: 0,
        totalDebits: 0,
        commission: 0,
        transactionCount: 0,
        walletBalance: 0  // Always 0 for clients (not used)
      };
    } catch (error) {
      logger.error('Client dashboard error:', error);
      throw error;
    }
  }

  async getStaffDashboard(staffId, branchId = null) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const staffObjectId = staffId instanceof mongoose.Types.ObjectId 
        ? staffId 
        : new mongoose.Types.ObjectId(staffId);

      const matchStage = {
        staffId: staffObjectId,
        createdAt: { $gte: today },
        status: 'completed'
      };

      if (branchId) {
        const branchObjectId = branchId instanceof mongoose.Types.ObjectId 
          ? branchId 
          : new mongoose.Types.ObjectId(branchId);
        matchStage.branchId = branchObjectId;
      }

      const summary = await Transaction.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalCredits: {
              $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$finalAmount', 0] }
            },
            totalDebits: {
              $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$finalAmount', 0] }
            },
            commission: { $sum: '$commission' },
            transactionCount: { $sum: 1 }
          }
        }
      ]);

      // CHANGED: Get current staff balance
      const staff = await User.findById(staffObjectId).select('walletBalance');

      return {
        ...(summary[0] || {
          totalCredits: 0,
          totalDebits: 0,
          commission: 0,
          transactionCount: 0
        }),
        walletBalance: staff?.walletBalance || 0  // Staff's current balance
      };
    } catch (error) {
      logger.error('Staff dashboard error:', error);
      throw error;
    }
  }
}

module.exports = new DashboardService();