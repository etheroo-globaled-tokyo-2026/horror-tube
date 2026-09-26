"""The one place that decides which device runs a model: the GPU or the Neural Engine, never the CPU. Building a
model on the CPU raises CPUBlocked, naming the model, unless the environment has ROTO_CPU=1; that opt-in never moves
a GPU model to the CPU, it only lets a model with no GPU path run. Plain numpy and OpenCV image code isn't a model.

torch, MLX and MediaPipe are imported inside the functions that need them: the core and its tests run without them,
and torch must not be imported before block_mps_fallback() has run.
"""
import logging
import os
import sys

log = logging.getLogger(__name__)


class CPUBlocked(RuntimeError):
    """A model would have run on the CPU and ROTO_CPU=1 isn't set."""


def cpu_allowed() -> bool:
    return os.environ.get("ROTO_CPU") == "1"


def allow_cpu(model: str, why: str) -> None:
    """Call before building a model that will run on the CPU: raises CPUBlocked unless ROTO_CPU=1."""
    if not cpu_allowed():
        raise CPUBlocked(f"{model} would run on the CPU ({why}). The rotoscope runs models on the GPU only; set "
                         f"ROTO_CPU=1 to allow the CPU for this run.")
    log.warning("ROTO_CPU=1: %s runs on the CPU (%s)", model, why)


def block_mps_fallback() -> None:
    """PyTorch quietly runs an op MPS lacks on the CPU when PYTORCH_ENABLE_MPS_FALLBACK=1, and reads the variable
    once, when it's imported. Call before importing torch."""
    if cpu_allowed() or os.environ.get("PYTORCH_ENABLE_MPS_FALLBACK", "0") == "0":
        return
    if "torch" in sys.modules:
        raise CPUBlocked("PYTORCH_ENABLE_MPS_FALLBACK is set and torch is already imported, so PyTorch would run "
                         "unsupported ops on the CPU; unset it, or set ROTO_CPU=1 to allow the CPU.")
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "0"


def torch_device(model: str):
    """The torch.device for a PyTorch model: MPS, else CUDA; with neither it raises unless ROTO_CPU=1."""
    block_mps_fallback()
    import torch

    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    allow_cpu(model, "PyTorch finds no MPS or CUDA device")
    return torch.device("cpu")


def mlx_gpu(model: str) -> None:
    """Raises unless MLX runs on the GPU (or ROTO_CPU=1)."""
    import mlx.core as mx

    if mx.default_device() != mx.gpu:
        allow_cpu(model, f"MLX's default device is {mx.default_device()}")


def mediapipe_delegate():
    """MediaPipe's GPU delegate (Metal). It takes RGBA images."""
    from mediapipe.tasks.python import BaseOptions

    return BaseOptions.Delegate.GPU


def accelerator() -> str:
    """The GPU the PyTorch models run on: "mps" or "cuda", or "cpu" under ROTO_CPU=1; raises otherwise."""
    return torch_device("device check").type
