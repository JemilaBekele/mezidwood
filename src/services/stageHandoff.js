/**
 * Partial hand-off between production stages.
 *
 * A stage does not wait for the stages before it to finish completely: as soon
 * as they have done part of their work, that share is handed on. Stages follow
 * the scheduler's phase order (Metal Works + CNC → Cutting + Edge Banding →
 * Assembly + Painting → Finishing → Delivery → Installation); a stage's
 * prerequisites are the stages of the nearest earlier phase present in the
 * project. Design is a separate gate (it must be finished) and is not part of
 * the hand-off.
 *
 * Work is handed on as a SHARE of the plan, because stages plan different
 * unit counts (e.g. CNC 14, Cutting 80). With the same plan the share is the
 * plain unit count: Metal Works 10/50 and CNC 5/50 → Cutting may do 5 of 50.
 * With parallel prerequisites the slowest one decides.
 */
const { PHASES } = require('./scheduling/engine');

const EPS = 1e-6;

const HANDOFF_PHASES = PHASES.filter((phase) => !phase.includes('DESIGN'));

const isStageDone = (stage) =>
  stage?.finished === true ||
  stage?.status === 'COMPLETED' ||
  stage?.status === 'CANCELLED';

/** Share (0..1) of a stage's planned work that is done. */
const doneShare = (stage) => {
  if (isStageDone(stage)) return 1;
  const planned = Number(stage?.workUnits) || 0;
  const actual = Number(stage?.actualWorkUnits) || 0;
  return planned > 0 ? Math.min(actual / planned, 1) : 0;
};

/** The stages this stage receives work from (nearest earlier phase present). */
const prerequisitesOf = (stageName, stages) => {
  const phaseIndex = HANDOFF_PHASES.findIndex((p) => p.includes(stageName));
  for (let i = phaseIndex - 1; i >= 0; i -= 1) {
    const present = stages.filter((s) => HANDOFF_PHASES[i].includes(s.stage));
    if (present.length > 0) return present;
  }
  return [];
};

/**
 * What a stage may work on, given `stages` = all stages of its project (each
 * with stage, workUnits, actualWorkUnits, finished, status).
 *
 * @returns {{ availableShare, allowedUnits, availableUnits, readyPercent,
 *             visible, prerequisites }}
 *   allowedUnits   – total units this stage may have done so far
 *   availableUnits – units it can still log now (allowed − already done)
 *   visible        – the stage has work to show: something was handed on, or
 *                    it already has progress of its own
 */
const stageHandoff = (stageName, stages) => {
  const stage = stages.find((s) => s.stage === stageName);
  const prerequisites = prerequisitesOf(stageName, stages);
  const availableShare = prerequisites.length
    ? Math.min(...prerequisites.map(doneShare))
    : 1;

  const planned = Number(stage?.workUnits) || 0;
  const actual = Number(stage?.actualWorkUnits) || 0;
  const allowedUnits = planned * availableShare;
  const availableUnits = Math.max(0, allowedUnits - actual);

  return {
    availableShare,
    allowedUnits: Math.round(allowedUnits * 10000) / 10000,
    availableUnits: Math.round(availableUnits * 10000) / 10000,
    readyPercent: Math.round(availableShare * 10000) / 100,
    visible: availableShare > EPS || actual > EPS || isStageDone(stage),
    prerequisites: prerequisites.map((s) => ({
      stage: s.stage,
      donePercent: Math.round(doneShare(s) * 10000) / 100,
    })),
  };
};

module.exports = {
  EPS,
  isStageDone,
  doneShare,
  prerequisitesOf,
  stageHandoff,
};
