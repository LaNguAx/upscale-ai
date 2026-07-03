# UPscale AI — model architecture deep dive

The neural network behind UPscale is **`BasicVSRRecurrentSeq`** — a bidirectional recurrent video super-resolution (VSR) network in the style of [BasicVSR (Chan et al., CVPR 2021)](https://arxiv.org/abs/2012.02181), with a pretrained [SPyNet (Ranjan & Black, CVPR 2017)](https://arxiv.org/abs/1611.00850) for optical-flow alignment. It upscales video **4×** by processing **15-frame sequences**, so every output frame is reconstructed with temporal context from 14 neighbors instead of being upscaled in isolation.

- Definition: [`baseline/model_architecture.py`](baseline/model_architecture.py) (frozen — do not modify without an explicit request)
- Hyperparameters: [`baseline/__init__.py`](baseline/__init__.py) (`SCALE=4`, `SEQ_LEN=15`, `NUM_FEATS=64`, `NUM_EXTRACT_BLOCKS=5`, `NUM_PROP_BLOCKS=20`, `NUM_RECON_BLOCKS=5`)
- Training recipe: [`baseline/Model_v3.ipynb`](baseline/Model_v3.ipynb) (the V3 checkpoint was trained there)
- Inference wrapper: [`baseline/vsr_inference.py`](baseline/vsr_inference.py) (`VSRInferenceEngine`)
- Deployed weights: `checkpoints/vsr_model_best.pth` (~21 MB, gitignored)

**Total: 5,587,887 trainable parameters.**

| Component | Parameters | Role |
| --- | ---: | --- |
| `feat_extractor` | 371,072 | Per-frame shallow feature extraction (3→64 ch) |
| `flow_estimator` (SPyNet) | 1,440,300 | Optical flow between neighboring frames (6 pyramid levels × 240,050) |
| `backward_trunk` | 1,550,912 | Recurrent propagation, future → past |
| `forward_trunk` | 1,550,912 | Recurrent propagation, past → future |
| `fusion` | 377,536 | Merge the two temporal directions |
| `upsample` | 297,155 | 4× PixelShuffle reconstruction to RGB |

## 1. End-to-end dataflow

Input is a batch of LR (low-resolution) frame sequences shaped `[B, T, 3, H, W]`, RGB, `float32` in `[0, 1]` (`T = 15`, odd by assertion). Output is `[B, T, 3, 4H, 4W]`, clamped to `[0, 1]`.

```
LR sequence x: [B, T, 3, H, W]
      │
      ├─► feat_extractor (per frame) ──────────► feats[t]: [B, 64, H, W]
      │
      └─► SPyNet (per neighbor pair) ──► flows_forward[t]  (frame t   → t-1)
                                         flows_backward[t] (frame t   → t+1)
      BACKWARD PASS  (t = T-1 … 0)
        prop ← flow_warp(prop, flows_backward[t])
        prop ← backward_trunk(concat[feats[t], prop])          ─► backward_feats[t]
      FORWARD PASS   (t = 0 … T-1)
        prop ← flow_warp(prop, flows_forward[t-1])
        prop ← forward_trunk(concat[feats[t], prop])
        fused  = fusion(concat[prop, backward_feats[t]])       [B, 64, H, W]
        out[t] = clamp(upsample(fused), 0, 1)                  [B, 3, 4H, 4W]
```

Two ideas carry the whole design:

1. **Bidirectional recurrence** — a hidden state (64-channel feature map, zero-initialized) is threaded across the sequence twice, once backward and once forward, so frame `t` aggregates evidence from the *entire* window on both sides.
2. **Flow-guided alignment** — before the hidden state is fused with the next frame's features, it is warped by the optical flow between the frames, so propagated details land on the right pixels even under motion.

## 2. Building blocks

### `ResidualBlock` (used everywhere)

Plain pre-activation-free residual unit, no normalization layers:

```
x ──► Conv2d(C→C, 3×3, pad 1) ──► LeakyReLU(0.1) ──► Conv2d(C→C, 3×3, pad 1) ──►(+)──► out
└───────────────────────────── identity ───────────────────────────────────────┘
```

### `ConvResidualBlocks(in, out, N)`

A head `Conv2d(in→out, 3×3) + LeakyReLU(0.1)` followed by `N` × `ResidualBlock(out)`. This is the shape of the feature extractor and both propagation trunks.

## 3. Input layer / feature extraction

`feat_extractor = ConvResidualBlocks(3, 64, 5)` — the "input layer" of the network. All `B·T` frames are flattened into one batch and mapped `3 → 64` channels at the **LR resolution** (no downsampling anywhere in the network; all spatial reasoning happens at LR scale until the final upsampler):

```
[B·T, 3, H, W] ─ Conv3×3 + LReLU ─► [B·T, 64, H, W] ─ 5× ResidualBlock ─► reshaped to T × [B, 64, H, W]
```

## 4. SPyNet — optical flow estimation

A 6-level spatial-pyramid coarse-to-fine flow network. Weights are **initialized from OpenMMLab's pretrained SPyNet** (`spynet_20210409-c6c1bd09.pth`, auto-downloaded to the system temp dir on first model load) and then fine-tuned during training at a reduced learning rate.

### Per-level module (`SPyNetBasicModule`)

Every pyramid level has an identical 5-layer CNN. All kernels are **7×7, stride 1, pad 3**; ReLU between layers, **no activation after the last** (it predicts a signed flow residual):

```
input [8ch] ─ Conv7×7 → 32 ─ ReLU ─ Conv7×7 → 64 ─ ReLU ─ Conv7×7 → 32 ─ ReLU ─ Conv7×7 → 16 ─ ReLU ─ Conv7×7 → 2
```

The 8 input channels are the concatenation of: reference frame (3) + supporting frame *warped by the current flow estimate* (3) + upsampled flow from the coarser level (2). The 2 output channels are the flow refinement `(dx, dy)`.

### Coarse-to-fine estimation

1. Both frames are normalized with ImageNet statistics (`mean [0.485, 0.456, 0.406]`, `std [0.229, 0.224, 0.225]`) — a preprocessing quirk inherited from the pretrained weights.
2. A 6-level pyramid is built with five successive `avg_pool2d(2×2)` steps (finest = input resolution, coarsest = 1/32).
3. Flow starts as zeros at the coarsest level. At each level: upsample the flow ×2 (bilinear, values ×2), warp the supporting frame with it (`grid_sample`, bilinear, border padding), run the level's module on `[ref, warped, flow]`, and **add** the predicted residual. Repeat down to full resolution.

The model computes flow for every adjacent pair, in both directions: `flows_backward[i] = flow(x_i → x_{i+1})` used by the backward pass, `flows_forward[i-1] = flow(x_i → x_{i-1})` used by the forward pass — `2·(T−1) = 28` flow estimations per 15-frame window.

### `flow_warp`

Backward warping via `F.grid_sample` (bilinear, `padding_mode="border"`, `align_corners=True`): a normalized identity grid is offset by the flow and used to sample the propagated feature map. Inputs, grids, and outputs are scrubbed with `nan_to_num`/clamping — defensive guards against non-finite values destabilizing the recurrence on pathological inputs.

## 5. Recurrent propagation trunks

Both trunks are `ConvResidualBlocks(128, 64, 20)` — the deepest parts of the network (20 residual blocks each):

- **Backward trunk** (runs `t = T−1 → 0`): hidden state warped by `flows_backward[t]`, concatenated with `feats[t]` (64+64=128 ch), reduced back to 64. Results are stored per frame.
- **Forward trunk** (runs `t = 0 → T−1`): identical shape, using `flows_forward`, executed second so its output can be fused immediately with the stored backward feature of the same frame.

Both hidden states start as zeros at their respective sequence ends.

## 6. Fusion and reconstruction

`fusion` merges the two directions for each frame: `Conv2d(128→64, 1×1) + LeakyReLU(0.1)` followed by **5 × ResidualBlock(64)** (the "reconstruction blocks").

`upsample = PixelShuffleUpsample(64, scale=4)` then brings the fused 64-channel LR feature map to HR RGB with two sub-pixel convolution stages:

```
[B, 64, H, W]
  ─ Conv3×3 64→256 ─ PixelShuffle(2) ─ LReLU ─   # [B, 64, 2H, 2W]
  ─ Conv3×3 64→256 ─ PixelShuffle(2) ─ LReLU ─   # [B, 64, 4H, 4W]
  ─ Conv3×3 64→3                                 # [B, 3, 4H, 4W]
─► clamp(·, 0, 1)
```

(`scale=2` is also implemented with a single stage; the deployed checkpoint is ×4. Note there is no global bicubic skip-connection — the upsampler reconstructs the HR image directly from features.)

## 7. Training (the V3 recipe, `Model_v3.ipynb`)

The deployed checkpoint was trained in `baseline/Model_v3.ipynb`; the notebook is the source of truth for everything below. The architecture constants in `baseline/__init__.py` must match it exactly or the checkpoint will not load.

### Data

- **REDS sharp** clips (`train_sharp.zip` / `val_sharp.zip`), extracted and re-split: 5 validation clips kept for validation, 5 moved to a held-out test split, up to 200 frames per sequence.
- LR inputs are **synthesized offline** from the sharp HR frames with a realistic degradation pipeline (this is what makes the model a *restoration* model rather than a pure downscale-inverter — it matches the old/compressed footage the product targets). Per frame, applied in order, each step probabilistic:

| Step | Probability | Parameters |
| --- | --- | --- |
| Gaussian blur | 0.6 | kernel ∈ {3, 5}, σ ∈ [0.5, 1.6] |
| Motion blur (horizontal box kernel) | 0.15 | kernel ∈ {5, 7} |
| Additive Gaussian noise | 0.6 | σ ∈ [1, 10] (8-bit scale) |
| JPEG re-compression | 0.6 | quality ∈ [35, 75] |
| Downscale ×4 | always | `cv2.resize`, `INTER_AREA` |

- Sampling: every valid 15-frame window (sliding, centered) is a training sample. Random **64×64 LR crops** (→ 256×256 HR targets), augmented with horizontal/vertical flips and 90° rotation (each p = 0.5), applied identically across the window.
- Degradation simulation is a **training-time concept only** — at inference the input is upscaled as-is (see `AGENTS.md`).

### Loss function — `CombinedRestorationLoss`

Weighted sum of three terms, computed on the full output sequence against the HR ground-truth sequence:

```
L = 1.0 · L_charbonnier + 0.05 · L_edge + 0.1 · L_perceptual
```

1. **Charbonnier loss** (`ε = 1e-6`): `mean(√((pred − target)² + ε²))` — a differentiable, outlier-robust L1 variant; the standard VSR fidelity term.
2. **Sobel edge loss**: L1 distance between Sobel gradient magnitudes (per-channel 3×3 Sobel-x/y, `√(gx² + gy² + 1e-6)`) of prediction and target — sharpens edges the plain fidelity term tends to blur.
3. **VGG19 perceptual loss**: L1 distance between frozen ImageNet-pretrained VGG19 feature maps at **`relu2_2`** (layers 0–8) and **`relu4_4`** (layers 9–26), inputs ImageNet-normalized — pushes outputs toward perceptually plausible textures.

### Optimization

| Setting | Value |
| --- | --- |
| Optimizer | AdamW, weight decay `1e-4` |
| Learning rate | `2e-4` main network; **`2.5e-5` (0.125×) for SPyNet** (fine-tuning the pretrained flow weights gently, per the BasicVSR paper) |
| Scheduler | `ReduceLROnPlateau` on val loss (factor 0.5, patience 5, min LR `1e-6`) |
| Batch | 4 sequences × 15 frames × 64×64 LR crops |
| Epochs | 150 (early stopping implemented but disabled) |
| Gradient clipping | global norm 1.0 |
| AMP | supported in the loop, **disabled** for the V3 run |
| Seed | 42 |
| Robustness | batches with non-finite inputs/outputs/losses are skipped and counted |

### Evaluation and checkpoint selection

- **PSNR** (border-shaved by `scale`=4 px) and **SSIM** (scikit-image), reported against a **bicubic ×4 baseline** on the same data; fast validation every epoch (20 batches), full validation every 2 epochs.
- The notebook tracks `vsr_model_best_loss.pth`, `vsr_model_best_psnr.pth`, and `vsr_model_last.pth` (plus resumable optimizer/scheduler state). The deployed `checkpoints/vsr_model_best.pth` is the selected export of that run.

## 8. Inference-time behavior (`VSRInferenceEngine`)

How the trained network is actually driven in production (details in `AGENTS.md`):

- **Sliding-window, per-frame output**: for output frame `i`, a 15-frame window centered on `i` is assembled (shifted at clip boundaries; padded by repeating the last frame near the end) and run through the model; **only the center frame's output is kept** (`pred[0, i − start]`). This trades ~15× redundant compute for maximum temporal context per frame with bounded memory.
- Frames taller than `MAX_INPUT_HEIGHT` (480) are downscaled first, aspect preserved — so worst-case output is ~1920 px tall.
- All frames are decoded into RAM up front (`ffmpeg` transcode fallback if OpenCV can't read the container); BGR↔RGB conversion and `/255` normalization at the tensor boundary.
- The raw output is written with OpenCV (`mp4v`) and then **re-encoded to H.264/yuv420p by `server.py`** for browser playback, alongside a low-res original-comparison video and sampled preview frame pairs — see `apps/ai/AGENTS.md` for that pipeline.
- Per-frame hooks: `progress_callback(i, n)`, `should_cancel()`, and `preview_callback(i, n, sr_bgr, lr_bgr)` — the engine stays free of any preview/sampling policy.

## 9. Invariants to respect

- `seq_len` must be **odd** (constructor raises otherwise) — windows are centered.
- The constants in `baseline/__init__.py` are **checkpoint-bound**: changing them without retraining breaks `load_state_dict`.
- First model load needs network access once (SPyNet pretrained download from OpenMMLab).
- `baseline/` is frozen reference code — model or engine changes require an explicit request (see `AGENTS.md`).

## References

- Chan et al., *BasicVSR: The Search for Essential Components in Video Super-Resolution and Beyond*, CVPR 2021 — [arXiv:2012.02181](https://arxiv.org/abs/2012.02181)
- Ranjan & Black, *Optical Flow Estimation using a Spatial Pyramid Network*, CVPR 2017 — [arXiv:1611.00850](https://arxiv.org/abs/1611.00850)
- Nah et al., *NTIRE 2019 Challenge on Video Deblurring and Super-Resolution: Dataset (REDS)*, CVPRW 2019
- Pretrained SPyNet weights: [OpenMMLab mmediting](https://github.com/open-mmlab/mmagic)
- Shi et al., *Real-Time Single Image and Video Super-Resolution Using an Efficient Sub-Pixel Convolutional Neural Network* (PixelShuffle), CVPR 2016
