/* eslint-disable no-nested-ternary */
/* eslint-disable no-restricted-syntax */
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');
const reschedule = require('./scheduling/reschedule');

/**
 * Midnight of `date`, matching the day granularity `releaseStageCapacity` uses
 * for its cutoff — so the audit log reports exactly the allocations that the
 * release actually freed.
 */
const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

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
        // Include work logs to check if this is the first one
        projectStageWorkLogs: {
          orderBy: {
            createdAt: 'asc',
          },
          take: 1,
        },
      },
    });

    if (!projectStage) {
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
      const user = await prisma.user.findUnique({
        where: { id: doneById },
      });

      if (!user) {
        throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
      }
    }

    // Check if this is the first work log for this stage
    const isFirstWorkLog = projectStage.projectStageWorkLogs.length === 0;

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
          totalLoggedUnits += logValue;
        }

        // Get planned work units (convert to float if needed)
        const plannedWorkUnits = parseFloat(projectStage.workUnits || 0);

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

        // ===== SET PROJECT START DATE ON FIRST WORK LOG =====
        // If this is the first work log, set the project start date
        if (isFirstWorkLog) {
          const now = new Date();

          // Update the project stage with start dates
          updatedProjectStage = await tx.projectStage.update({
            where: { id: projectStageId },
            data: {
              projectstartDate: now,
            },
          });

          // Create a log entry for the project start
          await tx.log.create({
            data: {
              action: `PROJECT_START: Stage "${
                projectStage.stage
              }" started for project "${
                projectStage.project.name || projectStage.project.projectNumber
              }"`,
              userId: doneById || null,
              details: {
                stage: projectStage.stage,
                projectId: projectStage.projectId,
                projectName:
                  projectStage.project.name ||
                  projectStage.project.projectNumber,
                startedAt: now.toISOString(),
                startedBy: doneById || null,
              },
            },
          });
        }

        // Check if stage is finished (allow for floating point precision)
        const isComplete = newTotalActualUnits >= plannedWorkUnits - epsilon;

        if (isComplete) {
          // ===== STEP 1: GET ALL CAPACITY ALLOCATIONS (for the audit log) =====
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

          // ===== STEP 2: RELEASE FUTURE CAPACITY ONLY =====
          const completionInstant = new Date();
          const releasedFrom = completionInstant;

          const totalFreedUnits = stageAllocations
            .filter(
              (a) => new Date(a.allocationDate) >= startOfDay(releasedFrom),
            )
            .reduce((sum, a) => sum + (a.allocatedUnits || 0), 0);
          const totalFreedHours = stageAllocations
            .filter(
              (a) => new Date(a.allocationDate) >= startOfDay(releasedFrom),
            )
            .reduce((sum, a) => sum + (a.allocatedHours || 0), 0);
          const allocationDetails = stageAllocations.map((a) => ({
            date: a.allocationDate.toISOString().split('T')[0],
            allocatedUnits: a.allocatedUnits,
            allocatedHours: a.allocatedHours,
            previousUsedCapacity: a.dailyStageCapacity.usedCapacity,
            released: new Date(a.allocationDate) >= startOfDay(releasedFrom),
            shift: a.shift,
          }));

          await reschedule.releaseStageCapacity(
            projectStageId,
            completionInstant,
            tx,
          );

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
          const mainLogAction = `STAGE_COMPLETED: ${
            projectStageInfo.stage
          } - Freed ${totalFreedUnits.toFixed(2)} units capacity from ${
            stageAllocations.length
          } day(s)`;

          const capacityLog = await tx.log.create({
            data: {
              action: mainLogAction,
              details: logData,
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

          // ===== UPDATE STAGE STATUS =====
          isFinished = true;
          updatedProjectStage = await tx.projectStage.update({
            where: { id: projectStageId },
            data: {
              finished: true,
              status: 'COMPLETED',
              projectendDate: new Date(),
              actualWorkUnits: newTotalActualUnits,
            },
          });
        } else {
          // Stage not finished yet, just update actual work units
          const progressPercent =
            (newTotalActualUnits / plannedWorkUnits) * 100;

          // If the stage hasn't started yet, set the start date
          const stageUpdateData = {
            actualWorkUnits: newTotalActualUnits,
          };

          // Add start date if this is the first work log and it wasn't set above
          if (isFirstWorkLog && !updatedProjectStage) {
            stageUpdateData.projectstartDate = new Date();
            stageUpdateData.startDateTime = new Date();
          }

          await tx.projectStage.update({
            where: { id: projectStageId },
            data: stageUpdateData,
          });
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
              const mainStore = await tx.store.findFirst({
                where: { isMain: true },
              });

              if (!mainStore) {
                console.log(
                  '⚠️ No main store found! Cannot update stock without main store.',
                );
              } else {
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
                    const { item } = invoiceItem;

                    if (!item) {
                      console.log(
                        `  💡 Make sure to select an item when creating the proforma invoice`,
                      );
                      return null;
                    }

                    // Check if item stock record exists for the MAIN store
                    let itemStock = await tx.itemStock.findFirst({
                      where: {
                        itemId: item.id,
                        storeId: mainStore.id,
                      },
                    });

                    const quantityToAdd = invoiceItem.quantity;

                    if (!itemStock) {
                      itemStock = await tx.itemStock.create({
                        data: {
                          itemId: item.id,
                          storeId: mainStore.id,
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
                        storeId: mainStore.id,
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
          } else if (nextStage) {
            // Move to next stage
            newProjectStatus = nextStage.stage;
          } else {
            // Fallback: no next stage found
            newProjectStatus = 'COMPLETED';
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
          isFirstWorkLog,
        };
      },
      {
        timeout: 10000,
        isolationLevel: 'Serializable',
      },
    );

    if (result.stockUpdateResults && result.stockUpdateResults.length > 0) {
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

    // Add note about project start if this is the first work log
    if (result.isFirstWorkLog) {
      successMessage += ' - Project started';
    }

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

    // Post-commit cascade: reschedule downstream stages from the real completion
    // moment and refresh the project's delivery date.
    let cascadeWarning = null;
    if (result.stageFinished) {
      try {
        await reschedule.onStageCompleted(
          projectStage.projectId,
          projectStage.stage,
        );
      } catch (cascadeErr) {
        cascadeWarning = `The stage was saved, but downstream stages could not be rescheduled: ${cascadeErr.message}. The project's delivery date may be out of date — re-run scheduling for this project.`;
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
      cascadeWarning,
      isFirstWorkLog: result.isFirstWorkLog,
      message: successMessage,
    };
  } catch (error) {
    console.error(
      '❌ Original workLogData that caused error:',
      JSON.stringify(workLogData, null, 2),
    );
    console.error(error);
    throw error;
  }
};

// Delete Project Stage Work Log
// Delete Project Stage Work Log
const deleteProjectStageWorkLog = async (id) => {
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

    // Use transaction to ensure data consistency
    const result = await prisma.$transaction(
      async (tx) => {
        // Delete the work log
        await tx.projectStageWorkLog.delete({
          where: { id },
        });

        // Get all remaining work logs for this stage
        const remainingWorkLogs = await tx.projectStageWorkLog.findMany({
          where: { projectStageId: projectStage.id },
          select: { doneUnits: true },
        });

        // Recalculate total actual work units
        const newTotalActualUnits = remainingWorkLogs.reduce(
          (sum, log) => sum + log.doneUnits,
          0,
        );

        const plannedWorkUnits = projectStage.workUnits || 0;

        // Determine if stage should still be marked as finished
        const isFinished = newTotalActualUnits >= plannedWorkUnits;
        const isExactMatch = newTotalActualUnits === plannedWorkUnits;

        // Update project stage with recalculated actual work units
        let updatedProjectStage;

        if (isFinished) {
          // Stage still completed after deletion

          updatedProjectStage = await tx.projectStage.update({
            where: { id: projectStage.id },
            data: {
              actualWorkUnits: newTotalActualUnits,
              // Keep finished and status as COMPLETED since it's still finished
            },
          });
        } else {
          // Stage is no longer completed - revert to ACTIVE/IN_PROGRESS
          updatedProjectStage = await tx.projectStage.update({
            where: { id: projectStage.id },
            data: {
              actualWorkUnits: newTotalActualUnits,
              finished: false, // Remove finished flag
              status: 'ACTIVE', // Revert to ACTIVE or IN_PROGRESS based on your logic
            },
          });
        }

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
