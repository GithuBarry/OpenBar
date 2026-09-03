# Eval log

Protocol frozen 2025-02-20. Do not change these knobs without a new table.

- $k = 10$ independent samples
- temperature $1.0$, no tools, no RAG
- partition: `src/partition.py --alg classifier` (DeBERTa-v3-large, first 128 tokens)
- score: `src/score.py --patience 0.8` with Skywork-Reward-Gemma-2-27B-v0.2
- machine notes: vLLM for open-weight; vendor APIs for Claude / GPT / Gemini / Command R

## Runs that landed in Table 1

| Date (ET) | Split | What closed |
| --- | --- | --- |
| 2025-02-24 | curated | Gemma 2 family + Llama 3.2 1B/3B |
| 2025-03-03 | curated | Llama 3.1 8B / 3.3 70B / 3.1 405B |
| 2025-03-07 | both | Anthropic 3.5 Haiku/Sonnet + Opus |
| 2025-03-11 | both | GPT-4o / 4o-mini |
| 2025-03-14 | both | Gemini 1.5 Pro + 2.0 flash/pro |
| 2025-03-16 | both | Cohere Command R family |
| 2025-03-18 | both | `summarize.py` freeze for Table 1 |

Inverse scaling showed up as soon as Gemma-2-2B (distinct$_{10}$ 5.66) sat next to Gemma-2-27B (3.03). The 405B number (3.20) did not rescue the story.

## Prompting ablation (curated, 8 gens)

Closed 2025-03-19. In-context regeneration is the only method that reaches the eight-author human pool. System prompt and paraphrase are within noise of resampling.

## OLMo 2

Closed 2025-03-22. DPO is the diversity drop. Utility still goes up SFT → DPO.
