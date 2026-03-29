"""Baseline Video Super-Resolution model architecture."""

import torch.nn as nn


class ResidualBlock(nn.Module):
    """Standard residual block with two 3x3 convolutions and skip connection."""

    def __init__(self, num_feat: int):
        super().__init__()
        self.conv1 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.relu = nn.ReLU(inplace=True)
        self.conv2 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)

    def forward(self, x):
        identity = x
        out = self.relu(self.conv1(x))
        out = self.conv2(out)
        return identity + out


class ResidualVSRModel(nn.Module):
    """
    Baseline CNN for Video Super-Resolution.

    Takes a temporal window of consecutive LR frames concatenated along the
    channel dimension and outputs a single upscaled frame (the central frame).

    Input:  [B, T, C, H, W]  — batch of T-frame sequences
    Output: [B, C, H*scale, W*scale] — single enhanced frame
    """

    def __init__(
        self,
        seq_len: int = 5,
        in_channels: int = 3,
        num_feat: int = 64,
        num_blocks: int = 10,
        scale: int = 4,
    ):
        super().__init__()
        self.seq_len = seq_len
        self.scale = scale

        self.conv_first = nn.Conv2d(seq_len * in_channels, num_feat, 3, 1, 1)
        self.body = nn.Sequential(*[ResidualBlock(num_feat) for _ in range(num_blocks)])

        self.upsample = nn.Sequential(
            nn.Conv2d(num_feat, num_feat * (scale ** 2), 3, 1, 1),
            nn.PixelShuffle(scale),
            nn.Conv2d(num_feat, 3, 3, 1, 1),
        )

    def forward(self, x):
        b, t, c, h, w = x.shape
        x = x.view(b, t * c, h, w)
        feat = self.conv_first(x)
        feat = self.body(feat)
        out = self.upsample(feat)
        return out
