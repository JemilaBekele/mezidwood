const prisma = require('./prisma');

// Additional helper function to check if design is finished for a project
const isDesignFinished = async (projectId) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        stages: {
          where: {
            stage: 'DESIGN',
          },
        },
      },
    });

    if (!project) return false;

    // Check design completion through multiple indicators
    const hasDesignStage = project.stages.length > 0;
    const designStage = project.stages[0];

    const isDesignFinishedViaStatus = project.designStatus === 'FINISHED';
    const isDesignFinishedViaDate = project.designFinished !== null;
    const isDesignStageFinished =
      designStage &&
      (designStage.finished === true || designStage.status === 'COMPLETED');

    return (
      isDesignFinishedViaStatus ||
      isDesignFinishedViaDate ||
      isDesignStageFinished
    );
  } catch (error) {
    console.error('Error checking design finished status:', error);
    return false;
  }
};
const getDesignProjects = async (status = 'all') => {
  try {
    // Get all projects that have DESIGN stage
    const projectsWithDesign = await prisma.project.findMany({
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        invoice: {
          select: {
            id: true,
            piNumber: true,
            total: true,
            status: true,
          },
        },
        stages: {
          orderBy: {
            stage: 'asc',
          },
          select: {
            id: true,
            stage: true,
            capacityDays: true,
            workUnits: true,
            actualWorkUnits: true,
            finished: true,
            startDate: true,
            endDate: true,
            autoSchedule: true,
            status: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    console.log('Raw projects from DB:', projectsWithDesign.length);
    console.log(
      'First project sample:',
      JSON.stringify(projectsWithDesign[0], null, 2),
    );

    // Filter by design status only (finished/not-finished)
    let eligibleProjects = projectsWithDesign;

    if (status !== 'all') {
      eligibleProjects = projectsWithDesign.filter((project) => {
        const designStage = project.stages.find(
          (stage) => stage.stage === 'DESIGN',
        );

        if (status === 'finished') {
          return designStage && designStage.finished === true;
        }

        if (status === 'not-finished') {
          return designStage && designStage.finished !== true;
        }

        return true;
      });
    }

    console.log('Filtered projects:', eligibleProjects.length);

    return {
      projects: eligibleProjects,
      count: eligibleProjects.length,
      total: projectsWithDesign.length,
    };
  } catch (error) {
    console.error('Error fetching design projects:', error);
    return {
      projects: [],
      count: 0,
      total: 0,
      error: error.message,
    };
  }
};
const getbyDesignProject = async (status = 'all', currentUserId) => {
  try {
    // Validate currentUserId
    if (!currentUserId) {
      throw new Error('Current user ID is required');
    }

    // Get projects where the current user is assigned as designer
    const projectsWithDesign = await prisma.project.findMany({
      where: {
        designById: currentUserId, // Only projects where this user is the designer
        stages: {
          some: {
            stage: 'DESIGN', // Ensure they have a DESIGN stage
          },
        },
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone1: true,
          },
        },
        invoice: {
          select: {
            id: true,
            piNumber: true,
            total: true,
            status: true,
            createdAt: true,
          },
        },
        stages: {
          orderBy: {
            stage: 'asc',
          },
          select: {
            id: true,
            stage: true,
            capacityDays: true,
            workUnits: true,
            actualWorkUnits: true,
            finished: true,
            startDate: true,
            endDate: true,
            autoSchedule: true,
            status: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        designBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        projectLogs: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 5, // Get recent logs
          select: {
            id: true,
            note: true,
            createdAt: true,
            createdBy: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc', // Show newest first
      },
    });

    // Double-check filter - ensure no projects from other designers
    const verifiedProjects = projectsWithDesign.filter(
      (project) => project.designById === currentUserId,
    );

    if (verifiedProjects.length !== projectsWithDesign.length) {
      console.warn(
        `Filtered out ${
          projectsWithDesign.length - verifiedProjects.length
        } projects that didn't match designer ID`,
      );
    }

    console.log('Raw projects from DB for designer:', verifiedProjects.length);

    if (verifiedProjects.length > 0) {
      console.log(
        'First project sample:',
        JSON.stringify(verifiedProjects[0], null, 2),
      );
    }

    // Filter by design stage completion status
    let eligibleProjects = verifiedProjects;

    if (status !== 'all') {
      eligibleProjects = verifiedProjects.filter((project) => {
        const designStage = project.stages.find(
          (stage) => stage.stage === 'DESIGN',
        );

        if (status === 'finished') {
          return designStage && designStage.finished === true;
        }

        if (status === 'not-finished') {
          return designStage && designStage.finished !== true;
        }

        return true;
      });
    }

    // Add additional metrics
    const projectsWithMetrics = eligibleProjects.map((project) => {
      const designStage = project.stages.find(
        (stage) => stage.stage === 'DESIGN',
      );
      const totalWorkUnits = project.stages.reduce(
        (sum, stage) => sum + (stage.workUnits || 0),
        0,
      );
      const completedWorkUnits = project.stages.reduce(
        (sum, stage) => sum + (stage.actualWorkUnits || 0),
        0,
      );

      return {
        ...project,
        metrics: {
          designStageStatus: designStage?.finished
            ? 'Completed'
            : designStage
            ? 'In Progress'
            : 'Not Started',
          totalWorkUnits,
          completedWorkUnits,
          completionPercentage:
            totalWorkUnits > 0
              ? (completedWorkUnits / totalWorkUnits) * 100
              : 0,
          designProgress: designStage?.finished
            ? 100
            : designStage?.workUnits
            ? ((designStage.actualWorkUnits || 0) / designStage.workUnits) * 100
            : 0,
        },
      };
    });

    console.log('Filtered projects for user:', projectsWithMetrics.length);

    return {
      projects: projectsWithMetrics,
      count: projectsWithMetrics.length,
      total: verifiedProjects.length,
      userId: currentUserId,
    };
  } catch (error) {
    console.error('Error fetching design projects:', error);
    return {
      projects: [],
      count: 0,
      total: 0,
      error: error.message,
    };
  }
};
const getUnassignedDesignProjects = async (status = 'all') => {
  try {
    // Build where condition - only projects with no designer assigned
    const whereCondition = {
      designById: null, // Only projects with no designer assigned
      stages: {
        some: {
          stage: 'DESIGN',
        },
      },
    };

    // Get projects with no designer assigned
    const projectsWithDesign = await prisma.project.findMany({
      where: whereCondition,
      include: {
        customer: true,
        invoice: {
          select: {
            id: true,
            piNumber: true,
            total: true,
            status: true,
            createdAt: true,
          },
        },
        stages: {
          orderBy: {
            stage: 'asc',
          },
          select: {
            id: true,
            stage: true,
            capacityDays: true,
            workUnits: true,
            actualWorkUnits: true,
            finished: true,
            startDate: true,
            endDate: true,
            autoSchedule: true,
            status: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc', // Show newest first
      },
    });

    console.log('Raw unassigned projects from DB:', projectsWithDesign.length);

    // Filter by design stage completion status
    let eligibleProjects = projectsWithDesign;

    if (status !== 'all') {
      eligibleProjects = projectsWithDesign.filter((project) => {
        const designStage = project.stages.find(
          (stage) => stage.stage === 'DESIGN',
        );

        if (status === 'finished') {
          return designStage && designStage.finished === true;
        }

        if (status === 'not-finished') {
          return designStage && designStage.finished !== true;
        }

        return true;
      });
    }

    // Calculate additional metrics for each project
    const projectsWithMetrics = eligibleProjects.map((project) => {
      const designStage = project.stages.find(
        (stage) => stage.stage === 'DESIGN',
      );
      const totalWorkUnits = project.stages.reduce(
        (sum, stage) => sum + (stage.workUnits || 0),
        0,
      );
      const completedWorkUnits = project.stages.reduce(
        (sum, stage) => sum + (stage.actualWorkUnits || 0),
        0,
      );

      return {
        ...project,
        metrics: {
          designStageStatus: designStage?.finished
            ? 'Completed'
            : designStage
            ? 'In Progress'
            : 'Not Started',
          totalWorkUnits,
          completedWorkUnits,
          completionPercentage:
            totalWorkUnits > 0
              ? (completedWorkUnits / totalWorkUnits) * 100
              : 0,
          hasDesignStage: !!designStage,
        },
      };
    });

    console.log('Filtered unassigned projects:', projectsWithMetrics.length);

    return {
      projects: projectsWithMetrics,
      count: projectsWithMetrics.length,
      total: projectsWithDesign.length,
      status, // Return the status filter used
    };
  } catch (error) {
    console.error('Error fetching unassigned design projects:', error);
    return {
      projects: [],
      count: 0,
      total: 0,
      error: error.message,
    };
  }
};
const getPurchasingProjects = async (status = 'all') => {
  try {
    // Get all projects that have PURCHASING stage (no eligibility/prerequisite checks)
    const projectsWithPurchasing = await prisma.project.findMany({
      where: {
        stages: {
          some: {
            stage: 'PURCHASING',
          },
        },
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        invoice: {
          select: {
            id: true,
            piNumber: true,
            total: true,
            status: true,
          },
        },
        stages: {
          orderBy: {
            stage: 'asc',
          },
          select: {
            id: true,
            stage: true,
            capacityDays: true,
            workUnits: true,
            actualWorkUnits: true,
            finished: true,
            startDate: true,
            endDate: true,
            autoSchedule: true,
            status: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc', // Show newest first
      },
    });

    // Filter by purchasing status if specified (no prerequisite checks)
    let eligibleProjects = projectsWithPurchasing;

    if (status !== 'all') {
      eligibleProjects = eligibleProjects.filter((project) => {
        const purchasingStage = project.stages.find(
          (stage) => stage.stage === 'PURCHASING',
        );

        if (status === 'finished') {
          return (
            purchasingStage &&
            (purchasingStage.finished === true ||
              purchasingStage.status === 'COMPLETED')
          );
        }
        if (status === 'not-finished') {
          return (
            purchasingStage &&
            purchasingStage.finished !== true &&
            purchasingStage.status !== 'COMPLETED'
          );
        }

        return true;
      });
    }

    return {
      projects: eligibleProjects,
      count: eligibleProjects.length,
      total: projectsWithPurchasing.length,
    };
  } catch (error) {
    console.error('Error fetching purchasing projects:', error);
    return {
      projects: [],
      count: 0,
      total: 0,
      error: error.message,
    };
  }
};
// Function to get metal work projects with design completion requirement
const getMetalWorkProjects = async (status = 'all') => {
  try {
    // First, get all projects that have METAL_WORKS stage
    const projectsWithMetalWork = await prisma.project.findMany({
      where: {
        stages: {
          some: {
            stage: 'METAL_WORKS',
          },
        },
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        invoice: {
          select: {
            id: true,
            piNumber: true,
            total: true,
            status: true,
          },
        },
        stages: {
          orderBy: {
            stage: 'asc',
          },
          select: {
            id: true,
            stage: true,
            capacityDays: true,
            workUnits: true,
            actualWorkUnits: true,
            finished: true,
            startDate: true,
            endDate: true,
            autoSchedule: true,
            status: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc', // Show newest first
      },
    });

    // Filter projects that have design finished
    const projectsWithDesignFinished = await Promise.all(
      projectsWithMetalWork.map(async (project) => {
        const designFinished = await isDesignFinished(project.id);
        return {
          ...project,
          designFinished,
        };
      }),
    );

    // Only include projects where design is finished
    let eligibleProjects = projectsWithDesignFinished.filter(
      (p) => p.designFinished === true,
    );

    // Further filter by metal work status if specified
    if (status !== 'all') {
      eligibleProjects = eligibleProjects.filter((project) => {
        const metalWorkStage = project.stages.find(
          (stage) => stage.stage === 'METAL_WORKS',
        );

        if (status === 'finished') {
          return (
            metalWorkStage &&
            (metalWorkStage.finished === true ||
              metalWorkStage.status === 'COMPLETED')
          );
        }
        if (status === 'not-finished') {
          return (
            metalWorkStage &&
            metalWorkStage.finished !== true &&
            metalWorkStage.status !== 'COMPLETED'
          );
        }

        return true;
      });
    }

    return {
      projects: eligibleProjects,
      count: eligibleProjects.length,
      total: projectsWithMetalWork.length,
    };
  } catch (error) {
    console.error('Error fetching metal work projects:', error);
    return {
      projects: [],
      count: 0,
      total: 0,
      error: error.message,
    };
  }
};

const getCNCProjects = async (status = 'all') => {
  try {
    // First, get all projects that have CNC stage
    const projectsWithCNC = await prisma.project.findMany({
      where: {
        stages: {
          some: {
            stage: 'CNC',
          },
        },
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        invoice: {
          select: {
            id: true,
            piNumber: true,
            total: true,
            status: true,
          },
        },
        stages: {
          orderBy: {
            stage: 'asc',
          },
          select: {
            id: true,
            stage: true,
            capacityDays: true,
            workUnits: true,
            actualWorkUnits: true,
            finished: true,
            startDate: true,
            endDate: true,
            autoSchedule: true,
            status: true,
            projectStageWorkLogs: {
              select: {
                id: true,
                doneUnits: true,
                note: true,
                createdAt: true,
                doneBy: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc', // Show newest first
      },
    });

    // Filter projects that have design finished
    const projectsWithDesignFinished = await Promise.all(
      projectsWithCNC.map(async (project) => {
        const designFinished = await isDesignFinished(project.id);
        return {
          ...project,
          designFinished,
        };
      }),
    );

    // Only include projects where design is finished
    let eligibleProjects = projectsWithDesignFinished.filter(
      (p) => p.designFinished === true,
    );

    // Further filter by CNC status if specified
    if (status !== 'all') {
      eligibleProjects = eligibleProjects.filter((project) => {
        const cncStage = project.stages.find((stage) => stage.stage === 'CNC');

        if (status === 'finished') {
          return (
            cncStage &&
            (cncStage.finished === true || cncStage.status === 'COMPLETED')
          );
        }
        if (status === 'not-finished') {
          return (
            cncStage &&
            cncStage.finished !== true &&
            cncStage.status !== 'COMPLETED'
          );
        }

        return true;
      });
    }

    // Calculate progress for each CNC stage
    const projectsWithProgress = eligibleProjects.map((project) => {
      const cncStage = project.stages.find((stage) => stage.stage === 'CNC');

      let progress = 0;
      if (cncStage) {
        const plannedUnits = cncStage.workUnits || cncStage.capacityDays || 0;
        const actualUnits = cncStage.actualWorkUnits || 0;
        if (plannedUnits > 0) {
          progress = Math.min((actualUnits / plannedUnits) * 100, 100);
        }
      }

      return {
        ...project,
        cncProgress: progress,
        cncStage: cncStage || null,
      };
    });

    return {
      projects: projectsWithProgress,
      count: eligibleProjects.length,
      total: projectsWithCNC.length,
    };
  } catch (error) {
    console.error('Error fetching CNC projects:', error);
    return {
      projects: [],
      count: 0,
      total: 0,
      error: error.message,
    };
  }
};
const getCuttingProjects = async (status = 'all') => {
  try {
    // First, get all projects that have CUTTING stage
    const projectsWithCutting = await prisma.project.findMany({
      where: {
        stages: {
          some: {
            stage: 'CUTTING',
          },
        },
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        invoice: {
          select: {
            id: true,
            piNumber: true,
            total: true,
            status: true,
          },
        },
        stages: {
          orderBy: {
            stage: 'asc',
          },
          select: {
            id: true,
            stage: true,
            capacityDays: true,
            workUnits: true,
            actualWorkUnits: true,
            finished: true,
            startDate: true,
            endDate: true,
            autoSchedule: true,
            status: true,
            projectStageWorkLogs: {
              select: {
                id: true,
                doneUnits: true,
                note: true,
                createdAt: true,
                doneBy: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc', // Show newest first
      },
    });

    // Filter projects that have design finished
    const projectsWithDesignFinished = await Promise.all(
      projectsWithCutting.map(async (project) => {
        const designFinished = await isDesignFinished(project.id);
        return {
          ...project,
          designFinished,
        };
      }),
    );

    // Only include projects where design is finished
    let eligibleProjects = projectsWithDesignFinished.filter(
      (p) => p.designFinished === true,
    );

    // Further filter by Cutting status if specified
    if (status !== 'all') {
      eligibleProjects = eligibleProjects.filter((project) => {
        const cuttingStage = project.stages.find(
          (stage) => stage.stage === 'CUTTING',
        );

        if (status === 'finished') {
          return (
            cuttingStage &&
            (cuttingStage.finished === true ||
              cuttingStage.status === 'COMPLETED')
          );
        }
        if (status === 'not-finished') {
          return (
            cuttingStage &&
            cuttingStage.finished !== true &&
            cuttingStage.status !== 'COMPLETED'
          );
        }

        return true;
      });
    }

    // Calculate progress for each Cutting stage
    const projectsWithProgress = eligibleProjects.map((project) => {
      const cuttingStage = project.stages.find(
        (stage) => stage.stage === 'CUTTING',
      );

      let progress = 0;
      if (cuttingStage) {
        const plannedUnits =
          cuttingStage.workUnits || cuttingStage.capacityDays || 0;
        const actualUnits = cuttingStage.actualWorkUnits || 0;

        if (plannedUnits > 0) {
          progress = Math.min((actualUnits / plannedUnits) * 100, 100);
        }
      }

      return {
        ...project,
        cuttingProgress: progress,
        cuttingStage: cuttingStage || null,
      };
    });

    return {
      projects: projectsWithProgress,
      count: eligibleProjects.length,
      total: projectsWithCutting.length,
    };
  } catch (error) {
    console.error('Error fetching Cutting projects:', error);
    return {
      projects: [],
      count: 0,
      total: 0,
      error: error.message,
    };
  }
};
const getEdgeBandingProjects = async (status = 'all') => {
  try {
    // First, get all projects that have EDGE_BANDING stage
    const projectsWithEdgeBanding = await prisma.project.findMany({
      where: {
        stages: {
          some: {
            stage: 'EDGE_BANDING',
          },
        },
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        invoice: {
          select: {
            id: true,
            piNumber: true,
            total: true,
            status: true,
          },
        },
        stages: {
          orderBy: {
            stage: 'asc',
          },
          select: {
            id: true,
            stage: true,
            capacityDays: true,
            workUnits: true,
            actualWorkUnits: true,
            finished: true,
            startDate: true,
            endDate: true,
            autoSchedule: true,
            status: true,
            projectStageWorkLogs: {
              select: {
                id: true,
                doneUnits: true,
                note: true,
                createdAt: true,
                doneBy: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc', // Show newest first
      },
    });

    // Filter projects that have design finished
    const projectsWithDesignFinished = await Promise.all(
      projectsWithEdgeBanding.map(async (project) => {
        const designFinished = await isDesignFinished(project.id);
        return {
          ...project,
          designFinished,
        };
      }),
    );

    // Only include projects where design is finished
    let eligibleProjects = projectsWithDesignFinished.filter(
      (p) => p.designFinished === true,
    );

    // Further filter by Edge Banding status if specified
    if (status !== 'all') {
      eligibleProjects = eligibleProjects.filter((project) => {
        const edgeBandingStage = project.stages.find(
          (stage) => stage.stage === 'EDGE_BANDING',
        );

        if (status === 'finished') {
          return (
            edgeBandingStage &&
            (edgeBandingStage.finished === true ||
              edgeBandingStage.status === 'COMPLETED')
          );
        }
        if (status === 'not-finished') {
          return (
            edgeBandingStage &&
            edgeBandingStage.finished !== true &&
            edgeBandingStage.status !== 'COMPLETED'
          );
        }

        return true;
      });
    }

    // Calculate progress for each Edge Banding stage
    const projectsWithProgress = eligibleProjects.map((project) => {
      const edgeBandingStage = project.stages.find(
        (stage) => stage.stage === 'EDGE_BANDING',
      );

      let progress = 0;
      if (edgeBandingStage) {
        const plannedUnits =
          edgeBandingStage.workUnits || edgeBandingStage.capacityDays || 0;
        const actualUnits = edgeBandingStage.actualWorkUnits || 0;

        if (plannedUnits > 0) {
          progress = Math.min((actualUnits / plannedUnits) * 100, 100);
        }
      }

      return {
        ...project,
        edgeBandingProgress: progress,
        edgeBandingStage: edgeBandingStage || null,
      };
    });

    return {
      projects: projectsWithProgress,
      count: eligibleProjects.length,
      total: projectsWithEdgeBanding.length,
    };
  } catch (error) {
    console.error('Error fetching Edge Banding projects:', error);
    return {
      projects: [],
      count: 0,
      total: 0,
      error: error.message,
    };
  }
};

const getAssemblyProjects = async (status = 'all') => {
  try {
    const projectsWithAssembly = await prisma.project.findMany({
      where: {
        stages: {
          some: {
            stage: 'ASSEMBLY',
          },
        },
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        invoice: {
          select: {
            id: true,
            piNumber: true,
            total: true,
            status: true,
          },
        },
        stages: {
          orderBy: {
            stage: 'asc',
          },
          select: {
            id: true,
            stage: true,
            capacityDays: true,
            workUnits: true,
            actualWorkUnits: true,
            finished: true,
            startDate: true,
            endDate: true,
            autoSchedule: true,
            status: true,
            projectStageWorkLogs: {
              select: {
                id: true,
                doneUnits: true,
                note: true,
                createdAt: true,
                doneBy: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },

        createdBy: true,
        updatedBy: true,
      },
      orderBy: {
        createdAt: 'desc', // Show newest first
      },
    });

    const prerequisiteStages = [
      'METAL_WORKS',
      'CNC',
      'CUTTING',
      'EDGE_BANDING',
    ];

    const projectsWithPrerequisitesFinished = await Promise.all(
      projectsWithAssembly.map(async (project) => {
        const designFinished = await isDesignFinished(project.id);

        // Get only the prerequisite stages that actually exist in this project
        const existingPrerequisiteStages = prerequisiteStages.filter(
          (stageName) => project.stages.some((s) => s.stage === stageName),
        );

        // If no prerequisite stages exist, consider it as finished
        const allPrerequisitesFinished =
          existingPrerequisiteStages.length === 0
            ? true
            : existingPrerequisiteStages.every((stageName) => {
                const stage = project.stages.find((s) => s.stage === stageName);
                return (
                  stage?.finished === true || stage?.status === 'COMPLETED'
                );
              });

        // Build prerequisite status object for reference (only for existing stages)
        const prerequisiteStatus = {};
        existingPrerequisiteStages.forEach((stageName) => {
          const stage = project.stages.find((s) => s.stage === stageName);
          prerequisiteStatus[stageName] =
            stage?.finished === true || stage?.status === 'COMPLETED';
        });

        return {
          ...project,
          designFinished,
          allPrerequisitesFinished,
          prerequisiteStatus,
        };
      }),
    );

    let eligibleProjects = projectsWithPrerequisitesFinished.filter(
      (p) => p.designFinished === true && p.allPrerequisitesFinished === true,
    );

    if (status !== 'all') {
      eligibleProjects = eligibleProjects.filter((project) => {
        const assemblyStage = project.stages.find(
          (stage) => stage.stage === 'ASSEMBLY',
        );

        if (status === 'finished') {
          return (
            assemblyStage &&
            (assemblyStage.finished === true ||
              assemblyStage.status === 'COMPLETED')
          );
        }

        if (status === 'not-finished') {
          return (
            assemblyStage &&
            assemblyStage.finished !== true &&
            assemblyStage.status !== 'COMPLETED'
          );
        }

        return true;
      });
    }

    const projectsWithProgress = eligibleProjects.map((project) => {
      const assemblyStage = project.stages.find(
        (stage) => stage.stage === 'ASSEMBLY',
      );

      let progress = 0;

      if (assemblyStage) {
        const plannedUnits =
          assemblyStage.workUnits || assemblyStage.capacityDays || 0;
        const actualUnits = assemblyStage.actualWorkUnits || 0;

        if (plannedUnits > 0) {
          progress = Math.min((actualUnits / plannedUnits) * 100, 100);
        }
      }

      return {
        ...project,
        assemblyProgress: progress,
        assemblyStage: assemblyStage || null,
      };
    });

    return {
      projects: projectsWithProgress,
      count: eligibleProjects.length,
      total: projectsWithAssembly.length,
    };
  } catch (error) {
    console.error('Error fetching Assembly projects:', error);
    return {
      projects: [],
      count: 0,
      total: 0,
      error: error.message,
    };
  }
};
const getPaintingProjects = async (status = 'all') => {
  try {
    const projectsWithPainting = await prisma.project.findMany({
      where: {
        stages: {
          some: {
            stage: 'PAINTING',
          },
        },
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        invoice: {
          select: {
            id: true,
            piNumber: true,
            total: true,
            status: true,
          },
        },
        stages: {
          orderBy: {
            stage: 'asc',
          },
          select: {
            id: true,
            stage: true,
            capacityDays: true,
            workUnits: true,
            actualWorkUnits: true,
            finished: true,
            startDate: true,
            endDate: true,
            autoSchedule: true,
            status: true,
            projectStageWorkLogs: {
              select: {
                id: true,
                doneUnits: true,
                note: true,
                createdAt: true,
                doneBy: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },

        createdBy: true,
        updatedBy: true,
      },
      orderBy: {
        createdAt: 'desc', // Show newest first
      },
    });

    // Same prerequisite logic
    const prerequisiteStages = [
      'METAL_WORKS',
      'CNC',
      'CUTTING',
      'EDGE_BANDING',
    ];

    const projectsWithPrerequisitesFinished = await Promise.all(
      projectsWithPainting.map(async (project) => {
        const designFinished = await isDesignFinished(project.id);

        const existingPrerequisiteStages = prerequisiteStages.filter(
          (stageName) => project.stages.some((s) => s.stage === stageName),
        );

        const allPrerequisitesFinished =
          existingPrerequisiteStages.length === 0
            ? true
            : existingPrerequisiteStages.every((stageName) => {
                const stage = project.stages.find((s) => s.stage === stageName);

                return (
                  stage?.finished === true || stage?.status === 'COMPLETED'
                );
              });

        const prerequisiteStatus = {};
        existingPrerequisiteStages.forEach((stageName) => {
          const stage = project.stages.find((s) => s.stage === stageName);

          prerequisiteStatus[stageName] =
            stage?.finished === true || stage?.status === 'COMPLETED';
        });

        return {
          ...project,
          designFinished,
          allPrerequisitesFinished,
          prerequisiteStatus,
        };
      }),
    );

    let eligibleProjects = projectsWithPrerequisitesFinished.filter(
      (p) => p.designFinished === true && p.allPrerequisitesFinished === true,
    );

    if (status !== 'all') {
      eligibleProjects = eligibleProjects.filter((project) => {
        const paintingStage = project.stages.find(
          (stage) => stage.stage === 'PAINTING',
        );

        if (status === 'finished') {
          return (
            paintingStage &&
            (paintingStage.finished === true ||
              paintingStage.status === 'COMPLETED')
          );
        }

        if (status === 'not-finished') {
          return (
            paintingStage &&
            paintingStage.finished !== true &&
            paintingStage.status !== 'COMPLETED'
          );
        }

        return true;
      });
    }

    const projectsWithProgress = eligibleProjects.map((project) => {
      const paintingStage = project.stages.find(
        (stage) => stage.stage === 'PAINTING',
      );

      let progress = 0;

      if (paintingStage) {
        const plannedUnits =
          paintingStage.workUnits || paintingStage.capacityDays || 0;

        const actualUnits = paintingStage.actualWorkUnits || 0;

        if (plannedUnits > 0) {
          progress = Math.min((actualUnits / plannedUnits) * 100, 100);
        }
      }

      return {
        ...project,
        paintingProgress: progress,
        paintingStage: paintingStage || null,
      };
    });

    return {
      projects: projectsWithProgress,
      count: eligibleProjects.length,
      total: projectsWithPainting.length,
    };
  } catch (error) {
    console.error('Error fetching Painting projects:', error);
    return {
      projects: [],
      count: 0,
      total: 0,
      error: error.message,
    };
  }
};
const getFinishingProjects = async (status = 'all') => {
  try {
    const projectsWithFinishing = await prisma.project.findMany({
      where: {
        stages: {
          some: {
            stage: 'FINISHING',
          },
        },
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        invoice: {
          select: {
            id: true,
            piNumber: true,
            total: true,
            status: true,
          },
        },
        stages: {
          orderBy: {
            stage: 'asc',
          },
          select: {
            id: true,
            stage: true,
            capacityDays: true,
            workUnits: true,
            actualWorkUnits: true,
            finished: true,
            startDate: true,
            endDate: true,
            autoSchedule: true,
            status: true,
            projectStageWorkLogs: {
              select: {
                id: true,
                doneUnits: true,
                note: true,
                createdAt: true,
                doneBy: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },

        createdBy: true,
        updatedBy: true,
      },
      orderBy: {
        createdAt: 'desc', // Show newest first
      },
    });

    const prerequisiteStages = [
      'METAL_WORKS',
      'CNC',
      'CUTTING',
      'EDGE_BANDING',
      'ASSEMBLY',
      'PAINTING',
    ];

    const projectsWithPrerequisitesFinished = await Promise.all(
      projectsWithFinishing.map(async (project) => {
        const designFinished = await isDesignFinished(project.id);

        const existingPrerequisiteStages = prerequisiteStages.filter(
          (stageName) => project.stages.some((s) => s.stage === stageName),
        );

        const allPrerequisitesFinished =
          existingPrerequisiteStages.length === 0
            ? true
            : existingPrerequisiteStages.every((stageName) => {
                const stage = project.stages.find((s) => s.stage === stageName);
                return (
                  stage?.finished === true || stage?.status === 'COMPLETED'
                );
              });

        const prerequisiteStatus = {};
        existingPrerequisiteStages.forEach((stageName) => {
          const stage = project.stages.find((s) => s.stage === stageName);
          prerequisiteStatus[stageName] =
            stage?.finished === true || stage?.status === 'COMPLETED';
        });

        return {
          ...project,
          designFinished,
          allPrerequisitesFinished,
          prerequisiteStatus,
        };
      }),
    );

    let eligibleProjects = projectsWithPrerequisitesFinished.filter(
      (p) => p.designFinished === true && p.allPrerequisitesFinished === true,
    );

    if (status !== 'all') {
      eligibleProjects = eligibleProjects.filter((project) => {
        const finishingStage = project.stages.find(
          (stage) => stage.stage === 'FINISHING',
        );

        if (status === 'finished') {
          return (
            finishingStage &&
            (finishingStage.finished === true ||
              finishingStage.status === 'COMPLETED')
          );
        }

        if (status === 'not-finished') {
          return (
            finishingStage &&
            finishingStage.finished !== true &&
            finishingStage.status !== 'COMPLETED'
          );
        }

        return true;
      });
    }

    const projectsWithProgress = eligibleProjects.map((project) => {
      const finishingStage = project.stages.find(
        (stage) => stage.stage === 'FINISHING',
      );

      let progress = 0;

      if (finishingStage) {
        const plannedUnits =
          finishingStage.workUnits || finishingStage.capacityDays || 0;
        const actualUnits = finishingStage.actualWorkUnits || 0;

        if (plannedUnits > 0) {
          progress = Math.min((actualUnits / plannedUnits) * 100, 100);
        }
      }

      return {
        ...project,
        finishingProgress: progress,
        finishingStage: finishingStage || null,
      };
    });

    return {
      projects: projectsWithProgress,
      count: eligibleProjects.length,
      total: projectsWithFinishing.length,
    };
  } catch (error) {
    console.error('Error fetching Finishing projects:', error);
    return {
      projects: [],
      count: 0,
      total: 0,
      error: error.message,
    };
  }
};
const getDeliveryProjects = async (status = 'all') => {
  try {
    const projectsWithDelivery = await prisma.project.findMany({
      where: {
        stages: {
          some: {
            stage: 'DELIVERY',
          },
        },
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        invoice: {
          select: {
            id: true,
            piNumber: true,
            total: true,
            status: true,
          },
        },
        stages: {
          orderBy: {
            stage: 'asc',
          },
          select: {
            id: true,
            stage: true,
            capacityDays: true,
            workUnits: true,
            actualWorkUnits: true,
            finished: true,
            startDate: true,
            endDate: true,
            autoSchedule: true,
            status: true,
            projectStageWorkLogs: {
              select: {
                id: true,
                doneUnits: true,
                note: true,
                createdAt: true,
                doneBy: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },

        createdBy: true,
        updatedBy: true,
      },
      orderBy: {
        calculatedDelivery: 'desc',
      },
    });

    const prerequisiteStages = [
      'METAL_WORKS',
      'CNC',
      'CUTTING',
      'EDGE_BANDING',
      'ASSEMBLY',
      'PAINTING',
      'FINISHING',
    ];

    const projectsWithPrerequisitesFinished = await Promise.all(
      projectsWithDelivery.map(async (project) => {
        const designFinished = await isDesignFinished(project.id);

        const existingPrerequisiteStages = prerequisiteStages.filter(
          (stageName) => project.stages.some((s) => s.stage === stageName),
        );

        const allPrerequisitesFinished =
          existingPrerequisiteStages.length === 0
            ? true
            : existingPrerequisiteStages.every((stageName) => {
                const stage = project.stages.find((s) => s.stage === stageName);
                return (
                  stage?.finished === true || stage?.status === 'COMPLETED'
                );
              });

        const prerequisiteStatus = {};
        existingPrerequisiteStages.forEach((stageName) => {
          const stage = project.stages.find((s) => s.stage === stageName);
          prerequisiteStatus[stageName] =
            stage?.finished === true || stage?.status === 'COMPLETED';
        });

        return {
          ...project,
          designFinished,
          allPrerequisitesFinished,
          prerequisiteStatus,
        };
      }),
    );

    let eligibleProjects = projectsWithPrerequisitesFinished.filter(
      (p) => p.designFinished === true && p.allPrerequisitesFinished === true,
    );

    if (status !== 'all') {
      eligibleProjects = eligibleProjects.filter((project) => {
        const deliveryStage = project.stages.find(
          (stage) => stage.stage === 'DELIVERY',
        );

        if (status === 'finished') {
          return (
            deliveryStage &&
            (deliveryStage.finished === true ||
              deliveryStage.status === 'COMPLETED')
          );
        }

        if (status === 'not-finished') {
          return (
            deliveryStage &&
            deliveryStage.finished !== true &&
            deliveryStage.status !== 'COMPLETED'
          );
        }

        return true;
      });
    }

    const projectsWithProgress = eligibleProjects.map((project) => {
      const deliveryStage = project.stages.find(
        (stage) => stage.stage === 'DELIVERY',
      );

      let progress = 0;

      if (deliveryStage) {
        const plannedUnits =
          deliveryStage.workUnits || deliveryStage.capacityDays || 0;
        const actualUnits = deliveryStage.actualWorkUnits || 0;

        if (plannedUnits > 0) {
          progress = Math.min((actualUnits / plannedUnits) * 100, 100);
        }
      }

      return {
        ...project,
        deliveryProgress: progress,
        deliveryStage: deliveryStage || null,
      };
    });

    return {
      projects: projectsWithProgress,
      count: eligibleProjects.length,
      total: projectsWithDelivery.length,
    };
  } catch (error) {
    console.error('Error fetching Delivery projects:', error);
    return {
      projects: [],
      count: 0,
      total: 0,
      error: error.message,
    };
  }
};
const getInstallationProjects = async (status = 'all') => {
  try {
    const projectsWithInstallation = await prisma.project.findMany({
      where: {
        stages: {
          some: {
            stage: 'INSTALLATION',
          },
        },
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        invoice: {
          select: {
            id: true,
            piNumber: true,
            total: true,
            status: true,
          },
        },
        stages: {
          orderBy: {
            stage: 'asc',
          },
          select: {
            id: true,
            stage: true,
            capacityDays: true,
            workUnits: true,
            actualWorkUnits: true,
            finished: true,
            startDate: true,
            endDate: true,
            autoSchedule: true,
            status: true,
            projectStageWorkLogs: {
              select: {
                id: true,
                doneUnits: true,
                note: true,
                createdAt: true,
                doneBy: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        createdBy: true,
        updatedBy: true,
      },
      orderBy: {
        calculatedDelivery: 'desc',
      },
    });

    const prerequisiteStages = [
      'METAL_WORKS',
      'CNC',
      'CUTTING',
      'EDGE_BANDING',
      'ASSEMBLY',
      'PAINTING',
      'FINISHING',
      'DELIVERY',
    ];

    const projectsWithPrerequisitesFinished = await Promise.all(
      projectsWithInstallation.map(async (project) => {
        const designFinished = await isDesignFinished(project.id);

        const existingPrerequisiteStages = prerequisiteStages.filter(
          (stageName) => project.stages.some((s) => s.stage === stageName),
        );

        const allPrerequisitesFinished =
          existingPrerequisiteStages.length === 0
            ? true
            : existingPrerequisiteStages.every((stageName) => {
                const stage = project.stages.find((s) => s.stage === stageName);
                return (
                  stage?.finished === true || stage?.status === 'COMPLETED'
                );
              });

        const prerequisiteStatus = {};
        existingPrerequisiteStages.forEach((stageName) => {
          const stage = project.stages.find((s) => s.stage === stageName);
          prerequisiteStatus[stageName] =
            stage?.finished === true || stage?.status === 'COMPLETED';
        });

        return {
          ...project,
          designFinished,
          allPrerequisitesFinished,
          prerequisiteStatus,
        };
      }),
    );

    let eligibleProjects = projectsWithPrerequisitesFinished.filter(
      (p) => p.designFinished === true && p.allPrerequisitesFinished === true,
    );

    if (status !== 'all') {
      eligibleProjects = eligibleProjects.filter((project) => {
        const installationStage = project.stages.find(
          (stage) => stage.stage === 'INSTALLATION',
        );

        if (status === 'finished') {
          return (
            installationStage &&
            (installationStage.finished === true ||
              installationStage.status === 'COMPLETED')
          );
        }

        if (status === 'not-finished') {
          return (
            installationStage &&
            installationStage.finished !== true &&
            installationStage.status !== 'COMPLETED'
          );
        }

        return true;
      });
    }

    const projectsWithProgress = eligibleProjects.map((project) => {
      const installationStage = project.stages.find(
        (stage) => stage.stage === 'INSTALLATION',
      );

      let progress = 0;

      if (installationStage) {
        const plannedUnits =
          installationStage.workUnits || installationStage.capacityDays || 0;
        const actualUnits = installationStage.actualWorkUnits || 0;

        if (plannedUnits > 0) {
          progress = Math.min((actualUnits / plannedUnits) * 100, 100);
        }
      }

      return {
        ...project,
        installationProgress: progress,
        installationStage: installationStage || null,
      };
    });

    return {
      projects: projectsWithProgress,
      count: eligibleProjects.length,
      total: projectsWithInstallation.length,
    };
  } catch (error) {
    console.error('Error fetching Installation projects:', error);
    return {
      projects: [],
      count: 0,
      total: 0,
      error: error.message,
    };
  }
};
const getMaterialUsageReport = async () => {
  // Fetch ALL proforma invoices
  const invoices = await prisma.proformaInvoice.findMany({
    include: {
      items: {
        include: {
          proformaItemMaterials: {
            include: {
              material: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
      customer: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      piNumber: 'asc',
    },
  });

  // Inventory stocks
  const inventoryStocks = await prisma.inventoryStock.findMany({
    where: {
      status: 'Available',
    },
  });

  // Build stock map
  const stockMap = inventoryStocks.reduce((map, stock) => {
    const current = map.get(stock.materialId) || 0;

    map.set(stock.materialId, current + stock.quantity);

    return map;
  }, new Map());

  // Material totals map
  const materialTotals = new Map();

  // PI reports
  const piReports = invoices.reduce((invoiceAcc, invoice) => {
    const materialsForPI = [];

    invoice.items.forEach((item) => {
      item.proformaItemMaterials.forEach((materialItem) => {
        // Skip issued/cancelled
        if (
          materialItem.status === 'ISSUED' ||
          materialItem.status === 'CANCELLED'
        ) {
          return;
        }

        const totalRequired =
          (materialItem.quantity || 0) + (materialItem.additionalQuantity || 0);

        const alreadyIssued = materialItem.givenquantity || 0;

        const remainingRequired = totalRequired - alreadyIssued;

        // Skip empty remaining
        if (remainingRequired <= 0) {
          return;
        }

        const { materialId } = materialItem;

        const materialName = materialItem.material.name;

        const stock = stockMap.get(materialId) || 0;

        materialsForPI.push({
          name: materialName,
          required: remainingRequired,
          stock,
          status: materialItem.status,
        });

        // Initialize material totals
        if (!materialTotals.has(materialId)) {
          materialTotals.set(materialId, {
            name: materialName,
            requirements: [],
            totalRequired: 0,
          });
        }

        const materialData = materialTotals.get(materialId);

        materialData.requirements.push({
          piNumber: invoice.piNumber,
          customerName: invoice.customer?.name || 'Unknown',
          required: remainingRequired,
          status: materialItem.status,
        });

        materialData.totalRequired += remainingRequired;
      });
    });

    if (materialsForPI.length > 0) {
      invoiceAcc.push({
        piNumber: invoice.piNumber,
        customerName: invoice.customer?.name,
        materials: materialsForPI,
      });
    }

    return invoiceAcc;
  }, []);

  // Build purchase-needed summary
  const summary = Array.from(materialTotals.entries())
    .map(([materialId, data]) => {
      const stock = stockMap.get(materialId) || 0;

      const need = data.totalRequired > stock ? data.totalRequired - stock : 0;

      return {
        materialName: data.name,
        requirements: data.requirements,
        totalRequired: data.totalRequired,
        stock,
        need,
      };
    })
    // Only show purchase-needed materials
    .filter((item) => item.need > 0)
    .sort((a, b) => a.materialName.localeCompare(b.materialName));

  return {
    piReports,
    summary,
  };
};

module.exports = {
  getUnassignedDesignProjects,
  getbyDesignProject,
  getDesignProjects,
  getPurchasingProjects,
  isDesignFinished,
  getMaterialUsageReport,
  getMetalWorkProjects,
  getCNCProjects,
  getCuttingProjects,
  getEdgeBandingProjects,
  getAssemblyProjects,
  getPaintingProjects,
  getFinishingProjects,
  getDeliveryProjects,
  getInstallationProjects,
};
