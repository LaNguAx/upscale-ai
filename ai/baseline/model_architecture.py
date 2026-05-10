"""VSR Model Architecture - for backend inference."""

import os
import torch
import torch.nn as nn
import torch.nn.functional as F
import urllib.request

class ResidualBlock(nn.Module):
    def __init__(self, channels):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, 3, 1, 1)
        self.conv2 = nn.Conv2d(channels, channels, 3, 1, 1)
        self.act = nn.LeakyReLU(0.1, inplace=True)

    def forward(self, x):
        identity = x
        out = self.act(self.conv1(x))
        out = self.conv2(out)
        return identity + out

class ConvResidualBlocks(nn.Module):
    def __init__(self, in_channels, out_channels, num_blocks):
        super().__init__()
        self.head = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, 3, 1, 1),
            nn.LeakyReLU(0.1, inplace=True)
        )
        self.body = nn.Sequential(*[ResidualBlock(out_channels) for _ in range(num_blocks)])

    def forward(self, x):
        return self.body(self.head(x))


# ===================== SPyNet =====================
class SPyNetBasicModule(nn.Module):
    """A single level of SPyNet."""
    def __init__(self):
        super().__init__()
        self.basic_module = nn.ModuleList([
            self._make_layer(8, 32),
            self._make_layer(32, 64),
            self._make_layer(64, 32),
            self._make_layer(32, 16),
            self._make_layer(16, 2),
        ])

    def _make_layer(self, in_ch, out_ch):
        m = nn.Module()
        m.conv = nn.Conv2d(in_ch, out_ch, 7, 1, 3)
        return m

    def forward(self, tensor_input):
        x = tensor_input
        for i, layer in enumerate(self.basic_module):
            x = layer.conv(x)
            if i < len(self.basic_module) - 1:  # no ReLU on last layer
                x = F.relu(x, inplace=True)
        return x

class SPyNet(nn.Module):
    """SPyNet: Spatial Pyramid Network for optical flow estimation.
    Pretrained weights from: https://github.com/open-mmlab/mmediting
    """
    PRETRAINED_URL = (
        "https://download.openmmlab.com/mmediting/restorers/"
        "basicvsr/spynet_20210409-c6c1bd09.pth"
    )

    def __init__(self, pretrained=True):
        super().__init__()
        self.basic_module = nn.ModuleList([SPyNetBasicModule() for _ in range(6)])

        if pretrained:
            import urllib.request, tempfile, os
            weights_dir = os.path.join(tempfile.gettempdir(), "spynet_weights")
            os.makedirs(weights_dir, exist_ok=True)
            weights_path = os.path.join(weights_dir, "spynet_20210409-c6c1bd09.pth")
            if not os.path.exists(weights_path):
                print(f"Downloading SPyNet weights to {weights_path}...")
                urllib.request.urlretrieve(self.PRETRAINED_URL, weights_path)
                print("Download complete.")
            state_dict = torch.load(weights_path, map_location="cpu")
            self.load_state_dict(state_dict)
            print("Loaded pretrained SPyNet weights")

        self.register_buffer("mean", torch.Tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        self.register_buffer("std", torch.Tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))

    def preprocess(self, tensor_input):
        return (tensor_input - self.mean) / self.std

    def forward(self, ref, supp):
        """Estimate optical flow from ref to supp."""
        ref = [self.preprocess(ref)]
        supp = [self.preprocess(supp)]

        # build pyramid
        for _ in range(5):
            ref.insert(0, F.avg_pool2d(ref[0], kernel_size=2, stride=2, count_include_pad=False))
            supp.insert(0, F.avg_pool2d(supp[0], kernel_size=2, stride=2, count_include_pad=False))

        flow = ref[0].new_zeros(ref[0].shape[0], 2, ref[0].shape[2], ref[0].shape[3])

        for level in range(len(ref)):
            upsampled_flow = F.interpolate(flow, scale_factor=2, mode="bilinear", align_corners=True) * 2.0 if level > 0 else flow

            # pad if needed
            h, w = ref[level].shape[2:4]
            uh, uw = upsampled_flow.shape[2:4]
            if uh != h or uw != w:
                upsampled_flow = F.interpolate(upsampled_flow, size=(h, w), mode="bilinear", align_corners=True)

            # warp supp
            flow_for_warp = upsampled_flow.permute(0, 2, 3, 1)
            b, fh, fw, _ = flow_for_warp.shape
            yy, xx = torch.meshgrid(torch.arange(fh, device=flow.device, dtype=flow.dtype),
                                     torch.arange(fw, device=flow.device, dtype=flow.dtype), indexing="ij")
            grid = torch.stack((xx, yy), dim=-1).unsqueeze(0).expand(b, -1, -1, -1)
            vgrid = grid + flow_for_warp
            vgrid[..., 0] = 2.0 * vgrid[..., 0] / max(fw - 1, 1) - 1.0
            vgrid[..., 1] = 2.0 * vgrid[..., 1] / max(fh - 1, 1) - 1.0
            warped = F.grid_sample(supp[level], vgrid, mode="bilinear", padding_mode="border", align_corners=True)

            flow_input = torch.cat([ref[level], warped, upsampled_flow], dim=1)
            flow = upsampled_flow + self.basic_module[level](flow_input)

        return flow


