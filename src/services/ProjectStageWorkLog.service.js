/* eslint-disable no-nested-ternary */
/* eslint-disable no-restricted-syntax */
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');
const reschedule = require('./scheduling/reschedule');

// Create ProjectStage Work Log
const createProjectStageWorkLog = async (workLogData) => {
  try {
    // Fix: Extract data from the nested structure
    const data = workLogData.workLog || workLogData;
    const { projectStageId, doneUnits, note, hours } = data;
    const doneById = workLogData.doneById || data.doneById;

    // Validate required fields
    if (!projectStageId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Project stage ID is required',
      );
    }

    if (doneUnits === undefined || doneUnits === null) {
      console.error('❌ doneUnits is undefined or null');
      throw new ApiError(httpStatus.BAD_REQUEST, 'Done units are required');
    }

    // Check if project stage exists and get project info
    const projectStage = await prisma.projectStage.findUnique({
      where: { id: projectStageId },
      include: {
        project: {
          include: {
            stages: {
              orderBy: {
                stage: 'asc',
              },
            },
            invoice: {
              include: {
                items: {
                  include: {
                    item: true, // ✅ Include the linked item
                    proformaItemMaterials: {
                      include: {
                        material: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!projectStage) {
      console.error('❌ Project stage not found:', projectStageId);
      throw new ApiError(httpStatus.NOT_FOUND, 'Project stage not found');
    }

    // Check if stage is already finished/completed
    if (projectStage.finished === true || projectStage.status === 'COMPLETED') {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cannot add work log to a finished or completed stage',
      );
    }

    // Validate doneUnits is a positive number (allow float)
    const parsedDoneUnits = parseFloat(doneUnits);

    if (isNaN(parsedDoneUnits) || parsedDoneUnits <= 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Done units must be a positive number',
      );
    }

    // REMOVED ROUNDING - keep exact value
    const exactDoneUnits = parsedDoneUnits; // Use as-is, no rounding

    // Validate doneById if provided
    if (doneById) {
      console.log('🔎 Validating user:', doneById);
      const user = await prisma.user.findUnique({
        where: { id: doneById },
      });

      if (!user) {
        console.error('❌ User not found:', doneById);
        throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
      }
    }

    // Use transaction with proper locking
    const result = await prisma.$transaction(
      async (tx) => {
        // Get current work logs WITH lock
        const currentWorkLogs = await tx.projectStageWorkLog.findMany({
          where: { projectStageId },
          select: { doneUnits: true },
        });

        // Calculate total logged units (sum of floats)
        let totalLoggedUnits = 0;
        for (let i = 0; i < currentWorkLogs.length; i++) {
          const logValue = parseFloat(currentWorkLogs[i].doneUnits);
          console.log(
            `  Log ${i + 1}: ${logValue} (from ${
              currentWorkLogs[i].doneUnits
            })`,
          );
          totalLoggedUnits += logValue;
        }

        // Get planned work units (convert to float if needed)
        const plannedWorkUnits = parseFloat(
          projectStage.workUnits || projectStage.capacityDays || 0,
        );

        // Calculate new total with exact precision
        const newTotalActualUnits = totalLoggedUnits + exactDoneUnits;

        // Check capacity with small epsilon for floating point comparison
        const epsilon = 0.000001; // Increased precision for small values
        const exceedsCapacity =
          newTotalActualUnits > plannedWorkUnits + epsilon;

        if (exceedsCapacity) {
          const remaining = plannedWorkUnits - totalLoggedUnits;

          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Cannot add ${exactDoneUnits.toFixed(
              6,
            )} units. Only ${remaining.toFixed(
              6,
            )} units remaining out of ${plannedWorkUnits} total planned units`,
          );
        }

        const parsedHours =
          hours === undefined || hours === null || hours === ''
            ? null
            : parseFloat(hours);
        const workLog = await tx.projectStageWorkLog.create({
          data: {
            projectStageId,
            doneUnits: exactDoneUnits, // Store exact value, no rounding
            hours: Number.isNaN(parsedHours) ? null : parsedHours,
            doneById: doneById || null,
            note: note ? note.trim() : null,
          },
          include: {
            projectStage: true,
            doneBy: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        });

        let updatedProjectStage = null;
        let isFinished = false;

        // Check if stage is finished (allow for floating point precision)
        const isComplete = newTotalActualUnits >= plannedWorkUnits - epsilon;

        if (isComplete) {
          // ===== STEP 1: GET ALL CAPACITY ALLOCATIONS =====
          console.log('🔍 Fetching capacity allocations for finished stage...');
          const stageAllocations =
            await tx.projectStageCapacityAllocation.findMany({
              where: { projectStageId },
              include: {
                dailyStageCapacity: true,
                projectStage: {
                  include: {
                    project: true,
                  },
                },
              },
            });

          // ===== STEP 2: SUBTRACT ALLOCATED CAPACITY FROM DAILY CAPACITIES =====
          let totalFreedUnits = 0;
          let totalFreedHours = 0;
          const allocationDetails = [];

          for (const allocation of stageAllocations) {
            const dateStr = allocation.allocationDate
              .toISOString()
              .split('T')[0];
            console.log(`\n🔄 Processing allocation from ${dateStr}:`);
            console.log(`  Allocated Units: ${allocation.allocatedUnits}`);
            console.log(`  Allocated Hours: ${allocation.allocatedHours}`);
            console.log(
              `  Current Daily UsedCapacity: ${allocation.dailyStageCapacity.usedCapacity}`,
            );

            // Update daily capacity - subtract the allocation
            await tx.dailyStageCapacity.update({
              where: { id: allocation.dailyStageCapacityId },
              data: {
                usedCapacity: {
                  decrement: allocation.allocatedUnits,
                },
                usedHours: {
                  decrement: allocation.allocatedHours,
                },
              },
            });

            totalFreedUnits += allocation.allocatedUnits;
            totalFreedHours += allocation.allocatedHours;

            allocationDetails.push({
              date: dateStr,
              allocatedUnits: allocation.allocatedUnits,
              allocatedHours: allocation.allocatedHours,
              previousUsedCapacity: allocation.dailyStageCapacity.usedCapacity,
              newUsedCapacity:
                allocation.dailyStageCapacity.usedCapacity -
                allocation.allocatedUnits,
              shift: allocation.shift,
            });

            // Verify the update
            const updatedDaily = await tx.dailyStageCapacity.findUnique({
              where: { id: allocation.dailyStageCapacityId },
            });
            console.log(
              `  ✅ Updated Daily UsedCapacity: ${updatedDaily.usedCapacity} (freed ${allocation.allocatedUnits} units)`,
            );
          }

          // ===== STEP 3: CREATE COMPREHENSIVE LOG =====

          // Get project and stage info
          const projectStageInfo = await tx.projectStage.findUnique({
            where: { id: projectStageId },
            include: {
              project: true,
            },
          });

          // Create a structured log entry with JSON data
          const logData = {
            stage: projectStageInfo.stage,
            projectId: projectStageInfo.projectId,
            projectName:
              projectStageInfo.project.name ||
              projectStageInfo.project.projectNumber,
            totalUnitsFreed: totalFreedUnits,
            totalHoursFreed: totalFreedHours,
            allocationsCount: stageAllocations.length,
            allocations: allocationDetails,
            completedAt: new Date().toISOString(),
            completedBy: doneById || null,
            actualWorkUnits: newTotalActualUnits,
            plannedWorkUnits,
          };

          // Create main log entry
          // Create main log entry with separate JSON field
          const mainLogAction = `STAGE_COMPLETED: ${
            projectStageInfo.stage
          } - Freed ${totalFreedUnits.toFixed(2)} units capacity from ${
            stageAllocations.length
          } day(s)`;

          const capacityLog = await tx.log.create({
            data: {
              action: mainLogAction,
              details: logData, // Store full details as JSON
              userId: doneById || null,
            },
          });

          // Optional: Create summary log entry for the project
          const summaryLogAction = `PROJECT_UPDATE: Project "${
            projectStageInfo.project.name ||
            projectStageInfo.project.projectNumber
          }" - Stage "${
            projectStageInfo.stage
          }" completed. Total capacity freed: ${totalFreedUnits.toFixed(
            2,
          )} units over ${stageAllocations.length} days.`;

          await tx.log.create({
            data: {
              action: summaryLogAction,
              userId: doneById || null,
            },
          });

          // ===== STEP 4: DELETE ALLOCATION RECORDS =====
          const deletedCount =
            await tx.projectStageCapacityAllocation.deleteMany({
              where: { projectStageId },
            });

          // ===== STEP 5: CREATE DELETE CONFIRMATION LOG =====
          const deleteLogAction = `DELETED_ALLOCATIONS: Removed ${
            deletedCount.count
          } capacity allocation records for completed stage "${
            projectStageInfo.stage
          }" (Project: ${
            projectStageInfo.project.name ||
            projectStageInfo.project.projectNumber
          })`;

          await tx.log.create({
            data: {
              action: deleteLogAction,
              userId: doneById || null,
            },
          });

          // ===== STEP 6: UPDATE STAGE STATUS =====
          isFinished = true;
          updatedProjectStage = await tx.projectStage.update({
            where: { id: projectStageId },
            data: {
              finished: true,
              status: 'COMPLETED',
              endDate: new Date(),
              actualWorkUnits: newTotalActualUnits,
            },
          });
        } else {
          // Stage not finished yet, just update actual work units
          const progressPercent =
            (newTotalActualUnits / plannedWorkUnits) * 100;
          console.log(
            `📝 Updating actual work units only... Progress: ${progressPercent.toFixed(
              6,
            )}%`,
          );
          console.log(`   New actual units: ${newTotalActualUnits.toFixed(6)}`);

          await tx.projectStage.update({
            where: { id: projectStageId },
            data: {
              actualWorkUnits: newTotalActualUnits,
            },
          });
          console.log('✅ Actual work units updated successfully');
        }

        // ===== UPDATE PROJECT STATUS IF STAGE IS FINISHED =====
        let updatedProject = null;
        const nextStage = null;
        const stockUpdateResults = [];

        if (isFinished) {
          // ===== HANDLE ITEM STOCK UPDATE FOR FINISHING STAGE =====
          if (projectStage.stage === 'FINISHING') {
            const proformaInvoice = projectStage.project.invoice;

            if (proformaInvoice && proformaInvoice.store === true) {
              // ✅ Get the store from the invoice (assuming storeId is linked)
              // You need to add storeId to ProformaInvoice model or get store from somewhere
              // For now, let's find the main store
              const mainStore = await tx.store.findFirst({
                where: { isMain: true },
              });

              if (!mainStore) {
                console.log(
                  '⚠️ No main store found! Cannot update stock without main store.',
                );
                console.log('  💡 Please configure a main store first.');
              } else {
                console.log(
                  `🏪 Found main store: ${mainStore.name} (ID: ${mainStore.id})`,
                );

                const invoiceItems = proformaInvoice.items;

                const piNumber = proformaInvoice.piNumber || 'N/A';
                const customerName =
                  projectStage.project.customerName ||
                  projectStage.project.customer?.name ||
                  projectStage.project.name ||
                  projectStage.project.projectNumber ||
                  'Unknown customer';

                const stockUpdatePromises = invoiceItems.map(
                  async (invoiceItem) => {
                    // ✅ Use the item relation directly since we have itemId in ProformaInvoiceItem
                    const { item } = invoiceItem;

                    if (!item) {
                      console.error(
                        `  ❌ No item linked to invoice item ${invoiceItem.id}`,
                      );
                      console.log(
                        `  💡 Make sure to select an item when creating the proforma invoice`,
                      );
                      return null;
                    }

                    // Check if item stock record exists for the MAIN store
                    let itemStock = await tx.itemStock.findFirst({
                      where: {
                        itemId: item.id,
                        storeId: mainStore.id, // ✅ Only update stock for main store
                      },
                    });

                    const quantityToAdd = invoiceItem.quantity;

                    if (!itemStock) {
                      itemStock = await tx.itemStock.create({
                        data: {
                          itemId: item.id,
                          storeId: mainStore.id, // ✅ Link to main store
                          quantity: quantityToAdd,
                        },
                      });
                    } else {
                      const oldQuantity = itemStock.quantity;

                      itemStock = await tx.itemStock.update({
                        where: { id: itemStock.id },
                        data: {
                          quantity: { increment: quantityToAdd },
                        },
                      });
                    }

                    // Create stock ledger entry for MAIN store
                    const stockLedger = await tx.itemStockLedger.create({
                      data: {
                        itemId: item.id,
                        storeId: mainStore.id, // ✅ Link to main store
                        movementType: 'IN',
                        quantity: quantityToAdd,
                        reference: `Stock added from proforma invoice ${piNumber} - Customer: ${customerName}  `,
                        notes: `Stock added from proforma invoice`,
                        userId: doneById || null,
                      },
                    });

                    return {
                      itemId: item.id,
                      itemName: item.name,
                      storeName: mainStore.name,
                      quantityAdded: quantityToAdd,
                      newStockLevel: itemStock.quantity,
                    };
                  },
                );

                const stockUpdateResultsFromInvoice = (
                  await Promise.all(stockUpdatePromises)
                ).filter(Boolean);
                stockUpdateResults.push(...stockUpdateResultsFromInvoice);

                console.log(
                  `\n✅ Item stock update completed for main store! Updated ${stockUpdateResults.length} item records`,
                );
              }
            } else {
              console.log(
                '⚠️ Proforma invoice does NOT have store: true - Skipping item stock update',
              );
              if (!proformaInvoice) {
                console.log('  ❌ No proforma invoice found for this project');
              } else {
                console.log(`  ❌ store flag is: ${proformaInvoice.store}`);
              }
            }
          }
          // Get all stages for this project
          const allStages = await tx.projectStage.findMany({
            where: { projectId: projectStage.projectId },
            orderBy: { stage: 'asc' },
          });

          // Define stage order
          const stageOrder = [
            'INVOICE',
            'DESIGN',
            'PURCHASING',
            'METAL_WORKS',
            'CNC',
            'CUTTING',
            'EDGE_BANDING',
            'ASSEMBLY',
            'PAINTING',
            'FINISHING',
            'DELIVERY',
            'INSTALLATION',
          ];

          // Find current stage index
          const currentStageIndex = stageOrder.indexOf(projectStage.stage);

          // Find the next incomplete stage
          let nextStage = null;
          let hasIncompleteFutureStage = false;

          for (let i = currentStageIndex + 1; i < stageOrder.length; i++) {
            const stageName = stageOrder[i];
            const stageObj = allStages.find((s) => s.stage === stageName);

            if (stageObj && !stageObj.finished) {
              nextStage = stageObj;
              hasIncompleteFutureStage = true;
              break;
            }
          }

          // Check if this is the last stage in the project's stage list
          const projectStageNames = allStages.map((s) => s.stage);
          const lastProjectStage =
            projectStageNames[projectStageNames.length - 1];
          const isLastStageInProject = projectStage.stage === lastProjectStage;

          // Update project status
          let newProjectStatus = null;

          if (isLastStageInProject && isFinished) {
            // This is the final stage for this project
            newProjectStatus = 'COMPLETED';
            console.log('🏁 PROJECT COMPLETED! Final stage finished.');
          } else if (nextStage) {
            // Move to next stage
            newProjectStatus = nextStage.stage;
          } else {
            // Fallback: no next stage found
            newProjectStatus = 'COMPLETED';
            console.log('🏁 PROJECT COMPLETED! No more stages.');
          }

          // Update the project
          updatedProject = await tx.project.update({
            where: { id: projectStage.projectId },
            data: {
              status: newProjectStatus,
              ...(newProjectStatus === 'COMPLETED'
                ? {
                    finalDelivery: new Date(),
                    completedAt: new Date(),
                  }
                : {}),
            },
          });

          // Also update designStatus if DESIGN stage is finished
          if (projectStage.stage === 'DESIGN' && isFinished) {
            await tx.project.update({
              where: { id: projectStage.projectId },
              data: {
                designStatus: 'FINISHED',
                designFinished: new Date(),
              },
            });
            console.log('✅ Design status updated to FINISHED');
          }
        }

        return {
          workLog,
          stageFinished: isFinished,
          plannedUnits: plannedWorkUnits,
          actualUnits: newTotalActualUnits,
          isExactMatch:
            Math.abs(newTotalActualUnits - plannedWorkUnits) < epsilon,
          projectUpdated: updatedProject,
          nextStage,
          stockUpdateResults,
        };
      },
      {
        timeout: 10000,
        isolationLevel: 'Serializable',
      },
    );

    if (result.stockUpdateResults && result.stockUpdateResults.length > 0) {
      console.log('📦 Item stock update details:');
      result.stockUpdateResults.forEach((update, idx) => {
        console.log(
          `  ${idx + 1}. Item ${update.itemName}: +${
            update.quantityAdded
          } units (new stock: ${update.newStockLevel})`,
        );
      });
    }

    // Build success message with proper formatting
    let successMessage = 'Work log added successfully';
    if (result.stageFinished) {
      if (result.nextStage) {
        successMessage = `✅ Stage "${
          projectStage.stage
        }" finished! Project moved to "${
          result.nextStage.stage
        }" stage. Progress: ${result.actualUnits.toFixed(
          4,
        )}/${result.plannedUnits.toFixed(4)} units`;

        if (
          projectStage.stage === 'FINISHING' &&
          result.stockUpdateResults?.length > 0
        ) {
          successMessage += `\n📦 Item stock updated: ${result.stockUpdateResults.length} item(s) added to inventory.`;
        }
      } else {
        successMessage = `✅ Stage "${
          projectStage.stage
        }" finished! All stages complete! Project completed. Progress: ${result.actualUnits.toFixed(
          4,
        )}/${result.plannedUnits.toFixed(4)} units`;
      }
    } else {
      const percentComplete = (result.actualUnits / result.plannedUnits) * 100;
      successMessage = `Work log added successfully (Progress: ${result.actualUnits.toFixed(
        4,
      )}/${result.plannedUnits.toFixed(4)} units, ${percentComplete.toFixed(
        4,
      )}%)`;
    }

    // Post-commit cascade: when a stage completes, free its unused future
    // capacity and reschedule downstream stages from the real completion moment,
    // then refresh the project's delivery date. Best-effort — a failure here must
    // never undo the work log that already committed.
    if (result.stageFinished) {
      try {
        await reschedule.onStageCompleted(
          projectStage.projectId,
          projectStage.stage,
        );
        console.log('🔁 Downstream reschedule + delivery recompute done');
      } catch (cascadeErr) {
        console.error(
          '⚠️ reschedule cascade failed (work log still saved):',
          cascadeErr.message,
        );
      }
    }

    return {
      workLog: result.workLog,
      stageFinished: result.stageFinished,
      isExactMatch: result.isExactMatch,
      plannedUnits: result.plannedUnits,
      actualUnits: result.actualUnits,
      nextStage: result.nextStage,
      projectStatus: result.projectUpdated?.status,
      stockUpdates: result.stockUpdateResults || [],
      message: successMessage,
    };
  } catch (error) {
    console.error('❌ ===== ERROR in createProjectStageWorkLog =====');
    console.error('❌ Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code,
      meta: error.meta,
    });
    console.error(
      '❌ Original workLogData that caused error:',
      JSON.stringify(workLogData, null, 2),
    );
    throw error;
  }
};

// Delete Project Stage Work Log
// Delete Project Stage Work Log
const deleteProjectStageWorkLog = async (id) => {
  console.log('🔍 deleteProjectStageWorkLog called with ID:', id);

  try {
    // Check if work log exists and get project stage details
    const existingWorkLog = await prisma.projectStageWorkLog.findUnique({
      where: { id },
      include: {
        projectStage: {
          include: {
            projectStageWorkLogs: {
              select: { doneUnits: true },
            },
          },
        },
      },
    });

    if (!existingWorkLog) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        'Project stage work log not found',
      );
    }

    const { projectStage } = existingWorkLog;
    const deletedUnits = existingWorkLog.doneUnits;

    console.log('📊 Found work log to delete:', {
      id: existingWorkLog.id,
      doneUnits: deletedUnits,
      projectStageId: projectStage.id,
      currentActualWorkUnits: projectStage.actualWorkUnits,
      currentStatus: projectStage.status,
      finished: projectStage.finished,
    });

    // Use transaction to ensure data consistency
    const result = await prisma.$transaction(
      async (tx) => {
        // Delete the work log
        console.log('🗑️ Deleting work log...');
        await tx.projectStageWorkLog.delete({
          where: { id },
        });
        console.log('✅ Work log deleted');

        // Get all remaining work logs for this stage
        const remainingWorkLogs = await tx.projectStageWorkLog.findMany({
          where: { projectStageId: projectStage.id },
          select: { doneUnits: true },
        });

        console.log('📊 Remaining work logs count:', remainingWorkLogs.length);

        // Recalculate total actual work units
        const newTotalActualUnits = remainingWorkLogs.reduce(
          (sum, log) => sum + log.doneUnits,
          0,
        );
        console.log('🧮 New total actual units:', newTotalActualUnits);

        const plannedWorkUnits =
          projectStage.workUnits || projectStage.capacityDays || 0;
        console.log('📊 Planned work units:', plannedWorkUnits);

        // Determine if stage should still be marked as finished
        const isFinished = newTotalActualUnits >= plannedWorkUnits;
        const isExactMatch = newTotalActualUnits === plannedWorkUnits;

        console.log('🏁 Stage status check:', {
          isFinished,
          isExactMatch,
          newTotalActualUnits,
          plannedWorkUnits,
        });

        // Update project stage with recalculated actual work units
        let updatedProjectStage;

        if (isFinished) {
          // Stage still completed after deletion
          console.log(
            '📝 Stage remains completed, updating actual units only...',
          );
          updatedProjectStage = await tx.projectStage.update({
            where: { id: projectStage.id },
            data: {
              actualWorkUnits: newTotalActualUnits,
              // Keep finished and status as COMPLETED since it's still finished
            },
          });
        } else {
          // Stage is no longer completed - revert to ACTIVE/IN_PROGRESS
          console.log('🔄 Stage no longer completed, reverting status...');
          updatedProjectStage = await tx.projectStage.update({
            where: { id: projectStage.id },
            data: {
              actualWorkUnits: newTotalActualUnits,
              finished: false, // Remove finished flag
              status: 'ACTIVE', // Revert to ACTIVE or IN_PROGRESS based on your logic
              endDate: null, // Remove end date since stage is not completed
            },
          });
        }

        console.log('✅ Project stage updated:', {
          id: updatedProjectStage.id,
          actualWorkUnits: updatedProjectStage.actualWorkUnits,
          finished: updatedProjectStage.finished,
          status: updatedProjectStage.status,
          endDate: updatedProjectStage.endDate,
        });

        return {
          updatedStage: updatedProjectStage,
          newTotalActualUnits,
          wasFinishedBeforeDeletion: projectStage.finished,
          isStillFinished: isFinished,
        };
      },
      {
        timeout: 10000,
        isolationLevel: 'Serializable',
      },
    );

    console.log('🎉 Work log deletion completed successfully:', {
      deletedUnits,
      newTotalActualUnits: result.newTotalActualUnits,
      wasFinishedBeforeDeletion: result.wasFinishedBeforeDeletion,
      isStillFinished: result.isStillFinished,
    });

    return {
      message:
        result.wasFinishedBeforeDeletion && !result.isStillFinished
          ? 'Work log deleted successfully. Stage status has been reverted from COMPLETED to ACTIVE.'
          : 'Project stage work log deleted successfully',
      deletedWorkLog: {
        id: existingWorkLog.id,
        projectStageId: existingWorkLog.projectStageId,
        doneUnits: existingWorkLog.doneUnits,
      },
      updatedStage: {
        id: result.updatedStage.id,
        actualWorkUnits: result.updatedStage.actualWorkUnits,
        finished: result.updatedStage.finished,
        status: result.updatedStage.status,
        endDate: result.updatedStage.endDate,
      },
    };
  } catch (error) {
    console.error('❌ Error in deleteProjectStageWorkLog:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code,
      meta: error.meta,
    });
    throw error;
  }
};

module.exports = {
  createProjectStageWorkLog,
  deleteProjectStageWorkLog,
};
