// server/src/models/Transaction.js
const mongoose = require('mongoose');
const aggregatePaginate = require('mongoose-aggregate-paginate-v2');

const transactionSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  staffId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    required: true
  },
  type: {
    type: String,
    enum: ['credit', 'debit'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: [0.01, 'Amount must be greater than 0']
  },
  commission: {
    type: Number,
    default: 0
  },
  finalAmount: {
    type: Number,
    required: true
  },
  remark: {
    type: String,
    trim: true,
    default: ''
  },
utrId: {
  type: String,
  required: [true, 'UTR ID is required'],
  unique: true,
  trim: true,
  validate: {
    validator: function(v) {
      return /^[A-Za-z0-9]{10,22}$/.test(v);
    },
    message: 'UTR ID must be alphanumeric and 10–22 characters long'
  }
}
,
  balanceBefore: {
    type: Number,
    required: true
  },
  balanceAfter: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'completed'
  }
}, {
  timestamps: true
});

// Create unique index for UTR ID
transactionSchema.index({ utrId: 1 }, { unique: true });

transactionSchema.plugin(aggregatePaginate);

module.exports = mongoose.model('Transaction', transactionSchema);