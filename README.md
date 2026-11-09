# Recitation 9: Property-Based Testing

The completed interval properties are in `test/intervals.test.ts`. Each property
has its English statement and pattern immediately above `it(...)`.

## Run

Use Node.js 20, 22, or 24+.

```sh
npm ci
npm run test:intervals
npm run mutants:intervals
npm run typecheck
```

## Checkpoint 1: repair the generator

The starter failed on the correct implementation with counterexample
`[[[1, 0]]]`. The generated interval `[1, 0]` violates `start <= end`, so the
specified `RangeError` is correct. The property was valid; its generator was not.
Mapping each endpoint pair to `[Math.min(a, b), Math.max(a, b)]` constructs valid
inputs without `.filter` or `fc.pre`. The repaired starter passed and killed
4 of 7 mutants in all five runs.

## Checkpoint 2: properties and observed results

After every addition, `test:intervals` passed before `mutants:intervals` ran.
The following results record the initial wide-integer generator, before the
targeted generators were added. Every mutation check used five fresh seeds.

| Property added | Pattern | Mutants killed by that property in the observed runs |
| --- | --- | --- |
| Every input interval is contained in an output interval | Invariant | `assumesSorted`, `lexicographicSort`, `keepsLastEnd`, `dropsLast` |
| Output is valid, sorted, and strictly separated | Invariant | `touchingNotMerged` in only 1/5 runs: flaky |
| Input and output cover the same real points | Differential | `assumesSorted`, `lexicographicSort`, `keepsLastEnd`, `dropsLast` |
| Reordering and duplicating inputs preserves the result | Metamorphic | `assumesSorted`, `keepsLastEnd` |
| Merging twice equals merging once | Algebraic | `dropsLast` |
| Already separated inputs are returned sorted and unchanged | Conditional | `assumesSorted`, `lexicographicSort`, `mergesIntegerNeighbors`, `dropsLast` |

The differential oracle only asks whether a point lies in any interval. It checks
all endpoints, midpoints between consecutive endpoints, points outside the
union, and an independently generated integer. For the bounded integer endpoints
generated here, coverage cannot change between adjacent endpoints. Checking
midpoints therefore detects real-number gaps, including the gap between
`[1, 2]` and `[3, 4]`.

The conditional generator constructs separated intervals directly using
nonnegative widths and strictly positive gaps, then shuffles the list. No
precondition filtering is needed.

## Checkpoint 3: survivors and fixes

| Survivor or flaky mutant | Missing check or generator? | Fix and result |
| --- | --- | --- |
| `touchingNotMerged` | Generator: independent wide endpoints rarely coincide | Construct touching pairs directly; also include an explicit touching example. The shape invariant kills it in 5/5 runs. |
| `mergesIntegerNeighbors` | Generator: wide endpoints rarely leave a one-unit gap | Construct separated lists and one-unit-gap pairs. The conditional property and midpoint coverage check kill it in 5/5 runs. |
| `aliasesInput` | Property: equivalent coverage does not establish input preservation | Snapshot both endpoint values and array-entry references before merging. The added invariant kills it in 5/5 runs. |

The final valid-input generator mixes wide and small integer lists with touching
pairs, one-unit gaps, and nested intervals containing duplicates and singleton
intervals. Empty lists and singleton intervals are also explicit shape examples.
With the input-preservation invariant added, all seven mutants were killed in
all five runs, before adding the final validation property.

An eighth property checks the precondition contract: an invalid interval anywhere
in the list must throw `RangeError`. It constructs reversed endpoints,
fractional endpoints, `NaN`, and infinities directly.

## Final verification

- `npm run test:intervals`: all 8 properties passed.
- `npm run mutants:intervals`: all 8 properties passed on the real implementation
  in 5/5 runs; all 7 mutants were killed in 5/5 runs (100%, no flaky mutants).
- `npm run typecheck`: passed.
- `npm test`: 8 passed; the 4 unrelated Wordle starter todos remain pending.

The final mutation-runner output, including counterexamples, is saved in
[`MUTATION_RESULTS.txt`](MUTATION_RESULTS.txt). Production implementations and
mutant definitions are unchanged; tests import only through `../src/intervals`.
