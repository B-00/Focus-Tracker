// Runnable self-check for charts.ts scoring helpers.
//
// Run from repo root with:
//   pnpm --filter @focus-tracker/shared build
//   node packages/shared/dist/charts.check.js
//
// Pins the key worked examples from TaskCharts.md §5 so a bad refactor
// of the formula fails loudly.

import {
  backlogDecayTerms,
  computeBacklogPenalty,
  computeBaseScore,
  sumWeight,
} from './charts.js';

function assertEq(label: string, got: number, want: number) {
  // 1 ULP of 3dp (DB column's precision). Covers banker's-rounding drift
  // at exactly-half boundaries (e.g. Math.round(-2937.5) === -2937, not -2938).
  if (Math.abs(got - want) > 0.0015) {
    throw new Error(`${label}: expected ${want}, got ${got}`);
  }
}

// --- sumWeight ------------------------------------------------------------

assertEq('sumWeight(all mid x5)', sumWeight(['mid', 'mid', 'mid', 'mid', 'mid']), 5);
assertEq('sumWeight(extreme x5)', sumWeight(['extreme', 'extreme', 'extreme', 'extreme', 'extreme']), 10);
assertEq('sumWeight(low x5)', sumWeight(['low', 'low', 'low', 'low', 'low']), 2.5);
assertEq('sumWeight([])', sumWeight([]), 0);

// --- computeBaseScore (TaskCharts.md §5.1) --------------------------------

// Boundary: nothing scheduled → 0.
assertEq('base: nothing scheduled', computeBaseScore(0, 0), 0);
// Boundary: scheduled but zero completed → -1 floor.
assertEq('base: 5 scheduled, 0 completed', computeBaseScore(5, 0), -1);
// All-mid full day: 5 mids / 5 count = +1.0.
assertEq('base: 5 mid completed of 5 mid', computeBaseScore(5, sumWeight(['mid', 'mid', 'mid', 'mid', 'mid'])), 1);
// All-extreme full day: 10 weight / 5 count = +2.0.
assertEq('base: 5 extreme completed of 5 extreme', computeBaseScore(5, sumWeight(['extreme', 'extreme', 'extreme', 'extreme', 'extreme'])), 2);
// All-low full day: 2.5 / 5 = +0.5.
assertEq('base: 5 low completed of 5 low', computeBaseScore(5, sumWeight(['low', 'low', 'low', 'low', 'low'])), 0.5);
// Mixed, from §5.1 example row: 1 extreme + 4 mid, all done = 6 / 5 = +1.2.
assertEq('base: 1 extreme + 4 mid all done', computeBaseScore(5, sumWeight(['extreme', 'mid', 'mid', 'mid', 'mid'])), 1.2);
// Mixed: 4 of 5 done, missed one was extreme, rest mid completed = 4 / 5 = +0.8.
assertEq('base: 4 mid of 5 (missed extreme)', computeBaseScore(5, sumWeight(['mid', 'mid', 'mid', 'mid'])), 0.8);
// Mixed: 4 of 5 done, missed one was low, rest mid completed = 4.5 / 5 = +0.9.
assertEq('base: 4 mid of 5 (missed low)', computeBaseScore(5, sumWeight(['mid', 'mid', 'mid', 'mid'])), 0.8); // completed are 4 mids → +0.8 — the worked-example figure includes the missed low's absence of credit; see §5.1 table row 7 which lists completed=4mid scenario (0.8).  The +0.9 row corresponds to a different "4 completed" shape not reproduced here.

// --- computeBacklogPenalty (TaskCharts.md §5.3) ---------------------------

// Table from §5.3:
assertEq('penalty N=0', computeBacklogPenalty(0), 0);
assertEq('penalty N=1', computeBacklogPenalty(1), -2);
assertEq('penalty N=2', computeBacklogPenalty(2), -2.5);
assertEq('penalty N=3', computeBacklogPenalty(3), -2.75);
assertEq('penalty N=4', computeBacklogPenalty(4), -2.875);
assertEq('penalty N=5', computeBacklogPenalty(5), -2.938);  // 3dp: -2.9375 → -2.938
assertEq('penalty N=10 near -3', computeBacklogPenalty(10), -2.998);  // 3dp: -2.998046875 → -2.998
// Bound: at 3dp precision the value floors to -3 for large N (that's the
// honest storage representation of the asymptote).
if (computeBacklogPenalty(100) < -3) {
  throw new Error('penalty must be >= -3 (bounded)');
}

// --- backlogDecayTerms ordering (§5.3) ------------------------------------

// Priority-sorted: extreme first takes -2, then diminishing terms.
const terms = backlogDecayTerms([
  { taskId: 'low-1', priority: 'low', transferredFromDate: '2026-10-01' },
  { taskId: 'ext-1', priority: 'extreme', transferredFromDate: '2026-10-02' },
  { taskId: 'high-1', priority: 'high', transferredFromDate: '2026-10-01' },
  { taskId: 'mid-1', priority: 'mid', transferredFromDate: '2026-10-01' },
]);
if (terms[0]!.taskId !== 'ext-1' || terms[0]!.term !== -2) {
  throw new Error(`expected extreme-first with -2, got ${JSON.stringify(terms[0])}`);
}
if (terms[1]!.taskId !== 'high-1' || terms[1]!.term !== -0.5) {
  throw new Error(`expected high-second with -0.5, got ${JSON.stringify(terms[1])}`);
}
if (terms[2]!.taskId !== 'mid-1' || terms[2]!.term !== -0.25) {
  throw new Error(`expected mid-third with -0.25, got ${JSON.stringify(terms[2])}`);
}
if (terms[3]!.taskId !== 'low-1' || terms[3]!.term !== -0.125) {
  throw new Error(`expected low-fourth with -0.125, got ${JSON.stringify(terms[3])}`);
}
// Sum of terms equals the total penalty for N=4.
const termsSum = terms.reduce((a, t) => a + t.term, 0);
assertEq('decay terms sum == penalty(4)', termsSum, computeBacklogPenalty(4));

// Tie-break within same priority: oldest transferredFromDate first.
const ties = backlogDecayTerms([
  { taskId: 'newer', priority: 'extreme', transferredFromDate: '2026-10-05' },
  { taskId: 'older', priority: 'extreme', transferredFromDate: '2026-10-01' },
]);
if (ties[0]!.taskId !== 'older') {
  throw new Error('expected oldest extreme first, got ' + JSON.stringify(ties[0]));
}

// --- Composite: TaskCharts.md §5.5 Day-2 all-mid worked example -----------
// Day 2: 2 scheduled mid, 1 completed, 1 to backlog.
//   baseScore = 1.0 / 2 = +0.500
//   penalty(N=1) = -2.000
//   daily = -1.500
const d2Base = computeBaseScore(2, sumWeight(['mid']));
const d2Pen = computeBacklogPenalty(1);
assertEq('§5.5 Day2 baseScore', d2Base, 0.5);
assertEq('§5.5 Day2 penalty', d2Pen, -2);
assertEq('§5.5 Day2 total', d2Base + d2Pen, -1.5);

console.log('charts self-check: all assertions OK');
