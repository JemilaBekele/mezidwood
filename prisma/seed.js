// prisma/seed.js
// ─────────────────────────────────────────────────────────────────────
// Complete seed script for Mezidwood — Furniture Manufacturing ERP
// Run:  node prisma/seed.js
// ─────────────────────────────────────────────────────────────────────
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('../src/generated/prisma');

const prisma = new PrismaClient();

// ── Helpers ──────────────────────────────────────────────────────────
const hash = (pw) => bcrypt.hashSync(pw, 10);
const ago = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
};
const future = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

// ── Seed Data ────────────────────────────────────────────────────────
async function main() {
  console.log('🌱 Starting seed …');

  // ─── 1. ROLES ───────────────────────────────────────────────────
  const [adminRole, managerRole, salesRole, warehouseRole, productionRole, designerRole] =
    await Promise.all([
      prisma.role.upsert({ where: { name: 'Admin' }, update: {}, create: { name: 'Admin', description: 'System administrator with full access' } }),
      prisma.role.upsert({ where: { name: 'Manager' }, update: {}, create: { name: 'Manager', description: 'Branch / department manager' } }),
      prisma.role.upsert({ where: { name: 'Sales' }, update: {}, create: { name: 'Sales', description: 'Sales representative' } }),
      prisma.role.upsert({ where: { name: 'Warehouse' }, update: {}, create: { name: 'Warehouse', description: 'Warehouse / inventory staff' } }),
      prisma.role.upsert({ where: { name: 'Production' }, update: {}, create: { name: 'Production', description: 'Production floor worker' } }),
      prisma.role.upsert({ where: { name: 'Designer' }, update: {}, create: { name: 'Designer', description: 'Furniture / interior designer' } }),
    ]);
  console.log('  ✅ Roles');

  // ─── 2. PERMISSIONS ─────────────────────────────────────────────
  const PERMISSIONS = require('../src/middlewares/permissions.constants');
  const permArray = Object.values(PERMISSIONS).flatMap((cat) =>
    Object.values(cat),
  );
  await Promise.all(
    permArray.map((perm) =>
      prisma.permission.upsert({
        where: { name: perm.name },
        update: {},
        create: { name: perm.name, description: perm.description || null },
      }),
    ),
  );
  // Assign all permissions to Admin
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
  console.log('  ✅ Permissions (' + allPerms.length + ')');

  // ─── 3. USERS ───────────────────────────────────────────────────
  const users = await Promise.all([
    prisma.user.upsert({
      where: { email: 'admin@mezidwood.com' },
      update: {},
      create: {
        name: 'System Admin',
        email: 'admin@mezidwood.com',
        phone: '+251911000001',
        userCode: 'USR-001',
        password: hash('Admin@1234'),
        roleId: adminRole.id,
        admin: true,
        status: 'Active',
      },
    }),
    prisma.user.upsert({
      where: { email: 'dawit@mezidwood.com' },
      update: {},
      create: {
        name: 'Dawit Tadesse',
        email: 'dawit@mezidwood.com',
        phone: '+251911000002',
        userCode: 'USR-002',
        password: hash('Pass@1234'),
        roleId: managerRole.id,
        status: 'Active',
      },
    }),
    prisma.user.upsert({
      where: { email: 'meron@mezidwood.com' },
      update: {},
      create: {
        name: 'Meron Alemayehu',
        email: 'meron@mezidwood.com',
        phone: '+251911000003',
        userCode: 'USR-003',
        password: hash('Pass@1234'),
        roleId: salesRole.id,
        status: 'Active',
      },
    }),
    prisma.user.upsert({
      where: { email: 'abebe@mezidwood.com' },
      update: {},
      create: {
        name: 'Abebe Kebede',
        email: 'abebe@mezidwood.com',
        phone: '+251911000004',
        userCode: 'USR-004',
        password: hash('Pass@1234'),
        roleId: warehouseRole.id,
        status: 'Active',
      },
    }),
    prisma.user.upsert({
      where: { email: 'tigist@mezidwood.com' },
      update: {},
      create: {
        name: 'Tigist Hailu',
        email: 'tigist@mezidwood.com',
        phone: '+251911000005',
        userCode: 'USR-005',
        password: hash('Pass@1234'),
        roleId: productionRole.id,
        status: 'Active',
      },
    }),
    prisma.user.upsert({
      where: { email: 'samuel@mezidwood.com' },
      update: {},
      create: {
        name: 'Samuel Girma',
        email: 'samuel@mezidwood.com',
        phone: '+251911000006',
        userCode: 'USR-006',
        password: hash('Pass@1234'),
        roleId: designerRole.id,
        status: 'Active',
      },
    }),
    prisma.user.upsert({
      where: { email: 'hana@mezidwood.com' },
      update: {},
      create: {
        name: 'Hana Bekele',
        email: 'hana@mezidwood.com',
        phone: '+251911000007',
        userCode: 'USR-007',
        password: hash('Pass@1234'),
        roleId: salesRole.id,
        status: 'Active',
      },
    }),
    prisma.user.upsert({
      where: { email: 'yonas@mezidwood.com' },
      update: {},
      create: {
        name: 'Yonas Tesfaye',
        email: 'yonas@mezidwood.com',
        phone: '+251911000008',
        userCode: 'USR-008',
        password: hash('Pass@1234'),
        roleId: productionRole.id,
        status: 'Inactive',
      },
    }),
  ]);
  const [adminUser, managerUser, salesUser, warehouseUser, productionUser, designerUser, salesUser2, inactiveUser] = users;
  console.log('  ✅ Users (' + users.length + ')');

  // ─── 4. COMPANY ─────────────────────────────────────────────────
  await prisma.company.upsert({
    where: { email: 'info@mezidwood.com' },
    update: {},
    create: {
      name: 'Mezid Woodworks PLC',
      email: 'info@mezidwood.com',
      phone: '+251115123456',
      address: 'Bole Sub-City, Woreda 03, Addis Ababa',
      addressTow: 'Behind Edna Mall',
      description: 'Premium furniture manufacturing & interior solutions',
      TIN: '0012345678',
      tinAddress: 'Addis Ababa Revenue Office',
      From: 'Ethiopia',
    },
  });
  console.log('  ✅ Company');

  // ─── 5. STORES & SHOWROOMS ─────────────────────────────────────
  // Delete existing to avoid unique constraint on isMain
  const existingStores = await prisma.store.findMany();
  const existingShowrooms = await prisma.showroom.findMany();

  let mainStore, branchStore;
  if (existingStores.length === 0) {
    [mainStore, branchStore] = await Promise.all([
      prisma.store.create({ data: { name: 'Main Warehouse', isMain: true } }),
      prisma.store.create({ data: { name: 'Bole Branch Store', isMain: false } }),
    ]);
  } else {
    mainStore = existingStores.find((s) => s.isMain) || existingStores[0];
    branchStore = existingStores.find((s) => !s.isMain) || mainStore;
  }

  let mainShowroom, branchShowroom;
  if (existingShowrooms.length === 0) {
    [mainShowroom, branchShowroom] = await Promise.all([
      prisma.showroom.create({ data: { name: 'Main Showroom', isMain: true } }),
      prisma.showroom.create({ data: { name: 'Bole Showroom', isMain: false } }),
    ]);
  } else {
    mainShowroom = existingShowrooms.find((s) => s.isMain) || existingShowrooms[0];
    branchShowroom = existingShowrooms.find((s) => !s.isMain) || mainShowroom;
  }

  // Connect users to stores/showrooms
  await Promise.all([
    prisma.user.update({
      where: { id: warehouseUser.id },
      data: { stores: { connect: [{ id: mainStore.id }] } },
    }),
    prisma.user.update({
      where: { id: salesUser.id },
      data: { showrooms: { connect: [{ id: mainShowroom.id }] } },
    }),
  ]);
  console.log('  ✅ Stores & Showrooms');

  // ─── 6. BANKS ───────────────────────────────────────────────────
  const bankData = [
    { bankName: 'Commercial Bank of Ethiopia', accountNumber: '1000123456789' },
    { bankName: 'Awash Bank', accountNumber: '2000987654321' },
    { bankName: 'Dashen Bank', accountNumber: '3000112233445' },
    { bankName: 'Bank of Abyssinia', accountNumber: '4000556677889' },
  ];
  const banks = await Promise.all(
    bankData.map((b) =>
      prisma.bank.upsert({ where: { accountNumber: b.accountNumber }, update: {}, create: b }),
    ),
  );
  console.log('  ✅ Banks (' + banks.length + ')');

  // ─── 7. CUSTOMERS ──────────────────────────────────────────────
  const customerData = [
    { name: 'Eyob Mekonnen', phone1: '+251912345001', companyName: 'Eyob Real Estate', email: 'eyob@email.com', tinNumber: 'TIN001234', address: 'Kazanchis, Addis Ababa' },
    { name: 'Sara Mulugeta', phone1: '+251912345002', companyName: 'Sara Interiors', email: 'sara@email.com', address: 'CMC, Addis Ababa' },
    { name: 'Bereket Construction', phone1: '+251912345003', companyName: 'Bereket Construction PLC', email: 'bereket@construction.com', tinNumber: 'TIN005678', address: 'Megenagna, Addis Ababa' },
    { name: 'Fasika Hotel Group', phone1: '+251912345004', companyName: 'Fasika Hotels', email: 'procurement@fasika.com', tinNumber: 'TIN009012', address: 'Bole, Addis Ababa' },
    { name: 'Kidist Alemu', phone1: '+251912345005', email: 'kidist@email.com', address: 'Sarbet, Addis Ababa' },
    { name: 'Henok Furniture Retail', phone1: '+251912345006', companyName: 'Henok Trading', tinNumber: 'TIN003456', address: 'Mexico, Addis Ababa' },
  ];
  const customers = await Promise.all(
    customerData.map((c) => prisma.customer.create({ data: { ...c, isdefault: false } })),
  );
  console.log('  ✅ Customers (' + customers.length + ')');

  // ─── 8. SUPPLIERS ──────────────────────────────────────────────
  const supplierData = [
    { name: 'Yeka Wood Supply', contactName: 'Ato Tesfaye', phone: '+251911222001', email: 'yeka@supply.com', city: 'Addis Ababa', country: 'Ethiopia', tinNumber: 'TIN-SUP-001' },
    { name: 'MDF Import Trading', contactName: 'W/ro Almaz', phone: '+251911222002', email: 'mdf@import.com', city: 'Addis Ababa', country: 'Ethiopia', tinNumber: 'TIN-SUP-002' },
    { name: 'Turkish Hardware & Fittings', contactName: 'Ali Demir', phone: '+905551234567', email: 'ali@turkishhardware.com', city: 'Istanbul', country: 'Turkey', tinNumber: 'TIN-SUP-003' },
    { name: 'Ethio Metal Works', contactName: 'Ato Girma', phone: '+251911222004', email: 'girma@ethiometal.com', city: 'Addis Ababa', country: 'Ethiopia', tinNumber: 'TIN-SUP-004' },
    { name: 'China Accessories Co.', contactName: 'Mr. Wei', phone: '+8613812345678', email: 'wei@chinaccessories.com', city: 'Guangzhou', country: 'China' },
  ];
  const suppliers = await Promise.all(
    supplierData.map((s) => prisma.supplier.create({ data: s })),
  );
  console.log('  ✅ Suppliers (' + suppliers.length + ')');

  // ─── 9. UNITS OF MEASURE ──────────────────────────────────────
  const unitData = [
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
    unitData.map((u) =>
      prisma.unitOfMeasure.upsert({ where: { name: u.name }, update: {}, create: u }),
    ),
  );
  const [pcUnit, sqmUnit, mUnit, kgUnit, shtUnit, lUnit, setUnit, rollUnit] = units;
  console.log('  ✅ Units of Measure (' + units.length + ')');

  // ─── 10. MATERIAL CATEGORIES ──────────────────────────────────
  const matCatData = [
    'MDF Board', 'Solid Wood', 'Metal & Steel', 'Hardware & Fittings',
    'Finishing & Paint', 'Adhesive & Sealant', 'Edge Band', 'Glass',
  ];
  const matCategories = await Promise.all(
    matCatData.map((name) => prisma.materialCategory.create({ data: { name } })),
  );
  const [mdfCat, woodCat, metalCat, hardwareCat, finishCat, adhesiveCat, edgebandCat, glassCat] = matCategories;
  console.log('  ✅ Material Categories (' + matCategories.length + ')');

  // ─── 11. MATERIALS ────────────────────────────────────────────
  const materialData = [
    // MDF Boards
    { name: 'White Laminated MDF 18mm', color: 'White', size: '2440x1220x18mm', laminatedMDF: true, materialTypeId: mdfCat.id, unitOfMeasureId: shtUnit.id, warningStockLevel: 5 },
    { name: 'Walnut Laminated MDF 18mm', color: 'Walnut', size: '2440x1220x18mm', laminatedMDF: true, materialTypeId: mdfCat.id, unitOfMeasureId: shtUnit.id, warningStockLevel: 5 },
    { name: 'Plain MDF 16mm', color: null, size: '2440x1220x16mm', plainMDF: true, materialTypeId: mdfCat.id, unitOfMeasureId: shtUnit.id, warningStockLevel: 8 },
    { name: 'Plain MDF 9mm', color: null, size: '2440x1220x9mm', plainMDF: true, materialTypeId: mdfCat.id, unitOfMeasureId: shtUnit.id, warningStockLevel: 10 },
    { name: 'Oak Laminated MDF 18mm', color: 'Oak', size: '2440x1220x18mm', laminatedMDF: true, materialTypeId: mdfCat.id, unitOfMeasureId: shtUnit.id, warningStockLevel: 5 },

    // Solid Wood
    { name: 'Eucalyptus Timber', color: null, size: '3m x varied', wood: true, materialTypeId: woodCat.id, unitOfMeasureId: mUnit.id, warningStockLevel: 20 },
    { name: 'Juniper Wood Plank', color: null, size: '2.5m x varied', wood: true, materialTypeId: woodCat.id, unitOfMeasureId: mUnit.id, warningStockLevel: 15 },

    // Metal
    { name: 'Steel Tube 25x25mm', color: null, size: '25x25x6000mm', metal: true, materialTypeId: metalCat.id, unitOfMeasureId: mUnit.id, warningStockLevel: 30 },
    { name: 'Steel Tube 40x20mm', color: null, size: '40x20x6000mm', metal: true, materialTypeId: metalCat.id, unitOfMeasureId: mUnit.id, warningStockLevel: 20 },
    { name: 'Flat Bar 30x3mm', color: null, size: '30x3x6000mm', metal: true, materialTypeId: metalCat.id, unitOfMeasureId: mUnit.id, warningStockLevel: 25 },

    // Hardware
    { name: 'Hinge – Soft Close 35mm', color: null, size: '35mm', accessory: true, materialTypeId: hardwareCat.id, unitOfMeasureId: pcUnit.id, warningStockLevel: 50 },
    { name: 'Drawer Slide 450mm', color: null, size: '450mm', accessory: true, materialTypeId: hardwareCat.id, unitOfMeasureId: pcUnit.id, warningStockLevel: 30 },
    { name: 'Handle – Modern Bar 128mm', color: 'Chrome', size: '128mm', accessory: true, materialTypeId: hardwareCat.id, unitOfMeasureId: pcUnit.id, warningStockLevel: 40 },
    { name: 'Cabinet Lock', color: null, size: null, accessory: true, materialTypeId: hardwareCat.id, unitOfMeasureId: pcUnit.id, warningStockLevel: 20 },
    { name: 'Screw 3.5x30mm (Box)', color: null, size: '3.5x30mm', accessory: true, materialTypeId: hardwareCat.id, unitOfMeasureId: pcUnit.id, warningStockLevel: 10 },

    // Finishing
    { name: 'PU Lacquer – Clear Gloss', color: 'Clear', size: '5L', other: true, materialTypeId: finishCat.id, unitOfMeasureId: lUnit.id, warningStockLevel: 5 },
    { name: 'PU Lacquer – Matte', color: 'Matte', size: '5L', other: true, materialTypeId: finishCat.id, unitOfMeasureId: lUnit.id, warningStockLevel: 5 },
    { name: 'Wood Stain – Dark Walnut', color: 'Dark Walnut', size: '1L', other: true, materialTypeId: finishCat.id, unitOfMeasureId: lUnit.id, warningStockLevel: 8 },
    { name: 'Primer – White', color: 'White', size: '5L', other: true, materialTypeId: finishCat.id, unitOfMeasureId: lUnit.id, warningStockLevel: 5 },

    // Adhesive
    { name: 'Wood Glue – D3', color: null, size: '5kg', other: true, materialTypeId: adhesiveCat.id, unitOfMeasureId: kgUnit.id, warningStockLevel: 5 },
    { name: 'Contact Cement', color: null, size: '5L', other: true, materialTypeId: adhesiveCat.id, unitOfMeasureId: lUnit.id, warningStockLevel: 3 },

    // Edge Band
    { name: 'PVC Edge Band – White 22mm', color: 'White', size: '22mm x 50m', other: true, materialTypeId: edgebandCat.id, unitOfMeasureId: rollUnit.id, warningStockLevel: 5 },
    { name: 'PVC Edge Band – Walnut 22mm', color: 'Walnut', size: '22mm x 50m', other: true, materialTypeId: edgebandCat.id, unitOfMeasureId: rollUnit.id, warningStockLevel: 5 },
    { name: 'PVC Edge Band – Oak 22mm', color: 'Oak', size: '22mm x 50m', other: true, materialTypeId: edgebandCat.id, unitOfMeasureId: rollUnit.id, warningStockLevel: 5 },

    // Glass
    { name: 'Tempered Glass 6mm', color: 'Clear', size: '6mm', other: true, materialTypeId: glassCat.id, unitOfMeasureId: sqmUnit.id, warningStockLevel: 3 },
  ];
  const materials = await Promise.all(
    materialData.map((m) => prisma.material.create({ data: m })),
  );
  console.log('  ✅ Materials (' + materials.length + ')');

  // ─── 12. PRODUCT CATEGORIES, TYPES, SIZES ─────────────────────
  const prodCatData = ['Kitchen Cabinet', 'Wardrobe', 'Office Desk', 'TV Stand', 'Bookshelf', 'Bed Frame', 'Door', 'Shelving Unit'];
  const productCategories = await Promise.all(
    prodCatData.map((name) =>
      prisma.productCategory.upsert({ where: { name }, update: {}, create: { name } }),
    ),
  );
  const [kitchenCat, wardrobeCat, deskCat, tvCat, bookshelfCat, bedCat, doorCat, shelvingCat] = productCategories;

  const sizeData = [
    { name: 'Small', categoryId: kitchenCat.id },
    { name: 'Medium', categoryId: kitchenCat.id },
    { name: 'Large', categoryId: kitchenCat.id },
    { name: 'Single', categoryId: bedCat.id },
    { name: 'Queen', categoryId: bedCat.id },
    { name: 'King', categoryId: bedCat.id },
    { name: '120cm', categoryId: deskCat.id },
    { name: '160cm', categoryId: deskCat.id },
    { name: '200cm', categoryId: deskCat.id },
  ];
  const sizes = await Promise.all(
    sizeData.map((s) => prisma.size.create({ data: s })),
  );

  const typeData = [
    { name: 'Modern' },
    { name: 'Classic' },
    { name: 'Minimalist' },
    { name: 'Industrial' },
  ];
  const productTypes = await Promise.all(
    typeData.map((t) =>
      prisma.productType.upsert({ where: { name: t.name }, update: {}, create: t }),
    ),
  );
  const [modernType, classicType, minimalistType, industrialType] = productTypes;
  console.log('  ✅ Product Categories, Types & Sizes');

  // ─── 13. ITEMS (FINISHED PRODUCTS) ────────────────────────────
  const itemData = [
    { name: 'Modern Kitchen Cabinet – L-Shape', price: 85000, color: 'White / Walnut', categoryId: kitchenCat.id, typeId: modernType.id, sizeId: sizes[2].id },
    { name: 'Classic Kitchen Cabinet – Straight', price: 62000, color: 'Oak', categoryId: kitchenCat.id, typeId: classicType.id, sizeId: sizes[1].id },
    { name: 'Built-in Wardrobe – Sliding Door', price: 95000, color: 'Walnut', categoryId: wardrobeCat.id, typeId: modernType.id },
    { name: 'Walk-in Closet System', price: 120000, color: 'White', categoryId: wardrobeCat.id, typeId: minimalistType.id },
    { name: 'Executive Office Desk', price: 45000, color: 'Dark Walnut', categoryId: deskCat.id, typeId: classicType.id, sizeId: sizes[8].id },
    { name: 'Standing Desk – Adjustable', price: 38000, color: 'Oak / Black', categoryId: deskCat.id, typeId: industrialType.id, sizeId: sizes[7].id },
    { name: 'Floating TV Console', price: 28000, color: 'White Matte', categoryId: tvCat.id, typeId: minimalistType.id },
    { name: 'TV Wall Unit – Full', price: 55000, color: 'Walnut', categoryId: tvCat.id, typeId: modernType.id },
    { name: 'Open Bookshelf – 5 Tier', price: 22000, color: 'Natural Wood', categoryId: bookshelfCat.id, typeId: industrialType.id },
    { name: 'King Size Bed Frame – Upholstered', price: 75000, color: 'Grey Fabric / Walnut', categoryId: bedCat.id, typeId: modernType.id, sizeId: sizes[5].id },
    { name: 'Queen Bed Frame – Simple', price: 42000, color: 'White', categoryId: bedCat.id, typeId: minimalistType.id, sizeId: sizes[4].id },
    { name: 'Interior Door – Flush Panel', price: 18000, color: 'White', categoryId: doorCat.id, typeId: modernType.id },
    { name: 'Interior Door – Classic Panel', price: 25000, color: 'Walnut', categoryId: doorCat.id, typeId: classicType.id },
    { name: 'Wall Shelving – Floating', price: 12000, color: 'White / Oak', categoryId: shelvingCat.id, typeId: minimalistType.id },
    { name: 'Shoe Rack Cabinet', price: 18000, color: 'Walnut', categoryId: shelvingCat.id, typeId: modernType.id },
  ];
  const items = await Promise.all(
    itemData.map((item) => prisma.items.create({ data: item })),
  );
  console.log('  ✅ Items / Products (' + items.length + ')');

  // ─── 14. ITEM–MATERIAL RELATIONSHIPS (BOM) ───────────────────
  // Kitchen cabinet BOM + Wardrobe BOM + Office Desk BOM — all independent
  await Promise.all([
    prisma.itemMaterial.createMany({
      data: [
        { itemId: items[0].id, materialId: materials[0].id, quantity: 4 },
        { itemId: items[0].id, materialId: materials[1].id, quantity: 2 },
        { itemId: items[0].id, materialId: materials[10].id, quantity: 12 },
        { itemId: items[0].id, materialId: materials[11].id, quantity: 6 },
        { itemId: items[0].id, materialId: materials[12].id, quantity: 10 },
        { itemId: items[0].id, materialId: materials[21].id, quantity: 2 },
      ],
      skipDuplicates: true,
    }),
    prisma.itemMaterial.createMany({
      data: [
        { itemId: items[2].id, materialId: materials[1].id, quantity: 6 },
        { itemId: items[2].id, materialId: materials[2].id, quantity: 3 },
        { itemId: items[2].id, materialId: materials[10].id, quantity: 8 },
        { itemId: items[2].id, materialId: materials[11].id, quantity: 4 },
        { itemId: items[2].id, materialId: materials[22].id, quantity: 3 },
      ],
      skipDuplicates: true,
    }),
    prisma.itemMaterial.createMany({
      data: [
        { itemId: items[4].id, materialId: materials[1].id, quantity: 2 },
        { itemId: items[4].id, materialId: materials[7].id, quantity: 4 },
        { itemId: items[4].id, materialId: materials[11].id, quantity: 2 },
        { itemId: items[4].id, materialId: materials[13].id, quantity: 2 },
      ],
      skipDuplicates: true,
    }),
  ]);
  console.log('  ✅ Bill of Materials (Item ↔ Material)');

  // ─── 15. INVENTORY STOCK (initial quantities) ─────────────────
  // Material stock in main store
  const materialStockData = materials.map((mat) => ({
    materialId: mat.id,
    storeId: mainStore.id,
    showroomId: null,
    quantity: 20 + Math.floor(Math.random() * 80),
    status: 'Available',
  }));
  await prisma.inventoryStock.createMany({ data: materialStockData, skipDuplicates: true });

  // Item stock in showroom (first 5 items)
  const showroomStockData = items.slice(0, 5).map((item) => ({
    itemId: item.id,
    showroomId: mainShowroom.id,
    storeId: null,
    quantity: 2 + Math.floor(Math.random() * 8),
  }));
  await prisma.itemStock.createMany({ data: showroomStockData, skipDuplicates: true });

  // Item stock in main store (all items)
  const storeStockData = items.map((item) => ({
    itemId: item.id,
    storeId: mainStore.id,
    showroomId: null,
    quantity: 3 + Math.floor(Math.random() * 12),
  }));
  await prisma.itemStock.createMany({ data: storeStockData, skipDuplicates: true });
  console.log('  ✅ Inventory Stock');

  // ─── 16. PURCHASES ────────────────────────────────────────────
  const purchaseData = [
    {
      invoiceNo: 'PUR-2025-0001',
      supplierId: suppliers[0].id,
      storeId: mainStore.id,
      bankId: banks[0].id,
      paymentStatus: 'APPROVED',
      notes: 'Monthly MDF board restock',
      createdById: warehouseUser.id,
      purchaseDate: ago(30),
      items: [
        { materialId: materials[0].id, quantity: 20, unitPrice: 3500, unitOfMeasureId: shtUnit.id },
        { materialId: materials[1].id, quantity: 15, unitPrice: 3800, unitOfMeasureId: shtUnit.id },
        { materialId: materials[2].id, quantity: 25, unitPrice: 2800, unitOfMeasureId: shtUnit.id },
      ],
    },
    {
      invoiceNo: 'PUR-2025-0002',
      supplierId: suppliers[1].id,
      storeId: mainStore.id,
      paymentStatus: 'APPROVED',
      notes: 'Hardware & fittings order',
      createdById: warehouseUser.id,
      purchaseDate: ago(20),
      items: [
        { materialId: materials[10].id, quantity: 200, unitPrice: 85, unitOfMeasureId: pcUnit.id },
        { materialId: materials[11].id, quantity: 100, unitPrice: 450, unitOfMeasureId: pcUnit.id },
        { materialId: materials[12].id, quantity: 150, unitPrice: 120, unitOfMeasureId: pcUnit.id },
      ],
    },
    {
      invoiceNo: 'PUR-2025-0003',
      supplierId: suppliers[3].id,
      storeId: mainStore.id,
      bankId: banks[1].id,
      paymentStatus: 'PENDING',
      notes: 'Steel tubes for metal frame production',
      createdById: warehouseUser.id,
      purchaseDate: ago(7),
      items: [
        { materialId: materials[7].id, quantity: 50, unitPrice: 280, unitOfMeasureId: mUnit.id },
        { materialId: materials[8].id, quantity: 30, unitPrice: 350, unitOfMeasureId: mUnit.id },
        { materialId: materials[9].id, quantity: 40, unitPrice: 180, unitOfMeasureId: mUnit.id },
      ],
    },
    {
      invoiceNo: 'PUR-2025-0004',
      supplierId: suppliers[2].id,
      storeId: mainStore.id,
      paymentStatus: 'PENDING',
      notes: 'Paint and finishing materials',
      createdById: warehouseUser.id,
      purchaseDate: ago(3),
      items: [
        { materialId: materials[15].id, quantity: 20, unitPrice: 2500, unitOfMeasureId: lUnit.id },
        { materialId: materials[16].id, quantity: 15, unitPrice: 2800, unitOfMeasureId: lUnit.id },
        { materialId: materials[17].id, quantity: 10, unitPrice: 1200, unitOfMeasureId: lUnit.id },
        { materialId: materials[18].id, quantity: 20, unitPrice: 1800, unitOfMeasureId: lUnit.id },
      ],
    },
  ];
  const purchases = await Promise.all(
    purchaseData.map((p) => {
      const { items: pItems, ...purchaseFields } = p;
      const subTotal = pItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      return prisma.purchase.create({
        data: {
          ...purchaseFields,
          totalProducts: pItems.length,
          subTotal,
          grandTotal: subTotal,
          items: {
            create: pItems.map((i) => ({
              materialId: i.materialId,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              totalPrice: i.quantity * i.unitPrice,
              unitOfMeasureId: i.unitOfMeasureId,
            })),
          },
        },
      });
    }),
  );
  console.log('  ✅ Purchases (' + purchases.length + ')');

  // ─── 17. PROFORMA INVOICES ────────────────────────────────────
  const piData = [
    {
      piNumber: 'PI-2025-0001',
      customerId: customers[0].id,
      status: 'APPROVED_CREATE_PROJECT',
      paymentStatus: 'PARTIAL',
      subtotal: 180000,
      vat: 27000,
      total: 207000,
      amountPaid: 100000,
      balance: 107000,
      preparedById: salesUser.id,
      approvedById: managerUser.id,
      items: [
        { description: 'Modern Kitchen Cabinet – L-Shape (Custom)', size: 'Large', quantity: 1, unitPrice: 95000, amount: 95000 },
        { description: 'Built-in Wardrobe – Sliding Door', size: null, quantity: 1, unitPrice: 85000, amount: 85000 },
      ],
    },
    {
      piNumber: 'PI-2025-0002',
      customerId: customers[1].id,
      status: 'SENT_TO_CLIENT',
      paymentStatus: 'PENDING',
      subtotal: 55000,
      vat: 8250,
      total: 63250,
      amountPaid: 0,
      balance: 63250,
      preparedById: salesUser.id,
      items: [
        { description: 'Floating TV Console – Custom Size', size: null, quantity: 2, unitPrice: 15000, amount: 30000 },
        { description: 'Wall Shelving – Floating (set of 5)', size: null, quantity: 1, unitPrice: 25000, amount: 25000 },
      ],
    },
    {
      piNumber: 'PI-2025-0003',
      customerId: customers[2].id,
      status: 'APPROVED_CREATE_PROJECT',
      paymentStatus: 'PAID',
      subtotal: 450000,
      vat: 67500,
      total: 517500,
      amountPaid: 517500,
      balance: 0,
      preparedById: salesUser2.id,
      approvedById: managerUser.id,
      items: [
        { description: 'Executive Office Desk – Custom', size: '200cm', quantity: 5, unitPrice: 50000, amount: 250000 },
        { description: 'Open Bookshelf – 5 Tier', size: null, quantity: 5, unitPrice: 25000, amount: 125000 },
        { description: 'Interior Door – Flush Panel', size: null, quantity: 5, unitPrice: 15000, amount: 75000 },
      ],
    },
    {
      piNumber: 'PI-2025-0004',
      customerId: customers[3].id,
      status: 'PENDING_ST',
      paymentStatus: 'PENDING',
      subtotal: 320000,
      vat: 48000,
      total: 368000,
      amountPaid: 0,
      balance: 368000,
      preparedById: salesUser.id,
      items: [
        { description: 'Hotel Room Wardrobe – Standard', size: null, quantity: 8, unitPrice: 40000, amount: 320000 },
      ],
    },
    {
      piNumber: 'PI-2025-0005',
      customerId: customers[4].id,
      status: 'APPROVED_CLIENT',
      paymentStatus: 'PARTIAL',
      subtotal: 117000,
      vat: 17550,
      total: 134550,
      amountPaid: 67000,
      balance: 67550,
      preparedById: salesUser2.id,
      approvedById: managerUser.id,
      items: [
        { description: 'Queen Bed Frame – Upholstered', size: 'Queen', quantity: 1, unitPrice: 55000, amount: 55000 },
        { description: 'Shoe Rack Cabinet', size: null, quantity: 1, unitPrice: 20000, amount: 20000 },
        { description: 'King Size Bed Frame – Simple', size: 'King', quantity: 1, unitPrice: 42000, amount: 42000 },
      ],
    },
  ];
  const proformas = await Promise.all(
    piData.map((pi) => {
      const { items: piItems, ...piFields } = pi;
      return prisma.proformaInvoice.create({
        data: { ...piFields, items: { create: piItems } },
      });
    }),
  );
  console.log('  ✅ Proforma Invoices (' + proformas.length + ')');

  // ─── 18. PROFORMA INVOICE PAYMENTS ────────────────────────────
  await prisma.proformaInvoiceBank.createMany({
    data: [
      { proformaInvoiceId: proformas[0].id, bankId: banks[0].id, amount: 60000, paidBy: 'Eyob Mekonnen', createdById: salesUser.id },
      { proformaInvoiceId: proformas[0].id, bankId: banks[1].id, amount: 40000, paidBy: 'Eyob Mekonnen', createdById: salesUser.id },
      { proformaInvoiceId: proformas[2].id, bankId: banks[0].id, amount: 517500, paidBy: 'Bereket Construction PLC', createdById: salesUser2.id },
      { proformaInvoiceId: proformas[4].id, bankId: banks[2].id, amount: 67000, paidBy: 'Kidist Alemu', createdById: salesUser2.id },
    ],
  });
  console.log('  ✅ Proforma Payments');

  // ─── 19. PROJECTS ─────────────────────────────────────────────
  const projectData = [
    {
      invoiceId: proformas[0].id,
      customerId: customers[0].id,
      status: 'CUTTING',
      designStatus: 'FINISHED',
      difficulty: 'HARD',
      totalProjectQuantity: 2,
      totalDays: 25,
      requestedDelivery: future(20),
      createdById: managerUser.id,
      designById: designerUser.id,
    },
    {
      invoiceId: proformas[2].id,
      customerId: customers[2].id,
      status: 'DESIGN',
      designStatus: 'MODELING',
      difficulty: 'MEDIUM',
      totalProjectQuantity: 15,
      totalDays: 35,
      requestedDelivery: future(40),
      createdById: managerUser.id,
      designById: designerUser.id,
    },
  ];
  const projects = await Promise.all(
    projectData.map((proj) => prisma.project.create({ data: proj })),
  );
  console.log('  ✅ Projects (' + projects.length + ')');

  // ─── 20. PROJECT STAGES ───────────────────────────────────────
  // Project 1 stages (further along)
  const p1Stages = [
    { stage: 'INVOICE', capacityDays: 1, startDate: ago(20), endDate: ago(19), startDateTime: ago(20), endDateTime: ago(19), finished: true, status: 'COMPLETED' },
    { stage: 'DESIGN', capacityDays: 5, startDate: ago(19), endDate: ago(14), startDateTime: ago(19), endDateTime: ago(14), finished: true, status: 'COMPLETED' },
    { stage: 'PURCHASING', capacityDays: 3, startDate: ago(14), endDate: ago(11), startDateTime: ago(14), endDateTime: ago(11), finished: true, status: 'COMPLETED' },
    { stage: 'METAL_WORKS', capacityDays: 3, startDate: ago(11), endDate: ago(8), startDateTime: ago(11), endDateTime: ago(8), finished: true, status: 'COMPLETED' },
    { stage: 'CNC', capacityDays: 2, startDate: ago(8), endDate: ago(6), startDateTime: ago(8), endDateTime: ago(6), finished: true, status: 'COMPLETED' },
    { stage: 'CUTTING', capacityDays: 3, startDate: ago(6), endDate: ago(3), startDateTime: ago(6), endDateTime: ago(3), finished: false, status: 'IN_PROGRESS' },
    { stage: 'EDGE_BANDING', capacityDays: 2, startDate: ago(3), endDate: ago(1), startDateTime: ago(3), endDateTime: ago(1), finished: false, status: 'ACTIVE' },
    { stage: 'ASSEMBLY', capacityDays: 4, startDate: future(0), endDate: future(4), startDateTime: future(0), endDateTime: future(4), finished: false, status: 'ACTIVE' },
    { stage: 'PAINTING', capacityDays: 3, startDate: future(4), endDate: future(7), startDateTime: future(4), endDateTime: future(7), finished: false, status: 'ACTIVE' },
    { stage: 'FINISHING', capacityDays: 2, startDate: future(7), endDate: future(9), startDateTime: future(7), endDateTime: future(9), finished: false, status: 'ACTIVE' },
    { stage: 'DELIVERY', capacityDays: 1, startDate: future(9), endDate: future(10), startDateTime: future(9), endDateTime: future(10), finished: false, status: 'ACTIVE' },
    { stage: 'INSTALLATION', capacityDays: 2, startDate: future(10), endDate: future(12), startDateTime: future(10), endDateTime: future(12), finished: false, status: 'ACTIVE' },
  ];
  // Project 2 stages (early)
  const p2Stages = [
    { stage: 'INVOICE', capacityDays: 1, startDate: ago(5), endDate: ago(4), startDateTime: ago(5), endDateTime: ago(4), finished: true, status: 'COMPLETED' },
    { stage: 'DESIGN', capacityDays: 7, startDate: ago(4), endDate: future(3), startDateTime: ago(4), endDateTime: future(3), finished: false, status: 'IN_PROGRESS' },
  ];
  await Promise.all([
    prisma.projectStage.createMany({
      data: p1Stages.map((s) => ({ projectId: projects[0].id, ...s })),
    }),
    prisma.projectStage.createMany({
      data: p2Stages.map((s) => ({ projectId: projects[1].id, ...s })),
    }),
  ]);
  console.log('  ✅ Project Stages');

  // ─── 21. CAPACITY LOTS ────────────────────────────────────────
  const capacityStages = [
    { stage: 'DESIGN', days: 5, capacity: 3, parallelSlots: 2 },
    { stage: 'METAL_WORKS', days: 3, capacity: 2, parallelSlots: 1 },
    { stage: 'CNC', days: 2, capacity: 2, parallelSlots: 1 },
    { stage: 'CUTTING', days: 3, capacity: 4, parallelSlots: 2 },
    { stage: 'EDGE_BANDING', days: 2, capacity: 3, parallelSlots: 1 },
    { stage: 'ASSEMBLY', days: 4, capacity: 3, parallelSlots: 2 },
    { stage: 'PAINTING', days: 3, capacity: 2, parallelSlots: 1 },
    { stage: 'FINISHING', days: 2, capacity: 3, parallelSlots: 1 },
    { stage: 'DELIVERY', days: 1, capacity: 5, parallelSlots: 3 },
  ];
  await Promise.all(
    capacityStages.map((cl) =>
      prisma.capacityLot.upsert({ where: { stage: cl.stage }, update: {}, create: cl }),
    ),
  );
  console.log('  ✅ Capacity Lots');

  // ─── 22. SCHEDULING SETTINGS (singleton) ──────────────────────
  const existingSettings = await prisma.schedulingSettings.findFirst();
  if (!existingSettings) {
    await prisma.schedulingSettings.create({
      data: {
        contingencyDays: 3,
        easyPercent: 0,
        mediumPercent: 0.4,
        hardPercent: 0.5,
        workingHoursPerDay: 7.5,
        workingDays: '1,2,3,4,5,6',
        shiftStartHour: 8.5,
        shiftEndHour: 17.0,
        lunchStartHour: 12.5,
        lunchEndHour: 13.5,
        timezone: 'Africa/Addis_Ababa',
      },
    });
  }
  console.log('  ✅ Scheduling Settings');

  // ─── 23. HOLIDAYS ─────────────────────────────────────────────
  const holidays = [
    { date: new Date('2025-09-12'), name: 'Ethiopian New Year (Enkutatash)', recurring: true },
    { date: new Date('2025-09-27'), name: 'Meskel (Finding of the True Cross)', recurring: true },
    { date: new Date('2025-01-07'), name: 'Ethiopian Christmas (Genna)', recurring: true },
    { date: new Date('2025-01-19'), name: 'Epiphany (Timket)', recurring: true },
    { date: new Date('2025-03-02'), name: 'Battle of Adwa', recurring: true },
    { date: new Date('2025-05-01'), name: 'Labour Day', recurring: true },
    { date: new Date('2025-05-05'), name: 'Patriots Victory Day', recurring: true },
    { date: new Date('2025-05-28'), name: 'Downfall of the Derg', recurring: true },
  ];
  await Promise.all(
    holidays.map((h) =>
      prisma.holiday.upsert({ where: { date: h.date }, update: {}, create: h }),
    ),
  );
  console.log('  ✅ Holidays');

  // ─── 24. SELLS (POS) ─────────────────────────────────────────
  const sellData = [
    {
      invoiceNo: 'SL-2025-0001',
      storeId: mainStore.id,
      customerId: customers[4].id,
      paymentStatus: 'PAID',
      saleStatus: 'DELIVERED',
      grandTotal: 40000,
      subTotal: 40000,
      totalPaid: 40000,
      balance: 0,
      totalProducts: 2,
      saleDate: ago(15),
      createdById: salesUser.id,
      items: [
        { itemId: items[6].id, quantity: 1, unitPrice: 28000, totalPrice: 28000, storeId: mainStore.id },
        { itemId: items[13].id, quantity: 1, unitPrice: 12000, totalPrice: 12000, storeId: mainStore.id },
      ],
    },
    {
      invoiceNo: 'SL-2025-0002',
      storeId: mainStore.id,
      customerId: customers[5].id,
      paymentStatus: 'PARTIAL',
      saleStatus: 'APPROVED',
      grandTotal: 97000,
      subTotal: 97000,
      totalPaid: 50000,
      balance: 47000,
      totalProducts: 2,
      saleDate: ago(5),
      createdById: salesUser.id,
      items: [
        { itemId: items[0].id, quantity: 1, unitPrice: 85000, totalPrice: 85000, storeId: mainStore.id },
        { itemId: items[13].id, quantity: 1, unitPrice: 12000, totalPrice: 12000, storeId: mainStore.id },
      ],
    },
    {
      invoiceNo: 'SL-2025-0003',
      storeId: mainStore.id,
      paymentStatus: 'PENDING',
      saleStatus: 'NOT_APPROVED',
      grandTotal: 55000,
      subTotal: 55000,
      totalPaid: 0,
      balance: 55000,
      totalProducts: 1,
      saleDate: ago(1),
      createdById: salesUser2.id,
      items: [
        { itemId: items[7].id, quantity: 1, unitPrice: 55000, totalPrice: 55000, storeId: mainStore.id },
      ],
    },
  ];
  const sells = await Promise.all(
    sellData.map((s) => {
      const { items: sItems, ...sellFields } = s;
      return prisma.sell.create({
        data: { ...sellFields, items: { create: sItems } },
      });
    }),
  );
  console.log('  ✅ Sales (' + sells.length + ')');

  // ─── 25. SELL PAYMENTS ────────────────────────────────────────
  await prisma.sellPayment.createMany({
    data: [
      { sellId: sells[0].id, amount: 40000, bankId: banks[0].id, createdById: salesUser.id, paidBy: 'Kidist Alemu' },
      { sellId: sells[1].id, amount: 50000, bankId: banks[1].id, createdById: salesUser.id, paidBy: 'Henok Trading' },
    ],
  });
  console.log('  ✅ Sell Payments');

  // ─── 26. STOCK LEDGER ENTRIES ─────────────────────────────────
  await prisma.stockLedger.createMany({
    data: [
      { materialId: materials[0].id, movementType: 'IN', quantity: 20, storeId: mainStore.id, reference: 'PUR-2025-0001', userId: warehouseUser.id, notes: 'Purchase stock-in' },
      { materialId: materials[1].id, movementType: 'IN', quantity: 15, storeId: mainStore.id, reference: 'PUR-2025-0001', userId: warehouseUser.id, notes: 'Purchase stock-in' },
      { materialId: materials[10].id, movementType: 'IN', quantity: 200, storeId: mainStore.id, reference: 'PUR-2025-0002', userId: warehouseUser.id, notes: 'Hardware restock' },
      { materialId: materials[0].id, movementType: 'OUT', quantity: 4, storeId: mainStore.id, reference: 'PI-2025-0001', userId: productionUser.id, notes: 'Issued for kitchen cabinet project' },
      { materialId: materials[10].id, movementType: 'OUT', quantity: 12, storeId: mainStore.id, reference: 'PI-2025-0001', userId: productionUser.id, notes: 'Hinges issued for project' },
    ],
  });
  console.log('  ✅ Stock Ledger');

  // ─── 27. TRANSFERS ────────────────────────────────────────────
  await prisma.transfer.create({
    data: {
      shortCode: 'TRF-2025-0001',
      sourceType: 'STORE',
      sourceStoreId: mainStore.id,
      destinationType: 'SHOWROOM',
      destShowroomId: mainShowroom.id,
      status: 'COMPLETED',
      notes: 'Monthly showroom restock',
      createdById: warehouseUser.id,
      items: {
        create: [
          { itemId: items[0].id, quantity: 2, ismaterial: false },
          { itemId: items[6].id, quantity: 3, ismaterial: false },
          { itemId: items[8].id, quantity: 2, ismaterial: false },
        ],
      },
    },
  });
  console.log('  ✅ Transfers');

  // ─── 28. NOTIFICATIONS ────────────────────────────────────────
  await prisma.notification.createMany({
    data: [
      { title: 'Low Stock Alert', message: 'Plain MDF 9mm stock is below warning level (10 sheets remaining)', type: 'Inventory', read: false },
      { title: 'Sale Ready for Delivery', message: 'Sale SL-2025-0001 has been approved and is ready for delivery', type: 'SELL_READY_FOR_DELIVERY', read: true, relatedEntityType: 'SELL', relatedEntityId: sells[0].id },
      { title: 'Payment Received', message: 'Payment of ETB 100,000 received for PI-2025-0001', type: 'Payment', read: true },
      { title: 'Project Stage Complete', message: 'CNC stage completed for Project #1. Moving to Cutting.', type: 'Done', read: false },
      { title: 'New Sale Pending Approval', message: 'Sale SL-2025-0003 created by Hana Bekele requires approval', type: 'Approval', read: false },
    ],
  });
  console.log('  ✅ Notifications');

  // ─── 29. LOGS ─────────────────────────────────────────────────
  await prisma.log.createMany({
    data: [
      { action: 'Created purchase PUR-2025-0001 (MDF boards restock)', userId: warehouseUser.id, details: { entity: 'purchase', invoiceNo: 'PUR-2025-0001' } },
      { action: 'Created proforma invoice PI-2025-0001 for Eyob Real Estate', userId: salesUser.id, details: { entity: 'proforma', piNumber: 'PI-2025-0001' } },
      { action: 'Approved proforma invoice PI-2025-0001', userId: managerUser.id, details: { entity: 'proforma', piNumber: 'PI-2025-0001', action: 'approve' } },
      { action: 'Created project from PI-2025-0001', userId: managerUser.id, details: { entity: 'project', piNumber: 'PI-2025-0001' } },
      { action: 'Completed DESIGN stage for Project #1', userId: designerUser.id, details: { entity: 'projectStage', stage: 'DESIGN' } },
      { action: 'Created sale SL-2025-0001', userId: salesUser.id, details: { entity: 'sell', invoiceNo: 'SL-2025-0001' } },
      { action: 'Transferred 7 items from Main Warehouse to Main Showroom', userId: warehouseUser.id, details: { entity: 'transfer', shortCode: 'TRF-2025-0001' } },
      { action: 'User login: System Admin', userId: adminUser.id, details: { entity: 'auth', action: 'login' } },
    ],
  });
  console.log('  ✅ Activity Logs');

  // ─── 30. PROJECT LOGS ─────────────────────────────────────────
  await prisma.projectLog.createMany({
    data: [
      { projectId: projects[0].id, note: 'Project created from approved proforma PI-2025-0001. Customer: Eyob Real Estate.', createdById: managerUser.id },
      { projectId: projects[0].id, note: 'Design phase started. Assigned to Samuel Girma.', createdById: managerUser.id },
      { projectId: projects[0].id, note: 'Design completed. 3D renders approved by client. Moving to purchasing.', createdById: designerUser.id },
      { projectId: projects[0].id, note: 'All materials purchased and in stock. Ready for metal works.', createdById: warehouseUser.id },
      { projectId: projects[0].id, note: 'Metal framework completed. CNC cutting next.', createdById: productionUser.id },
      { projectId: projects[0].id, note: 'CNC cutting done. Board cutting in progress.', createdById: productionUser.id },
      { projectId: projects[1].id, note: 'Project created for Bereket Construction — 5 desks, 5 bookshelves, 5 doors.', createdById: managerUser.id },
      { projectId: projects[1].id, note: 'Design started. Initial measurements from client site received.', createdById: designerUser.id },
    ],
  });
  console.log('  ✅ Project Logs');

  // ─── DONE ─────────────────────────────────────────────────────
  console.log('\n🎉 Seed completed successfully!');
  console.log('──────────────────────────────────────');
  console.log('  Admin login:  admin@mezidwood.com / Admin@1234');
  console.log('  Other users:  [name]@mezidwood.com / Pass@1234');
  console.log('──────────────────────────────────────');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
