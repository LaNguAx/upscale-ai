# Upscale AI

AI-powered video restoration and super-resolution system. Upload a degraded video, and our deep learning pipeline enhances resolution, removes noise, and eliminates artifacts while preserving temporal consistency.

**B.Sc. Computer Science Final Project** | Deep Learning Specialization | The College of Management Academic Studies

## Overview

Upscale AI bridges the gap between academic deep learning research and practical video enhancement systems. It processes legacy and archival video content — old films, documentaries, historical recordings — using a convolutional neural network that operates on temporal windows of consecutive frames.

The system is built as a three-package monorepo:

| Package | Stack | Purpose |
|---------|-------|---------|
| `frontend/` | React 19, Vite, TypeScript, Tailwind CSS v4, shadcn/ui, Redux Toolkit | Web UI for upload, progress tracking, and video playback |
| `backend/` | NestJS 11, TypeScript, Express, Multer | API for file handling, job management, SSE progress, video streaming |
| `ai/` | Python, PyTorch, FastAPI | Baseline VSR model training and inference server |

## Architecture

```
Frontend (React :5173) ←SSE→ Backend (NestJS :3000) ←NDJSON→ AI Service (FastAPI :8000)
                                    ↕                                  ↕
                              storage/uploads/                   storage/results/
```

**Data Flow:**
1. User uploads a video through the web interface
2. Backend stores the file and creates a processing job
3. Backend calls the AI service with the file path
4. AI service runs frame-by-frame inference using temporal sliding windows
5. Real-time progress streams back: AI → Backend (NDJSON) → Frontend (SSE)
6. Enhanced video is served via HTTP Range streaming for playback with seek support

## Features

- **Video Upload** — Drag-and-drop with real-time upload progress (XHR)
- **AI Processing** — Baseline CNN with 5-frame temporal windows, 4x PixelShuffle upscaling
- **Live Progress** — Server-Sent Events for real-time processing status
- **Video Streaming** — HTTP Range requests (206 Partial Content) for native `<video>` playback
- **Product Pages** — Video Upscaler, Noise Reducer (WIP), Blur Fix (WIP), Artifact Cleaner (WIP), Upscale Pro
- **Mock Fallback** — Full UI works without the AI service running
- **Responsive UI** — Mobile-first design with royal blue theme

## Getting Started

### Prerequisites

- **Node.js** 24+
- **pnpm** 10+
- **Python** 3.11+ (for AI service)
- **Git**

### Installation

```bash
git clone https://github.com/LaNguAx/upscale-ai.git
cd upscale-ai
pnpm install
```

For the AI service:
```bash
cd ai
pip install -r requirements.txt
```

### Running

Start each service in a separate terminal:

```bash
# Backend (port 3000)
pnpm -F backend start:dev

# Frontend (port 5173)
pnpm -F frontend dev

# AI Service (port 8000) — optional, mock fallback exists
cd ai && python server.py
```

Then open http://localhost:5173

### Environment Variables

**Backend** (`backend/.env`):
```env
PORT=3000
AI_SERVICE_URL=http://localhost:8000
UPLOAD_DIR=../storage/uploads
RESULT_DIR=../storage/results
MAX_FILE_SIZE_MB=500
ALLOWED_VIDEO_EXTENSIONS=.mp4,.avi,.mkv,.mov,.wmv,.webm
```

**Frontend** (`frontend/.env.development`):
```env
VITE_API_BASE_URL=http://localhost:3000/api
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload` | Upload video (multipart/form-data), returns `{ jobId }` |
| `GET` | `/api/upload/status/:jobId` | Job state and progress (0-100) |
| `GET` | `/api/upload/result/:jobId` | Result metadata and download URL |
| `GET` | `/api/upload/stream/:jobId` | Video streaming with HTTP Range support |
| `SSE` | `/api/upload/events/:jobId` | Real-time progress via Server-Sent Events |
| `GET` | `/api/health` | Backend health check |

Swagger documentation available at http://localhost:3000/docs

## AI Model

The baseline model (`ResidualVSRModel`) is a CNN designed for video super-resolution:

