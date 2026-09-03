# Annotation protocol

Functional equivalence, not surface form. Two generations are the same class if a user who already saw one would not benefit from the other.

Positive (equivalent): same plot with swapped names; same recommended car with different adjectives; same Fields Medalist with a longer bio.

Negative (distinct): different entities, different jokes, different d20 values, different recipes.

## Pair set

- 1,100 pairs, mixed NB-Curated and NB-WildChat, mixed model families
- 1,000 train / 100 held-out
- Susan Holm owned the bulk of the equivalence labels and the WildChat prompt audit

## Classifier

`microsoft/deberta-v3-large`, max length 128. Held-out accuracy 79%, F1 0.811. BLEU / ROUGE / BERTScore were not close enough to use.

The 128-token window is a ceiling, not a bug relative to training. Long-form generations that only diverge late will be under-counted. Call that out if anyone applies the harness to stories.

## Human diversity pool

Eight authors, same institution. Treat as a lower bound. Dice rolls and Fields Medalists already beat GPT-4o resampling.
