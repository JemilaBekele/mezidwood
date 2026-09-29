const prisma = require('./prisma');

// Production order of project stages (for the pipeline chart)
const STAGE_ORDER = [
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

const DAY_MS = 24 * 60 * 60 * 1000;

const toNum = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const round2 = (value) => Math.round(toNum(value) * 100) / 100;

/**
 * Overview dashboard insights:
 * - delivery health of open projects (overdue / due in 7 days / later)
 * - production pipeline (open projects per current stage)
 * - PI collections (value, paid, outstanding) + top customers by balance
 * - most overdue projects
 */
const getOverviewInsights = async () => {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const in7Days = new Date(startOfToday.getTime() + 8 * DAY_MS); // end of day +7

  const [openProjects, piTotals, topDebtorGroups] = await Promise.all([
    prisma.project.findMany({
      where: {
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      select: {
        id: true,
        status: true,
        requestedDelivery: true,
        newRequestedDelivery: true,
        customer: { select: { name: true, phone1: true } },
        invoice: { select: { piNumber: true } },
      },
    }),
    prisma.proformaInvoice.aggregate({
      where: { store: false, status: { not: 'CANCELLED' } },
      _sum: { total: true, amountPaid: true, balance: true },
      _count: true,
    }),
    prisma.proformaInvoice.groupBy({
      by: ['customerId'],
      where: {
        store: false,
        status: { not: 'CANCELLED' },
        balance: { gt: 0 },
      },
      _sum: { balance: true },
      _count: true,
      orderBy: { _sum: { balance: 'desc' } },
      take: 5,
    }),
  ]);

  // ── Delivery health + pipeline ─────────────────────────────
  const delivery = { overdue: 0, dueThisWeek: 0, later: 0, noDate: 0 };
  const stageCounts = {};
  const overdueList = [];

  openProjects.forEach((project) => {
    const stage = project.status || 'UNKNOWN';
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;

    const due = project.newRequestedDelivery || project.requestedDelivery;
    if (!due) {
      delivery.noDate += 1;
      return;
    }
    const dueDate = new Date(due);
    if (dueDate < startOfToday) {
      delivery.overdue += 1;
      overdueList.push({
        projectId: project.id,
        piNumber: project.invoice?.piNumber || '-',
        customerName: project.customer?.name || '-',
        customerPhone: project.customer?.phone1 || null,
        stage,
        dueDate,
        daysLate: Math.floor((startOfToday - dueDate) / DAY_MS),
      });
    } else if (dueDate < in7Days) {
      delivery.dueThisWeek += 1;
    } else {
      delivery.later += 1;
    }
  });

  const pipeline = [
    ...STAGE_ORDER,
    ...Object.keys(stageCounts).filter((s) => !STAGE_ORDER.includes(s)),
  ]
    .filter((stage) => stageCounts[stage])
    .map((stage) => ({ stage, count: stageCounts[stage] }));

  const mostOverdue = overdueList
    .sort((a, b) => b.daysLate - a.daysLate)
    .slice(0, 5);

  // ── Collections ─────────────────────────────────────────────
  const customerIds = topDebtorGroups.map((g) => g.customerId).filter(Boolean);
  const customers = customerIds.length
    ? await prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, name: true, phone1: true },
      })
    : [];
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const topDebtors = topDebtorGroups.map((g) => ({
    customerId: g.customerId,
    customerName: customerById.get(g.customerId)?.name || 'Unknown',
    customerPhone: customerById.get(g.customerId)?.phone1 || null,
    invoiceCount: g._count,
    balance: round2(g._sum.balance),
  }));

  return {
    generatedAt: now,
    delivery: {
      ...delivery,
      openProjects: openProjects.length,
    },
    pipeline,
    mostOverdue,
    collections: {
      invoiceCount: piTotals._count,
      totalValue: round2(piTotals._sum.total),
      totalPaid: round2(piTotals._sum.amountPaid),
      outstanding: round2(piTotals._sum.balance),
    },
    topDebtors,
  };
};

module.exports = {
  getOverviewInsights,
};