# ===================== Flow Warp =====================
def flow_warp(x, flow):
    x = torch.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)
    flow = torch.nan_to_num(flow, nan=0.0, posinf=0.0, neginf=0.0)

    b, c, h, w = x.shape
    yy, xx = torch.meshgrid(torch.arange(h, device=x.device), torch.arange(w, device=x.device), indexing="ij")
    grid = torch.stack((xx, yy), dim=0).float().unsqueeze(0).repeat(b, 1, 1, 1)
    vgrid = grid + flow

    vgrid_x = 2.0 * vgrid[:, 0] / max(w - 1, 1) - 1.0
    vgrid_y = 2.0 * vgrid[:, 1] / max(h - 1, 1) - 1.0
    vgrid_x = torch.clamp(torch.nan_to_num(vgrid_x, nan=0.0, posinf=1.0, neginf=-1.0), -1.0, 1.0)
    vgrid_y = torch.clamp(torch.nan_to_num(vgrid_y, nan=0.0, posinf=1.0, neginf=-1.0), -1.0, 1.0)
    vgrid = torch.stack((vgrid_x, vgrid_y), dim=-1)

    out = F.grid_sample(x, vgrid, mode="bilinear", padding_mode="border", align_corners=True)
    return torch.nan_to_num(out, nan=0.0, posinf=0.0, neginf=0.0)


# ===================== Upsampler =====================
class PixelShuffleUpsample(nn.Module):
    def __init__(self, num_feats, scale):
        super().__init__()
        if scale == 2:
            self.net = nn.Sequential(
                nn.Conv2d(num_feats, num_feats * 4, 3, 1, 1),
                nn.PixelShuffle(2),
                nn.LeakyReLU(0.1, inplace=True),
                nn.Conv2d(num_feats, 3, 3, 1, 1),
            )
        elif scale == 4:
            self.net = nn.Sequential(
                nn.Conv2d(num_feats, num_feats * 4, 3, 1, 1),
                nn.PixelShuffle(2),
                nn.LeakyReLU(0.1, inplace=True),
                nn.Conv2d(num_feats, num_feats * 4, 3, 1, 1),
                nn.PixelShuffle(2),
                nn.LeakyReLU(0.1, inplace=True),
                nn.Conv2d(num_feats, 3, 3, 1, 1),
            )
        else:
            raise ValueError("Only scale=2 or scale=4 supported")

    def forward(self, x):
        return self.net(x)


# ===================== BasicVSR with SPyNet =====================
class BasicVSRRecurrentSeq(nn.Module):
    def __init__(self, seq_len=7, scale=4, num_feats=64, num_extract_blocks=5, num_prop_blocks=20, num_recon_blocks=5):
        super().__init__()
        if seq_len % 2 == 0:
            raise ValueError("seq_len must be odd")

        self.seq_len = seq_len
        self.scale = scale

        self.feat_extractor = ConvResidualBlocks(3, num_feats, num_extract_blocks)

        # SPyNet for optical flow (pretrained, fine-tuned with lower LR)
        self.flow_estimator = SPyNet(pretrained=True)

        self.backward_trunk = ConvResidualBlocks(num_feats * 2, num_feats, num_prop_blocks)
        self.forward_trunk = ConvResidualBlocks(num_feats * 2, num_feats, num_prop_blocks)

        fusion_layers = [
            nn.Conv2d(num_feats * 2, num_feats, 1, 1, 0),
            nn.LeakyReLU(0.1, inplace=True)
        ]
        for _ in range(num_recon_blocks):
            fusion_layers.append(ResidualBlock(num_feats))
        self.fusion = nn.Sequential(*fusion_layers)

        self.upsample = PixelShuffleUpsample(num_feats, scale)

    def compute_flows(self, x):
        b, t, c, h, w = x.shape
        flows_backward = [None] * (t - 1)
        flows_forward = [None] * (t - 1)

        for i in range(t - 1):
            flows_backward[i] = self.flow_estimator(x[:, i], x[:, i + 1])

        for i in range(1, t):
            flows_forward[i - 1] = self.flow_estimator(x[:, i], x[:, i - 1])

        return flows_forward, flows_backward

    def forward(self, x):
        b, t, c, h, w = x.shape
        feats_batch = self.feat_extractor(x.reshape(b * t, c, h, w))
        feats = list(feats_batch.reshape(b, t, -1, h, w).unbind(dim=1))
        flows_forward, flows_backward = self.compute_flows(x)

        backward_feats = [None] * t
        prop = torch.zeros_like(feats[0])

        for i in range(t - 1, -1, -1):
            if i < t - 1:
                prop = flow_warp(prop, flows_backward[i])
            prop = self.backward_trunk(torch.cat([feats[i], prop], dim=1))
            backward_feats[i] = prop

        forward_prop = torch.zeros_like(feats[0])
        outputs = []

        for i in range(t):
            if i > 0:
                forward_prop = flow_warp(forward_prop, flows_forward[i - 1])

            forward_prop = self.forward_trunk(torch.cat([feats[i], forward_prop], dim=1))
            fused = self.fusion(torch.cat([forward_prop, backward_feats[i]], dim=1))
            out = torch.clamp(self.upsample(fused), 0.0, 1.0)
            outputs.append(out)

        return torch.stack(outputs, dim=1)
