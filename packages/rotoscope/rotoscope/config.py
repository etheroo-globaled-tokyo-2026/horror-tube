"""Every threshold the rules use, the sizes and the frame rate, in one place. Mask sizes and the drawing's size are
the shared constants in rotoscope.types; pixel distances here are at the masks' size (ANALYSIS_W x ANALYSIS_H)."""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Video:
    fps: int = 15
    scale: int = 4                          # the drawing is encoded this many times its size, nearest neighbour
    cut: float = 0.15                       # a cut: the grey histogram changes by more than this from the frame before
    cut_size: tuple[int, int] = (160, 90)   # the copy the cut test compares
    cut_bins: int = 32
    crf: int = 16                           # x264 quality: palette art needs its 1 px lines kept sharp
    ffmpeg_timeout_s: float = 300


@dataclass(frozen=True)
class Rules:
    cast_min: float = 0.25          # a cast find's score floor
    prop_min: float = 0.4           # a prop's score floor
    prop_stay: float = 0.25         # a prop's floor when the same prop was kept at the same place nearby
    near: int = 2                   # frames either side, in the same shot, that count as nearby
    same_place: float = 0.3         # box IoU at which two finds of one prop are at the same place
    same_object: float = 0.5        # mask IoU at which two finds of one kind are one object
    contained: float = 0.7          # share of the smaller mask inside the other at which both are one object
    figure_in: float = 0.5          # a cast find with this share inside a kept prop is part of the prop
    foreground: float = 0.2         # a character is at least this share of the frame's height
    clear: float = 0.4              # a tracked find this sure is a clear sighting; its fill-ins are judged by it
    shrink: float = 0.25            # a fill-in under this share of its clear sighting's size has lost its object
    hand_reach: float = 10          # px: a hand joint this close to a prop holds it
    hand_owner_reach: float = 25    # px: a hand on no figure belongs to the nearest figure this close
    on_prop: float = 0.6            # a hand with this share of its joints on a prop's surface is the prop
    wrist_reach: float = 8          # px: a wrist farther than this from every figure is a guess
    worn: float = 0.5               # share of a prop inside a figure's filled outline: worn or held against them
    sam_hand_min: float = 0.4       # a SAM "hand" find needs this score to hold anything
    touch: int = 5                  # px: the square a mask is grown by to find what touches it
    carry: int = 5                  # frames either side a hold carries over a hidden grip
    sliver: int = 12                # px: a prop cut by the frame's edge to this depth or less isn't drawn
    hand_prompt: str = "hand"


@dataclass(frozen=True)
class Gore:
    blood_prompts: tuple[str, ...] = ("blood", "green blood")
    light_prompts: tuple[str, ...] = ("light",)
    min_score: float = 0.3                  # a blood or light find's score floor
    min_px: int = 20                        # a blood find smaller than this is noise
    green_hue: tuple[int, int] = (25, 90)   # OpenCV hue (0-180) of acid-green blood; any other hue is red
    hue_min_saturation: int = 60            # a patch's hue is measured over its pixels this saturated (0-255)
    hue_min_value: int = 50                 # and this bright (0-255); a patch with none of them is red
    light_cover: float = 0.5                # blood with this share under a higher-scoring light find is the light
    speckle: int = 5                        # speckle pixels: (x + 2y) % speckle == 0


@dataclass(frozen=True)
class Outline:
    min_length: float = 24          # contour length, at 4x the drawing, under which a prop outline is noise
    epsilon: float = 2.5            # polygon simplification, at 4x the drawing


@dataclass(frozen=True)
class Server:
    time_limit_s: float = 600


@dataclass(frozen=True)
class Config:
    video: Video = field(default_factory=Video)
    rules: Rules = field(default_factory=Rules)
    gore: Gore = field(default_factory=Gore)
    outline: Outline = field(default_factory=Outline)
    server: Server = field(default_factory=Server)
