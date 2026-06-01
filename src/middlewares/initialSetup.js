const { roleService, permissionService, userService } = require('../services');
const logger = require('../config/logger');
const PERMISSIONS = require('./permissions.constants');

class SystemInitializer {
  static async setupAdminRole() {
    try {
      // Try to create the role directly
      const adminRole = await roleService
        .createRole({
          name: 'Admin',
          description: 'System administrator with full access',
        })
        .catch(async (error) => {
          // If role already exists, fetch it
          if (error.code === 'P2002') {
            return roleService.getRoleByName('Admin');
          }
          throw error;
        });

      logger.info('Admin role setup completed');
      return adminRole;
    } catch (error) {
      logger.error('Admin role setup failed:', error);
      throw new Error('Failed to setup Admin role');
    }
  }

  static async setupDefaultPermissions() {
    try {
      const permissionsArray = Object.values(PERMISSIONS).flatMap((category) =>
        Object.values(category),
      );

      // Get all existing permissions first
      const { permissions: existingPermissions } =
        await permissionService.getAllPermissions();
      const existingPermissionNames = existingPermissions.map((p) => p.name);

      // Filter out permissions that already exist
      const newPermissions = permissionsArray.filter(
        (perm) => !existingPermissionNames.includes(perm.name),
      );

      if (newPermissions.length === 0) {
        logger.info('No new permissions to add');
        return;
      }

      const results = await Promise.allSettled(
        newPermissions.map((perm) => permissionService.createPermission(perm)),
      );

      // Log results
      results.forEach((result, index) => {
        const permName = newPermissions[index].name;
        if (result.status === 'fulfilled') {
          logger.info(`New permission created: ${permName}`);
        } else {
          logger.error(
            `Permission creation failed: ${permName} - ${result.reason.message}`,
          );
        }
      });

      // Check if any critical failures occurred
      const criticalFailures = results.filter((r) => r.status === 'rejected');

      if (criticalFailures.length > 0) {
        throw new Error('Some new permissions failed to create');
      }

      logger.info(`Added ${newPermissions.length} new permissions`);
    } catch (error) {
      logger.error('Permission setup failed:', error);
      throw new Error('Failed to setup permissions');
    }
  }

  static async setupAdminUser(adminRole) {
    try {
      const adminData = {
        name: 'System Admin',
        email: 'admwbn@example.com',
        password: process.env.ADMIN_PASSWORD || 'Admin@1234',
        roleId: adminRole.id,
        status: 'Active',
        admin: true,
      };

      // First try to find existing admin user
      let adminUser;
      try {
        adminUser = await userService.getUserByEmail(adminData.email);

        if (!adminUser) {
          // User doesn't exist, create it
          adminUser = await userService.createUser(adminData);
          logger.info('Admin user created successfully');
        } else {
          // User exists, check role
          // eslint-disable-next-line no-lonely-if
          if (adminUser.roleId !== adminRole.id || adminUser.admin !== true) {
            adminUser = await userService.updateUserById(adminUser.id, {
              roleId: adminRole.id,
              admin: true,
            });
            logger.info('Existing admin user role updated');
          } else {
            logger.info('Admin user already exists with correct role');
          }
        }
      } catch (error) {
        logger.error('Error in admin user setup:', error);
        throw new Error('Failed to setup admin user');
      }

      return adminUser;
    } catch (error) {
      logger.error('Admin user setup failed:', error);
      throw new Error('Failed to setup admin user');
    }
  }

  static async initialize() {
    try {
      logger.info('Starting system initialization...');

      // 1. Setup Admin role
      const adminRole = await SystemInitializer.setupAdminRole();

      // 2. Setup permissions (will only add new ones)
      await SystemInitializer.setupDefaultPermissions();

      // 3. Assign all permissions to admin role
      const { permissions } = await permissionService.getAllPermissions();
      await roleService.assignPermissions(
        adminRole.id,
        permissions.map((p) => p.id),
      );

      // 4. Create admin user
      await SystemInitializer.setupAdminUser(adminRole);

      logger.info('System initialization completed successfully');
      return true;
    } catch (error) {
      logger.error('System initialization failed:', error);
      throw new Error('System initialization failed');
    }
  }
}

module.exports = SystemInitializer;
