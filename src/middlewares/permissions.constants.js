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
    CREATE: { name: 'CREATE_ROLE' },
    VIEW_ALL: { name: 'VIEW_ALL_ROLES' },
    VIEW: { name: 'VIEW_ROLE' },
    UPDATE: { name: 'UPDATE_ROLE' },
    DELETE: { name: 'DELETE_ROLE' },
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
    VIEW_PROJECT_DASHBOARD: {
      name: 'VIEW_PROJECT_DASHBOARD',
    },
    VIEW_PROJECT_STAGES_DASHBOARD: {
      name: 'VIEW_PROJECT_STAGES_DASHBOARD',
    },
    VIEW_POS_DASHBOARD: {
      name: 'VIEW_POS_DASHBOARD',
    },
    VIEW_PRODUCT_DASHBOARD: {
      name: 'VIEW_PRODUCT_DASHBOARD',
    },
    VIEW_Users_DASHBOARD: {
      name: 'VIEW_Users_DASHBOARD',
    },
    VIEW_INVENTORY_DASHBOARD: {
      name: 'VIEW_INVENTORY_DASHBOARD',
    },
    VIEW_SYSTEM_DASHBOARD: {
      name: 'VIEW_SYSTEM_DASHBOARD',
    },
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

  COMPANY: {
    CREATE: { name: 'CREATE_COMPANY' },
    VIEW: { name: 'VIEW_COMPANY' },
    UPDATE: {
      name: 'UPDATE_COMPANY',
    },
    DELETE: { name: 'DELETE_COMPANY' },
  },
  SUPPLIER: {
    CREATE: {
      name: 'CREATE_SUPPLIER',
    },
    VIEW: {
      name: 'VIEW_SUPPLIER',
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
  CUSTOMER: {
    CREATE: { name: 'CREATE_CUSTOMER' },
    VIEW_ALL: { name: 'VIEW_ALL_CUSTOMERS' },
    UPDATE: {
      name: 'UPDATE_CUSTOMER',
    },
    DELETE: { name: 'DELETE_CUSTOMER' },
  },
  STORE: {
    CREATE: { name: 'CREATE_STORE' },
    VIEW_ALL: { name: 'VIEW_ALL_STORES' },
    UPDATE: { name: 'UPDATE_STORE' },
    DELETE: { name: 'DELETE_STORE' },
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
  SELL: {
    VIEW_DASHBOARD: {
      name: 'VIEW_SELL_DASHBOARD',
    },

    CREATE: {
      name: 'CREATE_SELL',
    },

    VIEW: {
      name: 'VIEW_SELL',
    },

    VIEW_ALL: {
      name: 'VIEW_ALL_SELLS',
    },

    UPDATE: {
      name: 'UPDATE_SELL',
    },

    DELETE: {
      name: 'DELETE_SELL',
    },

    DELIVER_ALL: {
      name: 'DELIVER_ALL_SALE_ITEMS',
    },

    UPDATE_STATUS: {
      name: 'UPDATE_SELL_STATUS',
    },

    ADD_PAYMENT: {
      name: 'ADD_SELL_PAYMENT',
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
  REPORT: {
    VIEW_COMPLETE_STATISTICS_REPORT: {
      name: 'VIEW_COMPLETE_STATISTICS_REPORT',
    },
    VIEW_DETAILED_FINISHED_PRODUCTS: {
      name: 'VIEW_DETAILED_FINISHED_PRODUCTS',
    },
    VIEW_MONTHLY_BREAKDOWN: {
      name: 'VIEW_MONTHLY_BREAKDOWN_REPORT',
    },
    VIEW_COMBINED: {
      name: 'VIEW_COMBINED_REPORT',
    },
    VIEW_DASHBOARD_COUNTS: {
      name: 'VIEW_DASHBOARD_COUNTS',
    },
    VIEW_ALL_SELLS_TREND: {
      name: 'VIEW_ALL_SELLS_TREND',
    },
  },

  BANK: {
    CREATE: {
      name: 'CREATE_BANK',
    },
    VIEW: {
      name: 'VIEW_BANK',
    },
    UPDATE: {
      name: 'UPDATE_BANK',
    },
    DELETE: {
      name: 'DELETE_BANK',
    },
  },
  CAPACITY_SLOT: {
    CREATE: {
      name: 'CREATE_CAPACITY_SLOT',
    },
    VIEW: {
      name: 'VIEW_CAPACITY_SLOT',
    },
    UPDATE: {
      name: 'UPDATE_CAPACITY_SLOT',
    },
    DELETE: {
      name: 'DELETE_CAPACITY_SLOT',
    },
  },
  DELIVERY_ESTIMATION: {
    CREATE: {
      name: 'CREATE_DELIVERY_ESTIMATION',
    },
    VIEW: {
      name: 'VIEW_DELIVERY_ESTIMATION',
    },

    DELETE: {
      name: 'DELETE_DELIVERY_ESTIMATION',
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
      name: 'VIEW_PRODUCT',
    },
  },
  MATERIAL: {
    CREATE: {
      name: 'CREATE_MATERIAL',
    },
    VIEW_ALL: {
      name: 'VIEW_MATERIAL_ALL',
    },
    VIEW: {
      name: 'VIEW_MATERIAL',
    },
    VIEW_STOCK: {
      name: 'VIEW_MATERIAL_STOCK',
    },
    UPDATE: {
      name: 'UPDATE_MATERIAL',
    },
    DELETE: {
      name: 'DELETE_MATERIAL',
    },
  },
  MATERIAL_CATEGORY: {
    CREATE: {
      name: 'CREATE_MATERIAL_CATEGORY',
    },
    VIEW_ALL: {
      name: 'VIEW_MATERIAL_CATEGORY_ALL',
    },
    UPDATE: {
      name: 'UPDATE_MATERIAL_CATEGORY',
    },
    DELETE: {
      name: 'DELETE_MATERIAL_CATEGORY',
    },
  },
  PRODUCT_CATEGORY: {
    CREATE: {
      name: 'CREATE_PRODUCT_CATEGORY',
    },
    VIEW_ALL: {
      name: 'VIEW_PRODUCT_CATEGORIES',
    },
    UPDATE: {
      name: 'UPDATE_PRODUCT_CATEGORY',
    },
    DELETE: {
      name: 'DELETE_PRODUCT_CATEGORY',
    },
  },

  PRODUCT_TYPE: {
    CREATE: {
      name: 'CREATE_PRODUCT_TYPE',
    },
    VIEW_ALL: {
      name: 'VIEW_PRODUCT_TYPES',
    },
    UPDATE: {
      name: 'UPDATE_PRODUCT_TYPE',
    },
    DELETE: {
      name: 'DELETE_PRODUCT_TYPE',
    },
  },

  SIZE: {
    CREATE: {
      name: 'CREATE_SIZE',
    },
    VIEW_ALL: {
      name: 'VIEW_SIZES',
    },
    UPDATE: {
      name: 'UPDATE_SIZE',
    },
    DELETE: {
      name: 'DELETE_SIZE',
    },
  },
  PROFORMA_INVOICE: {
    CREATE: {
      name: 'CREATE_PROFORMA',
    },
    VIEW_ALL: {
      name: 'VIEW_ALL_PROFORMA',
    },
    VIEW: {
      name: 'VIEW_PROFORMA',
    },
    UPDATE: {
      name: 'UPDATE_PROFORMA',
    },
    DELETE: {
      name: 'DELETE_PROFORMA',
    },
    UPDATE_STATUS: {
      name: 'UPDATE_PROFORMA_STATUS',
    },
    UPDATE_ADDITIONAL_QUANTITY: {
      name: 'UPDATE_PROFORMA_ADDITIONAL_QUANTITY',
    },
    ADD_PAYMENT: {
      name: 'ADD_PAYMENT_TO_PROFORMA_INVOICE',
    },
  },
  PROJECT: {
    CREATE: {
      name: 'CREATE_PROJECT',
    },
    VIEW_ALL: {
      name: 'VIEW_PROJECTS',
    },
    VIEW: {
      name: 'VIEW_PROJECT',
    },
    VIEW_BY_CUSTOMER: {
      name: 'VIEW_PROJECTS_BY_CUSTOMER',
    },
    UPDATE: {
      name: 'UPDATE_PROJECT',
    },

    DELETE: {
      name: 'DELETE_PROJECT',
    },

    UPDATE_STAGE: {
      name: 'UPDATE_PROJECT_STAGE',
    },
  },
  PROJECT_STAGE_WORK_LOG: {
    CREATE: {
      name: 'CREATE_PROJECT_STAGE_WORK_LOG',
    },
    DELETE: {
      name: 'DELETE_PROJECT_STAGE_WORK_LOG',
    },
  },
  SHOWROOM: {
    CREATE: {
      name: 'CREATE_SHOWROOM',
    },
    VIEW_ALL: {
      name: 'VIEW_SHOWROOMS',
    },
    UPDATE: {
      name: 'UPDATE_SHOWROOM',
    },
    DELETE: {
      name: 'DELETE_SHOWROOM',
    },
  },
  STAGE: {
    VIEW_METAL_WORK_PROJECTS: {
      name: 'VIEW_METAL_WORK_PROJECTS',
    },

    VIEW_DESIGN_PROJECTS: {
      name: 'VIEW_DESIGN_PROJECTS',
    },

    VIEW_DESIGN_PROJECTS_BY_DESIGNER: {
      name: 'VIEW_DESIGN_PROJECTS_BY_DESIGNER',
    },

    VIEW_UNASSIGNED_DESIGN_PROJECTS: {
      name: 'VIEW_UNASSIGNED_DESIGN_PROJECTS',
    },

    VIEW_PURCHASING_PROJECTS: {
      name: 'VIEW_PURCHASING_PROJECTS',
    },

    VIEW_MATERIAL_USAGE_REPORT: {
      name: 'VIEW_MATERIAL_USAGE_REPORT',
    },

    VIEW_CNC_PROJECTS: {
      name: 'VIEW_CNC_PROJECTS',
    },

    VIEW_CUTTING_PROJECTS: {
      name: 'VIEW_CUTTING_PROJECTS',
    },

    VIEW_EDGE_BANDING_PROJECTS: {
      name: 'VIEW_EDGE_BANDING_PROJECTS',
    },

    VIEW_ASSEMBLY_PROJECTS: {
      name: 'VIEW_ASSEMBLY_PROJECTS',
    },

    VIEW_PAINTING_PROJECTS: {
      name: 'VIEW_PAINTING_PROJECTS',
    },

    VIEW_FINISHED_PROJECTS: {
      name: 'VIEW_FINISHED_PROJECTS',
    },

    VIEW_DELIVERY_PROJECTS: {
      name: 'VIEW_DELIVERY_PROJECTS',
    },

    VIEW_INSTALLATION_PROJECTS: {
      name: 'VIEW_INSTALLATION_PROJECTS',
    },
  },
};
