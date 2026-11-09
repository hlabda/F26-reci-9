import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mergeIntervals, type Interval } from '../src/intervals';

// Construct valid endpoints instead of discarding reversed pairs.
const interval: fc.Arbitrary<Interval> = fc.tuple(fc.integer(), fc.integer())
  .map(([a, b]): Interval => [Math.min(a, b), Math.max(a, b)]);
const smallInterval: fc.Arbitrary<Interval> = fc.tuple(
  fc.integer({ min: -20, max: 20 }), fc.integer({ min: -20, max: 20 }),
).map(([a, b]): Interval => [Math.min(a, b), Math.max(a, b)]);

// Construct relationships that independent wide integers rarely hit exactly.
const touchingList = fc.tuple(
  fc.integer({ min: -1000, max: 1000 }), fc.nat(20), fc.nat(20),
).map(([start, left, right]): Interval[] => [
  [start + left, start + left + right], [start, start + left],
]);
const gappedList = fc.tuple(
  fc.integer({ min: -1000, max: 1000 }), fc.nat(20), fc.nat(20),
).map(([start, left, right]): Interval[] => [
  [start, start + left], [start + left + 1, start + left + 1 + right],
]);
const nestedList = fc.tuple(
  fc.integer({ min: -1000, max: 1000 }), fc.nat(20),
).map(([start, width]): Interval[] => [
  [start, start + width + 2], [start + 1, start + width + 1],
  [start, start + width + 2], [start + 1, start + 1],
]);
const intervalList = fc.oneof(
  fc.array(interval), fc.array(smallInterval), touchingList, gappedList, nestedList,
);

const copyIntervals = (xs: readonly Interval[]): Interval[] =>
  xs.map(([start, end]): Interval => [start, end]);

// This is a point-membership oracle, not a second merging implementation.
const covers = (xs: readonly Interval[], point: number): boolean =>
  xs.some(([start, end]) => start <= point && point <= end);

const permutedList = intervalList.chain(xs =>
  fc.shuffledSubarray(xs, { minLength: xs.length, maxLength: xs.length })
    .map(shuffled => ({ xs, shuffled })),
);

// Each interval starts strictly after the preceding end. Zero-width intervals
// and one-unit gaps are valid; neither overlap nor touching can be generated.
const separatedList = fc.tuple(
  fc.integer({ min: -1000, max: 1000 }),
  fc.array(fc.tuple(fc.nat(20), fc.integer({ min: 1, max: 5 }))),
).map(([start, steps]) => {
  let cursor = start;
  return steps.map(([width, gap]): Interval => {
    const next: Interval = [cursor, cursor + width];
    cursor = next[1] + gap;
    return next;
  });
}).chain(sorted =>
  fc.shuffledSubarray(sorted, { minLength: sorted.length, maxLength: sorted.length })
    .map(shuffled => ({ sorted, shuffled })),
);

const invalidInterval: fc.Arbitrary<Interval> = fc.oneof(
  // Strictly reversed endpoints, without filtering out valid pairs.
  fc.tuple(fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: 1, max: 20 }))
    .map(([start, gap]): Interval => [start + gap, start]),
  // Ordered endpoints with a non-integer at either end.
  fc.tuple(fc.integer({ min: -1000, max: 1000 }), fc.nat(20), fc.boolean())
    .map(([start, width, fractionalStart]): Interval => fractionalStart
      ? [start + 0.5, start + width + 1]
      : [start, start + width + 0.5]),
  fc.constantFrom<Interval>(
    [NaN, 0], [0, NaN], [-Infinity, 0], [0, Infinity],
    [Infinity, Infinity], [-Infinity, -Infinity],
  ),
);

