#!/bin/bash
set -e

# One-shot bootstrap + resume for the V4 fine-tune on a fresh temporary GPU env.
#
# Run it FROM THE TRAINING ROOT — the directory that contains:
#   finetune_v4_youtube.py, degrade_clip_video.py, model_architecture.py
#   vsr_workspace/  (persisted volume: V3 splits + checkpoint + V4 workspace)
#
# IMPORTANT: the V4 splits contain ABSOLUTE symlinks into the V3 splits.
# The persisted volume must be mounted at the SAME absolute path in every
# new environment, or every hr_frames link breaks.
#
# Tune workers without editing the file:  NUM_WORKERS=4 bash setup.sh
# Default is 2: repeated whole-environment freezes pointed to host RAM
# exhaustion from dataloader workers. Raise only while watching ~/watch.log.

NUM_WORKERS="${NUM_WORKERS:-2}"

echo "===== Installing system packages ====="

apt-get update
apt-get install -y \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libxcb1

echo "===== Installing python packages ====="

python -m pip install --upgrade pip
# Training deps (requirements.txt is the inference service's list and is
# missing torchvision/tqdm/scikit-image — install explicitly).
python -m pip install \
    torch \
    torchvision \
    opencv-python \
    numpy \
    tqdm \
    scikit-image \
    matplotlib

echo "===== Verifying environment ====="

python - <<'EOF'
import shutil
import cv2, numpy, skimage, torch, torchvision, tqdm

print("Torch:", torch.__version__)
print("CUDA:", torch.cuda.is_available())
print("Torchvision:", torchvision.__version__)
print("OpenCV:", cv2.__version__)
assert torch.cuda.is_available(), "CUDA not available - wrong image/driver?"
assert shutil.which("ffmpeg"), "ffmpeg not on PATH"
print("Everything OK!")
EOF

echo "===== Preflight: files, symlinks, resources ====="

for f in finetune_v4_youtube.py degrade_clip_video.py model_architecture.py; do
    [ -f "$f" ] || { echo "MISSING: $f (copy it next to this script)"; exit 1; }
done

V3=vsr_workspace/experiments/model_v3_seq15
V4=vsr_workspace/experiments/model_v4_finetune_youtube
[ -d "$V3/splits/train" ] || { echo "MISSING: $V3/splits — persisted volume not mounted?"; exit 1; }
[ -f "$V3/checkpoints/vsr_model_best_psnr.pth" ] || { echo "MISSING: V3 checkpoint"; exit 1; }

BROKEN=$(find "$V4/splits" -xtype l 2>/dev/null | head -5)
if [ -n "$BROKEN" ]; then
    echo "BROKEN SYMLINKS — the volume is mounted at a different absolute path than last time:"
    echo "$BROKEN"
    exit 1
fi

if [ -f "$V4/checkpoints/training_state.pth" ]; then
    echo "Resume state found — training will continue from the last saved batch."
else
    echo "No resume state — training starts from the V3 checkpoint (epoch 1)."
fi

# Cache VGG19 weights on the persisted volume so fresh envs don't re-download.
export TORCH_HOME="$PWD/vsr_workspace/.torch_cache"

echo "--- resources (check RAM/shm/disk are sane before a 2h epoch) ---"
free -h || true
df -h . /dev/shm || true
nvidia-smi || true

echo "===== Stopping any previous run ====="

# A leftover training process holds ~18GB of the 20GB VRAM slice, so a second
# launch OOMs instantly (the "VRAM full" crashes were exactly this). Kill any
# old run + watcher and give CUDA a moment to release the memory.
pkill -f finetune_v4_youtube.py 2>/dev/null && { echo "Killed previous training process; waiting for VRAM release..."; sleep 10; } || true
pkill -f 'watch\.sh' 2>/dev/null || true

echo "===== Starting resource watcher (~/watch.log) ====="

cat > ~/watch.sh <<'EOF'
# Report the CONTAINER's memory (cgroup), not the host's — `free` shows the
# whole 1.5TB host and is meaningless inside a 64GB-capped container.
WORKDIR="$1"
cg() {
    v=$(cat "/sys/fs/cgroup/$1" 2>/dev/null)
    if [ -z "$v" ]; then echo "?"; elif [ "$v" = "max" ]; then echo "unlimited"; else echo "$((v / 1048576))MB"; fi
}
while sleep 30; do
    shm=$(df -m /dev/shm 2>/dev/null | awk 'NR==2{print $3}')
    dir=$([ -d "$WORKDIR" ] && echo ok || echo GONE)
    echo "$(date '+%F %T') mem=$(cg memory.current) peak=$(cg memory.peak) limit=$(cg memory.max) shm=${shm}MB volume=$dir"
done
EOF
nohup bash ~/watch.sh "$PWD/vsr_workspace" >> ~/watch.log 2>&1 &
echo "Watcher PID $! — after any crash/freeze, check: tail -20 ~/watch.log"

echo "===== Starting training (num_workers=$NUM_WORKERS) ====="

# The run sits near the 20GB VRAM slice cap; expandable segments let the
# allocator grow/shrink in place instead of OOMing on fragmentation.
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

nohup python finetune_v4_youtube.py \
    --num-workers "$NUM_WORKERS" \
    >> finetune_v4.log 2>&1 &

echo "Started as PID $! — follow with: tail -f finetune_v4.log"
