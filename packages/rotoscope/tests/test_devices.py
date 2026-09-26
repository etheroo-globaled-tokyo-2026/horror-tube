import pytest

from rotoscope import devices


def test_a_model_on_the_cpu_is_refused_unless_the_cpu_is_allowed(monkeypatch):
    monkeypatch.delenv("ROTO_CPU", raising=False)
    with pytest.raises(devices.CPUBlocked, match="pose model"):
        devices.allow_cpu("pose model", "no GPU path")
    monkeypatch.setenv("ROTO_CPU", "1")
    devices.allow_cpu("pose model", "no GPU path")
