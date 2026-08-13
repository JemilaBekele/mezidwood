// prisma/seed-proforma-invoice.js
// ─────────────────────────────────────────────────────────────────────
// Complete Seeder for Proforma Invoice & Hierarchical Product Catalog
// Target Page: http://localhost:3030/dashboard/ProformaInvoice/new
// Run command: node prisma/seed-proforma-invoice.js
// ─────────────────────────────────────────────────────────────────────
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('../src/generated/prisma');

const prisma = new PrismaClient();
const hash = (pw) => bcrypt.hashSync(pw, 10);

async function main() {
  console.log('📄 Starting Full Proforma Invoice & Catalog Seeder …\n');

  // ─── 0. FIX CUSTOMERS ISDEFAULT FLAG ───────────────────────────────
  await prisma.customer.updateMany({ data: { isdefault: false } });
  console.log('0️⃣ Updated all existing customers to isdefault = false.');

  // ─── 1. ROLES & PERMISSIONS ─────────────────────────────────────────
  console.log('1️⃣ Seeding Roles & Permissions…');
  const [adminRole, managerRole, salesRole, warehouseRole, productionRole, designerRole] =
    await Promise.all([
      prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin', description: 'System administrator' } }),
      prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager', description: 'Branch / department manager' } }),
      prisma.role.upsert({ where: { name: 'Sales' }, update: {}, create: { name: 'Sales', description: 'Sales representative' } }),
      prisma.role.upsert({ where: { name: 'Warehouse' }, update: {}, create: { name: 'Warehouse', description: 'Warehouse / inventory staff' } }),
      prisma.role.upsert({ where: { name: 'Production' }, update: {}, create: { name: 'Production', description: 'Production worker' } }),
      prisma.role.upsert({ where: { name: 'Designer' }, update: {}, create: { name: 'Designer', description: 'Furniture designer' } }),
    ]);

  const PERMISSIONS = require('../src/middlewares/permissions.constants');
  const permArray = Object.values(PERMISSIONS).flatMap((cat) => Object.values(cat));
  await Promise.all(
    permArray.map((perm) =>
      prisma.permission.upsert({
        where: { name: perm.name },
        update: {},
        create: { name: perm.name, description: perm.description || null },
      }),
    ),
  );

  const allPerms = await prisma.permission.findMany();
  await Promise.all(
    allPerms.map((p) =>
      prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: adminRole.id, permissionId: p.id } },
        update: {},
        create: { roleId: adminRole.id, permissionId: p.id },
      }),
    ),
  );
  console.log(`   ✅ Setup ${allPerms.length} permissions for Admin.`);

  // ─── 2. USERS ───────────────────────────────────────────────────────
  console.log('2️⃣ Seeding Users…');
  const users = await Promise.all([
    prisma.user.upsert({
      where: { email: 'admin@mezidwood.com' },
      update: {},
      create: { name: 'System Admin', email: 'admin@mezidwood.com', phone: '+251911000001', userCode: 'USR-001', password: hash('Admin@1234'), roleId: adminRole.id, admin: true, status: 'Active' },
    }),
    prisma.user.upsert({
      where: { email: 'meron@mezidwood.com' },
      update: {},
      create: { name: 'Meron Sales', email: 'meron@mezidwood.com', phone: '+251911000003', userCode: 'USR-003', password: hash('Pass@1234'), roleId: salesRole.id, status: 'Active' },
    }),
    prisma.user.upsert({
      where: { email: 'hana@mezidwood.com' },
      update: {},
      create: { name: 'Hana Sales', email: 'hana@mezidwood.com', phone: '+251911000007', userCode: 'USR-007', password: hash('Pass@1234'), roleId: salesRole.id, status: 'Active' },
    }),
    prisma.user.upsert({
      where: { email: 'dawit@mezidwood.com' },
      update: {},
      create: { name: 'Dawit Manager', email: 'dawit@mezidwood.com', phone: '+251911000002', userCode: 'USR-002', password: hash('Pass@1234'), roleId: managerRole.id, status: 'Active' },
    }),
  ]);
  console.log(`   ✅ Setup ${users.length} system users.`);

  // ─── 3. COMPANY ─────────────────────────────────────────────────────
  console.log('3️⃣ Seeding Company Profile…');
  await prisma.company.upsert({
    where: { email: 'info@mezidwood.com' },
    update: {},
    create: {
      name: 'Mezid Woodworks PLC',
      email: 'info@mezidwood.com',
      phone: '+251115123456',
      address: 'Bole Sub-City, Woreda 03, Addis Ababa',
      addressTow: 'Behind Edna Mall',
      description: 'Premium Furniture Manufacturing & Interior Solutions',
      TIN: '0012345678',
      tinAddress: 'Addis Ababa Revenue Customs Branch',
      From: 'Ethiopia',
    },
  });
  console.log('   ✅ Company details created.');

  // ─── 4. STORES & SHOWROOMS ──────────────────────────────────────────
  console.log('4️⃣ Seeding Stores & Showrooms…');
  const existingStores = await prisma.store.findMany();
  const existingShowrooms = await prisma.showroom.findMany();

  let mainStore = existingStores.find((s) => s.isMain) || existingStores[0];
  if (!mainStore) {
    mainStore = await prisma.store.create({ data: { name: 'Main Factory Warehouse', isMain: true } });
  }

  let mainShowroom = existingShowrooms.find((s) => s.isMain) || existingShowrooms[0];
  if (!mainShowroom) {
    mainShowroom = await prisma.showroom.create({ data: { name: 'Bole Flagship Showroom', isMain: true } });
  }
  console.log('   ✅ Store & Showroom ready.');

  // ─── 5. BANKS ───────────────────────────────────────────────────────
  console.log('5️⃣ Seeding Banks…');
  const bankData = [
    { bankName: 'Commercial Bank of Ethiopia (CBE)', accountNumber: '1000123456789' },
    { bankName: 'Awash Bank', accountNumber: '2000987654321' },
    { bankName: 'Dashen Bank', accountNumber: '3000112233445' },
    { bankName: 'Bank of Abyssinia', accountNumber: '4000556677889' },
    { bankName: 'Wegagen Bank', accountNumber: '5000998877665' },
  ];
  const banks = await Promise.all(
    bankData.map((b) => prisma.bank.upsert({ where: { accountNumber: b.accountNumber }, update: {}, create: b })),
  );
  console.log(`   ✅ Setup ${banks.length} banks.`);

  // ─── 6. CUSTOMERS ───────────────────────────────────────────────────
  console.log('6️⃣ Seeding Customers for Proforma Invoice…');
  const customerList = [
    { name: 'Eyob Mekonnen', companyName: 'Eyob Real Estate PLC', phone1: '+251911223344', phone2: '+251922334455', email: 'eyob@eyobrealestate.et', tinNumber: '0045612378', address: 'Bole Atlas, Addis Ababa', isdefault: false },
    { name: 'Sara Mulugeta', companyName: 'Sara Interior Designs', phone1: '+251911334455', email: 'sara@sarainteriors.com', tinNumber: '0078912345', address: 'Kazanchis, Addis Ababa', isdefault: false },
    { name: 'Bereket Tadesse', companyName: 'Bereket Construction & Trading', phone1: '+251911445566', email: 'procurement@bereketconstruction.et', tinNumber: '0011223344', address: 'Megenagna, Addis Ababa', isdefault: false },
    { name: 'Fasika Haile', companyName: 'Fasika Luxury Boutique Hotel', phone1: '+251911556677', email: 'info@fasikahotel.et', tinNumber: '0055667788', address: 'Sarbet, Addis Ababa', isdefault: false },
    { name: 'Kidist Alemu', companyName: null, phone1: '+251911667788', email: 'kidist.alemu@gmail.com', address: 'CMC Sunshine Real Estate, Addis Ababa', isdefault: false },
    { name: 'Henok Girma', companyName: 'Henok Commercial Center', phone1: '+251911778899', email: 'henok@henokcenter.et', tinNumber: '0099887766', address: 'Mexico Square, Addis Ababa', isdefault: false },
    { name: 'Tigist Worku', companyName: 'Ethiopian Medical Association', phone1: '+251911889900', email: 'tworku@ema.org.et', tinNumber: '0033221144', address: 'Piazza, Addis Ababa', isdefault: false },
  ];

  const customers = await Promise.all(
    customerList.map(async (c) => {
      const existing = await prisma.customer.findFirst({
        where: { name: c.name },
      });
      if (existing) {
        await prisma.customer.update({ where: { id: existing.id }, data: { isdefault: false } });
        return existing;
      }
      return prisma.customer.create({ data: c });
    }),
  );
  console.log(`   ✅ Setup ${customers.length} customers (all with isdefault = false).`);

  // ─── 7. UNITS OF MEASURE ───────────────────────────────────────────
  console.log('7️⃣ Seeding Units of Measure…');
  const unitList = [
    { name: 'Piece', symbol: 'pc', base: true },
    { name: 'Square Meter', symbol: 'm²', base: false },
    { name: 'Meter', symbol: 'm', base: false },
    { name: 'Kilogram', symbol: 'kg', base: false },
    { name: 'Sheet', symbol: 'sht', base: false },
    { name: 'Liter', symbol: 'L', base: false },
    { name: 'Set', symbol: 'set', base: false },
    { name: 'Roll', symbol: 'roll', base: false },
  ];
  const units = await Promise.all(
    unitList.map((u) => prisma.unitOfMeasure.upsert({ where: { name: u.name }, update: {}, create: u })),
  );
  const [pcUnit, sqmUnit, mUnit, kgUnit, shtUnit, lUnit, setUnit, rollUnit] = units;
  console.log(`   ✅ Setup ${units.length} units of measure.`);

  // ─── 8. MATERIAL CATEGORIES & MATERIALS ──────────────────────────────
  console.log('8️⃣ Seeding Raw Materials & BOM Ingredients…');
  const matCatList = [
    'MDF Board', 'Solid Wood', 'Metal & Steel', 'Hardware & Fittings',
    'Finishing & Paint', 'Adhesive & Sealant', 'Edge Band', 'Glass & Mirror',
  ];
  const matCategories = await Promise.all(
    matCatList.map(async (name) => {
      const existing = await prisma.materialCategory.findFirst({ where: { name } });
      if (existing) return existing;
      return prisma.materialCategory.create({ data: { name } });
    }),
  );
  const [mdfCat, woodCat, metalCat, hardwareCat, finishCat, adhesiveCat, edgebandCat, glassCat] = matCategories;

  const rawMaterialsList = [
    { name: 'White High Gloss Laminated MDF 18mm', color: 'White', size: '2440x1220x18mm', laminatedMDF: true, materialTypeId: mdfCat.id, unitOfMeasureId: shtUnit.id, warningStockLevel: 10 },
    { name: 'Dark Walnut Laminated MDF 18mm', color: 'Dark Walnut', size: '2440x1220x18mm', laminatedMDF: true, materialTypeId: mdfCat.id, unitOfMeasureId: shtUnit.id, warningStockLevel: 10 },
    { name: 'Natural Oak Laminated MDF 18mm', color: 'Oak', size: '2440x1220x18mm', laminatedMDF: true, materialTypeId: mdfCat.id, unitOfMeasureId: shtUnit.id, warningStockLevel: 10 },
    { name: 'Plain MDF Board 16mm', color: 'Natural', size: '2440x1220x16mm', plainMDF: true, materialTypeId: mdfCat.id, unitOfMeasureId: shtUnit.id, warningStockLevel: 15 },
    { name: 'Plain Backing MDF Board 9mm', color: 'Natural', size: '2440x1220x9mm', plainMDF: true, materialTypeId: mdfCat.id, unitOfMeasureId: shtUnit.id, warningStockLevel: 20 },

    { name: 'Seasoned Eucalyptus Timber Plank', color: 'Brown', size: '3000x150x50mm', wood: true, materialTypeId: woodCat.id, unitOfMeasureId: mUnit.id, warningStockLevel: 25 },
    { name: 'High-Grade Wanza (Juniper) Plank', color: 'Reddish Brown', size: '2500x200x50mm', wood: true, materialTypeId: woodCat.id, unitOfMeasureId: mUnit.id, warningStockLevel: 15 },

    { name: 'Black Powder Coated Steel Square Tube 25x25mm', color: 'Black', size: '25x25x6000mm', metal: true, materialTypeId: metalCat.id, unitOfMeasureId: mUnit.id, warningStockLevel: 30 },
    { name: 'Heavy Duty Steel Rectangular Tube 40x20mm', color: 'Black', size: '40x20x6000mm', metal: true, materialTypeId: metalCat.id, unitOfMeasureId: mUnit.id, warningStockLevel: 20 },
    { name: 'Stainless Steel Trim Bar 30x3mm', color: 'Silver', size: '30x3x6000mm', metal: true, materialTypeId: metalCat.id, unitOfMeasureId: mUnit.id, warningStockLevel: 25 },

    { name: 'Soft Close Concealed Hinge 35mm (Hydraulic)', color: 'Nickel', size: '35mm', accessory: true, materialTypeId: hardwareCat.id, unitOfMeasureId: pcUnit.id, warningStockLevel: 100 },
    { name: 'Full Extension Soft-Close Ball Bearing Runner 450mm', color: 'Zinc', size: '450mm', accessory: true, materialTypeId: hardwareCat.id, unitOfMeasureId: pcUnit.id, warningStockLevel: 50 },
    { name: 'Modern Aluminum Handle 160mm (Matte Black)', color: 'Black', size: '160mm', accessory: true, materialTypeId: hardwareCat.id, unitOfMeasureId: pcUnit.id, warningStockLevel: 80 },
    { name: 'Cam Lock & Connecting Bolt Set', color: 'Silver', size: 'Standard', accessory: true, materialTypeId: hardwareCat.id, unitOfMeasureId: pcUnit.id, warningStockLevel: 200 },

    { name: 'Polyurethane Clear Gloss Lacquer (5L)', color: 'Clear', size: '5 L', other: true, materialTypeId: finishCat.id, unitOfMeasureId: lUnit.id, warningStockLevel: 5 },
    { name: 'Matte Finish Topcoat Lacquer (5L)', color: 'Clear Matte', size: '5 L', other: true, materialTypeId: finishCat.id, unitOfMeasureId: lUnit.id, warningStockLevel: 5 },
    { name: 'Rich Walnut Wood Stain (1L)', color: 'Walnut', size: '1 L', other: true, materialTypeId: finishCat.id, unitOfMeasureId: lUnit.id, warningStockLevel: 10 },

    { name: 'Heavy Duty Wood Glue D3 Grade (5kg)', color: 'White', size: '5 kg', other: true, materialTypeId: adhesiveCat.id, unitOfMeasureId: kgUnit.id, warningStockLevel: 10 },
    { name: 'PVC Edge Band Tape White 22x1mm (100m Roll)', color: 'White', size: '22mm x 100m', other: true, materialTypeId: edgebandCat.id, unitOfMeasureId: rollUnit.id, warningStockLevel: 5 },
    { name: 'PVC Edge Band Tape Walnut 22x1mm (100m Roll)', color: 'Dark Walnut', size: '22mm x 100m', other: true, materialTypeId: edgebandCat.id, unitOfMeasureId: rollUnit.id, warningStockLevel: 5 },

    { name: '6mm Clear Tempered Glass Sheet', color: 'Clear', size: 'Custom Cut', other: true, materialTypeId: glassCat.id, unitOfMeasureId: sqmUnit.id, warningStockLevel: 10 },
  ];

  const materials = await Promise.all(
    rawMaterialsList.map(async (m) => {
      const existing = await prisma.material.findFirst({ where: { name: m.name } });
      if (existing) return existing;
      return prisma.material.create({ data: m });
    }),
  );
  console.log(`   ✅ Setup ${materials.length} raw materials.`);

  // ─── 9. COMPLETE 4-TIER HIERARCHY (Category → Size → ProductType) ─────
  console.log('9️⃣ Seeding Complete Product Hierarchy (Category → Size → ProductType)…');

  const categoriesDefinition = [
    {
      name: 'Bed Frame',
      sizes: ['King', 'Queen', 'Single'],
      types: ['Modern', 'Classic', 'Minimalist', 'Industrial'],
    },
    {
      name: 'Office Desk',
      sizes: ['160cm', '120cm', '200cm'],
      types: ['Modern', 'Classic', 'Minimalist', 'Industrial'],
    },
    {
      name: 'Kitchen Cabinet',
      sizes: ['Small', 'Medium', 'Large'],
      types: ['Modern', 'Classic', 'Minimalist', 'Luxury'],
    },
    {
      name: 'Wardrobe',
      sizes: ['2 Door', '4 Door Sliding', 'Walk-In'],
      types: ['Modern', 'Classic', 'Minimalist', 'Luxury'],
    },
    {
      name: 'TV Stand',
      sizes: ['Console 160cm', 'Wall Unit 220cm'],
      types: ['Modern', 'Minimalist', 'Luxury'],
    },
    {
      name: 'Bookshelf',
      sizes: ['3-Tier', '5-Tier'],
      types: ['Industrial', 'Minimalist', 'Modern'],
    },
    {
      name: 'Door',
      sizes: ['Standard 90x210cm', 'Double Door 160x210cm'],
      types: ['Modern', 'Classic'],
    },
    {
      name: 'Shelving Unit',
      sizes: ['Wall Mounted', 'Free Standing'],
      types: ['Minimalist', 'Industrial'],
    },
  ];

  // Also include alias names so legacy category names match
  const categoryAliases = [
    { alias: 'Executive Office Desk', targetName: 'Office Desk' },
    { alias: 'Wardrobe & Closet', targetName: 'Wardrobe' },
    { alias: 'TV & Media Console', targetName: 'TV Stand' },
  ];

  // Map to store lookup: categoryName_sizeName_typeName -> { category, size, type }
  const hierarchyMap = {};
  let totalSizesCreated = 0;
  let totalTypesCreated = 0;

  for (const catDef of categoriesDefinition) {
    const category = await prisma.productCategory.upsert({
      where: { name: catDef.name },
      update: {},
      create: { name: catDef.name },
    });

    for (const sizeName of catDef.sizes) {
      let size = await prisma.size.findFirst({
        where: { name: sizeName, categoryId: category.id },
      });
      if (!size) {
        size = await prisma.size.create({
          data: { name: sizeName, categoryId: category.id },
        });
        totalSizesCreated++;
      }

      for (const baseTypeName of catDef.types) {
        // ProductType.name is unique in schema, so we make it descriptive per size
        const uniqueTypeName = `${baseTypeName} (${catDef.name} - ${sizeName})`;

        let type = await prisma.productType.findFirst({
          where: { name: uniqueTypeName },
        });
        if (!type) {
          type = await prisma.productType.create({
            data: { name: uniqueTypeName, sizeId: size.id },
          });
          totalTypesCreated++;
        } else if (type.sizeId !== size.id) {
          await prisma.productType.update({
            where: { id: type.id },
            data: { sizeId: size.id },
          });
        }

        hierarchyMap[`${catDef.name}_${sizeName}_${baseTypeName}`] = { category, size, type };
      }
    }
  }

  // Handle alias categories so dropdown matches both naming conventions
  for (const aliasDef of categoryAliases) {
    const targetDef = categoriesDefinition.find((c) => c.name === aliasDef.targetName);
    if (!targetDef) continue;

    const aliasCat = await prisma.productCategory.upsert({
      where: { name: aliasDef.alias },
      update: {},
      create: { name: aliasDef.alias },
    });

    for (const sizeName of targetDef.sizes) {
      let size = await prisma.size.findFirst({
        where: { name: sizeName, categoryId: aliasCat.id },
      });
      if (!size) {
        size = await prisma.size.create({
          data: { name: sizeName, categoryId: aliasCat.id },
        });
      }

      for (const baseTypeName of targetDef.types) {
        const uniqueTypeName = `${baseTypeName} (${aliasDef.alias} - ${sizeName})`;
        let type = await prisma.productType.findFirst({
          where: { name: uniqueTypeName },
        });
        if (!type) {
          type = await prisma.productType.create({
            data: { name: uniqueTypeName, sizeId: size.id },
          });
        }

        hierarchyMap[`${aliasDef.alias}_${sizeName}_${baseTypeName}`] = { category: aliasCat, size, type };
      }
    }
  }

  console.log(`   ✅ Setup ${categoriesDefinition.length} Categories, ${totalSizesCreated} Sizes, and ${totalTypesCreated} ProductTypes.`);

  // ─── 10. CATALOG PRODUCTS FOR ALL OPTIONS ─────────────────────────
  console.log('🔟 Seeding Catalog Items for every Category/Size/Type option…');

  const catalogItemsList = [
    // 🛏️ BED FRAME items for King, Queen, Single x Modern, Classic, Minimalist, Industrial
    { cat: 'Bed Frame', size: 'King', type: 'Modern', name: 'Modern Upholstered King Bed Frame', price: 89000, color: 'Grey Fabric / Dark Walnut' },
    { cat: 'Bed Frame', size: 'King', type: 'Classic', name: 'Classic Carved Solid Wanza King Bed Frame', price: 95000, color: 'Reddish Brown Wanza' },
    { cat: 'Bed Frame', size: 'King', type: 'Minimalist', name: 'Minimalist Low-Profile Platform King Bed', price: 72000, color: 'Natural White' },
    { cat: 'Bed Frame', size: 'King', type: 'Industrial', name: 'Industrial Iron & Steel Leg King Bed Frame', price: 68000, color: 'Black Steel / Oak' },

    { cat: 'Bed Frame', size: 'Queen', type: 'Modern', name: 'Modern Soft-Padded Queen Bed Frame', price: 65000, color: 'Beige Upholstery' },
    { cat: 'Bed Frame', size: 'Queen', type: 'Classic', name: 'Scandinavian Solid Wooden Queen Bed', price: 52000, color: 'Natural Oak' },
    { cat: 'Bed Frame', size: 'Queen', type: 'Minimalist', name: 'Japanese Style Floating Queen Bed Frame', price: 58000, color: 'Light Walnut' },
    { cat: 'Bed Frame', size: 'Queen', type: 'Industrial', name: 'Industrial Pipe Frame Queen Bed', price: 49000, color: 'Matte Black' },

    { cat: 'Bed Frame', size: 'Single', type: 'Modern', name: 'Single Modern Compact Bed Frame with Drawers', price: 34000, color: 'White Gloss' },
    { cat: 'Bed Frame', size: 'Single', type: 'Minimalist', name: 'Single Minimalist Wooden Bed', price: 28000, color: 'Natural Pine' },

    // 🖥️ OFFICE DESK items for 160cm, 120cm, 200cm x Modern, Classic, Minimalist, Industrial
    { cat: 'Office Desk', size: '160cm', type: 'Modern', name: 'Modern Executive Office Desk 160cm', price: 58000, color: 'Dark Walnut / Black Steel' },
    { cat: 'Office Desk', size: '160cm', type: 'Classic', name: 'Classic Wooden Executive Desk 160cm', price: 64000, color: 'Oak Finish' },
    { cat: 'Office Desk', size: '160cm', type: 'Industrial', name: 'Industrial Metal Leg Manager Desk 160cm', price: 48000, color: 'Oak / Black Steel' },
    { cat: 'Office Desk', size: '160cm', type: 'Minimalist', name: 'Minimalist Sleek Office Desk 160cm', price: 42000, color: 'White Matte' },

    { cat: 'Office Desk', size: '120cm', type: 'Minimalist', name: 'Compact Workstation Office Desk 120cm', price: 38000, color: 'White / Silver' },
    { cat: 'Office Desk', size: '120cm', type: 'Modern', name: 'Modern Home Office Writing Desk 120cm', price: 35000, color: 'Oak / White' },
    { cat: 'Office Desk', size: '120cm', type: 'Industrial', name: 'Industrial Compact Computer Desk 120cm', price: 36000, color: 'Black Steel / Oak' },

    { cat: 'Office Desk', size: '200cm', type: 'Classic', name: 'Grand Executive Office Desk 200cm', price: 85000, color: 'Dark Walnut' },
    { cat: 'Office Desk', size: '200cm', type: 'Modern', name: 'Presidential Modern L-Desk 200cm', price: 92000, color: 'Walnut & Black' },

    // 🍳 KITCHEN CABINET items
    { cat: 'Kitchen Cabinet', size: 'Large', type: 'Modern', name: 'Custom High Gloss L-Shape Kitchen Cabinet', price: 145000, color: 'White High Gloss / Dark Walnut' },
    { cat: 'Kitchen Cabinet', size: 'Medium', type: 'Modern', name: 'Straight Kitchen Cabinet with Overhead Storage', price: 78000, color: 'Oak / White' },
    { cat: 'Kitchen Cabinet', size: 'Small', type: 'Minimalist', name: 'Compact Kitchen Pantry & Base Cabinet', price: 45000, color: 'White Matte' },

    // 🚪 WARDROBE items
    { cat: 'Wardrobe', size: '4 Door Sliding', type: 'Modern', name: '4-Door Sliding Mirror Wardrobe', price: 115000, color: 'Dark Walnut' },
    { cat: 'Wardrobe', size: 'Walk-In', type: 'Minimalist', name: 'Modular Walk-in Closet Organization System', price: 165000, color: 'White Matte' },
    { cat: 'Wardrobe', size: '2 Door', type: 'Classic', name: '2-Door Wooden Armoire Wardrobe', price: 55000, color: 'Natural Oak' },

    // 📺 TV STAND items
    { cat: 'TV Stand', size: 'Console 160cm', type: 'Modern', name: 'Floating Wall-Mounted TV Console 160cm', price: 32000, color: 'White High Gloss & Walnut' },
    { cat: 'TV Stand', size: 'Wall Unit 220cm', type: 'Luxury', name: 'Full Wall Media Entertainment Center 220cm', price: 78000, color: 'Walnut & Glass' },

    // 📚 BOOKSHELF items
    { cat: 'Bookshelf', size: '5-Tier', type: 'Industrial', name: '5-Tier Industrial Steel Frame Bookshelf', price: 28000, color: 'Black Metal / Natural Oak' },
    { cat: 'Bookshelf', size: '3-Tier', type: 'Minimalist', name: '3-Tier Low Bookshelf Storage Unit', price: 18000, color: 'White Matte' },

    // 🚪 DOOR items
    { cat: 'Door', size: 'Standard 90x210cm', type: 'Modern', name: 'Flush Panel Solid Core Wooden Door', price: 22000, color: 'White Polyurethane' },
    { cat: 'Door', size: 'Double Door 160x210cm', type: 'Classic', name: 'Classic Carved Double Main Entrance Door', price: 48000, color: 'Dark Walnut' },

    // 🪵 SHELVING UNIT items
    { cat: 'Shelving Unit', size: 'Wall Mounted', type: 'Minimalist', name: 'Set of 3 Floating Wall Shelves', price: 12000, color: 'Natural Oak' },
  ];

  const items = await Promise.all(
    catalogItemsList.map(async (def) => {
      const key = `${def.cat}_${def.size}_${def.type}`;
      const refs = hierarchyMap[key];

      const itemData = {
        name: def.name,
        price: def.price,
        color: def.color,
        categoryId: refs?.category?.id,
        sizeId: refs?.size?.id,
        typeId: refs?.type?.id,
      };

      const existing = await prisma.items.findFirst({ where: { name: def.name } });
      if (existing) {
        return prisma.items.update({
          where: { id: existing.id },
          data: itemData,
        });
      }
      return prisma.items.create({ data: itemData });
    }),
  );
  console.log(`   ✅ Setup ${items.length} catalog products mapped to exact Category, Size, and Type combinations.`);

  // ─── 11. ITEM MATERIAL BILL OF MATERIALS (BOM) ──────────────────────
  console.log('1️⃣1️⃣ Seeding Item Bill of Materials (BOM)…');
  for (const item of items) {
    await prisma.itemMaterial.createMany({
      data: [
        { itemId: item.id, materialId: materials[0].id, quantity: 4, note: 'Primary MDF Sheet' },
        { itemId: item.id, materialId: materials[10].id, quantity: 4, note: 'Hydraulic Hinges / Fasteners' },
        { itemId: item.id, materialId: materials[11].id, quantity: 2, note: 'Drawer Runners' },
        { itemId: item.id, materialId: materials[18].id, quantity: 1, note: 'PVC Edge Band Roll' },
      ],
      skipDuplicates: true,
    });
  }
  console.log('   ✅ Linked all Items to Raw Materials (BOM populated for automatic proforma calculation).');

  console.log('\n🎉 Dedicated Proforma Invoice Seeder Completed Successfully!');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('📍 Page: http://localhost:3030/dashboard/ProformaInvoice/new');
  console.log('👤 Login: admin@mezidwood.com / Admin@1234');
  console.log('─────────────────────────────────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error('❌ Seeder failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
