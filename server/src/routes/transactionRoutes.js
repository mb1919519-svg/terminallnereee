// server/src/routes/transactionRoutes.js - COMPLETE FIXED VERSION
const express = require('express');
const { body, validationResult } = require('express-validator');
const { protect, authorize } = require('../middleware/auth');
const transactionService = require('../services/transactionService');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { createAuditLog } = require('../utils/auditLog');

const router = express.Router();

// Protect all transaction routes
router.use(protect);

// @route   POST /api/transactions
// @desc    Create new transaction (staff only)
// @access  Staff only
router.post('/', authorize('staff'), [
  body('clientId').isMongoId().withMessage('Invalid client ID'),
  body('branchId').isMongoId().withMessage('Invalid branch ID'),
  body('type').isIn(['credit', 'debit']).withMessage('Type must be credit or debit'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  body('utrId').notEmpty().trim().withMessage('UTR ID is required'),
  body('remark').optional().trim()
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

    const { clientId, branchId, type, amount, remark, utrId } = req.body;

    // Verify staff has access to this branch
    const hasAccess = req.user.branches.some(b => b.toString() === branchId.toString());
    if (!hasAccess) {
      return res.status(403).json({ 
        success: false, 
        message: 'You do not have access to this branch' 
      });
    }

    // Process transaction
    const transaction = await transactionService.processTransaction({
      clientId,
      staffId: req.user._id,
      branchId,
      type,
      amount: parseFloat(amount),
      remark: remark || '',
      utrId
    }, req);

    logger.info(`Transaction created: ${transaction._id} by staff ${req.user.phone}`);

    res.status(201).json({
      success: true,
      message: 'Transaction created successfully',
      data: transaction
    });
  } catch (error) {
    logger.error('Transaction creation error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// @route   DELETE /api/transactions/:id
// @desc    Delete transaction with balance reversal
// @access  Admin (any transaction) or Staff (own transactions within 24h)
router.delete('/:id', authorize('admin', 'staff'), async (req, res) => {
  let session = null;
  
  try {
    console.log('Delete transaction request:', {
      transactionId: req.params.id,
      userId: req.user._id,
      userRole: req.user.role
    });

    // Check if replica set is available for transactions
    const useTransactions = mongoose.connection.db?.topology?.description?.type === 'ReplicaSetWithPrimary';
    
    if (useTransactions) {
      session = await mongoose.startSession();
      await session.startTransaction();
    }

    // Find transaction
    const transaction = session 
      ? await Transaction.findById(req.params.id).session(session)
      : await Transaction.findById(req.params.id);
    
    if (!transaction) {
      if (session) await session.abortTransaction();
      return res.status(404).json({ 
        success: false, 
        message: 'Transaction not found' 
      });
    }

    console.log('Transaction found:', {
      id: transaction._id,
      staffId: transaction.staffId,
      type: transaction.type,
      amount: transaction.amount,
      createdAt: transaction.createdAt
    });

    // AUTHORIZATION CHECKS
    // Staff can only delete their own transactions
    if (req.user.role === 'staff') {
      if (transaction.staffId.toString() !== req.user._id.toString()) {
        if (session) await session.abortTransaction();
        return res.status(403).json({ 
          success: false, 
          message: 'You can only delete your own transactions' 
        });
      }

      // Staff can only delete transactions within 24 hours
      const transactionAge = Date.now() - new Date(transaction.createdAt).getTime();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      
      if (transactionAge > maxAge) {
        if (session) await session.abortTransaction();
        const hoursOld = Math.floor(transactionAge / (60 * 60 * 1000));
        return res.status(400).json({ 
          success: false, 
          message: `Cannot delete transactions older than 24 hours (this transaction is ${hoursOld} hours old). Contact admin for assistance.` 
        });
      }
    }
    // Admin can delete any transaction (no time restriction)

    // Get staff member
    const staff = session
      ? await User.findById(transaction.staffId).session(session)
      : await User.findById(transaction.staffId);
      
    if (!staff) {
      if (session) await session.abortTransaction();
      return res.status(404).json({ 
        success: false, 
        message: 'Staff member not found' 
      });
    }

    console.log('Staff found:', {
      id: staff._id,
      name: staff.name,
      currentBalance: staff.walletBalance
    });

    // Calculate balance reversal
    const oldBalance = staff.walletBalance;
    let newBalance;

    if (transaction.type === 'credit') {
      // Was: staff received finalAmount (amount - commission)
      // Reverse: subtract finalAmount from staff balance
      newBalance = oldBalance - transaction.finalAmount;
      console.log('Reversing CREDIT:', {
        oldBalance,
        finalAmount: transaction.finalAmount,
        newBalance
      });
    } else if (transaction.type === 'debit') {
      // Was: staff paid finalAmount (amount + commission)
      // Reverse: add finalAmount back to staff balance
      newBalance = oldBalance + transaction.finalAmount;
      console.log('Reversing DEBIT:', {
        oldBalance,
        finalAmount: transaction.finalAmount,
        newBalance
      });
    } else {
      if (session) await session.abortTransaction();
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid transaction type' 
      });
    }

    // Update staff balance
    staff.walletBalance = newBalance;

    if (session) {
      await staff.save({ session });
      await Transaction.findByIdAndDelete(transaction._id).session(session);
      await session.commitTransaction();
    } else {
      await staff.save();
      await Transaction.findByIdAndDelete(transaction._id);
    }

    // Create audit log
    await createAuditLog(
      req.user._id,
      'delete_transaction',
      'transaction',
      transaction._id,
      {
        deletedBy: req.user.role,
        transactionType: transaction.type,
        amount: transaction.amount,
        finalAmount: transaction.finalAmount,
        oldStaffBalance: oldBalance,
        newStaffBalance: newBalance,
        reversalAmount: transaction.finalAmount
      },
      req
    );

    logger.info(`Transaction deleted: ${transaction._id} by ${req.user.role} ${req.user.phone}. Staff balance: ${oldBalance} -> ${newBalance}`);

    res.json({
      success: true,
      message: 'Transaction deleted and balance reversed successfully',
      data: {
        deletedTransactionId: transaction._id,
        transactionType: transaction.type,
        reversedAmount: transaction.finalAmount,
        oldBalance: oldBalance,
        newBalance: newBalance,
        staff: {
          id: staff._id,
          name: staff.name,
          walletBalance: newBalance
        }
      }
    });
  } catch (error) {
    if (session) await session.abortTransaction();
    logger.error('Delete transaction error:', error);
    console.error('Delete transaction error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to delete transaction'
    });
  } finally {
    if (session) session.endSession();
  }
});

// @route   GET /api/transactions/:id
// @desc    Get transaction by ID
// @access  Staff (own), Client (own), Admin (all)
router.get('/:id', async (req, res) => {
  try {
    const transaction = await transactionService.getTransactionById(req.params.id);
    
    if (!transaction) {
      return res.status(404).json({ 
        success: false, 
        message: 'Transaction not found' 
      });
    }

    // Check access rights
    if (req.user.role === 'staff' && transaction.staffId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }
    
    if (req.user.role === 'client' && transaction.clientId._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    res.json({
      success: true,
      data: transaction
    });
  } catch (error) {
    logger.error('Get transaction error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

module.exports = router;