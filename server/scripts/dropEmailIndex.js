// server/scripts/dropEmailIndex.js
// Run this once to drop the email index: node server/scripts/dropEmailIndex.js

require('dotenv').config();
const mongoose = require('mongoose');

async function dropEmailIndex() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    
    // Check if users collection exists
    const usersCollection = collections.find(c => c.name === 'users');
    
    if (usersCollection) {
      const indexes = await db.collection('users').indexes();
      console.log('📋 Current indexes:', indexes.map(i => i.name));
      
      // Drop email index if it exists
      const emailIndex = indexes.find(i => i.name === 'email_1');
      if (emailIndex) {
        await db.collection('users').dropIndex('email_1');
        console.log('✅ Dropped email_1 index');
      } else {
        console.log('ℹ️  email_1 index does not exist');
      }
      
      // Verify phone index exists
      const phoneIndex = indexes.find(i => i.name === 'phone_1');
      if (!phoneIndex) {
        await db.collection('users').createIndex({ phone: 1 }, { unique: true });
        console.log('✅ Created phone_1 index');
      } else {
        console.log('✅ phone_1 index already exists');
      }
      
      console.log('\n📋 Final indexes:');
      const finalIndexes = await db.collection('users').indexes();
      finalIndexes.forEach(idx => {
        console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
      });
    } else {
      console.log('ℹ️  Users collection does not exist yet');
    }

    console.log('\n✅ Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

dropEmailIndex();