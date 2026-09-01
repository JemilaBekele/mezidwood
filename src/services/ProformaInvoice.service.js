/* eslint-disable no-nested-ternary */
/* eslint-disable no-restricted-syntax */
const fs = require('fs').promises;
const path = require('path');
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const money = require('../utils/money');
const prisma = require('./prisma');
const reschedule = require('./scheduling/reschedule');

// Generate unique PI number
const generatePINumber = async () => {
  // Find the latest PI number for this year/month
  const latestPI = await prisma.proformaInvoice.findFirst({
    where: {
      piNumber: {
        startsWith: `PI`,
      },
    },
    orderBy: {
      piNumber: 'desc',
    },
  });

  let sequence = 1;
  if (latestPI) {
    const lastSequence = parseInt(latestPI.piNumber.split('-').pop(), 10);
    sequence = lastSequence + 1;
  }

  return `PI-${sequence.toString().padStart(4, '0')}`;
};

const VAT_RATE = 0.15;


const calculateTotals = (items, vatApplied = false, vatPercent = 15) => {
  const subtotal = money.sum(
    items.map((item) => money.multiply(item.unitPrice, item.quantity)),
  );

  let vat = 0;
  let total = subtotal;

  // Only calculate VAT if vatApplied is true
  if (vatApplied === true || vatApplied === 'true' || vatApplied === '1' || vatApplied === 1) {
    const rate = parseFloat(vatPercent) / 100 || VAT_RATE;
    vat = money.multiply(subtotal, rate);
    total = money.sum(subtotal, vat);
  }

  return { subtotal, vat, total };
};

const saveImageToProformaPath = async (file, invoiceId, itemId, index) => {
  // Create the target directory if it doesn't exist
  const targetDir = path.join(__dirname, '../../uploads/proforma/images');

  try {
    await fs.mkdir(targetDir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }

  // Sanitize the original filename to remove spaces and special characters
  const sanitizeFilename = (filename) => {
    // Remove spaces and replace with underscores
    let sanitized = filename.replace(/\s+/g, '_');
    // Remove special characters except dots, underscores, and hyphens
    sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '');
    // Ensure we don't have consecutive dots or underscores
    sanitized = sanitized.replace(/\.{2,}/g, '.');
    sanitized = sanitized.replace(/_{2,}/g, '_');
    return sanitized;
  };

  // Get file extension
  const fileExt = path.extname(file.originalname);
  // Get base name without extension
  const baseName = path.basename(file.originalname, fileExt);
  // Sanitize the base name
  const sanitizedBaseName = sanitizeFilename(baseName);

  // Generate unique ID
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 8);

  // Create unique filename with sanitized original name
  const newFilename = `${timestamp}_${randomString}_${sanitizedBaseName}${fileExt}`;

  // Create the full path
  const targetPath = path.join(targetDir, newFilename);

  // Copy/Move the file to the new location
  await fs.copyFile(file.path, targetPath);

  // Clean up the temporary file
  await fs.unlink(file.path);

  // Log the save operation
  console.log(`Image saved: ${targetPath}`);
  console.log(`Original name: ${file.originalname}`);
  console.log(`Sanitized filename: ${newFilename}`);
  console.log(`Image URL path: /uploads/proforma/images/${newFilename}`);

  // Return the relative URL path for database storage
  return `/uploads/proforma/images/${newFilename}`;
};
// Create Proforma Invoice
const rescheduleProjectStages = async (
  projectId,
  client = null,
  byUserId = null,
) =>
  reschedule.reallocateProjectFromInvoiceMaterials(projectId, {
    client,
    byUserId,
    startInstant: new Date(),
  });
