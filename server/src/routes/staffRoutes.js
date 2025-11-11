// server/src/routes/staffRoutes.js - CLEAN VERSION
const express = require('express');
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Branch = require('../models/Branch');
const { protect, authorize } = require('../middleware/auth');
const dashboardService = require('../services/dashboardService');
const logger = require('../utils/logger');

const router = express.Router();

// Protect all staff routes
router.use(protect, authorize('staff'));

// @route   GET /api/staff/dashboard
// @desc    Get staff dashboard with balance and today's transactions
// @access  Staff only
router.get('/dashboard', async (req, res) => {
  try {
    const { branchId } = req.query;
    
    const dashboard = await dashboardService.getStaffDashboard(
      new mongoose.Types.ObjectId(req.user._id),
      branchId ? new mongoose.Types.ObjectId(branchId) : null
    );
    
    res.json({
      success: true,
      data: dashboard
    });
  } catch (error) {
    logger.error('Staff dashboard error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// @route   GET /api/staff/branches
// @desc    Get branches assigned to staff member
// @access  Staff only
router.get('/branches', async (req, res) => {
  try {
    const branches = await Branch.find({ 
      _id: { $in: req.user.branches },
      isActive: true
    })
      .populate('clientId', 'name phone')
      .sort({ name: 1 });
    
    res.json({
      success: true,
      count: branches.length,
      data: branches
    });
  } catch (error) {
    logger.error('Get branches error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// @route   GET /api/staff/transactions
// @desc    Get staff member's transactions
// @access  Staff only
router.get('/transactions', async (req, res) => {
  try {
    const { page = 1, limit = 50, branchId, type } = req.query;

    console.log('Staff transactions query:', {
      staffId: req.user._id,
      branchId,
      type,
      page,
      limit
    });

    const query = { 
      staffId: req.user._id, 
      status: 'completed' 
    };
    
    if (branchId) {
      query.branchId = new mongoose.Types.ObjectId(branchId);
    }
    if (type) {
      query.type = type;
    }

    // Check total count
    const totalCount = await Transaction.countDocuments(query);
    console.log(`Found ${totalCount} transactions for staff`);

    // Use aggregation with pagination
    if (Transaction.aggregatePaginate) {
      const aggregate = Transaction.aggregate([
        { $match: query },
        { $sort: { createdAt: -1 } },
        {
          $lookup: {
            from: 'users',
            localField: 'clientId',
            foreignField: '_id',
            as: 'client'
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
        {
          $addFields: {
            client: { $arrayElemAt: ['$client', 0] },
            branch: { $arrayElemAt: ['$branch', 0] }
          }
        },
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
            status: 1,
            createdAt: 1,
            'client.name': 1,
            'client.phone': 1,
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
      
      console.log('Paginated transactions result:', {
        totalDocs: transactions.totalDocs,
        docsReturned: transactions.docs?.length || 0
      });

      res.json({
        success: true,
        data: transactions
      });
    } else {
      // Fallback without aggregatePaginate
      const transactions = await Transaction.find(query)
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit))
        .populate('clientId', 'name phone')
        .populate('branchId', 'name code')
        .lean();

      console.log(`Returning ${transactions.length} transactions`);

      res.json({
        success: true,
        data: {
          docs: transactions,
          totalDocs: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(totalCount / parseInt(limit))
        }
      });
    }
  } catch (error) {
    logger.error('Get transactions error:', error);
    console.error('Get transactions error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// @route   GET /api/staff/balance
// @desc    Get current wallet balance
// @access  Staff only
router.get('/balance', async (req, res) => {
  try {
    const staff = await User.findById(req.user._id).select('walletBalance');
    
    res.json({
      success: true,
      data: {
        walletBalance: staff.walletBalance || 0,
        isNegative: (staff.walletBalance || 0) < 0
      }
    });
  } catch (error) {
    logger.error('Get balance error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

module.exports = router;