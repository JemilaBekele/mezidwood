const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Customer Services

const getCustomerById = async (id) => {
  return prisma.customer.findUnique({ where: { id } });
};

const getCustomerByEmail = async (email) => {
  return prisma.customer.findFirst({ where: { email } });
};

// ✅ Get customer by either phone1 or phone2
const getCustomerByPhone = async (phone) => {
  return prisma.customer.findFirst({
    where: {
      OR: [{ phone1: phone }, { phone2: phone }],
    },
  });
};

const getCustomerByTin = async (tinNumber) => {
  return prisma.customer.findFirst({ where: { tinNumber } });
};

const getAllCustomers = async (filter = {}) => {
  const customers = await prisma.customer.findMany({
    where: {
      ...filter,
      isdefault: false, // Exclude default customer
    },
    orderBy: { name: 'asc' },
  });

  return { customers, count: customers.length };
};

const DEFAULT_CUSTOMER = {
  name: 'Stock',
  companyName: '',
  isdefault: true,
  phone1: '0',
  phone2: null,
  tinNumber: null,
  address: '',
};

const createCustomer = async (customerBody) => {
  try {
    // Clean the customer body - remove fields that don't exist in the model
    // and combine address fields
    const { city, state, postalCode, country, ...cleanBody } = customerBody;
    
    // Build a complete address from all address components
    const addressParts = [];
    if (cleanBody.address) addressParts.push(cleanBody.address);
    if (city) addressParts.push(city);
    if (state) addressParts.push(state);
    if (country) addressParts.push(country);
    if (postalCode) addressParts.push(postalCode);
    
    const combinedAddress = addressParts.filter(Boolean).join(', ');
    
    // Prepare the final customer data
    const preparedBody = {
      ...cleanBody,
      address: combinedAddress || cleanBody.address || '',
      // Convert empty strings to null for optional fields
      phone2: cleanBody.phone2 || null,
      tinNumber: cleanBody.tinNumber || null,
    };

    // Check if the requested customer already exists by email
    if (preparedBody.email) {
      try {
        const existingCustomer = await getCustomerByEmail(preparedBody.email);
        if (existingCustomer) {
          console.log('❌ Email already exists:', preparedBody.email);
          throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        console.error('❌ Error checking email existence:', error);
        throw error;
      }
    }

    // Check if customer with same phone1 already exists
    if (preparedBody.phone1) {
      try {
        const existingCustomer = await getCustomerByPhone(preparedBody.phone1);
        if (existingCustomer) {
          console.log('❌ Phone1 already exists:', preparedBody.phone1);
          throw new ApiError(httpStatus.BAD_REQUEST, 'Phone1 already taken');
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        console.error('❌ Error checking phone1 existence:', error);
        throw error;
      }
    }

    // Check if customer with same phone2 already exists
    if (preparedBody.phone2) {
      try {
        const existingCustomer = await getCustomerByPhone(preparedBody.phone2);
        if (existingCustomer) {
          console.log('❌ Phone2 already exists:', preparedBody.phone2);
          throw new ApiError(httpStatus.BAD_REQUEST, 'Phone2 already taken');
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        console.error('❌ Error checking phone2 existence:', error);
        throw error;
      }
    }

    // Check if customer with same TIN already exists
    if (preparedBody.tinNumber) {
      try {
        const existingCustomer = await getCustomerByTin(preparedBody.tinNumber);
        if (existingCustomer) {
          console.log('❌ TIN already exists:', preparedBody.tinNumber);
          throw new ApiError(httpStatus.BAD_REQUEST, 'TIN already registered');
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        console.error('❌ Error checking TIN existence:', error);
        throw error;
      }
    }

    // Prepare data for creation
    const customerData = {
      ...preparedBody,
      isdefault: false,
    };

    // Create the requested customer
    let newCustomer;
    try {
      console.log('ℹ️ Creating new customer with data:', JSON.stringify(customerData, null, 2));
      newCustomer = await prisma.customer.create({
        data: customerData,
      });
      console.log('✅ Customer created successfully:', newCustomer.id);
    } catch (error) {
      console.error('❌ Failed to create requested customer:');
      console.error('  - Error message:', error.message);
      console.error('  - Error code:', error.code);
      console.error('  - Error meta:', error.meta);
      console.error('  - Full error:', error);
      throw error;
    }

    // Check for existing default customer
    let existingDefaultCustomer;
    try {
      existingDefaultCustomer = await prisma.customer.findFirst({
        where: {
          isdefault: true,
        },
      });
    } catch (error) {
      console.error('❌ Error finding default customer:', error);
      // Continue execution - we can proceed without default customer check
    }

    // If default customer exists but has wrong name/phone, update it
    if (existingDefaultCustomer) {
      if (
        existingDefaultCustomer.name !== DEFAULT_CUSTOMER.name ||
        existingDefaultCustomer.phone1 !== DEFAULT_CUSTOMER.phone1
      ) {
        try {
          console.log('ℹ️ Updating default customer to match DEFAULT_CUSTOMER');
          existingDefaultCustomer = await prisma.customer.update({
            where: { id: existingDefaultCustomer.id },
            data: {
              name: DEFAULT_CUSTOMER.name,
              companyName: DEFAULT_CUSTOMER.companyName,
              phone1: DEFAULT_CUSTOMER.phone1,
              address: DEFAULT_CUSTOMER.address,
              tinNumber: DEFAULT_CUSTOMER.tinNumber,
            },
          });
          console.log('✅ Default customer updated successfully');
        } catch (error) {
          console.error('❌ Failed to update default customer:');
          console.error('  - Error message:', error.message);
          console.error('  - Full error:', error);
          // Don't throw - we already created the new customer
        }
      } else {
        console.log('ℹ️ Default customer already exists and is correct');
      }
    } else {
      // Create default customer only if it doesn't exist
      try {
        console.log('ℹ️ Creating default customer');
        const defaultCustomer = await prisma.customer.create({
          data: DEFAULT_CUSTOMER,
        });
        console.log('✅ Default customer created successfully:', defaultCustomer.id);
      } catch (error) {
        console.error('❌ Failed to create default customer:');
        console.error('  - Error message:', error.message);
        console.error('  - Error code:', error.code);
        console.error('  - Error meta:', error.meta);
        console.error('  - Full error:', error);
        // Don't throw - we already created the new customer
      }
    }

    return newCustomer;
  } catch (error) {
    // Catch any unhandled errors at the top level
    console.error('❌ Unhandled error in createCustomer:');
    console.error('  - Error name:', error.name);
    console.error('  - Error message:', error.message);
    console.error('  - Error stack:', error.stack);
    console.error('  - Full error:', error);
    throw error;
  }
};

// === AUTO-RUN when this file is imported/required ===
(async () => {
  try {
    // Check if default customer exists
    const existingDefaultCustomer = await prisma.customer.findFirst({
      where: {
        isdefault: true,
      },
    });

    // If not, create it automatically WITHOUT needing createCustomer
    if (!existingDefaultCustomer) {
      await prisma.customer.create({
        data: DEFAULT_CUSTOMER,
      });
      console.log('✅ Default customer created automatically on file load');
    }
  } catch (error) {
    console.error('Error creating default customer:', error);
  }
})();
const updateCustomer = async (id, updateBody) => {
  const existingCustomer = await getCustomerById(id);
  if (!existingCustomer) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Customer not found');
  }

  // Validate email uniqueness
  if (updateBody.email && updateBody.email !== existingCustomer.email) {
    if (await getCustomerByEmail(updateBody.email)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
    }
  }

  // Validate phone1 uniqueness
  if (updateBody.phone1 && updateBody.phone1 !== existingCustomer.phone1) {
    if (await getCustomerByPhone(updateBody.phone1)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Phone1 already taken');
    }
  }

  // Validate phone2 uniqueness
  if (updateBody.phone2 && updateBody.phone2 !== existingCustomer.phone2) {
    if (await getCustomerByPhone(updateBody.phone2)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Phone2 already taken');
    }
  }

  // Validate TIN uniqueness
  if (
    updateBody.tinNumber &&
    updateBody.tinNumber !== existingCustomer.tinNumber
  ) {
    if (await getCustomerByTin(updateBody.tinNumber)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'TIN already registered');
    }
  }

  // Explicit allowlist: `updateBody` is unvalidated req.body, and writing it
  // through let a client flip `isdefault`, which silently zeroes DELIVERY and
  // INSTALLATION on every future project for that customer.
  const UPDATABLE_FIELDS = [
    'name',
    'companyName',
    'phone1',
    'phone2',
    'tinNumber',
    'address',
    'email',
  ];

  const data = {};
  UPDATABLE_FIELDS.forEach((field) => {
    if (updateBody[field] !== undefined) {
      data[field] = updateBody[field];
    }
  });

  return prisma.customer.update({
    where: { id },
    data,
  });
};
/**
 * Customer picker source: search results when a term is given, otherwise the
 * top customers by sales value, falling back to the first few alphabetically.
 *
 * NOTE: this previously used raw SQL against `Customer`/`Sell` with `c.id`.
 * The real tables are `customers`/`sells` and the PK column is `_id`, so the
 * query always threw and was silently caught — the "top customers" branch had
 * never once executed. It is expressed through Prisma now, which keeps the
 * @map()ping correct by construction.
 */
const getCustomersWithFallback = async (search = '') => {
  // The internal "Stock" customer must never appear in a picker; getAllCustomers
  // already excludes it and this endpoint must agree.
  const excludeDefault = { isdefault: false };

  if (search.trim()) {
    const customers = await prisma.customer.findMany({
      where: {
        ...excludeDefault,
        OR: [
          { name: { contains: search } },
          { companyName: { contains: search } },
          { phone1: { contains: search } },
          { phone2: { contains: search } },
        ],
      },
      orderBy: { name: 'asc' },
      take: 50,
    });

    return {
      customers,
      count: customers.length,
      isSearchResults: true,
    };
  }

  // Top customers by total sales value.
  const salesByCustomer = await prisma.sell.groupBy({
    by: ['customerId'],
    _sum: { grandTotal: true },
    where: { customerId: { not: null } },
    orderBy: { _sum: { grandTotal: 'desc' } },
    take: 10,
  });

  const topCustomerIds = salesByCustomer
    .map((row) => row.customerId)
    .filter(Boolean);

  if (topCustomerIds.length > 0) {
    const topCustomers = await prisma.customer.findMany({
      where: { ...excludeDefault, id: { in: topCustomerIds } },
    });

    // Preserve the ranking from the aggregate, which findMany does not keep.
    const rank = new Map(topCustomerIds.map((id, index) => [id, index]));
    topCustomers.sort((a, b) => rank.get(a.id) - rank.get(b.id));

    if (topCustomers.length > 0) {
      return {
        customers: topCustomers,
        count: topCustomers.length,
        isTopCustomers: true,
      };
    }
  }

  // Fallback: first 10 customers alphabetically
  const defaultCustomers = await prisma.customer.findMany({
    where: excludeDefault,
    orderBy: { name: 'asc' },
    take: 10,
  });

  return {
    customers: defaultCustomers,
    count: defaultCustomers.length,
    isDefaultCustomers: true,
  };
};
const deleteCustomer = async (id) => {
  const existingCustomer = await getCustomerById(id);
  if (!existingCustomer) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Customer not found');
  }

  if (existingCustomer.isdefault) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'The default customer cannot be deleted',
    );
  }

  // Customer is referenced by projects, proforma invoices and sells. Without
  // this check the FK violation escaped as an opaque error; report what is
  // actually blocking the delete instead.
  const [projects, proformaInvoices, sells] = await Promise.all([
    prisma.project.count({ where: { customerId: id } }),
    prisma.proformaInvoice.count({ where: { customerId: id } }),
    prisma.sell.count({ where: { customerId: id } }),
  ]);

  if (projects > 0 || proformaInvoices > 0 || sells > 0) {
    const blockers = [
      projects && `${projects} project(s)`,
      proformaInvoices && `${proformaInvoices} proforma invoice(s)`,
      sells && `${sells} sale(s)`,
    ].filter(Boolean);

    throw new ApiError(
      httpStatus.CONFLICT,
      `Customer cannot be deleted because it is still linked to ${blockers.join(', ')}`,
    );
  }

  await prisma.customer.delete({ where: { id } });
  return { message: 'Customer deleted successfully' };
}; // Supplier Services