const createProformaInvoice = async (
  invoiceData,
  userId,
  structuredFiles = {},
) => {
  try {
    // Extract fields including store (remove amountPaid from extraction)
    const {
      customerId,
      items,
      status = 'PENDING_ST',
      preparedById,
      approvedById,
      amountDate,
      store = false,
         vatApplied = false,    // ← Add this
      vatPercent = 15,  
      ...otherData
    } = invoiceData;

    // ✅ IMPORTANT: Convert store from string to boolean if needed
    const isStore =
      store === true || store === 'true' || store === '1' || store === 1;

    // ✅ Get default customer if customerId not provided (regardless of store)
    let finalCustomerId = customerId;

    if (!customerId || customerId === '') {
      try {
        // Find the default customer
        const defaultCustomer = await prisma.customer.findFirst({
          where: { isdefault: true },
        });

        if (!defaultCustomer) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            'No default customer configured. Please select a customer or configure a default customer.',
          );
        }

        finalCustomerId = defaultCustomer.id;
      } catch (error) {
        console.error('Error fetching default customer:', error);
        throw error;
      }
    }

    // ✅ Validate customer if we have a customerId (for both store and non-store)
    if (finalCustomerId) {
      try {
        const customerExists = await prisma.customer.findUnique({
          where: { id: finalCustomerId },
        });

        if (!customerExists) {
          throw new ApiError(httpStatus.NOT_FOUND, 'Customer not found');
        }
      } catch (error) {
        console.error(`Error validating customer ${finalCustomerId}:`, error);
        throw error;
      }
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'At least one item is required',
      );
    }

    if (isStore) {
      console.log(`Store invoice: Balance will be set to ZERO`);
    }

    // Validate items
    for (const [index, item] of items.entries()) {
      try {
        if (!item.description || item.description.trim().length === 0) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Item ${index + 1}: description is required`,
          );
        }
        if (!item.quantity || item.quantity <= 0) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Item ${index + 1}: quantity must be greater than 0`,
          );
        }
        if (!item.unitPrice || item.unitPrice <= 0) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Item ${index + 1}: unit price must be greater than 0`,
          );
        }

        // ✅ Validate that itemId exists in the items table (if provided)
        if (item.itemId) {
          try {
            const existingItem = await prisma.items.findUnique({
              where: { id: item.itemId },
            });

            if (!existingItem) {
              throw new ApiError(
                httpStatus.NOT_FOUND,
                `Item ${index + 1}: Item with ID ${item.itemId} not found`,
              );
            }
          } catch (error) {
            console.error(`Error validating item ${item.itemId}:`, error);
            throw error;
          }
        }

        // ✅ Validate that categoryId exists in the category table (if provided)
        if (item.categoryId) {
          try {
            const existingCategory = await prisma.productCategory.findUnique({
              where: { id: item.categoryId },
            });

            if (!existingCategory) {
              throw new ApiError(
                httpStatus.NOT_FOUND,
                `Item ${index + 1}: Category with ID ${
                  item.categoryId
                } not found`,
              );
            }
          } catch (error) {
            console.error(
              `Error validating category ${item.categoryId}:`,
              error,
            );
            throw error;
          }
        }

        // Validate materials if provided
        if (item.materials && Array.isArray(item.materials)) {
          for (const [matIndex, material] of item.materials.entries()) {
            if (!material.materialId) {
              throw new ApiError(
                httpStatus.BAD_REQUEST,
                `Item ${index + 1}: Material ${
                  matIndex + 1
                }: materialId is required`,
              );
            }
            if (!material.quantity || material.quantity <= 0) {
              throw new ApiError(
                httpStatus.BAD_REQUEST,
                `Item ${index + 1}: Material ${
                  matIndex + 1
                }: quantity must be greater than 0`,
              );
            }
          }
        }
      } catch (error) {
        console.error(`Error validating item at index ${index}:`, error);
        throw error;
      }
    }

    // Check if materials exist
    const allMaterialIds = [];
    items.forEach((item) => {
      if (item.materials && Array.isArray(item.materials)) {
        item.materials.forEach((material) => {
          if (material.materialId) {
            allMaterialIds.push(material.materialId);
          }
        });
      }
    });

    if (allMaterialIds.length > 0) {
      try {
        const uniqueMaterialIds = [...new Set(allMaterialIds)];
        const existingMaterials = await prisma.material.findMany({
          where: {
            id: {
              in: uniqueMaterialIds,
            },
          },
          select: {
            id: true,
          },
        });

        const existingMaterialIds = existingMaterials.map((m) => m.id);
        const missingMaterialIds = uniqueMaterialIds.filter(
          (id) => !existingMaterialIds.includes(id),
        );

        if (missingMaterialIds.length > 0) {
          throw new ApiError(
            httpStatus.NOT_FOUND,
            `Materials not found with IDs: ${missingMaterialIds.join(', ')}`,
          );
        }
      } catch (error) {
        console.error('Error validating materials:', error);
        throw error;
      }
    }

    // Calculate totals
    const { subtotal, vat, total } = calculateTotals(items, vatApplied, vatPercent);

    // ✅ amountPaid is always 0 for new proforma invoices
    const amountPaid = 0;

    // ✅ Set balance: always total for non-store, zero for store invoices
    let balance;
    if (isStore) {
      balance = 0;
    } else {
      balance = total; // Since amountPaid is 0, balance equals total
    }
    let paymentStatus;
    if (isStore) {
      paymentStatus = 'NONE'; // Store invoices don't require payment tracking
    } else {
      paymentStatus = 'PENDING'; // Regular invoices start as PENDING
    }
    // Generate PI number
    const piNumber = await generatePINumber();

    try {
      const proformaInvoice = await prisma.$transaction(async (prismaTx) => {
        // Create the invoice with store field
        const invoiceData = {
          piNumber,
          status,
          subtotal: money.round(subtotal),
          vat: money.round(vat),
          total: money.round(total),
          amountPaid: money.round(amountPaid), // Always 0
          balance: money.round(balance),
          amountDate: amountDate ? new Date(amountDate) : null,
          preparedById: userId,
          store: isStore,
          paymentStatus,
        };

        // ✅ ALWAYS add customerId if we have one (even for store invoices)
        if (finalCustomerId) {
          invoiceData.customerId = finalCustomerId;
        }

        const invoice = await prismaTx.proformaInvoice.create({
          data: invoiceData,
        });

        if (isStore) {
          console.log(
            `  Store invoice balance: ${invoice.balance} (forced to zero)`,
          );
        } else {
          console.log(
            `  Balance: ${invoice.balance} (full amount, no payment received)`,
          );
        }

        // Log customer association
        if (finalCustomerId) {
          console.log(
            `  Associated with customer ID: ${finalCustomerId}${
              !customerId || customerId === '' ? ' (default)' : ''
            }`,
          );
        } else {
          console.log(`  No customer associated with this invoice`);
        }

        // Create invoice items with materials and multiple images
        await Promise.all(
          items.map(async (item, index) => {
            try {
              // Convert item numeric fields
              const quantity =
                typeof item.quantity === 'string'
                  ? parseInt(item.quantity, 10)
                  : item.quantity;

              const unitPrice =
                typeof item.unitPrice === 'string'
                  ? parseFloat(item.unitPrice)
                  : item.unitPrice;

              // ✅ Handle size properly - extract name from object
              let sizeValue = null;
              if (item.size) {
                if (typeof item.size === 'string') {
                  sizeValue = item.size.trim();
                } else if (typeof item.size === 'object') {
                  // If size is an object with name property
                  sizeValue = item.size.name?.trim() || null;
                  // OR use the ID if you want to store that
                  // sizeValue = item.size.id || null;
                }
              }

              // ✅ Create the invoice item WITH itemId and categoryId if provided (both optional)
              const createdItem = await prismaTx.proformaInvoiceItem.create({
                data: {
                  invoiceId: invoice.id,
                  itemId: item.itemId || null, // ✅ Link to Items table if provided (optional)
                  categoryId: item.categoryId || null, // ✅ Link to Category if provided (optional)
                  description: item.description.trim(),
                  size: sizeValue, // ✅ Use the extracted size value
                  quantity,
                  unitPrice,
                  itemname: item.itemname?.trim() || null,
                  amount: unitPrice * quantity,
                  additionalDescription: item.additionalDescription?.trim(),
                },
              });

              // Log the associations
              if (item.itemId) {
                console.log(`  Linked to Item ID: ${item.itemId}`);
              }
              if (item.categoryId) {
                console.log(`  Linked to Category ID: ${item.categoryId}`);
              }

              // Handle images from the item
              const uploadedImages = [];
              const existingImageUrls = [];

              // Check for uploaded files and save to proforma/images path
              if (item.itemIndex !== undefined) {
                // Look for multiple image fields
                const imageFields = Object.keys(structuredFiles).filter(
                  (key) =>
                    key.startsWith(`items[${item.itemIndex}].images[`) ||
                    key === `items[${item.itemIndex}].image`,
                );

                for (const fieldName of imageFields) {
                  const uploadedFile = structuredFiles[fieldName];

                  if (uploadedFile && uploadedFile.length > 0) {
                    // Process each uploaded file
                    for (const [imgIndex, file] of uploadedFile.entries()) {
                      try {
                        // Validate file is actually an image
                        if (
                          !file.mimetype ||
                          !file.mimetype.startsWith('image/')
                        ) {
                          console.warn(
                            `Skipping non-image file: ${file.originalname} (${file.mimetype})`,
                          );
                          continue;
                        }

                        // Save image to proforma/images path
                        const imageUrl = await saveImageToProformaPath(
                          file,
                          invoice.id,
                          createdItem.id,
                          imgIndex,
                        );
                        uploadedImages.push(imageUrl);
                      } catch (imageError) {
                        console.error(
                          `Failed to save image ${file.originalname}:`,
                          imageError,
                        );
                        // Continue with other images, don't fail the whole request
                      }
                    }
                  }
                }
              }

              // Check for existing image URLs from the item data (when selecting an item)
              if (
                item.images &&
                Array.isArray(item.images) &&
                item.images.length > 0
              ) {
                for (const image of item.images) {
                  if (image.imageUrl && typeof image.imageUrl === 'string') {
                    let { imageUrl } = image;

                    // Don't store raw filenames that aren't proper paths
                    if (
                      !imageUrl.startsWith('/') &&
                      !imageUrl.startsWith('http')
                    ) {
                      // Check if it's just a filename without path
                      if (!imageUrl.includes('/') && !imageUrl.includes('\\')) {
                        // This is a raw filename - we need to process it properly

                        continue;
                      }
                      // Normalize the path
                      imageUrl = `/${imageUrl.replace(/\\/g, '/')}`;
                    }
                    existingImageUrls.push(imageUrl);
                  }
                }
              }

              // Combine both sources of images
              const allImageUrls = [...uploadedImages, ...existingImageUrls];

              // Create image records for all images
              if (allImageUrls.length > 0) {
                try {
                  await Promise.all(
                    allImageUrls.map(async (imageUrl) => {
                      await prismaTx.proformaInvoiceItemImage.create({
                        data: {
                          itemId: createdItem.id,
                          imageUrl,
                        },
                      });
                    }),
                  );
                } catch (imageCreateError) {
                  console.error(
                    'Error creating image records:',
                    imageCreateError,
                  );
                  throw imageCreateError;
                }
              }

              // Create materials for this item if provided
              if (
                item.materials &&
                Array.isArray(item.materials) &&
                item.materials.length > 0
              ) {
                try {
                  await Promise.all(
                    item.materials.map(async (material) => {
                      const materialQuantity =
                        typeof material.quantity === 'string'
                          ? parseInt(material.quantity, 10)
                          : material.quantity;

                      try {
                        await prismaTx.proformaItemMaterial.create({
                          data: {
                            itemId: createdItem.id,
                            materialId: material.materialId,
                            quantity: materialQuantity,
                            note: material.note?.trim(),
                          },
                        });
                      } catch (materialError) {
                        if (materialError.code === 'P2002') {
                          throw new ApiError(
                            httpStatus.BAD_REQUEST,
                            `Duplicate material ${material.materialId} for item ${item.description}. Each material can only be added once per item.`,
                          );
                        }
                        throw new ApiError(
                          httpStatus.INTERNAL_SERVER_ERROR,
                          `Failed to create material record: ${materialError.message}`,
                        );
                      }
                    }),
                  );
                } catch (materialCreateError) {
                  console.error(
                    'Error creating materials for item:',
                    materialCreateError,
                  );
                  throw materialCreateError;
                }
              }

              return createdItem;
            } catch (itemError) {
              console.error(
                `Error processing item at index ${index}:`,
                itemError,
              );
              throw itemError;
            }
          }),
        );

        // Handle bank relationships
        if (
          otherData.banks &&
          Array.isArray(otherData.banks) &&
          otherData.banks.length > 0
        ) {
          try {
            await Promise.all(
              otherData.banks.map(async (bankData) => {
                if (!bankData.bankId) {
                  throw new ApiError(
                    httpStatus.BAD_REQUEST,
                    'Bank ID is required for bank relation',
                  );
                }

                const bankExists = await prismaTx.bank.findUnique({
                  where: { id: bankData.bankId },
                });

                if (!bankExists) {
                  throw new ApiError(
                    httpStatus.NOT_FOUND,
                    `Bank not found with ID: ${bankData.bankId}`,
                  );
                }

                await prismaTx.proformaInvoiceBank.create({
                  data: {
                    proformaInvoiceId: invoice.id,
                    bankId: bankData.bankId,
                    amount: bankData.amount ? Number(bankData.amount) : null,
                  },
                });
              }),
            );
          } catch (bankError) {
            console.error('Error processing bank relationships:', bankError);
            throw bankError;
          }
        }

        // Handle attachments upload - save to attachments folder
        if (
          structuredFiles.attachments &&
          structuredFiles.attachments.length > 0
        ) {
          try {
            await Promise.all(
              structuredFiles.attachments.map(async (file) => {
                // Save attachment to appropriate path
                const targetDir = path.join(
                  __dirname,
                  '../../uploads/proforma/attachments',
                );

                // Create directory if it doesn't exist using native fs
                try {
                  await fs.mkdir(targetDir, { recursive: true });
                } catch (err) {
                  if (err.code !== 'EEXIST') {
                    console.error('Error creating directory:', err);
                    throw err;
                  }
                }

                const timestamp = Date.now();
                const randomString = Math.random().toString(36).substring(2, 8);
                const fileExt = path.extname(file.originalname);
                const baseName = path.basename(file.originalname, fileExt);

                // Sanitize filename (remove spaces and special characters)
                const sanitizedBaseName = baseName.replace(
                  /[^a-zA-Z0-9]/g,
                  '_',
                );
                const newFilename = `${timestamp}_${randomString}_${sanitizedBaseName}${fileExt}`;
                const targetPath = path.join(targetDir, newFilename);

                // Copy file using native fs
                await fs.copyFile(file.path, targetPath);

                // Clean up temporary file
                await fs.unlink(file.path);

                const fileUrl = `/uploads/proforma/attachments/${newFilename}`;

                await prismaTx.attachment.create({
                  data: {
                    proformaInvoiceId: invoice.id,
                    fileUrl,
                  },
                });
              }),
            );
          } catch (attachmentError) {
            console.error('Error processing attachments:', attachmentError);
            throw attachmentError;
          }
        }

        // Fetch the complete invoice with all relations including images
        try {
          const completeInvoice = await prismaTx.proformaInvoice.findUnique({
            where: { id: invoice.id },
            include: {
              customer: {
                // ✅ Always include customer if exists
                select: {
                  id: true,
                  name: true,
                  companyName: true,
                  isdefault: true,
                },
              },
              preparedBy: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
              approvedBy: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
              items: {
                include: {
                  item: {
                    // ✅ Include the linked item
                    select: {
                      id: true,
                      name: true,
                      price: true,
                    },
                  },
                  category: {
                    // ✅ Include the linked category
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                  images: true,
                  proformaItemMaterials: {
                    include: {
                      material: true,
                    },
                  },
                },
              },
              banks: {
                include: {
                  bank: true,
                },
              },
              attachments: {
                select: {
                  id: true,
                  fileUrl: true,
                },
              },
              project: true,
            },
          });

          return completeInvoice;
        } catch (fetchError) {
          console.error('Error fetching complete invoice:', fetchError);
          throw fetchError;
        }
      });

      return proformaInvoice;
    } catch (transactionError) {
      // Log the full error details
      if (transactionError.code) {
        console.error('Error code:', transactionError.code);
      }
      if (transactionError.meta) {
        console.error('Error meta:', transactionError.meta);
      }

      throw transactionError;
    }
  } catch (error) {
    // Log the error with full details

    if (error.code) {
      console.error('Error code:', error.code);
    }
    if (error.meta) {
      console.error('Error meta:', JSON.stringify(error.meta, null, 2));
    }
    console.error('=== END ERROR ===');

    if (error instanceof ApiError) {
      throw error;
    }

    if (error.code === 'P2002') {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Duplicate entry detected. Please check your input data.',
      );
    }

    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to create proforma invoice: ${error.message}`,
    );
  }
};
const updateProformaInvoice = async (id, updateData, structuredFiles = {}) => {
  // Check if invoice exists with all relations including project
  const existingInvoice = await prisma.proformaInvoice.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          images: true,
          proformaItemMaterials: true,
        },
      },
      banks: true,
      attachments: true,
      customer: true,
      project: {
        include: {
          stages: true,
        },
      },
    },
  });

  if (!existingInvoice) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Proforma invoice not found');
  }

  // Check if invoice can be updated (not cancelled)
  if (existingInvoice.status === 'CANCELLED') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot update a cancelled invoice',
    );
  }

  // 🔥 DETECT IF THIS IS AN EDIT OPERATION
  // Check if items are being updated
  const hasItems =
    updateData.items !== undefined && Array.isArray(updateData.items);

  // Check if there are actual changes to items
  let hasItemChanges = false;
  if (hasItems) {
    const existingItemsStr = JSON.stringify(
      existingInvoice.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        size: item.size,
        itemname: item.itemname,
        additionalDescription: item.additionalDescription,
        itemId: item.itemId,
        categoryId: item.categoryId,
        materials:
          item.proformaItemMaterials?.map((m) => ({
            materialId: m.materialId,
            quantity: m.quantity,
            note: m.note,
          })) || [],
      })),
    );

    const newItemsStr = JSON.stringify(
      updateData.items.map((item) => ({
        description: item.description,
        itemname: item.itemname?.trim() || null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        size: item.size,
        additionalDescription: item.additionalDescription,
        itemId: item.itemId || null,
        categoryId: item.categoryId || null,
        materials:
          item.materials?.map((m) => ({
            materialId: m.materialId,
            quantity: m.quantity,
            note: m.note,
          })) || [],
      })),
    );

    hasItemChanges = existingItemsStr !== newItemsStr;
  }

  // Check if any other important fields are being updated
  const hasCustomerChange =
    updateData.customerId !== undefined &&
    updateData.customerId !== existingInvoice.customerId;
  const hasBankChange = updateData.banks !== undefined;
  const hasAttachmentChange =
    structuredFiles.attachments && structuredFiles.attachments.length > 0;

  // This is an edit if any of these are true
  const isEditing =
    hasItemChanges || hasCustomerChange || hasBankChange || hasAttachmentChange;

  // Determine the final status
  let finalStatus = existingInvoice.status;

  // If editing and status is NOT PENDING_ST, set to REVISION
  if (isEditing && existingInvoice.status !== 'PENDING_ST') {
    // Only set to REVISION if the invoice is not already in REVISION or CANCELLED
    if (!['REVISION', 'CANCELLED'].includes(existingInvoice.status)) {
      finalStatus = 'REVISION';
      console.log(
        `🔄 Status changed from ${existingInvoice.status} to REVISION`,
      );
    }
  }

  // Extract fields from updateData
  const {
    customerId = existingInvoice.customerId,
    items,
    amountPaid = existingInvoice.amountPaid || 0,
    status = finalStatus, // Use the computed status
    preparedById = existingInvoice.preparedById,
    approvedById = existingInvoice.approvedById,
    amountDate = existingInvoice.amountDate,
    banks,
    store = existingInvoice.store || false,
  } = updateData;

  // Convert store from string to boolean if needed
  const isStore =
    store === true || store === 'true' || store === '1' || store === 1;

  // Validate customer if not a store invoice and customer is being updated
  if (!isStore && customerId && customerId !== existingInvoice.customerId) {
    const customerExists = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customerExists) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Customer not found');
    }
  }

  // Handle items update if provided
  const itemsToUpdate = items;
  let materialQuantityChanged = false;
  let materialChangeDetails = null;

  if (itemsToUpdate) {
    if (!Array.isArray(itemsToUpdate) || itemsToUpdate.length === 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'At least one item is required',
      );
    }

    // Validate items structure
    for (const [index, item] of itemsToUpdate.entries()) {
      if (!item.description || item.description.trim().length === 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${index + 1}: description is required`,
        );
      }
      if (!item.quantity || item.quantity <= 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${index + 1}: quantity must be greater than 0`,
        );
      }
      if (!item.unitPrice || item.unitPrice <= 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${index + 1}: unit price must be greater than 0`,
        );
      }

      // ✅ Validate that itemId exists in the items table (if provided)
      if (item.itemId) {
        const existingItem = await prisma.items.findUnique({
          where: { id: item.itemId },
        });

        if (!existingItem) {
          throw new ApiError(
            httpStatus.NOT_FOUND,
            `Item ${index + 1}: Item with ID ${item.itemId} not found`,
          );
        }
      }

      // ✅ Validate that categoryId exists in the category table (if provided)
      if (item.categoryId) {
        const existingCategory = await prisma.productCategory.findUnique({
          where: { id: item.categoryId },
        });

        if (!existingCategory) {
          throw new ApiError(
            httpStatus.NOT_FOUND,
            `Item ${index + 1}: Category with ID ${item.categoryId} not found`,
          );
        }
      }

      // Validate materials if provided
      if (item.materials && Array.isArray(item.materials)) {
        for (const material of item.materials) {
          if (!material.materialId) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Item ${index + 1}: Material materialId is required`,
            );
          }
          if (!material.quantity || material.quantity <= 0) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Item ${index + 1}: Material quantity must be greater than 0`,
            );
          }
        }
      }
    }

    // Check if materials exist
    const allMaterialIds = [];
    itemsToUpdate.forEach((item) => {
      if (item.materials && Array.isArray(item.materials)) {
        item.materials.forEach((material) => {
          if (material.materialId) {
            allMaterialIds.push(material.materialId);
          }
        });
      }
    });

    if (allMaterialIds.length > 0) {
      const uniqueMaterialIds = [...new Set(allMaterialIds)];
      const existingMaterials = await prisma.material.findMany({
        where: {
          id: {
            in: uniqueMaterialIds,
          },
        },
        select: {
          id: true,
        },
      });

      const existingMaterialIds = existingMaterials.map((m) => m.id);
      const missingMaterialIds = uniqueMaterialIds.filter(
        (materialId) => !existingMaterialIds.includes(materialId),
      );

      if (missingMaterialIds.length > 0) {
        throw new ApiError(
          httpStatus.NOT_FOUND,
          `Materials not found with IDs: ${missingMaterialIds.join(', ')}`,
        );
      }
    }

    // --- DETAILED MATERIAL QUANTITY CHANGE DETECTION ---
    // Build old materials map from existing invoice
    const oldMaterialsMap = new Map();
    existingInvoice.items.forEach((item) => {
      if (
        item.proformaItemMaterials &&
        Array.isArray(item.proformaItemMaterials)
      ) {
        item.proformaItemMaterials.forEach((mat) => {
          const currentQty = oldMaterialsMap.get(mat.materialId) || 0;
          oldMaterialsMap.set(mat.materialId, currentQty + mat.quantity);
        });
      }
    });

    // Build new materials map from update data
    const newMaterialsMap = new Map();
    itemsToUpdate.forEach((item) => {
      if (item.materials && Array.isArray(item.materials)) {
        item.materials.forEach((mat) => {
          const qty =
            typeof mat.quantity === 'string'
              ? parseInt(mat.quantity, 10)
              : mat.quantity;
          const currentQty = newMaterialsMap.get(mat.materialId) || 0;
          newMaterialsMap.set(mat.materialId, currentQty + qty);
        });
      }
    });

    // Detailed comparison
    const materialChanges = {
      added: [],
      removed: [],
      changed: [],
      oldMap: Object.fromEntries(oldMaterialsMap),
      newMap: Object.fromEntries(newMaterialsMap),
    };

    // Check for removed or changed materials
    for (const [materialId, oldQty] of oldMaterialsMap.entries()) {
      if (!newMaterialsMap.has(materialId)) {
        materialChanges.removed.push({ materialId, oldQty });
        materialQuantityChanged = true;
      } else {
        const newQty = newMaterialsMap.get(materialId);
        if (newQty !== oldQty) {
          materialChanges.changed.push({ materialId, oldQty, newQty });
          materialQuantityChanged = true;
        }
      }
    }

    // Check for added materials
    for (const [materialId, newQty] of newMaterialsMap.entries()) {
      if (!oldMaterialsMap.has(materialId)) {
        materialChanges.added.push({ materialId, newQty });
        materialQuantityChanged = true;
      }
    }

    if (materialQuantityChanged) {
      materialChangeDetails = materialChanges;
      console.log(
        '🔍 MATERIAL CHANGES DETECTED:',
        JSON.stringify(materialChanges, null, 2),
      );

      // Only trigger reschedule if project exists
      if (existingInvoice.project?.id) {
        console.log(
          `✅ Will trigger reschedule for project: ${existingInvoice.project.id}`,
        );
      } else {
        console.log(
          `⚠️ No project linked to invoice ${existingInvoice.id}, skipping reschedule trigger`,
        );
      }
    } else {
      console.log('✅ No material quantity changes detected');
    }
    // --- END MATERIAL CHECK ---
  }

  // Calculate totals if items are being updated
  // Calculate totals - use frontend values directly
  let subtotal;
  let vat;
  let total;

  if (itemsToUpdate) {
    // ✅ Use values directly from frontend
    subtotal =
      updateData.subtotal !== undefined && updateData.subtotal !== null
        ? money.round(Number(updateData.subtotal))
        : money.round(
            itemsToUpdate.reduce((sum, item) => {
              const quantity =
                typeof item.quantity === 'string'
                  ? parseInt(item.quantity, 10)
                  : item.quantity;
              const unitPrice =
                typeof item.unitPrice === 'string'
                  ? parseFloat(item.unitPrice)
                  : item.unitPrice;
              return sum + quantity * unitPrice;
            }, 0),
          );

    vat =
      updateData.vat !== undefined && updateData.vat !== null
        ? money.round(Number(updateData.vat))
        : money.round(0);

    total =
      updateData.total !== undefined && updateData.total !== null
        ? money.round(Number(updateData.total))
        : money.round(money.add(subtotal, vat));

    console.log(
      `📊 Totals from frontend: Subtotal=${subtotal}, VAT=${vat}, Total=${total}`,
    );
  } else {
    // Use existing values
    subtotal = existingInvoice.subtotal;
    vat = existingInvoice.vat;
    total = existingInvoice.total;
  }

  // Money read back from the DB is Decimal — normalise before any arithmetic.
  const parsedAmountPaid = money.round(amountPaid);
  const totalAmount = money.round(total);
  const balance = money.subtract(totalAmount, parsedAmountPaid);

  // Handle payment updates
  let updatedAmountDate = amountDate;
  if (!money.equals(parsedAmountPaid, existingInvoice.amountPaid)) {
    if (parsedAmountPaid < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Amount paid cannot be negative',
      );
    }

    if (money.greaterThan(parsedAmountPaid, totalAmount)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Amount paid cannot exceed total amount',
      );
    }

    // Set amountDate if payment is made and date not provided
    if (money.isPositive(parsedAmountPaid) && !updatedAmountDate) {
      updatedAmountDate = new Date();
    }
  }

  try {
    const updatedInvoice = await prisma.$transaction(
      async (prismaTx) => {
        // Prepare invoice update data
        const invoiceUpdateData = {
          ...(!isStore && customerId && { customerId }),
          status,
          subtotal: money.round(subtotal),
          vat: money.round(vat),
          total: money.round(total),
          amountPaid: money.round(parsedAmountPaid),
          balance: money.round(balance),
          store: isStore,
          ...(updatedAmountDate && { amountDate: new Date(updatedAmountDate) }),
          ...(preparedById && { preparedById }),
          ...(approvedById && { approvedById }),
        };

        // Update the invoice
        const invoice = await prismaTx.proformaInvoice.update({
          where: { id },
          data: invoiceUpdateData,
        });

        // 🔥 NEW: Create a log entry for status change
        if (status !== existingInvoice.status) {
          const userId =
            approvedById || preparedById || existingInvoice.preparedById;

          await prismaTx.piLog.create({
            data: {
              action: `Status changed from ${existingInvoice.status} to ${status}`,
              proformaId: id,
              piuserId: userId,
            },
          });
        }

        // Update banks if provided
        if (banks !== undefined) {
          // Delete existing bank relations
          await prismaTx.proformaInvoiceBank.deleteMany({
            where: { proformaInvoiceId: id },
          });

          // Create new bank relations if provided
          if (Array.isArray(banks) && banks.length > 0) {
            await Promise.all(
              banks.map(async (bankData) => {
                if (!bankData.bankId) {
                  throw new ApiError(
                    httpStatus.BAD_REQUEST,
                    'Bank ID is required for bank relation',
                  );
                }

                // Check if bank exists
                const bankExists = await prismaTx.bank.findUnique({
                  where: { id: bankData.bankId },
                });

                if (!bankExists) {
                  throw new ApiError(
                    httpStatus.NOT_FOUND,
                    `Bank not found with ID: ${bankData.bankId}`,
                  );
                }

                await prismaTx.proformaInvoiceBank.create({
                  data: {
                    proformaInvoiceId: id,
                    bankId: bankData.bankId,
                    amount: bankData.amount ? Number(bankData.amount) : null,
                  },
                });
              }),
            );
          }
        }

        // Update items if provided
        if (itemsToUpdate) {
          // ✅ Get existing items to preserve itemId and categoryId references
          const existingItems = await prismaTx.proformaInvoiceItem.findMany({
            where: { invoiceId: id },
            include: {
              images: true,
              proformaItemMaterials: true,
            },
          });

          // ✅ Map existing items by index or id for matching
          const existingItemsMap = new Map();
          existingItems.forEach((existingItem, index) => {
            existingItemsMap.set(index, existingItem);
          });

          // ✅ Delete items that are NOT in the update list (removed items)
          const updateItemIds = itemsToUpdate
            .map((item, index) => {
              // If item has an id, use it to identify existing items
              if (item.id) return item.id;
              // Otherwise use index as fallback
              return index;
            })
            .filter(Boolean);

          // Find items to delete (those not in the update list)
          const itemsToDelete = existingItems.filter(
            (existingItem) => !updateItemIds.includes(existingItem.id),
          );

          // Delete removed items
          for (const itemToDelete of itemsToDelete) {
            await prismaTx.proformaInvoiceItem.delete({
              where: { id: itemToDelete.id },
            });
          }

          // ✅ Create or update items from the update list
          await Promise.all(
            itemsToUpdate.map(async (item, index) => {
              // Convert item numeric fields
              const quantity =
                typeof item.quantity === 'string'
                  ? parseInt(item.quantity, 10)
                  : item.quantity;

              const unitPrice =
                typeof item.unitPrice === 'string'
                  ? parseFloat(item.unitPrice)
                  : item.unitPrice;

              // ✅ Check if this item already exists (by id or index)
              let existingItem = null;
              if (item.id) {
                existingItem = await prismaTx.proformaInvoiceItem.findUnique({
                  where: { id: item.id },
                });
              }

              let createdItem;

              if (existingItem) {
                // ✅ UPDATE existing item - preserve itemId and categoryId
                createdItem = await prismaTx.proformaInvoiceItem.update({
                  where: { id: existingItem.id },
                  data: {
                    // ✅ Keep existing itemId, or update if provided (optional)
                    itemId: item.itemId || existingItem.itemId || null,
                    // ✅ Keep existing categoryId, or update if provided (optional)
                    categoryId:
                      item.categoryId || existingItem.categoryId || null,
                    description: item.description.trim(),
                    itemname: item.itemname?.trim() || null,
                    size: item.size?.trim(),
                    quantity,
                    unitPrice,
                    amount: unitPrice * quantity,
                    additionalDescription: item.additionalDescription?.trim(),
                  },
                });

                // ✅ Delete existing images and materials for this item
                await prismaTx.proformaInvoiceItemImage.deleteMany({
                  where: { itemId: existingItem.id },
                });
                await prismaTx.proformaItemMaterial.deleteMany({
                  where: { itemId: existingItem.id },
                });
              } else {
                // ✅ CREATE new item - include itemId and categoryId (both optional)
                createdItem = await prismaTx.proformaInvoiceItem.create({
                  data: {
                    invoiceId: id,
                    itemId: item.itemId || null, // ✅ Link to Items table if provided (optional)
                    categoryId: item.categoryId || null, // ✅ Link to Category if provided (optional)
                    description: item.description.trim(),
                    size: item.size?.trim(),
                    quantity,
                    unitPrice,
                    amount: unitPrice * quantity,
                    additionalDescription: item.additionalDescription?.trim(),
                    itemname: item.itemname?.trim() || null,
                  },
                });
              }

              // Log the associations
              if (item.itemId || (existingItem && existingItem.itemId)) {
                console.log(
                  `  Linked to Item ID: ${item.itemId || existingItem.itemId}`,
                );
              }
              if (
                item.categoryId ||
                (existingItem && existingItem.categoryId)
              ) {
                console.log(
                  `  Linked to Category ID: ${
                    item.categoryId || existingItem.categoryId
                  }`,
                );
              }

              // Handle images from the item
              const uploadedImages = [];
              const existingImageUrls = [];

              // Check for uploaded files and save to proforma/images path
              if (item.itemIndex !== undefined) {
                // Look for multiple image fields
                const imageFields = Object.keys(structuredFiles).filter(
                  (key) =>
                    key.startsWith(`items[${item.itemIndex}].images[`) ||
                    key === `items[${item.itemIndex}].image`,
                );

                console.log(
                  `Item ${item.itemIndex} - Found image fields:`,
                  imageFields,
                );
                console.log(
                  `Structured files keys:`,
                  Object.keys(structuredFiles),
                );

                for (const fieldName of imageFields) {
                  const uploadedFile = structuredFiles[fieldName];

                  if (uploadedFile && uploadedFile.length > 0) {
                    console.log(
                      `Processing ${uploadedFile.length} file(s) for field: ${fieldName}`,
                    );

                    // Process each uploaded file
                    for (const [imgIndex, file] of uploadedFile.entries()) {
                      try {
                        // Validate file is actually an image
                        if (
                          !file.mimetype ||
                          !file.mimetype.startsWith('image/')
                        ) {
                          console.warn(
                            `Skipping non-image file: ${file.originalname} (${file.mimetype})`,
                          );
                          continue;
                        }

                        console.log(
                          `Saving image ${imgIndex}: ${file.originalname} (${file.size} bytes)`,
                        );

                        // Save image to proforma/images path
                        const imageUrl = await saveImageToProformaPath(
                          file,
                          invoice.id,
                          createdItem.id,
                          imgIndex,
                        );
                        uploadedImages.push(imageUrl);
                        console.log(`Image saved successfully: ${imageUrl}`);
                      } catch (imageError) {
                        console.error(
                          `Failed to save image ${file.originalname}:`,
                          imageError,
                        );
                        // Continue with other images, don't fail the whole request
                      }
                    }
                  }
                }
              }

              // Check for existing image URLs from the item data (when selecting an item)
              if (
                item.images &&
                Array.isArray(item.images) &&
                item.images.length > 0
              ) {
                console.log(
                  `Item has ${item.images.length} existing images in data`,
                );

                for (const [imgIndex, image] of item.images.entries()) {
                  if (image.imageUrl && typeof image.imageUrl === 'string') {
                    let { imageUrl } = image;

                    console.log(
                      `Processing existing image ${imgIndex}: ${imageUrl}`,
                    );

                    // Don't store raw filenames that aren't proper paths
                    if (
                      !imageUrl.startsWith('/') &&
                      !imageUrl.startsWith('http')
                    ) {
                      // Check if it's just a filename without path
                      if (!imageUrl.includes('/') && !imageUrl.includes('\\')) {
                        // This is a raw filename - skip it since it's not a proper URL
                        console.warn(
                          `Found raw filename without path: ${imageUrl}, skipping...`,
                        );
                        continue;
                      }
                      // Normalize the path
                      imageUrl = `/${imageUrl.replace(/\\/g, '/')}`;
                    }
                    existingImageUrls.push(imageUrl);
                  }
                }
              }

              // Combine both sources of images
              const allImageUrls = [...uploadedImages, ...existingImageUrls];

              console.log(
                `Total images for item: ${allImageUrls.length} (Uploaded: ${uploadedImages.length}, Existing: ${existingImageUrls.length})`,
              );

              // Create image records for all images
              if (allImageUrls.length > 0) {
                await Promise.all(
                  allImageUrls.map(async (imageUrl, idx) => {
                    await prismaTx.proformaInvoiceItemImage.create({
                      data: {
                        itemId: createdItem.id,
                        imageUrl,
                      },
                    });
                    console.log(`Created image ${idx + 1}: ${imageUrl}`);
                  }),
                );
                console.log(
                  `Created ${allImageUrls.length} images for item ${createdItem.id}`,
                );
              }

              // Handle legacy single image URL if provided (for backward compatibility)
              if (item.imageUrl && !item.itemIndex && !item.images) {
                let { imageUrl } = item;
                if (!imageUrl.startsWith('/') && !imageUrl.startsWith('http')) {
                  imageUrl = `/${imageUrl.replace(/\\/g, '/')}`;
                }

                await prismaTx.proformaInvoiceItemImage.create({
                  data: {
                    itemId: createdItem.id,
                    imageUrl,
                  },
                });
              }

              // Create materials for this item if provided
              if (
                item.materials &&
                Array.isArray(item.materials) &&
                item.materials.length > 0
              ) {
                await Promise.all(
                  item.materials.map(async (material) => {
                    const materialQuantity =
                      typeof material.quantity === 'string'
                        ? parseInt(material.quantity, 10)
                        : material.quantity;

                    try {
                      await prismaTx.proformaItemMaterial.create({
                        data: {
                          itemId: createdItem.id,
                          materialId: material.materialId,
                          quantity: materialQuantity,
                          note: material.note?.trim(),
                        },
                      });
                    } catch (materialError) {
                      if (materialError.code === 'P2002') {
                        throw new ApiError(
                          httpStatus.BAD_REQUEST,
                          `Duplicate material ${material.materialId} for item ${item.description}. Each material can only be added once per item.`,
                        );
                      }
                      throw new ApiError(
                        httpStatus.INTERNAL_SERVER_ERROR,
                        `Failed to create material record: ${materialError.message}`,
                      );
                    }
                  }),
                );
              }

              return createdItem;
            }),
          );
        }

        // Handle attachments upload - preserve existing attachments if no new ones are uploaded
        // Handle attachments - PRESERVE existing, DELETE only marked ones, ADD new ones
        try {
          // 1. Get existing attachments
          const existingAttachments = await prismaTx.attachment.findMany({
            where: { proformaInvoiceId: id },
          });
          console.log(`📎 Existing attachments: ${existingAttachments.length}`);

          // 2. Parse attachments to delete from updateData
          let attachmentsToDelete = [];
          if (updateData.attachmentsToDelete) {
            try {
              attachmentsToDelete =
                typeof updateData.attachmentsToDelete === 'string'
                  ? JSON.parse(updateData.attachmentsToDelete)
                  : updateData.attachmentsToDelete;

              // Ensure it's an array
              if (!Array.isArray(attachmentsToDelete)) {
                attachmentsToDelete = [attachmentsToDelete];
              }
            } catch (e) {
              // If it's not a JSON string, treat it as a single ID
              attachmentsToDelete = [updateData.attachmentsToDelete];
            }
          }
          console.log(
            `🗑️ Attachments marked for deletion: ${attachmentsToDelete.length}`,
          );

          // 3. Delete only the attachments marked for deletion
          if (attachmentsToDelete.length > 0) {
            const deleteResult = await prismaTx.attachment.deleteMany({
              where: {
                proformaInvoiceId: id,
                id: { in: attachmentsToDelete },
              },
            });
            console.log(`✅ Deleted ${deleteResult.count} attachments`);
          }

          // 4. Add new attachments (if any)
          if (
            structuredFiles.attachments &&
            structuredFiles.attachments.length > 0
          ) {
            console.log(
              `📤 Adding ${structuredFiles.attachments.length} new attachments`,
            );

            await Promise.all(
              structuredFiles.attachments.map(async (file) => {
                // Save attachment to appropriate path
                const targetDir = path.join(
                  __dirname,
                  '../../uploads/proforma/attachments',
                );

                try {
                  await fs.mkdir(targetDir, { recursive: true });
                } catch (err) {
                  if (err.code !== 'EEXIST') throw err;
                }

                const timestamp = Date.now();
                const randomString = Math.random().toString(36).substring(2, 8);
                const fileExt = path.extname(file.originalname);
                const baseName = path.basename(file.originalname, fileExt);
                // Sanitize filename
                const sanitizedBaseName = baseName.replace(
                  /[^a-zA-Z0-9]/g,
                  '_',
                );
                const newFilename = `${timestamp}_${randomString}_${sanitizedBaseName}${fileExt}`;
                const targetPath = path.join(targetDir, newFilename);

                // Copy file
                await fs.copyFile(file.path, targetPath);
                // Clean up temp file
                await fs.unlink(file.path);

                // Return URL with /uploads prefix
                const fileUrl = `/uploads/proforma/attachments/${newFilename}`;

                await prismaTx.attachment.create({
                  data: {
                    proformaInvoiceId: id,
                    fileUrl,
                  },
                });

                console.log(`✅ Attachment saved: ${targetPath}`);
                console.log(`✅ Attachment URL: ${fileUrl}`);
              }),
            );
          } else {
            console.log('ℹ️ No new attachments to upload');
          }

          // 5. Log final attachment count
          const finalAttachments = await prismaTx.attachment.findMany({
            where: { proformaInvoiceId: id },
          });
          console.log(`📎 Final attachments count: ${finalAttachments.length}`);
        } catch (error) {
          console.error('❌ Error handling attachments:', error);
          throw new ApiError(
            httpStatus.INTERNAL_SERVER_ERROR,
            `Failed to handle attachments: ${error.message}`,
          );
        }

        if (materialQuantityChanged && existingInvoice.project?.id) {
          console.log(
            `Material changes detected; reallocating project schedule for ${existingInvoice.project.id}`,
          );
          console.log('Material change details:', materialChangeDetails);
          await rescheduleProjectStages(existingInvoice.project.id, prismaTx);
        }

        // Fetch the complete updated invoice with all relations including images and project
        const completeInvoice = await prismaTx.proformaInvoice.findUnique({
          where: { id: invoice.id },
          include: {
            customer: !isStore
              ? {
                  select: {
                    id: true,
                    name: true,
                    companyName: true,
                    phone1: true,
                    phone2: true,
                    tinNumber: true,
                    address: true,
                  },
                }
              : false,
            preparedBy: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            approvedBy: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            items: {
              include: {
                item: {
                  // ✅ Include the linked item details
                  select: {
                    id: true,
                    name: true,
                    price: true,
                  },
                },
                category: {
                  // ✅ Include the linked category details
                  select: {
                    id: true,
                    name: true,
                  },
                },
                images: true,
                proformaItemMaterials: {
                  include: {
                    material: true,
                  },
                },
              },
            },
            banks: {
              include: {
                bank: true,
                createdBy: true,
              },
            },
            attachments: {
              select: {
                id: true,
                fileUrl: true,
              },
            },
            project: {
              select: {
                id: true,
                status: true,
                difficulty: true,
                requestedDelivery: true,
                calculatedDelivery: true,
              },
            },
          },
        });

        return completeInvoice;
      },
      { timeout: 60000, maxWait: 20000 },
    );

    if (materialQuantityChanged && !updatedInvoice.project?.id) {
      console.log(
        `Material quantities changed, but no project is linked to invoice ${id}. Skipping reschedule.`,
      );
    }

    return updatedInvoice;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error.code === 'P2002') {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Duplicate entry detected. Please check your input data.',
      );
    }

    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to update proforma invoice: ${error.message}`,
    );
  }
};
const updateProformaInvoiceseco = async (
  id,
  updateData,
  structuredFiles = {},
) => {
  // Check if invoice exists with all relations including project
  const existingInvoice = await prisma.proformaInvoice.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          images: true,
          proformaItemMaterials: true,
        },
      },
      banks: true,
      attachments: true,
      customer: true,
      project: {
        include: {
          stages: true,
        },
      },
    },
  });

  if (!existingInvoice) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Proforma invoice not found');
  }

  // Check if invoice can be updated (not cancelled)
  if (existingInvoice.status === 'CANCELLED') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot update a cancelled invoice',
    );
  }

  // Extract fields from updateData
  const {
    customerId = existingInvoice.customerId,
    items,
    amountPaid = existingInvoice.amountPaid || 0,
    preparedById = existingInvoice.preparedById,
    approvedById = existingInvoice.approvedById,
    amountDate = existingInvoice.amountDate,
    banks,
    store = existingInvoice.store || false,
  } = updateData;

  // Convert store from string to boolean if needed
  const isStore =
    store === true || store === 'true' || store === '1' || store === 1;

  // Validate customer if not a store invoice and customer is being updated
  if (!isStore && customerId && customerId !== existingInvoice.customerId) {
    const customerExists = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customerExists) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Customer not found');
    }
  }

  // Handle items update if provided
  const itemsToUpdate = items;
  let materialQuantityChanged = false;
  let materialChangeDetails = null;

  if (itemsToUpdate) {
    if (!Array.isArray(itemsToUpdate) || itemsToUpdate.length === 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'At least one item is required',
      );
    }

    // Validate items structure
    for (const [index, item] of itemsToUpdate.entries()) {
      if (!item.description || item.description.trim().length === 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${index + 1}: description is required`,
        );
      }
      if (!item.quantity || item.quantity <= 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${index + 1}: quantity must be greater than 0`,
        );
      }
      if (!item.unitPrice || item.unitPrice <= 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${index + 1}: unit price must be greater than 0`,
        );
      }

      // ✅ Validate that itemId exists in the items table (if provided)
      if (item.itemId) {
        const existingItem = await prisma.items.findUnique({
          where: { id: item.itemId },
        });

        if (!existingItem) {
          throw new ApiError(
            httpStatus.NOT_FOUND,
            `Item ${index + 1}: Item with ID ${item.itemId} not found`,
          );
        }
      }

      // ✅ Validate that categoryId exists in the category table (if provided)
      if (item.categoryId) {
        const existingCategory = await prisma.productCategory.findUnique({
          where: { id: item.categoryId },
        });

        if (!existingCategory) {
          throw new ApiError(
            httpStatus.NOT_FOUND,
            `Item ${index + 1}: Category with ID ${item.categoryId} not found`,
          );
        }
      }

      // Validate materials if provided
      if (item.materials && Array.isArray(item.materials)) {
        for (const material of item.materials) {
          if (!material.materialId) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Item ${index + 1}: Material materialId is required`,
            );
          }
          if (!material.quantity || material.quantity <= 0) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Item ${index + 1}: Material quantity must be greater than 0`,
            );
          }
        }
      }
    }

    // Check if materials exist
    const allMaterialIds = [];
    itemsToUpdate.forEach((item) => {
      if (item.materials && Array.isArray(item.materials)) {
        item.materials.forEach((material) => {
          if (material.materialId) {
            allMaterialIds.push(material.materialId);
          }
        });
      }
    });

    if (allMaterialIds.length > 0) {
      const uniqueMaterialIds = [...new Set(allMaterialIds)];
      const existingMaterials = await prisma.material.findMany({
        where: {
          id: {
            in: uniqueMaterialIds,
          },
        },
        select: {
          id: true,
        },
      });

      const existingMaterialIds = existingMaterials.map((m) => m.id);
      const missingMaterialIds = uniqueMaterialIds.filter(
        (materialId) => !existingMaterialIds.includes(materialId),
      );

      if (missingMaterialIds.length > 0) {
        throw new ApiError(
          httpStatus.NOT_FOUND,
          `Materials not found with IDs: ${missingMaterialIds.join(', ')}`,
        );
      }
    }

    // --- DETAILED MATERIAL QUANTITY CHANGE DETECTION ---
    // Build old materials map from existing invoice
    const oldMaterialsMap = new Map();
    existingInvoice.items.forEach((item) => {
      if (
        item.proformaItemMaterials &&
        Array.isArray(item.proformaItemMaterials)
      ) {
        item.proformaItemMaterials.forEach((mat) => {
          const currentQty = oldMaterialsMap.get(mat.materialId) || 0;
          oldMaterialsMap.set(mat.materialId, currentQty + mat.quantity);
        });
      }
    });

    // Build new materials map from update data
    const newMaterialsMap = new Map();
    itemsToUpdate.forEach((item) => {
      if (item.materials && Array.isArray(item.materials)) {
        item.materials.forEach((mat) => {
          const qty =
            typeof mat.quantity === 'string'
              ? parseInt(mat.quantity, 10)
              : mat.quantity;
          const currentQty = newMaterialsMap.get(mat.materialId) || 0;
          newMaterialsMap.set(mat.materialId, currentQty + qty);
        });
      }
    });

    // Detailed comparison
    const materialChanges = {
      added: [],
      removed: [],
      changed: [],
      oldMap: Object.fromEntries(oldMaterialsMap),
      newMap: Object.fromEntries(newMaterialsMap),
    };

    // Check for removed or changed materials
    for (const [materialId, oldQty] of oldMaterialsMap.entries()) {
      if (!newMaterialsMap.has(materialId)) {
        materialChanges.removed.push({ materialId, oldQty });
        materialQuantityChanged = true;
      } else {
        const newQty = newMaterialsMap.get(materialId);
        if (newQty !== oldQty) {
          materialChanges.changed.push({ materialId, oldQty, newQty });
          materialQuantityChanged = true;
        }
      }
    }

    // Check for added materials
    for (const [materialId, newQty] of newMaterialsMap.entries()) {
      if (!oldMaterialsMap.has(materialId)) {
        materialChanges.added.push({ materialId, newQty });
        materialQuantityChanged = true;
      }
    }

    if (materialQuantityChanged) {
      materialChangeDetails = materialChanges;
      console.log(
        '🔍 MATERIAL CHANGES DETECTED:',
        JSON.stringify(materialChanges, null, 2),
      );

      // Only trigger reschedule if project exists
      if (existingInvoice.project?.id) {
        console.log(
          `✅ Will trigger reschedule for project: ${existingInvoice.project.id}`,
        );
      } else {
        console.log(
          `⚠️ No project linked to invoice ${existingInvoice.id}, skipping reschedule trigger`,
        );
      }
    } else {
      console.log('✅ No material quantity changes detected');
    }
    // --- END MATERIAL CHECK ---
  }

  // Calculate totals if items are being updated
  // Calculate totals - use frontend values directly
  let subtotal;
  let vat;
  let total;

  if (itemsToUpdate) {
    // ✅ Use values directly from frontend
    subtotal =
      updateData.subtotal !== undefined && updateData.subtotal !== null
        ? money.round(Number(updateData.subtotal))
        : money.round(
            itemsToUpdate.reduce((sum, item) => {
              const quantity =
                typeof item.quantity === 'string'
                  ? parseInt(item.quantity, 10)
                  : item.quantity;
              const unitPrice =
                typeof item.unitPrice === 'string'
                  ? parseFloat(item.unitPrice)
                  : item.unitPrice;
              return sum + quantity * unitPrice;
            }, 0),
          );

    vat =
      updateData.vat !== undefined && updateData.vat !== null
        ? money.round(Number(updateData.vat))
        : money.round(0);

    total =
      updateData.total !== undefined && updateData.total !== null
        ? money.round(Number(updateData.total))
        : money.round(money.add(subtotal, vat));

    console.log(
      `📊 Totals from frontend: Subtotal=${subtotal}, VAT=${vat}, Total=${total}`,
    );
  } else {
    // Use existing values
    subtotal = existingInvoice.subtotal;
    vat = existingInvoice.vat;
    total = existingInvoice.total;
  }

  // Money read back from the DB is Decimal — normalise before any arithmetic.
  const parsedAmountPaid = money.round(amountPaid);
  const totalAmount = money.round(total);
  const balance = money.subtract(totalAmount, parsedAmountPaid);

  // Handle payment updates
  let updatedAmountDate = amountDate;
  if (!money.equals(parsedAmountPaid, existingInvoice.amountPaid)) {
    if (parsedAmountPaid < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Amount paid cannot be negative',
      );
    }

    if (money.greaterThan(parsedAmountPaid, totalAmount)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Amount paid cannot exceed total amount',
      );
    }

    // Set amountDate if payment is made and date not provided
    if (money.isPositive(parsedAmountPaid) && !updatedAmountDate) {
      updatedAmountDate = new Date();
    }
  }

  try {
    const updatedInvoice = await prisma.$transaction(
      async (prismaTx) => {
        // Prepare invoice update data
        const invoiceUpdateData = {
          ...(!isStore && customerId && { customerId }),

          subtotal: money.round(subtotal),
          vat: money.round(vat),
          total: money.round(total),
          amountPaid: money.round(parsedAmountPaid),
          balance: money.round(balance),
          store: isStore,
          ...(updatedAmountDate && { amountDate: new Date(updatedAmountDate) }),
          ...(preparedById && { preparedById }),
          ...(approvedById && { approvedById }),
        };

        // Update the invoice
        const invoice = await prismaTx.proformaInvoice.update({
          where: { id },
          data: invoiceUpdateData,
        });

        // Update banks if provided
        if (banks !== undefined) {
          // Delete existing bank relations
          await prismaTx.proformaInvoiceBank.deleteMany({
            where: { proformaInvoiceId: id },
          });

          // Create new bank relations if provided
          if (Array.isArray(banks) && banks.length > 0) {
            await Promise.all(
              banks.map(async (bankData) => {
                if (!bankData.bankId) {
                  throw new ApiError(
                    httpStatus.BAD_REQUEST,
                    'Bank ID is required for bank relation',
                  );
                }

                // Check if bank exists
                const bankExists = await prismaTx.bank.findUnique({
                  where: { id: bankData.bankId },
                });

                if (!bankExists) {
                  throw new ApiError(
                    httpStatus.NOT_FOUND,
                    `Bank not found with ID: ${bankData.bankId}`,
                  );
                }

                await prismaTx.proformaInvoiceBank.create({
                  data: {
                    proformaInvoiceId: id,
                    bankId: bankData.bankId,
                    amount: bankData.amount ? Number(bankData.amount) : null,
                  },
                });
              }),
            );
          }
        }

        // Update items if provided
        if (itemsToUpdate) {
          // ✅ Get existing items to preserve itemId and categoryId references
          const existingItems = await prismaTx.proformaInvoiceItem.findMany({
            where: { invoiceId: id },
            include: {
              images: true,
              proformaItemMaterials: true,
            },
          });

          // ✅ Map existing items by index or id for matching
          const existingItemsMap = new Map();
          existingItems.forEach((existingItem, index) => {
            existingItemsMap.set(index, existingItem);
          });

          // ✅ Delete items that are NOT in the update list (removed items)
          const updateItemIds = itemsToUpdate
            .map((item, index) => {
              // If item has an id, use it to identify existing items
              if (item.id) return item.id;
              // Otherwise use index as fallback
              return index;
            })
            .filter(Boolean);

          // Find items to delete (those not in the update list)
          const itemsToDelete = existingItems.filter(
            (existingItem) => !updateItemIds.includes(existingItem.id),
          );

          // Delete removed items
          for (const itemToDelete of itemsToDelete) {
            await prismaTx.proformaInvoiceItem.delete({
              where: { id: itemToDelete.id },
            });
          }

          // ✅ Create or update items from the update list
          await Promise.all(
            itemsToUpdate.map(async (item, index) => {
              // Convert item numeric fields
              const quantity =
                typeof item.quantity === 'string'
                  ? parseInt(item.quantity, 10)
                  : item.quantity;

              const unitPrice =
                typeof item.unitPrice === 'string'
                  ? parseFloat(item.unitPrice)
                  : item.unitPrice;

              // ✅ Check if this item already exists (by id or index)
              let existingItem = null;
              if (item.id) {
                existingItem = await prismaTx.proformaInvoiceItem.findUnique({
                  where: { id: item.id },
                });
              }

              let createdItem;

              if (existingItem) {
                // ✅ UPDATE existing item - preserve itemId and categoryId
                createdItem = await prismaTx.proformaInvoiceItem.update({
                  where: { id: existingItem.id },
                  data: {
                    // ✅ Keep existing itemId, or update if provided (optional)
                    itemId: item.itemId || existingItem.itemId || null,
                    // ✅ Keep existing categoryId, or update if provided (optional)
                    categoryId:
                      item.categoryId || existingItem.categoryId || null,
                    description: item.description.trim(),
                    itemname: item.itemname?.trim(),
                    size: item.size?.trim(),
                    quantity,
                    unitPrice,
                    amount: unitPrice * quantity,
                    additionalDescription: item.additionalDescription?.trim(),
                  },
                });

                // ✅ Delete existing images and materials for this item
                await prismaTx.proformaInvoiceItemImage.deleteMany({
                  where: { itemId: existingItem.id },
                });
                await prismaTx.proformaItemMaterial.deleteMany({
                  where: { itemId: existingItem.id },
                });
              } else {
                // ✅ CREATE new item - include itemId and categoryId (both optional)
                createdItem = await prismaTx.proformaInvoiceItem.create({
                  data: {
                    invoiceId: id,
                    itemId: item.itemId || null, // ✅ Link to Items table if provided (optional)
                    categoryId: item.categoryId || null, // ✅ Link to Category if provided (optional)
                    description: item.description.trim(),
                    itemname: item.itemname?.trim() || null,
                    size: item.size?.trim(),
                    quantity,
                    unitPrice,
                    amount: unitPrice * quantity,
                    additionalDescription: item.additionalDescription?.trim(),
                  },
                });
              }

              // Log the associations
              if (item.itemId || (existingItem && existingItem.itemId)) {
                console.log(
                  `  Linked to Item ID: ${item.itemId || existingItem.itemId}`,
                );
              }
              if (
                item.categoryId ||
                (existingItem && existingItem.categoryId)
              ) {
                console.log(
                  `  Linked to Category ID: ${
                    item.categoryId || existingItem.categoryId
                  }`,
                );
              }

              // Handle images from the item
              const uploadedImages = [];
              const existingImageUrls = [];

              // Check for uploaded files and save to proforma/images path
              if (item.itemIndex !== undefined) {
                // Look for multiple image fields
                const imageFields = Object.keys(structuredFiles).filter(
                  (key) =>
                    key.startsWith(`items[${item.itemIndex}].images[`) ||
                    key === `items[${item.itemIndex}].image`,
                );

                console.log(
                  `Item ${item.itemIndex} - Found image fields:`,
                  imageFields,
                );
                console.log(
                  `Structured files keys:`,
                  Object.keys(structuredFiles),
                );

                for (const fieldName of imageFields) {
                  const uploadedFile = structuredFiles[fieldName];

                  if (uploadedFile && uploadedFile.length > 0) {
                    console.log(
                      `Processing ${uploadedFile.length} file(s) for field: ${fieldName}`,
                    );

                    // Process each uploaded file
                    for (const [imgIndex, file] of uploadedFile.entries()) {
                      try {
                        // Validate file is actually an image
                        if (
                          !file.mimetype ||
                          !file.mimetype.startsWith('image/')
                        ) {
                          console.warn(
                            `Skipping non-image file: ${file.originalname} (${file.mimetype})`,
                          );
                          continue;
                        }

                        console.log(
                          `Saving image ${imgIndex}: ${file.originalname} (${file.size} bytes)`,
                        );

                        // Save image to proforma/images path
                        const imageUrl = await saveImageToProformaPath(
                          file,
                          invoice.id,
                          createdItem.id,
                          imgIndex,
                        );
                        uploadedImages.push(imageUrl);
                        console.log(`Image saved successfully: ${imageUrl}`);
                      } catch (imageError) {
                        console.error(
                          `Failed to save image ${file.originalname}:`,
                          imageError,
                        );
                        // Continue with other images, don't fail the whole request
                      }
                    }
                  }
                }
              }

              // Check for existing image URLs from the item data (when selecting an item)
              if (
                item.images &&
                Array.isArray(item.images) &&
                item.images.length > 0
              ) {
                console.log(
                  `Item has ${item.images.length} existing images in data`,
                );

                for (const [imgIndex, image] of item.images.entries()) {
                  if (image.imageUrl && typeof image.imageUrl === 'string') {
                    let { imageUrl } = image;

                    console.log(
                      `Processing existing image ${imgIndex}: ${imageUrl}`,
                    );

                    // Don't store raw filenames that aren't proper paths
                    if (
                      !imageUrl.startsWith('/') &&
                      !imageUrl.startsWith('http')
                    ) {
                      // Check if it's just a filename without path
                      if (!imageUrl.includes('/') && !imageUrl.includes('\\')) {
                        // This is a raw filename - skip it since it's not a proper URL
                        console.warn(
                          `Found raw filename without path: ${imageUrl}, skipping...`,
                        );
                        continue;
                      }
                      // Normalize the path
                      imageUrl = `/${imageUrl.replace(/\\/g, '/')}`;
                    }
                    existingImageUrls.push(imageUrl);
                  }
                }
              }

              // Combine both sources of images
              const allImageUrls = [...uploadedImages, ...existingImageUrls];

              console.log(
                `Total images for item: ${allImageUrls.length} (Uploaded: ${uploadedImages.length}, Existing: ${existingImageUrls.length})`,
              );

              // Create image records for all images
              if (allImageUrls.length > 0) {
                await Promise.all(
                  allImageUrls.map(async (imageUrl, idx) => {
                    await prismaTx.proformaInvoiceItemImage.create({
                      data: {
                        itemId: createdItem.id,
                        imageUrl,
                      },
                    });
                    console.log(`Created image ${idx + 1}: ${imageUrl}`);
                  }),
                );
                console.log(
                  `Created ${allImageUrls.length} images for item ${createdItem.id}`,
                );
              }

              // Handle legacy single image URL if provided (for backward compatibility)
              if (item.imageUrl && !item.itemIndex && !item.images) {
                let { imageUrl } = item;
                if (!imageUrl.startsWith('/') && !imageUrl.startsWith('http')) {
                  imageUrl = `/${imageUrl.replace(/\\/g, '/')}`;
                }

                await prismaTx.proformaInvoiceItemImage.create({
                  data: {
                    itemId: createdItem.id,
                    imageUrl,
                  },
                });
              }

              // Create materials for this item if provided
              if (
                item.materials &&
                Array.isArray(item.materials) &&
                item.materials.length > 0
              ) {
                await Promise.all(
                  item.materials.map(async (material) => {
                    const materialQuantity =
                      typeof material.quantity === 'string'
                        ? parseInt(material.quantity, 10)
                        : material.quantity;

                    try {
                      await prismaTx.proformaItemMaterial.create({
                        data: {
                          itemId: createdItem.id,
                          materialId: material.materialId,
                          quantity: materialQuantity,
                          note: material.note?.trim(),
                        },
                      });
                    } catch (materialError) {
                      if (materialError.code === 'P2002') {
                        throw new ApiError(
                          httpStatus.BAD_REQUEST,
                          `Duplicate material ${material.materialId} for item ${item.description}. Each material can only be added once per item.`,
                        );
                      }
                      throw new ApiError(
                        httpStatus.INTERNAL_SERVER_ERROR,
                        `Failed to create material record: ${materialError.message}`,
                      );
                    }
                  }),
                );
              }

              return createdItem;
            }),
          );
        }

        // Handle attachments upload - preserve existing attachments if no new ones are uploaded
        // Handle attachments - PRESERVE existing, DELETE only marked ones, ADD new ones
        try {
          // 1. Get existing attachments
          const existingAttachments = await prismaTx.attachment.findMany({
            where: { proformaInvoiceId: id },
          });
          console.log(`📎 Existing attachments: ${existingAttachments.length}`);

          // 2. Parse attachments to delete from updateData
          let attachmentsToDelete = [];
          if (updateData.attachmentsToDelete) {
            try {
              attachmentsToDelete =
                typeof updateData.attachmentsToDelete === 'string'
                  ? JSON.parse(updateData.attachmentsToDelete)
                  : updateData.attachmentsToDelete;

              // Ensure it's an array
              if (!Array.isArray(attachmentsToDelete)) {
                attachmentsToDelete = [attachmentsToDelete];
              }
            } catch (e) {
              // If it's not a JSON string, treat it as a single ID
              attachmentsToDelete = [updateData.attachmentsToDelete];
            }
          }
          console.log(
            `🗑️ Attachments marked for deletion: ${attachmentsToDelete.length}`,
          );

          // 3. Delete only the attachments marked for deletion
          if (attachmentsToDelete.length > 0) {
            const deleteResult = await prismaTx.attachment.deleteMany({
              where: {
                proformaInvoiceId: id,
                id: { in: attachmentsToDelete },
              },
            });
            console.log(`✅ Deleted ${deleteResult.count} attachments`);
          }

          // 4. Add new attachments (if any)
          if (
            structuredFiles.attachments &&
            structuredFiles.attachments.length > 0
          ) {
            console.log(
              `📤 Adding ${structuredFiles.attachments.length} new attachments`,
            );

            await Promise.all(
              structuredFiles.attachments.map(async (file) => {
                // Save attachment to appropriate path
                const targetDir = path.join(
                  __dirname,
                  '../../uploads/proforma/attachments',
                );

                try {
                  await fs.mkdir(targetDir, { recursive: true });
                } catch (err) {
                  if (err.code !== 'EEXIST') throw err;
                }

                const timestamp = Date.now();
                const randomString = Math.random().toString(36).substring(2, 8);
                const fileExt = path.extname(file.originalname);
                const baseName = path.basename(file.originalname, fileExt);
                // Sanitize filename
                const sanitizedBaseName = baseName.replace(
                  /[^a-zA-Z0-9]/g,
                  '_',
                );
                const newFilename = `${timestamp}_${randomString}_${sanitizedBaseName}${fileExt}`;
                const targetPath = path.join(targetDir, newFilename);

                // Copy file
                await fs.copyFile(file.path, targetPath);
                // Clean up temp file
                await fs.unlink(file.path);

                // Return URL with /uploads prefix
                const fileUrl = `/uploads/proforma/attachments/${newFilename}`;

                await prismaTx.attachment.create({
                  data: {
                    proformaInvoiceId: id,
                    fileUrl,
                  },
                });

                console.log(`✅ Attachment saved: ${targetPath}`);
                console.log(`✅ Attachment URL: ${fileUrl}`);
              }),
            );
          } else {
            console.log('ℹ️ No new attachments to upload');
          }

          // 5. Log final attachment count
          const finalAttachments = await prismaTx.attachment.findMany({
            where: { proformaInvoiceId: id },
          });
          console.log(`📎 Final attachments count: ${finalAttachments.length}`);
        } catch (error) {
          console.error('❌ Error handling attachments:', error);
          throw new ApiError(
            httpStatus.INTERNAL_SERVER_ERROR,
            `Failed to handle attachments: ${error.message}`,
          );
        }

        if (materialQuantityChanged && existingInvoice.project?.id) {
          console.log(
            `Material changes detected; reallocating project schedule for ${existingInvoice.project.id}`,
          );
          console.log('Material change details:', materialChangeDetails);
          await rescheduleProjectStages(existingInvoice.project.id, prismaTx);
        }

        // Fetch the complete updated invoice with all relations including images and project
        const completeInvoice = await prismaTx.proformaInvoice.findUnique({
          where: { id: invoice.id },
          include: {
            customer: !isStore
              ? {
                  select: {
                    id: true,
                    name: true,
                    companyName: true,
                    phone1: true,
                    phone2: true,
                    tinNumber: true,
                    address: true,
                  },
                }
              : false,
            preparedBy: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            approvedBy: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            items: {
              include: {
                item: {
                  // ✅ Include the linked item details
                  select: {
                    id: true,
                    name: true,
                    price: true,
                  },
                },
                category: {
                  // ✅ Include the linked category details
                  select: {
                    id: true,
                    name: true,
                  },
                },
                images: true,
                proformaItemMaterials: {
                  include: {
                    material: true,
                  },
                },
              },
            },
            banks: {
              include: {
                bank: true,
                createdBy: true,
              },
            },
            attachments: {
              select: {
                id: true,
                fileUrl: true,
              },
            },
            project: {
              select: {
                id: true,
                status: true,
                difficulty: true,
                requestedDelivery: true,
                calculatedDelivery: true,
              },
            },
          },
        });

        return completeInvoice;
      },
      { timeout: 60000, maxWait: 20000 },
    );

    if (materialQuantityChanged && !updatedInvoice.project?.id) {
      console.log(
        `Material quantities changed, but no project is linked to invoice ${id}. Skipping reschedule.`,
      );
    }

    return updatedInvoice;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error.code === 'P2002') {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Duplicate entry detected. Please check your input data.',
      );
    }

    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to update proforma invoice: ${error.message}`,
    );
  }
};
// Delete Proforma Invoice
const deleteProformaInvoice = async (id) => {
  try {
    // Check if invoice exists with ALL relations
    const existingInvoice = await prisma.proformaInvoice.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            proformaItemMaterials: {
              select: { id: true },
            },
            images: {
              select: { id: true }, // 👈 ADD THIS - may be missing
            },
          },
        },
        attachments: {
          select: { id: true, fileUrl: true },
        },
        banks: {
          select: { id: true, bankId: true },
        },
        project: {
          select: { id: true },
        },
        piLogs: {
          // 👈 ADD THIS - may be missing
          select: { id: true },
        },
      },
    });

    if (!existingInvoice) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Proforma invoice not found');
    }

    // GUARD FIRST. `Project.invoiceId` is a required unique FK, so an invoice
    // that has a project can never be deleted — the final delete always fails
    // with P2003. Previously this relation was fetched and then ignored, so the
    // six deleteMany calls below ran first, destroying every line item, price,
    // image, bank row and attachment, and only THEN hit the constraint. With no
    // transaction wrapping them, none of it rolled back: the invoice survived
    // with all of its contents irrecoverably gone.
    if (existingInvoice.project) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'This proforma invoice has a project and cannot be deleted. Delete the project first.',
      );
    }

    const itemIds = existingInvoice.items.map((i) => i.id);

    // One transaction: either the whole invoice and its children go, or nothing
    // does. Ordered child-first so no FK is violated mid-flight.
    const { deletedInvoice, totalMaterials, totalImages } =
      await prisma.$transaction(async (tx) => {
        await tx.piLog.deleteMany({ where: { proformaId: id } });

        let materials = 0;
        let images = 0;
        if (itemIds.length > 0) {
          materials = (
            await tx.proformaItemMaterial.deleteMany({
              where: { itemId: { in: itemIds } },
            })
          ).count;
          images = (
            await tx.proformaInvoiceItemImage.deleteMany({
              where: { itemId: { in: itemIds } },
            })
          ).count;
          await tx.proformaInvoiceItem.deleteMany({ where: { invoiceId: id } });
        }

        await tx.proformaInvoiceBank.deleteMany({
          where: { proformaInvoiceId: id },
        });
        await tx.attachment.deleteMany({ where: { proformaInvoiceId: id } });

        const invoice = await tx.proformaInvoice.delete({ where: { id } });
        return {
          deletedInvoice: invoice,
          totalMaterials: materials,
          totalImages: images,
        };
      });

    // Files are removed only AFTER the transaction commits — deleting them
    // first meant a rolled-back or failed delete still destroyed them on disk,
    // with nothing to restore from.
    let deletedFiles = 0;
    for (const attachment of existingInvoice.attachments) {
      if (!attachment.fileUrl) continue;
      try {
        // `fs` here is fs/promises, which has no existsSync — the previous code
        // called it anyway and threw straight into an empty catch, so no file
        // was ever actually removed. unlink + ENOENT is the promise-API way.
        await fs.unlink(path.join(__dirname, '../..', attachment.fileUrl));
        deletedFiles += 1;
      } catch (fileError) {
        if (fileError.code !== 'ENOENT') {
          console.error(
            `Failed to delete attachment file ${attachment.fileUrl}:`,
            fileError.message,
          );
        }
      }
    }

    return {
      message: 'Proforma invoice deleted successfully',
      deletedInvoiceId: id,
      deletedInvoiceNumber: deletedInvoice.piNumber,
      deletedItemsCount: existingInvoice.items.length,
      deletedAttachmentsCount: existingInvoice.attachments.length,
      deletedBanksCount: existingInvoice.banks.length,
      deletedMaterialRelationsCount: totalMaterials,
      deletedImagesCount: totalImages,
      deletedLogsCount: existingInvoice.piLogs?.length || 0,
      deletedFilesCount: deletedFiles,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`❌ Fatal error in deleteProformaInvoice:`, error);
    console.error(`❌ Error details:`, {
      code: error.code,
      message: error.message,
      meta: error.meta,
    });

    // Handle Prisma specific errors
    if (error.code === 'P2003') {
      console.error(
        `❌ Foreign key constraint failed. Missing related records to delete.`,
      );
      throw new ApiError(
        httpStatus.CONFLICT,
        `Foreign key constraint failed. This usually means there are still related records that need to be deleted first. Error: ${error.message}`,
      );
    } else if (error.code === 'P2025') {
      console.error(`❌ Record not found.`);
      throw new ApiError(
        httpStatus.NOT_FOUND,
        'Record not found or already deleted.',
      );
    } else if (error.code === 'P2002') {
      console.error(`❌ Unique constraint violation.`);
      throw new ApiError(
        httpStatus.CONFLICT,
        `Unique constraint violation: ${error.message}`,
      );
    }

    // Re-throw if it's already an ApiError
    if (error instanceof ApiError) {
      throw error;
    }

    // Wrap other errors
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      error.message || 'Failed to delete proforma invoice',
    );
  }
};

