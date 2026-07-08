# V4 fine-tune GPU runbook

What to do on the temporary GPU environment: first start, restart after a crash,
and how to diagnose. Written for the `finetune_v4_youtube.py` run (epoch ≈ 2h,
13760 batches, ~1.9 it/s). Keep this file next to the training scripts.

## Files that must be in the training root

| File / dir                 | Where it comes from                                    |
| -------------------------- | ------------------------------------------------------ |
| `finetune_v4_youtube.py`   | repo `scripts/` — version with mid-epoch resume        |
| `degrade_clip_video.py`    | repo `scripts/`                                        |
| `model_architecture.py`    | repo `apps/ai/baseline/`                               |
| `setup.sh`                 | repo `apps/ai/` — installs deps, preflights, launches  |
| `vsr_workspace/`           | persisted volume — V3 splits + checkpoints + V4 state  |

`vsr_workspace` must be mounted at the **same absolute path** in every new
environment — the V4 splits contain absolute symlinks into the V3 splits, and
`setup.sh` aborts with "BROKEN SYMLINKS" if the path changed.

## Normal start / restart after ANY crash — same one command

```bash
cd <training-root>        # the dir with the files above
bash setup.sh
tail -f finetune_v4.log
```

`setup.sh` does everything in order: apt packages (ffmpeg), pip packages
(torch, torchvision, opencv, tqdm, scikit-image — NOT covered by
requirements.txt), environment verification, file/symlink preflight, starts
the memory watcher, launches training with `nohup`.

Confirm these lines, then you can walk away:

1. `Everything OK!` — deps and CUDA fine.
2. `Resume state found — training will continue from the last saved batch.`
3. `Watcher PID ...` — memory monitor running (`~/watch.log`).
4. In `finetune_v4.log`: `Resuming epoch N at batch X/13760`.

Resume is automatic and loses at most `--save-every` batches (default 500,
≈ 4 minutes). Never delete `vsr_workspace/experiments/model_v4_finetune_youtube/checkpoints/training_state.pth`
— that file IS the progress.

## If it crashed — diagnosis order

Run these BEFORE restarting (evidence survives in the same environment):

```bash
# 1. Did Python throw an error, or did the process just die silently?
grep -iE "traceback|Error|Killed|Bus error" finetune_v4.log | tail -20

# 2. Memory trajectory up to the crash (the key evidence):
tail -20 ~/watch.log

# 3. Did the kernel OOM-kill something?
dmesg -T 2>/dev/null | grep -iE "oom|killed process" | tail -10
```

How to read `~/watch.log` (one line per 30s):

```
2026-07-07 14:30:12 mem=9800MB peak=9950MB limit=61035MB shm=850MB volume=ok
```

| Symptom in the log                          | Meaning                | Action                                   |
| ------------------------------------------- | ---------------------- | ---------------------------------------- |
| `mem` climbed to ≈ `limit` before the crash | container RAM OOM      | restart with `NUM_WORKERS=0 bash setup.sh` |
| `volume=GONE` lines                         | storage detached       | provider problem — recreate env, same mount path |
| `mem` flat, volume ok, no traceback         | env was preempted/reset | just restart, nothing to fix             |
| CUDA OOM naming ANOTHER PID with ~18 GiB    | duplicate training run | old process was still alive at relaunch; setup.sh now kills it first — just rerun `bash setup.sh` |
| `torch.cuda.OutOfMemoryError`, own process ~18 GiB | VRAM fragmentation | setup.sh sets `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`; just restart |
| Python traceback in `finetune_v4.log`       | real bug               | copy the traceback and debug it          |

Note: `nvidia-smi` showing VRAM near the 20 GB slice cap is NORMAL — PyTorch's
caching allocator holds freed memory. Only a `torch.cuda.OutOfMemoryError`
traceback means an actual VRAM problem — and read WHICH process holds the
memory: if it's a different PID, the crash is a duplicate run, not this one.
Verify a single run with: `pgrep -af finetune_v4_youtube.py` (exactly one line).

If the environment is completely FROZEN and you can't run anything: don't
wait — kill/recreate it from the provider dashboard. Resume covers you.

## Known constraints of this environment (measured 2026-07-07)

- Container RAM limit is **64 GB** (`/sys/fs/cgroup/memory.max`), NOT the
  1.5 TB that `free -h` shows — `free` reports the host and is meaningless here.
  No swap. Hitting the limit freezes everything inside the container first
  (IDE "Directory not found" dialogs), then processes get killed. This was the
  cause of the repeated crashes at 1–5% of an epoch.
- Because of this, `setup.sh` defaults to `NUM_WORKERS=2`. Raise only while
  watching `~/watch.log` stay well under the limit. Dataloader workers now use
  the `spawn` context (not `fork`) and disable per-worker OpenCV threading, so
  worker RAM stays flat over the epoch instead of creeping toward the limit.
  Cost: a few seconds of worker startup at each epoch/val loader start.
- `/dev/shm` 30 GB, disk 7.9 TB free, GPU 20 GB VRAM slice — all fine.
- The environment is temporary (hours). Only `vsr_workspace/` persists;
  re-upload the four script files and rerun `setup.sh` in each new env.

## Tunables (env vars for setup.sh, flags for the script)

- `NUM_WORKERS=<n> bash setup.sh` — dataloader workers (default 2; 0 = safest, slowest).
- `--save-every <n>` — batches between resumable state saves (default 500).
- `--max-clips 5 --workspace .../v4_resume_smoketest` — cheap smoke test tree,
  safe to delete afterwards.
