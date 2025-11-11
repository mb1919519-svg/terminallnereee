// server/src/routes/adminRoutes.js - FIXED ObjectId issue
const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Branch = require('../models/Branch');
const Settings = require('../models/Settings');
const Transaction = require('../models/Transaction');
const { protect, authorize } = require('../middleware/auth');
const dashboardService = require('../services/dashboardService');
const { createAuditLog } = require('../utils/auditLog');
const logger = require('../utils/logger');

const router = express.Router();

// Protect all admin routes
router.use(protect, authorize('admin'));

// @route   POST /api/admin/clients
router.post('/clients', [
  body('name').notEmpty().trim().withMessage('Name is required'),
  body('phone').matches(/^[0-9]{10}$/).withMessage('Valid 10-digit phone number is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  // REMOVED: walletBalance validation - no longer used for clients
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        message: errors.array()[0].msg,
        errors: errors.array() 
      });
    }

    const { name, phone, password } = req.body;  // REMOVED: walletBalance

    const userExists = await User.findOne({ phone });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'Phone number already in use' });
    }

    // CHANGED: No wallet balance for clients
    const client = await User.create({
      name,
      phone,
      password,
      role: 'client',
      walletBalance: 0,  // Always 0 for clients (not used)
      createdBy: req.user._id
    });

    await createAuditLog(req.user._id, 'create_client', 'user', client._id, 
      { name, phone }, req);

    logger.info(`Client created: ${client.phone} by admin ${req.user.phone}`);

    const clientData = await User.findById(client._id).select('-password');

    res.status(201).json({
      success: true,
      message: 'Client created successfully',
      data: clientData
    });
  } catch (error) {
    logger.error('Create client error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/admin/branches
router.post('/branches', [
  body('name').notEmpty().trim().withMessage('Branch name is required'),
  body('code').notEmpty().trim().withMessage('Branch code is required'),
  body('clientId').isMongoId().withMessage('Valid client ID is required'),
  body('address').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        message: errors.array()[0].msg,
        errors: errors.array() 
      });
    }

    const { name, code, clientId, address } = req.body;

    const existingBranch = await Branch.findOne({ code: code.toUpperCase() });
    if (existingBranch) {
      return res.status(400).json({ 
        success: false, 
        message: 'Branch code already exists' 
      });
    }

    const client = await User.findById(clientId);
    if (!client || client.role !== 'client') {
      return res.status(400).json({ success: false, message: 'Invalid client ID' });
    }

    const branch = await Branch.create({
      name,
      code: code.toUpperCase(),
      clientId,
      address: address || '',
      createdBy: req.user._id
    });

    const populatedBranch = await Branch.findById(branch._id)
      .populate('clientId', 'name phone')
      .populate('staffMembers', 'name phone');

    await createAuditLog(req.user._id, 'create_branch', 'branch', branch._id, 
      { name, code, clientId }, req);

    logger.info(`Branch created: ${branch.code} by admin ${req.user.phone}`);

    res.status(201).json({
      success: true,
      message: 'Branch created successfully',
      data: populatedBranch
    });
  } catch (error) {
    logger.error('Create branch error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false, 
        message: 'Branch code already exists' 
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});
router.post('/staff', [
  body('name').notEmpty().trim().withMessage('Name is required'),
  body('phone').matches(/^[0-9]{10}$/).withMessage('Valid 10-digit phone number is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        message: errors.array()[0].msg,
        errors: errors.array() 
      });
    }

    const { name, phone, password } = req.body;

    const userExists = await User.findOne({ phone });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'Phone number already in use' });
    }

    // CHANGED: Staff starts with 0 balance
    const staff = await User.create({
      name,
      phone,
      password,
      role: 'staff',
      walletBalance: 0,  // Starts at 0, will change with transactions
      branches: [],
      clientId: null,
      createdBy: req.user._id
    });

    await createAuditLog(req.user._id, 'create_staff', 'user', staff._id, 
      { name, phone }, req);

    logger.info(`Staff created: ${staff.phone} by admin ${req.user.phone}`);

    const populatedStaff = await User.findById(staff._id)
      .select('-password')
      .populate('branches', 'name code clientId')
      .populate({
        path: 'branches',
        populate: { path: 'clientId', select: 'name phone' }
      });

    res.status(201).json({
      success: true,
      message: 'Staff member created successfully',
      data: populatedStaff
    });
  } catch (error) {
    logger.error('Create staff error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});
// Add these routes to server/src/routes/adminRoutes.js

// @route   DELETE /api/admin/clients/:id
// @desc    Delete client (soft delete - deactivate)
router.delete('/clients/:id', async (req, res) => {
  try {
    const client = await User.findById(req.params.id);
    
    if (!client || client.role !== 'client') {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    // Check if client has any branches
    const branches = await Branch.find({ clientId: client._id });
    if (branches.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete client with existing branches. Delete branches first.' 
      });
    }

    // Soft delete - deactivate instead of removing
    client.isActive = false;
    await client.save();

    await createAuditLog(req.user._id, 'delete_client', 'user', client._id, 
      { name: client.name, phone: client.phone }, req);

    logger.info(`Client deleted: ${client.phone} by admin ${req.user.phone}`);

    res.json({
      success: true,
      message: 'Client deleted successfully'
    });
  } catch (error) {
    logger.error('Delete client error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   DELETE /api/admin/branches/:id
// @desc    Delete branch (soft delete - deactivate)
router.delete('/branches/:id', async (req, res) => {
  try {
    const branch = await Branch.findById(req.params.id);
    
    if (!branch) {
      return res.status(404).json({ success: false, message: 'Branch not found' });
    }

    // Check if branch has any transactions
    const transactionCount = await Transaction.countDocuments({ branchId: branch._id });
    if (transactionCount > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot delete branch with ${transactionCount} transaction(s). Archive it instead by deactivating.` 
      });
    }

    // Remove branch from all assigned staff
    await User.updateMany(
      { branches: branch._id },
      { $pull: { branches: branch._id } }
    );

    // Soft delete
    branch.isActive = false;
    await branch.save();

    await createAuditLog(req.user._id, 'delete_branch', 'branch', branch._id, 
      { name: branch.name, code: branch.code }, req);

    logger.info(`Branch deleted: ${branch.code} by admin ${req.user.phone}`);

    res.json({
      success: true,
      message: 'Branch deleted successfully'
    });
  } catch (error) {
    logger.error('Delete branch error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   DELETE /api/admin/transactions/:id
// @desc    Delete transaction (hard delete with balance reversal)
// router.delete('/transactions/:id', async (req, res) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const transaction = await Transaction.findById(req.params.id).session(session);
    
//     if (!transaction) {
//       await session.abortTransaction();
//       return res.status(404).json({ success: false, message: 'Transaction not found' });
//     }

//     // Get staff member
//     const staff = await User.findById(transaction.staffId).session(session);
//     if (!staff) {
//       await session.abortTransaction();
//       return res.status(404).json({ success: false, message: 'Staff member not found' });
//     }

//     // Reverse the balance change
//     if (transaction.type === 'credit') {
//       // Was: staff balance increased by finalAmount
//       // Reverse: decrease staff balance
//       staff.walletBalance -= transaction.finalAmount;
//     } else if (transaction.type === 'debit') {
//       // Was: staff balance decreased by finalAmount
//       // Reverse: increase staff balance
//       staff.walletBalance += transaction.finalAmount;
//     }

//     await staff.save({ session });

//     // Delete the transaction
//     await Transaction.findByIdAndDelete(transaction._id).session(session);

//     await createAuditLog(req.user._id, 'delete_transaction', 'transaction', transaction._id, 
//       { 
//         type: transaction.type, 
//         amount: transaction.amount, 
//         reversedBalance: staff.walletBalance 
//       }, req);

//     await session.commitTransaction();

//     logger.info(`Transaction deleted: ${transaction._id} by admin ${req.user.phone}`);

//     res.json({
//       success: true,
//       message: 'Transaction deleted and balance reversed successfully'
//     });
//   } catch (error) {
//     await session.abortTransaction();
//     logger.error('Delete transaction error:', error);
//     res.status(500).json({ success: false, message: error.message });
//   } finally {
//     session.endSession();
//   }
// });

// @route   DELETE /api/admin/staff/:id
// @desc    Delete staff member (soft delete)
router.delete('/staff/:id', async (req, res) => {
  try {
    const staff = await User.findById(req.params.id);
    
    if (!staff || staff.role !== 'staff') {
      return res.status(404).json({ success: false, message: 'Staff member not found' });
    }

    // Check if staff has any transactions
    const transactionCount = await Transaction.countDocuments({ staffId: staff._id });
    if (transactionCount > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot delete staff with ${transactionCount} transaction(s). Deactivate instead.` 
      });
    }

    // Remove staff from all branches
    await Branch.updateMany(
      { staffMembers: staff._id },
      { $pull: { staffMembers: staff._id } }
    );

    // Soft delete
    staff.isActive = false;
    staff.branches = [];
    await staff.save();

    await createAuditLog(req.user._id, 'delete_staff', 'user', staff._id, 
      { name: staff.name, phone: staff.phone }, req);

    logger.info(`Staff deleted: ${staff.phone} by admin ${req.user.phone}`);

    res.json({
      success: true,
      message: 'Staff member deleted successfully'
    });
  } catch (error) {
    logger.error('Delete staff error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   POST /api/admin/staff/:staffId/assign-branches
// @desc    Assign staff to branches (can be from multiple clients)
router.post('/staff/:staffId/assign-branches', [
  body('branchIds').isArray().withMessage('Branch IDs must be an array'),
  body('branchIds.*').isMongoId().withMessage('Invalid branch ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        message: errors.array()[0].msg,
        errors: errors.array() 
      });
    }

    const { staffId } = req.params;
    const { branchIds } = req.body;

    const staff = await User.findById(staffId);
    if (!staff || staff.role !== 'staff') {
      return res.status(404).json({ success: false, message: 'Staff member not found' });
    }

    // Verify all branches exist
    const branches = await Branch.find({ _id: { $in: branchIds } });
    if (branches.length !== branchIds.length) {
      return res.status(400).json({ success: false, message: 'One or more invalid branch IDs' });
    }

    // Remove staff from old branches
    await Branch.updateMany(
      { staffMembers: staffId },
      { $pull: { staffMembers: staffId } }
    );

    // Add staff to new branches
    await Branch.updateMany(
      { _id: { $in: branchIds } },
      { $addToSet: { staffMembers: staffId } }
    );

    // Update staff document
    staff.branches = branchIds;
    await staff.save();

    const populatedStaff = await User.findById(staffId)
      .select('-password')
      .populate({
        path: 'branches',
        populate: { path: 'clientId', select: 'name phone' }
      });

    await createAuditLog(req.user._id, 'assign_branches', 'user', staff._id, 
      { branchIds }, req);

    logger.info(`Staff ${staff.phone} assigned to ${branchIds.length} branches by admin ${req.user.phone}`);

    res.json({
      success: true,
      message: 'Branches assigned successfully',
      data: populatedStaff
    });
  } catch (error) {
    logger.error('Assign branches error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/admin/staff
// @desc    Get all staff members with their branch assignments
router.get('/staff', async (req, res) => {
  try {
    const staff = await User.find({ role: 'staff' })
      .select('-password')
      .populate({
        path: 'branches',
        populate: { path: 'clientId', select: 'name phone' }
      })
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: staff.length,
      data: staff
    });
  } catch (error) {
    logger.error('Get staff error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/admin/staff/unassigned
// @desc    Get staff members not assigned to any branch
router.get('/staff/unassigned', async (req, res) => {
  try {
    const staff = await User.find({ 
      role: 'staff',
      $or: [
        { branches: { $exists: false } },
        { branches: { $size: 0 } }
      ]
    })
      .select('-password')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: staff.length,
      data: staff
    });
  } catch (error) {
    logger.error('Get unassigned staff error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/admin/branches/:branchId/staff
// @desc    Get all staff assigned to a specific branch
router.get('/branches/:branchId/staff', async (req, res) => {
  try {
    const { branchId } = req.params;

    const branch = await Branch.findById(branchId)
      .populate('staffMembers', 'name phone');

    if (!branch) {
      return res.status(404).json({ success: false, message: 'Branch not found' });
    }

    res.json({
      success: true,
      data: branch.staffMembers
    });
  } catch (error) {
    logger.error('Get branch staff error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   DELETE /api/admin/staff/:staffId/remove-branch/:branchId
// @desc    Remove staff from a specific branch
router.delete('/staff/:staffId/remove-branch/:branchId', async (req, res) => {
  try {
    const { staffId, branchId } = req.params;

    const staff = await User.findById(staffId);
    if (!staff || staff.role !== 'staff') {
      return res.status(404).json({ success: false, message: 'Staff member not found' });
    }

    // Remove branch from staff
    staff.branches = staff.branches.filter(b => b.toString() !== branchId);
    await staff.save();

    // Remove staff from branch
    await Branch.findByIdAndUpdate(branchId, {
      $pull: { staffMembers: staffId }
    });

    await createAuditLog(req.user._id, 'remove_branch', 'user', staff._id, 
      { branchId }, req);

    logger.info(`Staff ${staff.phone} removed from branch ${branchId} by admin ${req.user.phone}`);

    res.json({
      success: true,
      message: 'Staff removed from branch successfully'
    });
  } catch (error) {
    logger.error('Remove branch error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/admin/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const { clientId, branchId } = req.query;
    
    const filters = {};
    // FIX: Added 'new' keyword
    if (clientId && mongoose.Types.ObjectId.isValid(clientId)) {
      filters.clientId = new mongoose.Types.ObjectId(clientId);
    }
    if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
      filters.branchId = new mongoose.Types.ObjectId(branchId);
    }

    const dashboard = await dashboardService.getAdminDashboard(filters);
    
    res.json({
      success: true,
      data: dashboard
    });
  } catch (error) {
    logger.error('Admin dashboard error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/admin/clients
router.get('/clients', async (req, res) => {
  try {
    const clients = await User.find({ role: 'client' })
      .select('-password')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: clients.length,
      data: clients
    });
  } catch (error) {
    logger.error('Get clients error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/admin/branches
router.get('/branches', async (req, res) => {
  try {
    const branches = await Branch.find()
      .populate('clientId', 'name phone')
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

// @route   GET /api/admin/staff
router.get('/staff', async (req, res) => {
  try {
    const staff = await User.find({ role: 'staff' })
      .select('-password')
      .populate('branches', 'name code')
      .populate('clientId', 'name phone')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: staff.length,
      data: staff
    });
  } catch (error) {
    logger.error('Get staff error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/admin/transactions
router.get('/transactions', async (req, res) => {
  try {
    const { page = 1, limit = 20, clientId, branchId, type, startDate, endDate } = req.query;

    const query = { status: 'completed' };
    
    if (clientId && mongoose.Types.ObjectId.isValid(clientId)) {
      query.clientId = new mongoose.Types.ObjectId(clientId);
    }
    if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
      query.branchId = new mongoose.Types.ObjectId(branchId);
    }
    if (type) query.type = type;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    console.log('Admin transactions query:', query);

    // Check total count first
    const totalCount = await Transaction.countDocuments(query);
    console.log(`Found ${totalCount} total transactions`);

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
      {
        $addFields: {
          client: { $arrayElemAt: ['$client', 0] },
          staff: { $arrayElemAt: ['$staff', 0] },
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
    
    console.log('Admin transactions result:', {
      totalDocs: transactions.totalDocs,
      docsReturned: transactions.docs?.length || 0
    });
    
    res.json({
      success: true,
      data: transactions
    });
  } catch (error) {
    logger.error('Get transactions error:', error);
    console.error('Get transactions error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});
// @route   PUT /api/admin/settings
router.put('/settings', [
  body('commissionRate').optional().isFloat({ min: 0, max: 100 }).withMessage('Commission rate must be between 0-100'),
  body('depositDeductionRate').optional().isFloat({ min: 0, max: 100 }).withMessage('Deposit deduction rate must be between 0-100')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { commissionRate, depositDeductionRate } = req.body;

    let settings = await Settings.findOne();
    
    if (!settings) {
      settings = await Settings.create({
        commissionRate: commissionRate || 3,
        depositDeductionRate: depositDeductionRate || 3,
        updatedBy: req.user._id
      });
    } else {
      if (commissionRate !== undefined) settings.commissionRate = commissionRate;
      if (depositDeductionRate !== undefined) settings.depositDeductionRate = depositDeductionRate;
      settings.updatedBy = req.user._id;
      await settings.save();
    }

    await createAuditLog(req.user._id, 'update_settings', 'settings', settings._id, 
      { commissionRate, depositDeductionRate }, req);

    logger.info(`Settings updated by admin ${req.user.phone}`);

    res.json({
      success: true,
      message: 'Settings updated successfully',
      data: settings
    });
  } catch (error) {
    logger.error('Update settings error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   GET /api/admin/settings
router.get('/settings', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    
    if (!settings) {
      settings = await Settings.create({
        commissionRate: 3,
        depositDeductionRate: 3
      });
    }

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    logger.error('Get settings error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @route   PUT /api/admin/users/:id/status
router.put('/users/:id/status', async (req, res) => {
  try {
    const { isActive } = req.body;
    
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.isActive = isActive;
    await user.save();

    await createAuditLog(req.user._id, 'update_user_status', 'user', user._id, 
      { isActive }, req);

    logger.info(`User ${user.phone} status updated to ${isActive} by admin ${req.user.phone}`);

    res.json({
      success: true,
      message: 'User status updated successfully',
      data: user
    });
  } catch (error) {
    logger.error('Update user status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
 