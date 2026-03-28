from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ai_port: int = 8000
    upload_dir: str = "../storage/uploads"
    result_dir: str = "../storage/results"
    temp_dir: str = "../storage/temp"
    temporal_window_size: int = 5
    upscale_factor: int = 2
    max_concurrent_jobs: int = 1
    model_checkpoint: str = ""  # Path to trained .pth file (empty = stub mode)

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    def get_upload_path(self) -> Path:
        return Path(self.upload_dir).resolve()

    def get_result_path(self) -> Path:
        return Path(self.result_dir).resolve()

    def get_temp_path(self) -> Path:
        return Path(self.temp_dir).resolve()

    def ensure_directories(self) -> None:
        self.get_upload_path().mkdir(parents=True, exist_ok=True)
        self.get_result_path().mkdir(parents=True, exist_ok=True)
        self.get_temp_path().mkdir(parents=True, exist_ok=True)


settings = Settings()
