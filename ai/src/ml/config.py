"""ML hyperparameter configuration for the video restoration model."""

from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass(frozen=True)
class MLConfig:
    """Single source of truth for all deep learning hyperparameters.

    Frozen dataclass — create a new instance to change values.
    Saved inside checkpoints to reconstruct models at inference time.
    """

    # ── Model ──────────────────────────────────────────────────────────
    num_input_frames: int = 5
    num_channels: int = 3
    num_features: int = 64
    num_residual_blocks: int = 10
    upscale_factor: int = 2  # Supported: 2 or 4

    # ── Training ───────────────────────────────────────────────────────
    batch_size: int = 8
    patch_size: int = 64  # LR patch size; HR = patch_size * upscale_factor
    learning_rate: float = 2e-4
    weight_decay: float = 0.0
    num_epochs: int = 200
    lr_scheduler: str = "cosine"  # "cosine" | "step"
    step_lr_step_size: int = 50
    step_lr_gamma: float = 0.5
    gradient_clip_norm: float = 1.0

    # ── Loss ───────────────────────────────────────────────────────────
    l1_weight: float = 1.0
    perceptual_weight: float = 0.0  # 0 = disabled
    charbonnier_epsilon: float = 1e-6

    # ── Data ───────────────────────────────────────────────────────────
    data_root: str = ""
    train_split: float = 0.8
    val_split: float = 0.1
    test_split: float = 0.1
    num_workers: int = 4

    # ── Degradation ────────────────────────────────────────────────────
    downscale_range: tuple[float, float] = (2.0, 4.0)
    noise_sigma_range: tuple[float, float] = (0.0, 25.0)
    blur_kernel_range: tuple[int, int] = (3, 7)
    blur_sigma_range: tuple[float, float] = (0.5, 2.0)
    jpeg_quality_range: tuple[int, int] = (20, 70)

    # ── Checkpoint / Logging ───────────────────────────────────────────
    checkpoint_dir: str = "checkpoints"
    save_every_n_epochs: int = 10
    log_dir: str = "logs"

    # ── Device ─────────────────────────────────────────────────────────
    device: str = "auto"  # "auto" | "cuda" | "cpu"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "MLConfig":
        # Convert tuple fields back from lists (JSON serialization)
        for key in ("downscale_range", "noise_sigma_range", "blur_kernel_range",
                     "blur_sigma_range", "jpeg_quality_range"):
            if key in d and isinstance(d[key], list):
                d[key] = tuple(d[key])
        return cls(**d)