describe('mergeIntervals', () => {
  // Pattern: invariant. Every input interval lies inside some output interval.
  it('every input interval lies inside some output interval', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const out = mergeIntervals(xs);
        for (const [s, e] of xs) {
          expect(out.some(([a, b]) => a <= s && e <= b)).toBe(true);
        }
      }),
    );
  });

  // Pattern: invariant. Output intervals are valid, sorted, and strictly separated.
  it('output intervals are valid, sorted, and neither overlap nor touch', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const out = mergeIntervals(xs);
        for (let i = 0; i < out.length; i++) {
          const [start, end] = out[i];
          expect(Number.isInteger(start)).toBe(true);
          expect(Number.isInteger(end)).toBe(true);
          expect(start).toBeLessThanOrEqual(end);
          if (i > 0) expect(out[i - 1][1]).toBeLessThan(start);
        }
        expect(out.length).toBeLessThanOrEqual(xs.length);
      }),
      { examples: [[[]], [[[0, 0]]], [[[1, 3], [3, 5]]], [[[1, 2], [3, 4]]]] },
    );
  });

  // Pattern: differential. Input and output cover exactly the same real points.
  it('preserves coverage at endpoints, between endpoints, and outside the union', () => {
    fc.assert(
      fc.property(intervalList, fc.integer(), (xs, point) => {
        const before = copyIntervals(xs);
        const out = mergeIntervals(xs);
        const endpoints = [...before.flat(), ...out.flat()].sort((a, b) => a - b);
        const probes = [point];
        for (let i = 0; i < endpoints.length; i++) {
          probes.push(endpoints[i]);
          if (i > 0) probes.push((endpoints[i - 1] + endpoints[i]) / 2);
        }
        if (endpoints.length > 0) {
          probes.push(endpoints[0] - 0.5, endpoints[endpoints.length - 1] + 0.5);
        }
        // Coverage is constant between consecutive endpoints. Midpoints also
        // check fractional gaps such as the one between [1, 2] and [3, 4].
        for (const p of probes) expect(covers(out, p)).toBe(covers(before, p));
      }),
    );
  });

  // Pattern: metamorphic. Reordering or duplicating inputs does not change their union.
  it('reordering and duplicating intervals does not change the result', () => {
    fc.assert(
      fc.property(permutedList, ({ xs, shuffled }) => {
        const expected = copyIntervals(mergeIntervals(copyIntervals(xs)));
        expect(mergeIntervals(copyIntervals(shuffled))).toEqual(expected);
        expect(mergeIntervals(copyIntervals([...shuffled, ...shuffled]))).toEqual(expected);
      }),
    );
  });

  // Pattern: algebraic. Merging an already merged list is idempotent.
  it('merging an already merged list leaves it unchanged', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const once = copyIntervals(mergeIntervals(copyIntervals(xs)));
        expect(mergeIntervals(copyIntervals(once))).toEqual(once);
      }),
    );
  });

  // Pattern: conditional. Already separated intervals are returned in sorted order unchanged.
  it('already separated intervals are preserved, including one-unit gaps', () => {
    fc.assert(
      fc.property(separatedList, ({ sorted, shuffled }) => {
        expect(mergeIntervals(copyIntervals(shuffled))).toEqual(sorted);
      }),
    );
  });

  // Pattern: invariant. Merging never changes the input array or its interval objects.
  it('does not modify the input array or any interval in it', () => {
    fc.assert(
      fc.property(intervalList, xs => {
        const before = copyIntervals(xs);
        const references = [...xs];
        mergeIntervals(xs);
        expect(xs).toEqual(before);
        for (let i = 0; i < xs.length; i++) expect(xs[i]).toBe(references[i]);
      }),
      { examples: [[[[3, 5], [1, 3], [2, 2]]]] },
    );
  });

  // Pattern: conditional. Any reversed or non-integer interval causes a RangeError.
  it('rejects an invalid interval anywhere in the list with a RangeError', () => {
    fc.assert(
      fc.property(fc.array(interval), invalidInterval, fc.array(interval), (before, bad, after) => {
        expect(() => mergeIntervals([...before, bad, ...after])).toThrow(RangeError);
      }),
    );
  });
});