// Get all Proforma Invoices
const getAllProformaInvoices = async (filters = {}) => {
  const {
    search,
    status,
    customerId,
    startDate,
    endDate,
 
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = filters;

  // Build where clause
  const where = {};

  if (search) {
    where.OR = [
      {
        piNumber: {
          contains: search,
          mode: 'insensitive',
        },
      },
      {
        customer: {
          name: {
            contains: search,
            mode: 'insensitive',
          },
        },
      },
    ];
  }

  if (status) {
    where.status = status;
  }

  if (customerId) {
    where.customerId = customerId;
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      where.createdAt.gte = new Date(startDate);
    }
    if (endDate) {
      where.createdAt.lte = new Date(endDate);
    }
  }

  // Calculate pagination

  // Get invoices with pagination
  const [invoices, total] = await Promise.all([
    prisma.proformaInvoice.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            companyName: true,
            phone1: true,
            phone2: true,
            tinNumber: true,
            address: true,
          },
        },
        banks: {
          include: {
            bank: true,
            createdBy: true, // Include all bank fields
          },
        },
        preparedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        approvedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        items: {
          include: {
            proformaItemMaterials: {
              include: {
                material: true,
                materialIssues: {
                  // 👈 Include material issues
                  include: {
                    issuedBy: {
                      // 👈 Who issued the material
                      select: {
                        id: true,
                        name: true,
                        email: true,
                      },
                    },
                    givenTo: {
                      // 👈 Who received the material
                      select: {
                        id: true,
                        name: true,
                        email: true,
                      },
                    },
                  },
                  orderBy: {
                    issuedAt: 'desc', // 👈 Latest issues first
                  },
                },
              },
            },
            item: true, // Include item details (like name) if it's a relation to a product/item table
            images: true,
          },
        },
        piLogs: {
          // 👈 Include all logs for this proforma invoice
          include: {
            piuser: {
              // 👈 Include user who performed the action
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        attachments: true,
        project: {
          select: {
            id: true,
            status: true,
            difficulty: true,
            requestedDelivery: true,
            calculatedDelivery: true,
          },
        },
      },
      orderBy: {
        [sortBy]: sortOrder,
      },
    }),
    prisma.proformaInvoice.count({ where }),
  ]);
  return {
    invoices,
    count: invoices.length,
    pagination: {
      total,
    },
  };
};

