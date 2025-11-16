// server/src/services/transactionService.js - UPDATED: Staff balance tracking
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Branch = require('../models/Branch');
const Settings = require('../models/Settings');
const { createAuditLog } = require('../utils/auditLog');
const logger = require('../utils/logger');

class TransactionService {
  async processTransaction(data, req) {
    const useTransactions = process.env.USE_TRANSACTIONS === 'true' && 
                           mongoose.connection.db.topology.description.type === 'ReplicaSetWithPrimary';
    
    if (useTransactions) {
      return this.processTransactionWithSession(data, req);
    } else {
      return this.processTransactionWithoutSession(data, req);
    }
  }

  async processTransactionWithSession(data, req) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const result = await this.executeTransaction(data, req, session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Transaction failed:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  async processTransactionWithoutSession(data, req) {
    try {
      return await this.executeTransaction(data, req, null);
    } catch (error) {
      logger.error('Transaction failed:', error);
      throw error;
    }
  }

  async executeTransaction(data, req, session) {
    const { clientId, staffId, branchId, type, amount, remark, utrId } = data;

    // Validate client
    const client = session 
      ? await User.findById(clientId).session(session)
      : await User.findById(clientId);
      
    if (!client || client.role !== 'client') {
      throw new Error('Invalid client');
    }

    // Validate branch
    const branch = session
      ? await Branch.findById(branchId).session(session)
      : await Branch.findById(branchId);
      
    if (!branch || !branch.isActive) {
      throw new Error('Invalid or inactive branch');
    }

    // Validate staff has access to branch
    const staff = session
      ? await User.findById(staffId).session(session)
      : await User.findById(staffId);
      
    if (!staff || !staff.branches.some(b => b.toString() === branchId.toString())) {
      throw new Error('Staff does not have access to this branch');
    }

    // Get settings
    let settings = session
      ? await Settings.findOne().session(session)
      : await Settings.findOne();
      
    if (!settings) {
      if (session) {
        settings = await Settings.create([{}], { session });
        settings = settings[0];
      } else {
        settings = await Settings.create({});
      }
    }

    const commissionRate = settings.commissionRate || 3;
    const depositDeductionRate = settings.depositDeductionRate || 3;

    let finalAmount, commission;
    
    // CHANGED: Track staff balance instead of client balance
    const staffBalanceBefore = staff.walletBalance || 0;
    let staffBalanceAfter;

    if (type === 'credit') {
      // Credit: Client deposits money, staff receives (amount - 3% deduction)
      commission = (amount * depositDeductionRate) / 100;
      finalAmount = amount - commission;
      
      // Staff balance increases
      staffBalanceAfter = staffBalanceBefore + finalAmount;
    } else if (type === 'debit') {
      // Debit: Client withdraws money, staff pays out (amount + 3% commission)
      commission = (amount * commissionRate) / 100;
      finalAmount = amount - commission;
      
      // Staff balance decreases (can go negative)
      staffBalanceAfter = staffBalanceBefore - finalAmount;
    } else {
      throw new Error('Invalid transaction type');
    }

    // CHANGED: Update staff wallet instead of client
    staff.walletBalance = staffBalanceAfter;
    if (session) {
      await staff.save({ session });
    } else {
      await staff.save();
    }

    // Create transaction record
    const transactionData = {
      clientId,
      staffId,
      branchId,
      type,
      amount,
      commission,
      finalAmount,
      remark: remark || '',
      utrId,
      balanceBefore: staffBalanceBefore,  // Now staff balance
      balanceAfter: staffBalanceAfter,    // Now staff balance
      status: 'completed'
    };

    const transaction = session
      ? await Transaction.create([transactionData], { session })
      : await Transaction.create(transactionData);

    const transactionDoc = Array.isArray(transaction) ? transaction[0] : transaction;

    // Create audit log
    await createAuditLog(
      staffId,
      `transaction_${type}`,
      'transaction',
      transactionDoc._id,
      { amount, finalAmount, commission, staffBalanceAfter },
      req
    );

    logger.info(`Transaction ${type} completed: ${transactionDoc._id}, Staff balance: ${staffBalanceAfter}`);

    return transactionDoc;
  }

  async getTransactionById(transactionId) {
    return await Transaction.findById(transactionId)
      .populate('clientId', 'name phone')
      .populate('staffId', 'name phone walletBalance')
      .populate('branchId', 'name code');
  }
}

module.exports = new TransactionService();