const getSupplierById = async (id) => {
  const supplier = await prisma.supplier.findUnique({
    where: { id },
  });
  return supplier;
};

const getSupplierByName = async (name) => {
  const supplier = await prisma.supplier.findFirst({
    where: { name },
  });
  return supplier;
};

const getSupplierByEmail = async (email) => {
  const supplier = await prisma.supplier.findFirst({
    where: { email },
  });
  return supplier;
};

const getSupplierByPhone = async (phone) => {
  const supplier = await prisma.supplier.findFirst({
    where: { phone },
  });
  return supplier;
};

const getSupplierByTin = async (tinNumber) => {
  const supplier = await prisma.supplier.findFirst({
    where: { tinNumber },
  });
  return supplier;
};

const getAllSuppliers = async (filter = {}) => {
  const suppliers = await prisma.supplier.findMany({
    where: filter,
    orderBy: {
      name: 'asc',
    },
  });

  return {
    suppliers,
    count: suppliers.length,
  };
};

const createSupplier = async (supplierBody) => {
  // Check if supplier with same name already exists
  if (await getSupplierByName(supplierBody.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Supplier name already taken');
  }

  // Check if supplier with same email already exists
  if (supplierBody.email && (await getSupplierByEmail(supplierBody.email))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }

  // Check if supplier with same phone already exists
  if (supplierBody.phone && (await getSupplierByPhone(supplierBody.phone))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
  }

  // Check if supplier with same tinNumber already exists - FIXED
  if (
    supplierBody.tinNumber &&
    (await getSupplierByTin(supplierBody.tinNumber))
  ) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'TIN already registered');
  }

  const supplier = await prisma.supplier.create({
    data: supplierBody,
  });
  return supplier;
};

