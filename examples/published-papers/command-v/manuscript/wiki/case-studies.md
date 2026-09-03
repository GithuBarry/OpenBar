# Case study log

DiReFT rank 8, every other donor layer, last-token, 6 epochs. Conservative batches 2 (3B) and 4 (8B). Larger batches trained faster and defended worse.

## Refusal (WildJailbreak)

Closed 2025-04-27.

| Direction | Harmful ASR |
| --- | --- |
| 3B off-shelf → ReFT | 31.30% → 12.20% (dip 5.65%) |
| 8B off-shelf → ReFT | 36.85% → 28.55% (dip 21.05%) |
| 3B → 8B paste | 36.85% → 20.40% |
| 8B → 3B paste | → 16.4% |

Overrefusal on 221 adversarial-benign, human labeled 2025-05-06: 8B 1.36 / 2.26 / 4.52; 3B 3.17 / 8.60 / 14.48 (off-shelf / ReFT / paste).

## Jailbreak (AdvBench + HarmBench)

Closed 2025-05-28. Qwen2.5-7B best donor (mean 41.2% / 46.9%, peak 80.7% / 81.5% on 1.5B). Llama-3.2-1B most susceptible recipient. Gemma2-2B-it never meaningfully jailbroke.

## Auto-CoT (OpenMathReasoning → BBH)

Closed 2025-06-09. Replace `<thinking>` with words before porting. Qwen2.5-3B multistep arithmetic +50%. JSON fail rate up to 28.8%.

## Negative

Commonsense ReFT and TOFU: donor barely moves, recipient does not. Logged 2025-06-11. Do not put these in the teaser.