const getAllProformaInvoicesmy = async (filters = {}, userId) => {
  const {
    search,
    status,
    customerId,
    startDate,
    endDate,
    page = 1,
    limit = 10,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = filters;

  // Build where clause
  const where = {};

  // 🔥 Filter by creator (preparedBy)
  if (userId) {
    where.preparedById = userId;
  }

  if (search) {
    where.OR = [
      {
        piNumber: {
          contains: search,
          mode: 'insensitive',
        },
      },
      {
        customer: {
          name: {
            contains: search,
            mode: 'insensitive',
          },
        },
      },
    ];
  }

  if (status) {
    where.status = status;
  }

  if (customerId) {
    where.customerId = customerId;
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      where.createdAt.gte = new Date(startDate);
    }
    if (endDate) {
      where.createdAt.lte = new Date(endDate);
    }
  }

  // Calculate pagination
  const skip = (page - 1) * limit;

  // Get invoices with pagination
  const [invoices, total] = await Promise.all([
    prisma.proformaInvoice.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            companyName: true,
            phone1: true,
            phone2: true,
            tinNumber: true,
            address: true,
          },
        },
        banks: {
          include: {
            bank: true,
            createdBy: true,
          },
        },
        preparedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        approvedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        items: {
          include: {
            proformaItemMaterials: {
              include: {
                material: true,
                materialIssues: {
                  include: {
                    issuedBy: {
                      select: {
                        id: true,
                        name: true,
                        email: true,
                      },
                    },
                    givenTo: {
                      select: {
                        id: true,
                        name: true,
                        email: true,
                      },
                    },
                  },
                  orderBy: {
                    issuedAt: 'desc',
                  },
                },
              },
            },
            item: true,
            images: true,
          },
        },
        piLogs: {
          include: {
            piuser: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        attachments: true,
        project: {
          select: {
            id: true,
            status: true,
            difficulty: true,
            requestedDelivery: true,
            calculatedDelivery: true,
          },
        },
      },
      orderBy: {
        [sortBy]: sortOrder,
      },
      skip,
      take: parseInt(limit, 10),
    }),
    prisma.proformaInvoice.count({ where }),
  ]);

  return {
    invoices,
    count: invoices.length,
    pagination: {
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      totalPages: Math.ceil(total / limit),
    },
  };
};
const getProformaInvoiceById = async (id) => {
  const invoice = await prisma.proformaInvoice.findUnique({
    where: { id },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          companyName: true,
          phone1: true,
          phone2: true,
          tinNumber: true,
          address: true,
        },
      },
      banks: {
        include: {
          bank: true,
          createdBy: true, // Include all bank fields
        },
      },
      preparedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      approvedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      items: {
        include: {
          proformaItemMaterials: {
            include: {
              material: true,
              materialIssues: {
                // 👈 Include material issues
                include: {
                  issuedBy: {
                    // 👈 Who issued the material
                    select: {
                      id: true,
                      name: true,
                      email: true,
                    },
                  },
                  givenTo: {
                    // 👈 Who received the material
                    select: {
                      id: true,
                      name: true,
                      email: true,
                    },
                  },
                },
                orderBy: {
                  issuedAt: 'desc', // 👈 Latest issues first
                },
              },
            },
          },
          item: true, // Include item details (like name) if it's a relation to a product/item table
          images: true,
          category: true,
        },
      },
      piLogs: {
        // 👈 Include all logs for this proforma invoice
        include: {
          piuser: {
            // 👈 Include user who performed the action
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
      attachments: true,
      project: {
        select: {
          id: true,
          status: true,
          difficulty: true,
          requestedDelivery: true,
          calculatedDelivery: true,
        },
      },
    },
  });

  if (!invoice) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Proforma invoice not found');
  }

  return invoice;
};