const updateSupplier = async (id, updateBody) => {
  const existingSupplier = await getSupplierById(id);
  if (!existingSupplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Supplier not found');
  }

  // Check if name is being updated to an existing name
  if (updateBody.name && updateBody.name !== existingSupplier.name) {
    if (await getSupplierByName(updateBody.name)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Supplier name already taken');
    }
  }

  // Check if email is being updated to an existing email
  if (updateBody.email && updateBody.email !== existingSupplier.email) {
    if (await getSupplierByEmail(updateBody.email)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
    }
  }

  // Check if phone is being updated to an existing phone
  if (updateBody.phone && updateBody.phone !== existingSupplier.phone) {
    if (await getSupplierByPhone(updateBody.phone)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already taken');
    }
  }

  // Check if TIN is being updated to an existing TIN
  if (updateBody.tin && updateBody.tin !== existingSupplier.tin) {
    if (await getSupplierByTin(updateBody.tin)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'TIN already registered');
    }
  }

  const updatedSupplier = await prisma.supplier.update({
    where: { id },
    data: updateBody,
  });

  return updatedSupplier;
};

const deleteSupplier = async (id) => {
  const existingSupplier = await getSupplierById(id);
  if (!existingSupplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Supplier not found');
  }

  await prisma.supplier.delete({
    where: { id },
  });

  return { message: 'Supplier deleted successfully' };
};

module.exports = {
  // Customer exports
  getCustomersWithFallback,
  getCustomerById,
  getCustomerByEmail,
  getCustomerByPhone,
  getCustomerByTin,
  getAllCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,

  // Supplier exports
  getSupplierById,
  getSupplierByName,
  getSupplierByEmail,
  getSupplierByPhone,
  getSupplierByTin,
  getAllSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
};
