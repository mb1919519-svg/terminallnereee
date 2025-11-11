const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  commissionRate: {
    type: Number,
    default: 3,
    min: [0, 'Commission rate cannot be negative'],
    max: [100, 'Commission rate cannot exceed 100']
  },
  depositDeductionRate: {
    type: Number,
    default: 3,
    min: [0, 'Deposit deduction rate cannot be negative'],
    max: [100, 'Deposit deduction rate cannot exceed 100']
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Settings', settingsSchema);
