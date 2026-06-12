"""Upscale AI baseline package — V3 model (BasicVSR + SPyNet, x4, seq=15)."""

from .model_architecture import BasicVSRRecurrentSeq
from .vsr_inference import VSRInferenceEngine, InferenceCancelledError

# V3 training-time hyperparameters (must match the trained checkpoint)
SCALE = 4
SEQ_LEN = 15
NUM_FEATS = 64
NUM_EXTRACT_BLOCKS = 5
NUM_PROP_BLOCKS = 20
NUM_RECON_BLOCKS = 5

__all__ = [
    "BasicVSRRecurrentSeq",
    "VSRInferenceEngine",
    "InferenceCancelledError",
    "SCALE",
    "SEQ_LEN",
    "NUM_FEATS",
    "NUM_EXTRACT_BLOCKS",
    "NUM_PROP_BLOCKS",
    "NUM_RECON_BLOCKS",
]