const getProformaInvoiceByPInumber = async (piNumber) => {
  const invoice = await prisma.proformaInvoice.findUnique({
    where: { piNumber },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
      items: {
        select: {
          id: true,
          description: true,
          itemname: true,
          quantity: true,
          unitPrice: true,
          amount: true,
        },
      },
    },
  });

  return invoice;
};

const updateProformaInvoiceStatus = async (id, status, approvedById = null) => {
  try {
    const invoice = await prisma.proformaInvoice.findUnique({
      where: { id },
    });

    if (!invoice) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Proforma invoice not found');
    }

    if (invoice.status === 'CANCELLED') {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cannot update status of a cancelled invoice',
      );
    }

    const updateData = {
      status,
    };

    if (status === 'APPROVED_ST' && approvedById) {
      updateData.approvedById = approvedById;
    }

    const updatedInvoice = await prisma.proformaInvoice.update({
      where: { id },
      data: updateData,
    });

    const log = await prisma.piLog.create({
      data: {
        action: `Status changed from ${invoice.status} to ${status}`,
        proformaId: id,
        piuserId: approvedById,
      },
    });

    return updatedInvoice;
  } catch (error) {
    if (error.code) {
      console.error('Prisma Error Code:', error.code);
    }

    if (error.meta) {
      console.error('Prisma Error Meta:', error.meta);
    }

    throw error;
  }
};

