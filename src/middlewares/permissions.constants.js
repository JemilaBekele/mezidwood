module.exports = {
  PERMISSION: {
    VIEW_DASHBOARD: {
      name: 'VIEW_ROLE_PERMISSION_DASHBOARD',
    },
    VIEW_ALL: {
      name: 'VIEW_ALL_PERMISSIONS',
    },
    DELETE: {
      name: 'DELETE_PERMISSION',
    },
  },
  ROLE: {
    CREATE: { name: 'CREATE_ROLE', description: 'Create new role' },
    VIEW_ALL: { name: 'VIEW_ALL_ROLES', description: 'View all roles' },
    VIEW: { name: 'VIEW_ROLE', description: 'View role by ID' },
    UPDATE: { name: 'UPDATE_ROLE', description: 'Update role' },
    DELETE: { name: 'DELETE_ROLE', description: 'Delete role' },
  },

  ROLE_PERMISSION: {
    CREATE: {
      name: 'CREATE_ROLE_PERMISSION',
    },
    ASSIGN: {
      name: 'ASSIGN_ROLE_PERMISSIONS',
    },
    VIEW_ALL: {
      name: 'VIEW_ALL_ROLE_PERMISSIONS',
    },
    DELETE: {
      name: 'DELETE_ROLE_PERMISSION',
    },
  },
  Employee: {
    VIEW_MAIN_DASHBOARD: {
      name: 'VIEW_MAIN_DASHBOARD',
    },
    VIEW_DASHBOARD: {
      name: 'VIEW_Users_DASHBOARD',
    },
    CREATE: {
      name: 'CREATE_Employee',
    },
    VIEW: {
      name: 'VIEW_Employee', // For viewing a single employee
    },
    VIEW_ALL: {
      name: 'VIEW_ALL_EMPLOYEES', // Changed to be unique
    },
    UPDATE: {
      name: 'UPDATE_Employee',
    },
    DELETE: {
      name: 'DELETE_Employee',
    },
    CHANGE_PASSWORD: {
      name: 'CHANGE_USER_PASSWORD',
    },
  },
  BRANCH: {
    VIEW_DASHBOARD: {
      name: 'VIEW_SYSTEM_DASHBOARD',
    },
    CREATE: { name: 'CREATE_BRANCH', description: 'Create new branches' },
    VIEW_ALL: { name: 'VIEW_ALL_BRANCHES', description: 'View all branches' },
    UPDATE: { name: 'UPDATE_BRANCH', description: 'Update branch information' },
    DELETE: { name: 'DELETE_BRANCH', description: 'Delete branches' },
  },
  CATEGORY: {
    CREATE: { name: 'CREATE_CATEGORY' },
    VIEW_ALL: {
      name: 'VIEW_ALL_CATEGORIES',
    },
    UPDATE: {
      name: 'UPDATE_CATEGORY',
    },
    DELETE: { name: 'DELETE_CATEGORY' },
  },
  COLOUR: {
    CREATE: {
      name: 'CREATE_COLOUR',
    },
    VIEW_ALL: {
      name: 'VIEW_ALL_COLOURS',
    },
    UPDATE: {
      name: 'UPDATE_COLOUR',
    },
    DELETE: {
      name: 'DELETE_COLOUR',
    },
  },
  CURTAIN_ORDER: {
    CREATE: { name: 'CREATE_CURTAIN_ORDER' },
    VIEW_ALL: { name: 'VIEW_ALL_CURTAIN_ORDERS' },
    VIEW: { name: 'VIEW_CURTAIN_ORDER' },
    UPDATE: { name: 'UPDATE_CURTAIN_ORDER' },
    DELETE: { name: 'DELETE_CURTAIN_ORDER' },

    UPDATE_STATUS: { name: 'UPDATE_CURTAIN_ORDER_STATUS' },
    UPDATE_PAYMENT: { name: 'UPDATE_CURTAIN_ORDER_PAYMENT' },
    UPDATE_DELIVERY_DEADLINE: { name: 'UPDATE_CURTAIN_DELIVERY_DEADLINE' },
    ASSIGN_WORKER: { name: 'ASSIGN_CURTAIN_ORDER_WORKER' },
    GIVE_WORKER_PAYMENT: { name: 'GIVE_WORKER_PAYMENT' },
    VIEW_WORKER_PAYMENT_REPORT: { name: 'VIEW_WORKER_PAYMENT_REPORT' },
    VIEW_REPORT_DASHBOARD: { name: 'VIEW_REPORT_DASHBOARD' },
  },
  CURTAIN_TYPE: {
    CREATE: { name: 'CREATE_CURTAIN_TYPE' },
    VIEW_ALL: { name: 'VIEW_ALL_CURTAIN_TYPES' },
    UPDATE: { name: 'UPDATE_CURTAIN_TYPE' },
    DELETE: { name: 'DELETE_CURTAIN_TYPE' },
  },
  DASHBOARDS: {
    MAIN_DASHBOARD: {
      name: 'VIEW_MAIN_DASHBOARD',
      description: 'View main dashboard',
    },
    VIEW_REPORT: {
      name: 'VIEW_SALES_REPORT_VIEW_DASHBOARD',
      description: 'View sales report',
    },
    VIEW_SELL_DASHBOARD: {
      name: 'VIEW_SELL_DASHBOARD',
      description: 'View comprehensive sell dashboard data',
    },
    VIEW_PRODUCT_DASHBOARD: {
      name: 'VIEW_PRODUCT_DASHBOARD',
      description: 'View comprehensive product dashboard data',
    },
    VIEW_USERS_DASHBOARD: {
      name: 'VIEW_Users_DASHBOARD',
      description: 'View comprehensive inventory dashboard data',
    },
    VIEW_SYSTEM_DASHBOARD: {
      name: 'VIEW_SYSTEM_DASHBOARD',
      description: 'View comprehensive system dashboard data',
    },
  },
  REPORT: {
    VIEW_TOTAL_SOLD: {
      name: 'VIEW_TOTAL_SOLD',
      description: 'View total sold products report',
    },
    VIEW_ALL_TRENDS: {
      name: 'VIEW_ALL_SELLS_TREND',
      description: 'View sales trends across all sells',
    },
    VIEW_SALES_RANK: {
      name: 'VIEW_SALES_RANK',
      description: 'View ranked sales report',
    },
    VIEW_REPORT: {
      name: 'VIEW_SALES_REPORT_VIEW_DASHBOARD',
      description: 'View sales report',
    },
    RESET: {
      name: 'RESET_VIEW_DASHBOARD',
      description: 'Reset page',
    },
    MAIN_DASHBOARD: {
      name: 'VIEW_MAIN_DASHBOARD',
      description: 'View main dashboard',
    },
  },
  MOVEMENT_TYPE: {
    CREATE: { name: 'CREATE_MOVEMENT_TYPE' },
    VIEW_ALL: { name: 'VIEW_ALL_MOVEMENT_TYPES' },
    UPDATE: { name: 'UPDATE_MOVEMENT_TYPE' },
    DELETE: { name: 'DELETE_MOVEMENT_TYPE' },
  },
  CUSTOMER: {
    CREATE: { name: 'CREATE_CUSTOMER' },
    VIEW_ALL: { name: 'VIEW_ALL_CUSTOMERS' },
    UPDATE: {
      name: 'UPDATE_CUSTOMER',
    },
    DELETE: { name: 'DELETE_CUSTOMER' },
  },

  SUPPLIER: {
    CREATE: {
      name: 'CREATE_SUPPLIER',
    },
    VIEW_ALL: {
      name: 'VIEW_ALL_SUPPLIERS',
    },
    UPDATE: {
      name: 'UPDATE_SUPPLIER',
    },
    DELETE: {
      name: 'DELETE_SUPPLIER',
    },
  },
  PRODUCT: {
    VIEW_DASHBOARD: {
      name: 'VIEW_PRODUCT_DASHBOARD',
    },
    CREATE: {
      name: 'CREATE_PRODUCT',
    },
    VIEW_ALL: {
      name: 'VIEW_PRODUCT_ALL',
    },
    UPDATE: {
      name: 'UPDATE_PRODUCT',
    },
    DELETE: {
      name: 'DELETE_PRODUCT',
    },
    VIEW: {
      name: 'VIEW',
    },
  },
  PURCHASE: {
    CREATE: {
      name: 'CREATE_PURCHASE',
    },
    VIEW_ALL: {
      name: 'VIEW_ALL_PURCHASES',
    },
    UPDATE: {
      name: 'UPDATE_PURCHASE',
    },
    ACCEPT: {
      name: 'ACCEPT_PURCHASE',
    },
    DELETE: {
      name: 'DELETE_PURCHASE',
    },
  },

  SHOP: {
    CREATE: { name: 'CREATE_SHOP' },
    VIEW_ALL: { name: 'VIEW_ALL_SHOPS' },
    UPDATE: { name: 'UPDATE_SHOP' },
    DELETE: { name: 'DELETE_SHOP' },
  },
  STORE: {
    CREATE: { name: 'CREATE_STORE' },
    VIEW_ALL: { name: 'VIEW_ALL_STORES' },
    UPDATE: { name: 'UPDATE_STORE' },
    DELETE: { name: 'DELETE_STORE' },
  },
  STOCK_CORRECTION: {
    CREATE: {
      name: 'CREATE_STOCK_CORRECTION',
    },
    VIEW: {
      name: 'VIEW_STOCK_CORRECTION',
    },
    VIEW_ALL: {
      name: 'VIEW_ALL_STOCK_CORRECTIONS',
    },
    UPDATE: {
      name: 'UPDATE_STOCK_CORRECTION',
    },
    APPROVE: {
      name: 'APPROVE_STOCK_CORRECTION',
    },
    REJECT: {
      name: 'REJECT_STOCK_CORRECTION',
    },
    DELETE: {
      name: 'DELETE_STOCK_CORRECTION',
    },
  },

  UNIT_OF_MEASURE: {
    CREATE: {
      name: 'CREATE_UNIT_OF_MEASURE',
    },
    VIEW_ALL: {
      name: 'VIEW_ALL_UNIT_OF_MEASURE',
    },
    UPDATE: {
      name: 'UPDATE_UNIT_OF_MEASURE',
    },
    DELETE: {
      name: 'DELETE_UNIT_OF_MEASURE',
    },
  },
  TRANSFER: {
    CREATE: {
      name: 'CREATE_TRANSFER',
    },
    VIEW: {
      name: 'VIEW_TRANSFER',
    },
    VIEW_ALL: {
      name: 'VIEW_ALL_TRANSFERS',
    },
    UPDATE: {
      name: 'UPDATE_TRANSFER',
    },
    COMPLETE: {
      name: 'COMPLETE_TRANSFER',
    },
    CANCEL: {
      name: 'CANCEL_TRANSFER',
    },
    DELETE: {
      name: 'DELETE_TRANSFER',
    },
  },
};
