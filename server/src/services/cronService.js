const cron = require('node-cron');
const DailySummary = require('../models/DailySummary');
const Transaction = require('../models/Transaction');
const logger = require('../utils/logger');

class CronService {
  startDailyReset() {
    // Run at 12:00 AM every day (midnight)
    cron.schedule('0 0 * * *', async () => {
      try {
        logger.info('Starting daily reset job at midnight...');
        
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Aggregate yesterday's transactions by user
        const summaries = await Transaction.aggregate([
          {
            $match: {
              createdAt: {
                $gte: yesterday,
                $lt: today
              },
              status: 'completed'
            }
          },
          {
            $group: {
              _id: {
                userId: '$clientId',
                branchId: '$branchId'
              },
              totalCredit: {
                $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$finalAmount', 0] }
              },
              totalDebit: {
                $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$finalAmount', 0] }
              },
              totalCommission: { $sum: '$commission' },
              transactionCount: { $sum: 1 }
            }
          }
        ]);

        // Save daily summaries
        for (const summary of summaries) {
          await DailySummary.create({
            date: yesterday,
            userId: summary._id.userId,
            branchId: summary._id.branchId,
            role: 'client',
            totalCredit: summary.totalCredit,
            totalDebit: summary.totalDebit,
            totalCommission: summary.totalCommission,
            transactionCount: summary.transactionCount
          });
        }

        logger.info(`Daily reset completed. ${summaries.length} summaries created.`);
      } catch (error) {
        logger.error('Daily reset failed:', error);
      }
    });

    logger.info('✅ Daily reset cron job scheduled (runs at 12:00 AM)');
  }
}

module.exports = new CronService();