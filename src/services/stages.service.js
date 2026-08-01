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

    // Filter by design status FINISHED
    let eligibleProjects = verifiedProjects;

    if (status === 'finished') {
      eligibleProjects = verifiedProjects.filter((project) => {
        return project.designStatus === 'FINISHED';
      });
    } else if (status === 'not-finished') {
      eligibleProjects = verifiedProjects.filter((project) => {
        return project.designStatus !== 'FINISHED';
      });
    }
    // If status === 'all', return all projects

    return {
      projects: eligibleProjects,
      count: eligibleProjects.length,
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
    // 1. Fetch project deliveries with DELIVERY stage
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
            paymentStatus: true, // ✅ ADDED: Payment status from invoice
            amountPaid: true, // ✅ ADDED: Amount paid
            balance: true, // ✅ ADDED: Balance
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

    // 2. Fetch sell deliveries - includes APPROVED and PARTIALLY_DELIVERED
    const sellsWithDelivery = await prisma.sell.findMany({
      where: {
        // Include APPROVED, PARTIALLY_DELIVERED, and DELIVERED sales
        saleStatus: {
          in: ['APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED'],
        },
        // Ensure they have items with delivery-related statuses
        items: {
          some: {
            itemSaleStatus: {
              in: ['DELIVERED', 'PARTIALLY_DELIVERED', 'PENDING'],
            },
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
        store: {
          select: {
            id: true,
            name: true,
          },
        },
        items: {
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
            itemSaleStatus: true,
            itemId: true,
            item: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        sellPayments: {
          select: {
            id: true,
            amount: true,
            createdAt: true,
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
        deliveryDate: 'desc',
      },
    });

    // 3. Process project deliveries
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

        // Get delivery stage status
        const deliveryStage = project.stages.find(
          (s) => s.stage === 'DELIVERY',
        );

        // Get payment status from invoice
        const paymentStatus = project.invoice?.paymentStatus;
        const isPaid = paymentStatus === 'PAID' || paymentStatus === 'PAID';

        return {
          ...project,
          type: 'project',
          designFinished,
          allPrerequisitesFinished,
          prerequisiteStatus,
          paymentStatus: paymentStatus || 'PENDING',
          isPaid,
          deliveryStatus:
            deliveryStage?.finished || deliveryStage?.status === 'COMPLETED'
              ? 'finished'
              : deliveryStage?.actualWorkUnits > 0
              ? 'in-progress'
              : 'pending',
          // For project, "not-finished" means NOT delivered yet (approved but not delivered)
          isNotFinished: !(
            deliveryStage?.finished || deliveryStage?.status === 'COMPLETED'
          ),
          isFinished: !!(
            deliveryStage?.finished || deliveryStage?.status === 'COMPLETED'
          ),
        };
      }),
    );

    const eligibleProjects = projectsWithPrerequisitesFinished.filter(
      (p) => p.designFinished === true && p.allPrerequisitesFinished === true,
    );

    // 4. Process sell deliveries with enhanced status
    const processedSells = sellsWithDelivery.map((sell) => {
      // Calculate delivery status
      const { items } = sell;
      const totalItems = items.length;
      const deliveredItems = items.filter(
        (item) => item.itemSaleStatus === 'DELIVERED',
      );
      const pendingItems = items.filter(
        (item) => item.itemSaleStatus === 'PENDING',
      );
      const partiallyDeliveredItems = items.filter(
        (item) => item.itemSaleStatus === 'PARTIALLY_DELIVERED',
      );

      const allDelivered = deliveredItems.length === totalItems;
      const hasDelivered = deliveredItems.length > 0;
      const hasPending = pendingItems.length > 0;
      const hasPartial = partiallyDeliveredItems.length > 0;
      const progress =
        totalItems > 0
          ? ((deliveredItems.length + partiallyDeliveredItems.length * 0.5) /
              totalItems) *
            100
          : 0;

      // Determine delivery status
      let deliveryStatus;
      let isFinished = false;
      let isNotFinished = false;

      if (allDelivered) {
        deliveryStatus = 'finished';
        isFinished = true;
        isNotFinished = false;
      } else if (hasDelivered || hasPartial) {
        deliveryStatus = 'partially-delivered';
        isFinished = false;
        isNotFinished = true;
        // Check if it's partially delivered or in progress
        if (hasPartial) {
          deliveryStatus = 'partially-delivered';
        }
      } else if (hasPending) {
        deliveryStatus = 'pending';
        isFinished = false;
        isNotFinished = true;
      } else {
        deliveryStatus = 'not-finished';
        isFinished = false;
        isNotFinished = true;
      }

      // Calculate payment status
      const payments = sell.sellPayments || [];
      const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      const paymentStatus =
        totalPaid >= sell.grandTotal
          ? 'PAID'
          : totalPaid > 0
          ? 'PARTIAL'
          : 'PENDING';

      return {
        ...sell,
        type: 'sell',
        deliveryProgress: progress,
        deliveryStatus,
        isFinished,
        isNotFinished,
        allPrerequisitesFinished: true,
        designFinished: true,
        prerequisiteStatus: {},
        paymentStatus,
        totalPaid,
        isPaid: paymentStatus === 'PAID',
        // Map items to stages-like structure for consistency
        stages: items.map((item) => ({
          id: item.id,
          stage: item.itemSaleStatus,
          workUnits: item.quantity,
          actualWorkUnits:
            item.itemSaleStatus === 'DELIVERED'
              ? item.quantity
              : item.itemSaleStatus === 'PARTIALLY_DELIVERED'
              ? Math.ceil(item.quantity / 2)
              : 0,
          finished: item.itemSaleStatus === 'DELIVERED',
          status:
            item.itemSaleStatus === 'DELIVERED'
              ? 'COMPLETED'
              : item.itemSaleStatus === 'PARTIALLY_DELIVERED'
              ? 'PARTIAL'
              : 'PENDING',
          startDate: sell.deliveryDate,
          endDate: sell.deliveryDate,
          capacityDays: 0,
          autoSchedule: false,
          projectStageWorkLogs: [],
          itemName: item.item.name,
          itemCode: item.item.code,
        })),
        // Add summary for UI
        deliverySummary: {
          total: totalItems,
          delivered: deliveredItems.length,
          pending: pendingItems.length,
          partial: partiallyDeliveredItems.length,
        },
      };
    });

    // 5. Combine projects and sells
    let allDeliveries = [...eligibleProjects, ...processedSells];

    // 6. Apply status filter with clear logic for 'finished' and 'not-finished'
    if (status !== 'all') {
      allDeliveries = allDeliveries.filter((delivery) => {
        // For 'finished' - only show completed deliveries
        if (status === 'finished') {
          return delivery.isFinished === true;
        }

        // For 'not-finished' - show everything that is NOT finished
        // This includes: approved, partially-delivered, pending, in-progress
        if (status === 'not-finished') {
          return delivery.isNotFinished === true;
        }

        // For 'pending' - specifically show only pending (not started)
        if (status === 'pending') {
          if (delivery.type === 'project') {
            const deliveryStage = delivery.stages.find(
              (stage) => stage.stage === 'DELIVERY',
            );
            return (
              deliveryStage &&
              deliveryStage.finished !== true &&
              deliveryStage.status !== 'COMPLETED' &&
              (deliveryStage.actualWorkUnits === 0 ||
                !deliveryStage.actualWorkUnits)
            );
          }
          if (delivery.type === 'sell') {
            return delivery.deliveryStatus === 'pending';
          }
        }

        // For 'partially-delivered' - specifically show partial deliveries
        if (status === 'partially-delivered') {
          if (delivery.type === 'project') {
            const deliveryStage = delivery.stages.find(
              (stage) => stage.stage === 'DELIVERY',
            );
            return (
              deliveryStage &&
              deliveryStage.finished !== true &&
              deliveryStage.status !== 'COMPLETED' &&
              deliveryStage.actualWorkUnits > 0 &&
              deliveryStage.actualWorkUnits < deliveryStage.workUnits
            );
          }
          if (delivery.type === 'sell') {
            return delivery.deliveryStatus === 'partially-delivered';
          }
        }

        // For 'approved' - specifically show approved but not delivered
        if (status === 'approved') {
          if (delivery.type === 'project') {
            const deliveryStage = delivery.stages.find(
              (stage) => stage.stage === 'DELIVERY',
            );
            return (
              deliveryStage &&
              deliveryStage.finished !== true &&
              deliveryStage.status !== 'COMPLETED'
            );
          }
          if (delivery.type === 'sell') {
            return (
              delivery.saleStatus === 'APPROVED' &&
              delivery.deliveryStatus !== 'finished'
            );
          }
        }

        return true;
      });
    }

    // 7. Sort combined deliveries by date
    allDeliveries.sort((a, b) => {
      const dateA =
        a.type === 'project' ? a.calculatedDelivery : a.deliveryDate;
      const dateB =
        b.type === 'project' ? b.calculatedDelivery : b.deliveryDate;
      return new Date(dateB) - new Date(dateA);
    });

    // 8. Calculate comprehensive breakdown
    const breakdown = {
      projects: {
        total: eligibleProjects.length,
        finished: eligibleProjects.filter((p) => p.isFinished).length,
        'not-finished': eligibleProjects.filter((p) => p.isNotFinished).length,
        pending: eligibleProjects.filter((p) => p.deliveryStatus === 'pending')
          .length,
        'in-progress': eligibleProjects.filter(
          (p) => p.deliveryStatus === 'in-progress',
        ).length,
        'partially-delivered': eligibleProjects.filter(
          (p) => p.deliveryStatus === 'partially-delivered',
        ).length,
        paid: eligibleProjects.filter((p) => p.isPaid).length,
        unpaid: eligibleProjects.filter((p) => !p.isPaid).length,
      },
      sells: {
        total: processedSells.length,
        finished: processedSells.filter((s) => s.isFinished).length,
        'not-finished': processedSells.filter((s) => s.isNotFinished).length,
        pending: processedSells.filter((s) => s.deliveryStatus === 'pending')
          .length,
        'partially-delivered': processedSells.filter(
          (s) => s.deliveryStatus === 'partially-delivered',
        ).length,
        approved: processedSells.filter(
          (s) => s.saleStatus === 'APPROVED' && s.isNotFinished,
        ).length,
      },
      sellPayment: {
        paid: processedSells.filter((s) => s.paymentStatus === 'PAID').length,
        partial: processedSells.filter((s) => s.paymentStatus === 'PARTIAL')
          .length,
        pending: processedSells.filter((s) => s.paymentStatus === 'PENDING')
          .length,
      },
      sellSaleStatus: {
        approved: processedSells.filter((s) => s.saleStatus === 'APPROVED')
          .length,
        delivered: processedSells.filter((s) => s.saleStatus === 'DELIVERED')
          .length,
        partiallyDelivered: processedSells.filter(
          (s) => s.saleStatus === 'PARTIALLY_DELIVERED',
        ).length,
      },
    };

    return {
      projects: allDeliveries,
      count: allDeliveries.length,
      total: projectsWithDelivery.length + sellsWithDelivery.length,
      breakdown,
      // Summary for quick viewing
      summary: {
        totalProjects: eligibleProjects.length,
        totalSells: processedSells.length,
        totalDeliveries: allDeliveries.length,
        finished: allDeliveries.filter((d) => d.isFinished).length,
        notFinished: allDeliveries.filter((d) => d.isNotFinished).length,
        pending: allDeliveries.filter((d) => d.deliveryStatus === 'pending')
          .length,
        partiallyDelivered: allDeliveries.filter(
          (d) => d.deliveryStatus === 'partially-delivered',
        ).length,
        approved: allDeliveries.filter(
          (d) =>
            d.type === 'sell' && d.saleStatus === 'APPROVED' && d.isNotFinished,
        ).length,
        paid: allDeliveries.filter((d) => d.isPaid).length,
        unpaid: allDeliveries.filter((d) => !d.isPaid).length,
      },
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
  try {
    // Get request date
    const requestDate = new Date();

    // Fetch ALL proforma invoices with their project relation
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
                    imageUrl: true,
                    color: true,
                    size: true,
                    plainMDF: true,
                    laminatedMDF: true,
                    wood: true,
                    metal: true,
                    accessory: true,
                    other: true,
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
        project: {
          include: {
            designBy: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            stages: {
              select: {
                stage: true,
                finished: true,
                startDate: true,
                endDate: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: {
        piNumber: 'asc',
      },
    });

    // Log all projects and their design status for debugging
    console.log('📊 Projects with design status:');
    invoices.forEach((invoice) => {
      if (invoice.project) {
        console.log(
          `  PI: ${invoice.piNumber} | Project Status: ${
            invoice.project.status
          } | Design Status: ${
            invoice.project.designStatus || 'N/A'
          } | Design Finished: ${invoice.project.designFinished || false}`,
        );
      }
    });

    // ============================================================
    // STEP 1: Filter projects that meet BOTH criteria:
    //         1. Project is NOT COMPLETED or CANCELLED
    //         2. DesignStatus is DESIGN_FINISHED
    // ============================================================
    const eligibleProjects = invoices.filter((invoice) => {
      // Check if project exists
      if (!invoice.project) return false;

      // Check if project is NOT COMPLETED or CANCELLED
      const isActive =
        invoice.project.status !== 'COMPLETED' &&
        invoice.project.status !== 'CANCELLED';

      if (!isActive) return false;

      // Check if DesignStatus is DESIGN_FINISHED
      const isDesignFinished =
        invoice.project.designStatus === 'DESIGN_FINISHED' ||
        invoice.project.designStatus === 'FINISHED' ||
        invoice.project.designFinished !== null;

      return isDesignFinished;
    });

    console.log(
      `✅ Eligible projects (active + design finished): ${eligibleProjects.length}`,
    );
    eligibleProjects.forEach((inv) => {
      console.log(
        `  ✅ PI: ${inv.piNumber} | Status: ${inv.project.status} | Design Status: ${inv.project.designStatus}`,
      );
    });

    // Log skipped projects for debugging
    const skippedProjects = invoices.filter((invoice) => {
      if (!invoice.project) return true;
      const isActive =
        invoice.project.status !== 'COMPLETED' &&
        invoice.project.status !== 'CANCELLED';
      const isDesignFinished =
        invoice.project.designStatus === 'DESIGN_FINISHED' ||
        invoice.project.designStatus === 'FINISHED' ||
        invoice.project.designFinished !== null;
      return !isActive || !isDesignFinished;
    });

    if (skippedProjects.length > 0) {
      console.log('⚠️ Skipped projects (inactive or design not finished):');
      skippedProjects.forEach((inv) => {
        if (!inv.project) {
          console.log(`  ⚠️ PI: ${inv.piNumber} | No Project`);
          return;
        }
        console.log(
          `  ⚠️ PI: ${inv.piNumber} | Status: ${
            inv.project.status
          } | Design Status: ${inv.project.designStatus || 'N/A'}`,
        );
      });
    }

    // ============================================================
    // STEP 2: Check inventory stocks for eligible projects
    // ============================================================
    let stockMap = new Map();
    if (eligibleProjects.length > 0) {
      const inventoryStocks = await prisma.inventoryStock.findMany({
        where: {
          status: 'Available',
        },
      });

      stockMap = inventoryStocks.reduce((map, stock) => {
        const current = map.get(stock.materialId) || 0;
        map.set(stock.materialId, current + stock.quantity);
        return map;
      }, new Map());

      console.log(
        `ℹ️ Checking stock for ${eligibleProjects.length} eligible projects with finished design`,
      );
    } else {
      console.log(
        'ℹ️ No eligible projects (active + design finished), skipping stock check',
      );
      console.log(
        '💡 Tip: Set DesignStatus to DESIGN_FINISHED for active projects to see material requirements',
      );
    }

    // ============================================================
    // STEP 3: Process ONLY eligible projects
    // ============================================================

    // Material totals map - Store all material details
    const materialTotals = new Map();

    // PI reports - Process only eligible projects
    const piReports = eligibleProjects.reduce((invoiceAcc, invoice) => {
      const materialsForPI = [];

      // Check if design is finished
      const isDesignFinished =
        invoice.project.designStatus === 'DESIGN_FINISHED' ||
        invoice.project.designStatus === 'FINISHED' ||
        invoice.project.designFinished !== null;

      // Get designer name
      const designerName = invoice.project.designBy?.name || 'Not Assigned';
      const designerEmail = invoice.project.designBy?.email || null;

      // Get the requested delivery date for this project
      const { requestedDelivery } = invoice.project;

      invoice.items.forEach((item) => {
        item.proformaItemMaterials.forEach((materialItem) => {
          // Skip issued or cancelled materials
          if (
            materialItem.status === 'ISSUED' ||
            materialItem.status === 'CANCELLED'
          ) {
            return;
          }

          const totalRequired =
            (materialItem.quantity || 0) +
            (materialItem.additionalQuantity || 0);

          const alreadyIssued = materialItem.givenquantity || 0;

          const remainingRequired = totalRequired - alreadyIssued;

          // Skip if nothing remaining
          if (remainingRequired <= 0) {
            return;
          }

          const { materialId } = materialItem;
          const materialName =
            materialItem.material?.name || 'Unknown Material';
          const materialImageUrl = materialItem.material?.imageUrl || null;

          // Get stock (design is finished, so stock should be available)
          const stock = stockMap.get(materialId) || 0;

          materialsForPI.push({
            materialId,
            name: materialName,
            imageUrl: materialImageUrl,
            required: remainingRequired,
            stock,
            status: materialItem.status,
            color: materialItem.material?.color || '',
            size: materialItem.material?.size || '',
            materialType: getMaterialType(materialItem.material),
            designFinished: isDesignFinished,
            designerName,
            designerEmail,
            projectStatus: invoice.project.status,
            requestedDelivery, // Add requested delivery date per material
          });

          // Initialize material totals
          if (!materialTotals.has(materialId)) {
            materialTotals.set(materialId, {
              id: materialId,
              name: materialName,
              imageUrl: materialImageUrl,
              color: materialItem.material?.color || '',
              size: materialItem.material?.size || '',
              materialType: getMaterialType(materialItem.material),
              plainMDF: materialItem.material?.plainMDF || false,
              laminatedMDF: materialItem.material?.laminatedMDF || false,
              wood: materialItem.material?.wood || false,
              metal: materialItem.material?.metal || false,
              accessory: materialItem.material?.accessory || false,
              other: materialItem.material?.other || false,
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
            designerName,
            designFinished: isDesignFinished,
            projectStatus: invoice.project.status,
            requestedDelivery, // Add requested delivery date per requirement
          });

          materialData.totalRequired += remainingRequired;
        });
      });

      if (materialsForPI.length > 0) {
        invoiceAcc.push({
          piNumber: invoice.piNumber,
          customerName: invoice.customer?.name || 'Unknown',
          projectId: invoice.project?.id || null,
          projectStatus: invoice.project?.status || null,
          designerName,
          designerEmail,
          designFinished: isDesignFinished,
          requestedDelivery, // Add requested delivery date per PI
          materials: materialsForPI,
        });
      } else {
        console.log(
          `  ⚠️ PI ${invoice.piNumber} has no materials with pending requirements`,
        );
      }

      return invoiceAcc;
    }, []);

    // ============================================================
    // STEP 4: Build summary with stock comparison
    // ============================================================
    const summary = Array.from(materialTotals.entries())
      .map(([materialId, data]) => {
        const stock = stockMap.get(materialId) || 0;
        const need =
          data.totalRequired > stock ? data.totalRequired - stock : 0;

        return {
          materialId,
          materialName: data.name,
          imageUrl: data.imageUrl,
          color: data.color || '',
          size: data.size || '',
          materialType: data.materialType || '',
          requirements: data.requirements,
          totalRequired: data.totalRequired,
          stock,
          need,
          designFinished: true, // All materials here have design finished
          plainMDF: data.plainMDF || false,
          laminatedMDF: data.laminatedMDF || false,
          wood: data.wood || false,
          metal: data.metal || false,
          accessory: data.accessory || false,
          other: data.other || false,
        };
      })
      .sort((a, b) => a.materialName.localeCompare(b.materialName));

    // ============================================================
    // STEP 5: Log results
    // ============================================================
    if (summary.length === 0) {
      console.log('ℹ️ No materials found for eligible projects');
      console.log('  Reasons could be:');
      console.log('  - No active projects with design finished');
      console.log('  - Projects have no materials in proforma invoice items');
      console.log('  - All materials have been issued or cancelled');
    } else {
      console.log(
        `✅ ${summary.length} materials found with stock comparison:`,
      );
      summary.forEach((m) => {
        const status = m.need > 0 ? '⚠️ NEEDS PURCHASE' : '✅ SUFFICIENT';
        console.log(
          `  ${status} | ${m.materialName} | Required: ${m.totalRequired} | Stock: ${m.stock} | Need: ${m.need}`,
        );
      });
    }

    // ============================================================
    // STEP 6: Statistics
    // ============================================================
    const stats = {
      requestDate: requestDate.toISOString(),
      totalEligibleProjects: eligibleProjects.length,
      totalIneligibleProjects: invoices.filter(
        (inv) =>
          inv.project !== null &&
          (inv.project.status === 'COMPLETED' ||
            inv.project.status === 'CANCELLED'),
      ).length,
      totalProjectsWithoutDesign: invoices.filter((inv) => {
        if (!inv.project) return false;
        const isDesignFinished =
          inv.project.designStatus === 'DESIGN_FINISHED' ||
          inv.project.designStatus === 'FINISHED' ||
          inv.project.designFinished !== null;
        return (
          !isDesignFinished &&
          inv.project.status !== 'COMPLETED' &&
          inv.project.status !== 'CANCELLED'
        );
      }).length,
      totalMaterialsNeeded: Array.from(materialTotals.values()).reduce(
        (sum, data) => sum + data.totalRequired,
        0,
      ),
      totalPurchaseNeeded: summary.reduce((sum, item) => sum + item.need, 0),
      totalMaterialsInSummary: summary.length,
      projectsWithMaterials: piReports.length,
    };

    console.log('📊 Report Statistics:', stats);

    return {
      success: true,
      requestDate: requestDate.toISOString(),
      piReports,
      summary,
      stats,
    };
  } catch (error) {
    console.error('❌ Error generating Material Usage Report:', error);
    console.error('Error details:', {
      message: error?.message,
      stack: error?.stack,
      name: error?.name,
      ...(error?.response && { response: error.response }),
    });

    throw new Error(
      `Failed to generate material usage report: ${
        error?.message || 'Unknown error'
      }`,
    );
  }
};

/**
 * Helper function to determine material type
 */
function getMaterialType(material) {
  if (!material) return 'Unknown';

  if (material.plainMDF) return 'Plain MDF';
  if (material.laminatedMDF) return 'Laminated MDF';
  if (material.wood) return 'Wood';
  if (material.metal) return 'Metal';
  if (material.accessory) return 'Accessory';
  if (material.other) return 'Other';
  return 'Unknown';
}

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
