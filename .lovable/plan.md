# Fixed-point macro solve for every meal

Extend the breakfast dairy-path solver so meals 2-5 hit their protein/carb/fat targets the same way, replacing the greedy "size one food at a time" pass that currently overshoots fat and undershoots protein.

## Approach

Today each meal sizes foods in sequence: vegetables at a fixed 100g each, then carbs, then protein, then fat, each one subtracting only from the target it was chosen for and leaving its other two macros to distort whatever comes next. A 100g avocado sized for fat also drops ~9g carbs the carb step never knew about.

New flow per meal (2-5):

1. Select the same foods as today (veg x2, one protein, one carb, one fat) and resolve their per-100g densities exactly as now.
2. Vegetables are fixed at 100g each and are **pre-deducted**: their protein, carbs and fat come off all three meal targets before the solve runs, producing residual targets tP/tC/tF.
3. Solve the three unknown gram weights (protein, carb, fat food) against the residual targets with the same fixed-point iteration the dairy breakfast uses: on each pass, each food is re-sized from its own primary target minus what the *other* foods currently contribute to that macro. ~10 iterations, which converges well within a gram for these density ranges.
4. Round each solved weight (5g steps, oils to whole tsp) and re-solve the remaining foods against the post-rounding residual so rounding error does not accumulate.
5. Place the foods and subtract their real contributions, so the existing `actual` accumulator and variance line stay accurate.

## Extracted vs new

One shared solver only. The iteration currently inlined in the dairy breakfast branch gets lifted into a single helper (e.g. `solveMealGrams`) that takes a list of `{ per100, primaryMacro, min, max, roundTo }` plus residual targets and returns gram weights. The dairy breakfast is switched over to call it — its flax/protein/slow-carb/fast-carb layout is just a four-food instance of the same problem — so there is exactly one implementation, not two.

Replaced in meals 2-5:
- the greedy `grams = remainingProtein * 100 / proteinPer100` sizing inside `placeProtein`
- the equivalent one-shot carb sizing in `placeCarbFromFound`
- the fat sizing and the `fatPer100 > 7` "fatty-protein cap" hack, which exists only to paper over the greedy ordering and becomes unnecessary
- the implicit assumption that vegetables are macro-free

## Untouched

No changes to: the exclusion filter and its synonym groups, the output-level exclusion drop, the brand filter and final brand scrub, the zero-macro guarantee and `CATEGORY_DEFAULT_PER100` fallback, `canonicalName` naming normalization, the oil `N tsp` display format, the egg breakfast path, and the dairy breakfast path's food choices and behaviour (only its solver call site moves to the shared helper; its outputs must stay identical).

## Food selection

Unchanged. AI candidate lists, `findUSDAFood` matching and its category filters, the pinned pools, fat rotation across slots, legume pairing detection, and all fallbacks pick the same foods as today. Only the gram weights they are placed at change.

## Edge cases

- **Negative residual** (vegetables or a multi-macro protein already exceed a target): the solver clamps that food's weight at its floor rather than emitting a negative or zero portion; the residual is reported in the variance line rather than being forced onto another food.
- **Portion caps**: per-category min/max grams (e.g. protein 60-300g, carbs 20-250g, oils 1-4 tsp, avocado capped) so the solve can never produce an absurd 700g portion to chase a macro. When a cap binds, the solver re-solves the remaining foods against the leftover.
- **Non-convergence / unreachable target**: after the iterations, take the best result and let the existing variance logging record the gap. No silent retry loops.
- **Rounding**: solve in continuous grams, round once at placement, re-solve the not-yet-placed foods after each rounding.
- **Old failure modes avoided**: fat overshoot from avocado is impossible because the avocado's carbs/protein are in the solve; protein undershoot is impossible because protein is solved jointly rather than last-in-line.

## Verification

Run several generations across meal counts (3, 4 and 5 meals/day) and different candidate sets, then read the per-meal variance lines the function already logs. Pass criterion: every meal within ~2g on protein, carbs and fat. Also run control generations for both breakfast paths (egg and dairy) and confirm the produced foods and gram weights are byte-identical to today's output. Report the actual per-meal numbers for a few generations before calling it done.

## Technical notes

All work is contained to `supabase/functions/generate-foodlist-plan/index.ts`. The density model, `src/lib/macros.ts`, `src/lib/portion.ts`, the editors and the client portal are untouched — the function still emits the same item shape with `withDensityModel` applied.
