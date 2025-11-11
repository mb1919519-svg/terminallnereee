const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 100,
      minPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    
    // Drop email index if it exists and create proper indexes
    await dropEmailIndexAndCreateIndexes();
  } catch (error) {
    console.error(`❌ MongoDB Error: ${error.message}`);
    process.exit(1);
  }
};

const dropEmailIndexAndCreateIndexes = async () => {
  try {
    const db = mongoose.connection.db;
    const collections = await db.listCollections({ name: 'users' }).toArray();
    
    if (collections.length > 0) {
      const indexes = await db.collection('users').indexes();
      
      // Drop email index if it exists
      const emailIndex = indexes.find(i => i.name === 'email_1');
      if (emailIndex) {
        try {
          await db.collection('users').dropIndex('email_1');
          console.log('✅ Dropped email_1 index');
        } catch (err) {
          if (err.code !== 27) { // Index not found error
            console.log('⚠️  Could not drop email index:', err.message);
          }
        }
      }
      
      // Ensure phone index exists
      const phoneIndex = indexes.find(i => i.name === 'phone_1');
      if (!phoneIndex) {
        await db.collection('users').createIndex({ phone: 1 }, { unique: true });
        console.log('✅ Created phone_1 unique index');
      }
      
      console.log('✅ User indexes configured correctly');
    }
    
    // Create other indexes
    collections = mongoose.connection.collections;
    
    if (collections.transactions) {
      await collections.transactions.createIndex({ clientId: 1, createdAt: -1 });
      await collections.transactions.createIndex({ staffId: 1, createdAt: -1 });
      await collections.transactions.createIndex({ branchId: 1, createdAt: -1 });
      await collections.transactions.createIndex({ utrId: 1 });
      console.log('✅ Transaction indexes created');
    }
    
    if (collections.branches) {
      await collections.branches.createIndex({ clientId: 1 });
      await collections.branches.createIndex({ code: 1 }, { unique: true });
      console.log('✅ Branch indexes created');
    }
  } catch (error) {
    console.log('⚠️  Index management:', error.message);
  }
};

module.exports = connectDB;