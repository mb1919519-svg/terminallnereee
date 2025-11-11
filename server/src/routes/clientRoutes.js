// server/src/routes/clientRoutes.js - FIXED VERSION
const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Branch = require('../models/Branch');
const Transaction = require('../models/Transaction');
const { protect, authorize } = require('../middleware/auth');
const dashboardService = require('../services/dashboardService');
const logger = require('../utils/logger');

const router = express.Router();

// Protect all client routes
router.use(protect, authorize('client'));

// @route   GET /api/client/dashboard
// @desc    Get client dashboard
// @access  Client only
router.get('/dashboard', async (req, res) => {
  try {
    // FIX: Use new keyword with ObjectId
    const dashboard = await dashboardService.getClientDashboard(
      new mongoose.Types.ObjectId(req.user._id)
    );
    
    res.json({
      success: true,
      data: {
        ...dashboard,
        walletBalance: req.user.walletBalance
      }
    });
  } catch (error) {
    logger.error('Client dashboard error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/client/branches
// @desc    Get client's branches
// @access  Client only
router.get('/branches', async (req, res) => {
  try {
    const branches = await Branch.find({ clientId: req.user._id, isActive: true })
      .populate('staffMembers', 'name phone')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: branches.length,
      data: branches
    });
  } catch (error) {
    logger.error('Get branches error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/client/transactions
// @desc    Get client's transaction history
// @access  Client only
router.get('/transactions', async (req, res) => {
  try {
    const { page = 1, limit = 20, branchId, type, startDate, endDate } = req.query;

    const query = { clientId: req.user._id, status: 'completed' };
    
    if (branchId) query.branchId = branchId;
    if (type) query.type = type;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const aggregate = Transaction.aggregate([
      { $match: query },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: 'users',
          localField: 'staffId',
          foreignField: '_id',
          as: 'staff'
        }
      },
      {
        $lookup: {
          from: 'branches',
          localField: 'branchId',
          foreignField: '_id',
          as: 'branch'
        }
      },
      { $unwind: '$staff' },
      { $unwind: '$branch' },
      {
        $project: {
          type: 1,
          amount: 1,
          commission: 1,
          finalAmount: 1,
          remark: 1,
          utrId: 1,
          balanceBefore: 1,
          balanceAfter: 1,
          createdAt: 1,
          'staff.name': 1,
          'staff.phone': 1,
          'branch.name': 1,
          'branch.code': 1
        }
      }
    ]);

    const options = {
      page: parseInt(page),
      limit: parseInt(limit)
    };

    const transactions = await Transaction.aggregatePaginate(aggregate, options);
    
    res.json({
      success: true,
      data: transactions
    });
  } catch (error) {
    logger.error('Get transactions error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/client/wallet
// @desc    Get wallet balance
// @access  Client only
router.get('/wallet', async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('walletBalance');
    
    res.json({
      success: true,
      data: {
        walletBalance: user.walletBalance
      }
    });
  } catch (error) {
    logger.error('Get wallet error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;