const addPayment = async (
  invoiceId,
  amountPaid,
  amountDate,
  bankId,
  paidBy, // This is now a string (customer name or ID)
  userId, // This is the user ID (relation to User model)
) => {
  const paymentAmount = money.round(amountPaid);

  if (!money.isPositive(paymentAmount)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Payment amount must be greater than zero',
    );
  }

  try {
    // Update invoice with payment.
    // NOTE: the invoice is read INSIDE the transaction. Reading the balance
    // before opening it let two concurrent payments both see the old
    // amountPaid — the later write won and one payment vanished from the
    // totals while its bank row survived, so ledger and invoice disagreed.
    const updatedInvoice = await prisma.$transaction(
      async (tx) => {
        const invoice = await tx.proformaInvoice.findUnique({
          where: { id: invoiceId },
        });

        if (!invoice) {
          throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found');
        }

        const invoiceTotal = money.toNumber(invoice.total);
        const alreadyPaid = money.toNumber(invoice.amountPaid);
        const newTotalPaid = money.sum(alreadyPaid, paymentAmount);
        const newBalance = money.subtract(invoiceTotal, newTotalPaid);

        // Reject overpayment rather than storing a negative balance.
        if (money.greaterThan(newTotalPaid, invoiceTotal)) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Payment of ${paymentAmount} exceeds the outstanding balance of ${money.subtract(
              invoiceTotal,
              alreadyPaid,
            )}`,
          );
        }

        // Comparisons go through the money helpers so a settled invoice is not
        // left PARTIAL forever by a sub-cent floating point residue.
        let paymentStatus;
        if (money.isSettled(newBalance)) {
          paymentStatus = 'PAID';
        } else if (money.isPositive(newTotalPaid)) {
          paymentStatus = 'PARTIAL';
        } else {
          paymentStatus = 'PENDING';
        }

        // Update the invoice with payment AND paymentStatus
        const updatedInvoiceData = await tx.proformaInvoice.update({
          where: { id: invoiceId },
          data: {
            amountPaid: newTotalPaid,
            balance: newBalance,
            // Only advance the date when one was supplied — this used to write
            // `null` on any payment without a date, erasing the previous one.
            ...(amountDate ? { amountDate: new Date(amountDate) } : {}),
            paymentStatus, // ✅ Update payment status
          },
          include: {
            items: true,
            banks: {
              include: {
                bank: true,
                createdBy: true,
              },
            },
            attachments: true,
            customer: true,
          },
        });

        // If bankId is provided, ALWAYS CREATE NEW bank record
        if (bankId) {
          {
            // Prepare the data for bank record creation
            const bankData = {
              proformaInvoiceId: invoiceId,
              bankId,
              amount: paymentAmount, // Store the payment amount for this specific transaction
            };

            // Add paidBy as string if provided
            if (paidBy) {
              bankData.paidBy = paidBy;
            }

            // Add createdBy relation if userId is provided
            if (userId) {
              bankData.createdById = userId;
            }

            // NOTE: this used to be wrapped in a try/catch that logged and
            // deliberately did NOT rethrow ("continue even if bank linking
            // fails"). Because it runs inside the transaction, that committed
            // the invoice's amountPaid with no payment record behind it —
            // money recorded against no source. A failure here must roll the
            // whole payment back.
            await tx.proformaInvoiceBank.create({
              data: bankData,
              include: {
                bank: true,
                createdBy: true,
              },
            });

            console.log(`Bank record created for payment: ${paymentAmount}`);
          }
        } else {
          console.log('No bankId provided, skipping bank record processing');
        }

        return updatedInvoiceData;
      },
      {
        timeout: 10000, // 10 second timeout
        maxWait: 5000, // 5 second max wait
      },
    );

    // ✅ Log the final payment status
    console.log(
      `Payment completed. Invoice ${invoiceId} status: ${updatedInvoice.paymentStatus}`,
    );
    if (updatedInvoice.paymentStatus === 'PAID') {
      console.log(`✅ Invoice ${invoiceId} is now fully paid!`);
    } else if (updatedInvoice.paymentStatus === 'PARTIAL') {
      console.log(
        `⚠️ Invoice ${invoiceId} has partial payment. Remaining balance: ${updatedInvoice.balance}`,
      );
    }

    return updatedInvoice;
  } catch (error) {
    console.error('Error in addPayment function:', error);
    console.error('Full error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    throw error;
  }
};
const updateProformaInvoiceAdditionalQuantity = async (id, materialUpdates) => {
  const invoice = await prisma.proformaInvoice.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          proformaItemMaterials: { include: { material: true } },
        },
      },
      project: { select: { id: true } },
    },
  });

  if (!invoice) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Proforma invoice not found');
  }
  if (invoice.status === 'CANCELLED') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot update additional quantity of a cancelled invoice',
    );
  }
  if (
    !materialUpdates ||
    !Array.isArray(materialUpdates) ||
    materialUpdates.length === 0
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Material updates array is required',
    );
  }

  const allItemMaterials = [];
  invoice.items.forEach((item) => {
    if (item.proformaItemMaterials?.length)
      allItemMaterials.push(...item.proformaItemMaterials);
  });
  const existingMaterialMap = new Map();
  allItemMaterials.forEach((material) => {
    existingMaterialMap.set(material.materialId, material);
  });

  let materialQuantitiesChanged = false;
  materialUpdates.forEach((update) => {
    const { additionalQuantity, materialId } = update;
    if (!materialId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Material ID is required for all updates',
      );
    }
    if (additionalQuantity === undefined || additionalQuantity === null) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Additional quantity is required for all materials',
      );
    }
    if (typeof additionalQuantity !== 'number' || additionalQuantity < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Additional quantity must be a non-negative number',
      );
    }

    const existingMaterial = existingMaterialMap.get(materialId);
    const pastAdditionalQuantity = existingMaterial?.additionalQuantity || 0;
    if (additionalQuantity !== pastAdditionalQuantity) {
      materialQuantitiesChanged = true;
    }
  });

  return prisma.$transaction(
    async (tx) => {
      const results = [];
      for (const update of materialUpdates) {
        const { materialId, additionalQuantity, note = null } = update;
        const existingMaterial = existingMaterialMap.get(materialId);
        const pastQuantity = existingMaterial?.quantity || 0;
        const totalQuantity = pastQuantity + additionalQuantity;
        const givenQuantity = existingMaterial?.givenquantity || 0;

        let status;
        if (additionalQuantity === 0 && pastQuantity === 0) {
          status = 'PENDING';
        } else if (givenQuantity > 0 && totalQuantity > givenQuantity) {
          status = 'PARTIALLY';
        } else if (givenQuantity > 0 && totalQuantity >= givenQuantity) {
          status = 'ISSUED';
        } else {
          status = additionalQuantity > 0 ? 'PARTIALLY' : 'PENDING';
        }

        if (existingMaterial) {
          // eslint-disable-next-line no-await-in-loop
          const updated = await tx.proformaItemMaterial.update({
            where: { id: existingMaterial.id },
            data: {
              additionalQuantity,
              status,
              note: note || existingMaterial.note,
            },
          });
          results.push(updated);
          continue;
        }

        if (invoice.items.length === 0) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Cannot add new material ${materialId} because invoice has no items`,
          );
        }

        // eslint-disable-next-line no-await-in-loop
        const created = await tx.proformaItemMaterial.create({
          data: {
            itemId: invoice.items[0].id,
            materialId,
            quantity: 0,
            additionalQuantity,
            status: additionalQuantity > 0 ? 'PARTIALLY' : 'PENDING',
            note,
          },
        });
        results.push(created);
      }

      if (materialQuantitiesChanged && invoice.project?.id) {
        await rescheduleProjectStages(invoice.project.id, tx);
      }

      return results;
    },
    { timeout: 60000, maxWait: 20000 },
  );
};
const addProformaInvoiceAttachment = async (invoiceId, files) => {
  try {
    // 1. Check if invoice exists
    const invoice = await prisma.proformaInvoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      throw new Error(`Proforma invoice with ID ${invoiceId} not found`);
    }

    // 2. Validate files
    if (!files || files.length === 0) {
      throw new Error('At least one file is required');
    }

    // 3. Save files and create attachment records
    const attachments = [];

    for (const file of files) {
      // Create attachments directory
      const targetDir = path.join(
        process.cwd(),
        'uploads/proforma/attachments',
      );
      await fs.mkdir(targetDir, { recursive: true });

      // Generate unique filename
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 8);
      const fileExt = path.extname(file.originalname);
      const baseName = path.basename(file.originalname, fileExt);
      const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9]/g, '_');
      const newFilename = `${timestamp}_${randomString}_${sanitizedBaseName}${fileExt}`;
      const targetPath = path.join(targetDir, newFilename);

      // Save file
      await fs.copyFile(file.path, targetPath);
      await fs.unlink(file.path).catch(() => {});

      const fileUrl = `/uploads/proforma/attachments/${newFilename}`;

      // Create attachment record in database
      const attachment = await prisma.attachment.create({
        data: {
          proformaInvoiceId: invoiceId,
          fileUrl,
        },
      });

      attachments.push(attachment);
    }

    // 4. Return the created attachments
    return {
      success: true,
      message: `Successfully added ${attachments.length} attachment(s)`,
      attachments,
      invoiceId,
    };
  } catch (error) {
    console.error('Error adding attachments:', error);
    throw error;
  }
};

module.exports = {
  addProformaInvoiceAttachment,
  createProformaInvoice,
  updateProformaInvoice,
  updateProformaInvoiceseco,
  deleteProformaInvoice,
  getAllProformaInvoices,
  getProformaInvoiceById,
  getProformaInvoiceByPInumber,
  updateProformaInvoiceStatus,
  addPayment,
  getAllProformaInvoicesmy,
  updateProformaInvoiceAdditionalQuantity,
};
