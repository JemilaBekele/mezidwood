const { roleService, userService } = require('./src/services');
const logger = require('./src/config/logger');

async function seed() {
  try {
    const adminData = {
      name: 'Super Admin',
      email: 'admin@woodwork.local',
      password: 'password123',
      status: 'Active',
      admin: true,
    };

    let adminRole = await roleService.getRoleByName('Admin').catch(() => null);
    if (!adminRole) {
      adminRole = await roleService.createRole({
        name: 'Admin',
        description: 'System administrator with full access',
      });
      logger.info('Admin role created');
    }

    adminData.roleId = adminRole.id;

    let adminUser = await userService.getUserByEmail(adminData.email);
    if (!adminUser) {
      adminUser = await userService.createUser(adminData);
      logger.info('Custom admin user created successfully');
    } else {
      adminUser = await userService.updateUserById(adminUser.id, {
        roleId: adminRole.id,
        admin: true,
      });
      // We also update the password since they might be testing
      const bcrypt = require('bcryptjs');
      const prisma = require('./src/services/prisma');
      const hashedPassword = await bcrypt.hash(adminData.password, 8);
      await prisma.user.update({
        where: { id: adminUser.id },
        data: { password: hashedPassword }
      });
      logger.info('Custom admin user updated');
    }

    console.log('\n================================');
    console.log('Admin User Seeded!');
    console.log(`Email: ${adminData.email}`);
    console.log(`Password: ${adminData.password}`);
    console.log('================================\n');
    process.exit(0);
  } catch (error) {
    console.error('Failed to seed custom admin:', error);
    process.exit(1);
  }
}

seed();
