// server/src/utils/createDefaultAdmin.js
const User = require('../models/User');
const logger = require('./logger');

const createDefaultAdmin = async () => {
  try {
    const defaultAdminPhone = '6935642148';
    
    // Check if admin already exists
    const existingAdmin = await User.findOne({ phone: defaultAdminPhone });
    
    if (existingAdmin) {
      logger.info('✅ Default admin already exists');
      console.log('✅ Default admin already exists');
      return existingAdmin;
    }

    // Create default admin
    const admin = await User.create({
      name: 'Admin User',
      phone: defaultAdminPhone,
      password: 'admin123',
      role: 'admin',
      isActive: true
    });

    logger.info(`✅ Default admin created: ${admin.phone}`);
    console.log('');
    console.log('='.repeat(60));
    console.log('🎉 DEFAULT ADMIN ACCOUNT CREATED');
    console.log('='.repeat(60));
    console.log(`📱 Phone: ${admin.phone}`);
    console.log(`🔑 Password: admin123`);
    console.log(`👤 Name: ${admin.name}`);
    console.log('⚠️  IMPORTANT: Change this password after first login!');
    console.log('='.repeat(60));
    console.log('');

    return admin;
  } catch (error) {
    logger.error('❌ Failed to create default admin:', error);
    console.error('❌ Failed to create default admin:', error.message);
    // Don't throw error - let server continue even if admin creation fails
    return null;
  }
};

module.exports = createDefaultAdmin;