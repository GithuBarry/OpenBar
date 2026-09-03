# Compute notes

Profiles: `step1_capture_activations.py`, LIMA train $N=1030$, last token, every layer, batch 4, bfloat16. Once per model.

Converters: `step2_derive_converters.py`, Moore-Penrose on CPU. Mean 6.35s for 14--18 pairs on a MacBook Pro. 3B↔8B is 25.2M params/pair × 14 = 352.8M converter params, still cheap next to a backward pass.

Inference: `step3_commandv_inference.py`. ReFT modules fire once per sequence on last prompt tokens.

Refusal Pareto plot (Fig 2) includes amortized profiling cost on A100 40GB. Do not drop that cost when someone asks "is paste free."
