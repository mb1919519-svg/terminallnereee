const mongoose = require('mongoose');

const dailySummarySchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'client', 'staff'],
    required: true
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch'
  },
  totalCredit: {
    type: Number,
    default: 0
  },
  totalDebit: {
    type: Number,
    default: 0
  },
  totalCommission: {
    type: Number,
    default: 0
  },
  transactionCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

dailySummarySchema.index({ date: 1, userId: 1, branchId: 1 });

module.exports = mongoose.model('DailySummary', dailySummarySchema);

 