- **Input:** 5 consecutive LR frames concatenated along channel dimension (15-channel tensor)
- **Architecture:** Conv → 10 Residual Blocks (64 features each) → PixelShuffle 4x upscaling
- **Output:** Single enhanced frame (the central frame of the window)
- **Loss:** L1 (Mean Absolute Error)
- **Training:** Supervised learning with synthetically degraded video pairs
- **Parameters:** ~1.3M

The model is trained on Google Colab using publicly available video datasets (Tears of Steel, Big Buck Bunny, Sintel, Elephant's Dream). Place the trained checkpoint at `ai/checkpoints/vsr_model_best.pth`.

### AI Package Structure

```
ai/
├── baseline/
│   ├── config.py      — Constants, seed setup, device config
│   ├── model.py       — ResidualBlock, ResidualVSRModel
│   ├── data.py        — Video sources, frame extraction
│   ├── dataset.py     — CustomVideoDataset, data loading
│   ├── metrics.py     — PSNR, SSIM, evaluation functions
│   ├── train.py       — Training loop, optimizer, checkpointing
│   └── inference.py   — run_video_vsr() sliding window inference
├── server.py          — FastAPI service (/health, /process)
├── checkpoints/       — Trained model weights (.pth)
└── requirements.txt
```

## Project Structure

```
upscale-ai/
├── frontend/                    # React web application
│   ├── src/
│   │   ├── ui/
│   │   │   ├── pages/           # Home, Products, Product, Technology, About
│   │   │   ├── components/      # Navbar, Footer, section components
│   │   │   │   ├── home/        # Hero, Features, HowItWorks, CTA
│   │   │   │   ├── product/     # VideoUploadForm, JobStatusPanel, JobResultPanel
│   │   │   │   ├── technology/  # Pipeline, Architecture, TechStack
│   │   │   │   └── about/       # Project, Team, Academic
│   │   │   ├── layouts/         # RootLayout
│   │   │   └── shadcn/          # UI primitives (button, card, badge, etc.)
│   │   ├── store/               # Redux store, RTK Query API, job slice
│   │   ├── styles/              # Tailwind CSS v4 theme
│   │   ├── consts/              # Navigation, features, products config
│   │   ├── types/               # TypeScript interfaces
│   │   └── utils/               # Formatting utilities
│   └── package.json
├── backend/                     # NestJS API server
│   ├── src/
│   │   ├── upload/              # Upload module (controller, service, DTOs)
│   │   │   ├── upload.controller.ts
│   │   │   ├── upload.service.ts
│   │   │   ├── upload.module.ts
│   │   │   ├── processing.service.ts
│   │   │   └── dto/
│   │   ├── health/              # Health check module
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── .env
│   └── package.json
├── ai/                          # Python AI package
│   ├── baseline/                # VSR model modules
│   ├── server.py                # FastAPI inference server
│   ├── checkpoints/             # Model weights
│   └── requirements.txt
├── storage/                     # Uploaded and processed videos (gitignored)
├── CLAUDE.md                    # Claude Code project instructions
├── .claude/settings.json        # Claude Code hooks
├── Upscale-Project-Characterization.pdf  # Full project specification
├── pnpm-workspace.yaml
└── package.json
```

## Team

| Name | Role |
|------|------|
| **Itay Aknin** | Backend & Full-Stack Architecture Lead |
| **Moriel Turgeman** | AI & Deep Learning Architecture Lead |
| **Roi Forer** | Data & Evaluation Lead |

**Supervisor:** Dr. Moshe Butman

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 19, Vite 8, TypeScript, Tailwind CSS v4, shadcn/ui, Redux Toolkit, RTK Query |
| **Backend** | NestJS 11, TypeScript, Express, Multer, RxJS (SSE) |
| **AI** | Python, PyTorch, FastAPI, OpenCV, NumPy |
| **DevOps** | pnpm workspaces, GitHub Actions, PM2 |

## License

This project is developed as part of a B.Sc. Computer Science final project at The College of Management Academic Studies.
