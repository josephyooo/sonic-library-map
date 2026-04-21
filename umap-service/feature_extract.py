"""Essentia-based audio feature extraction.

Extracts a fixed-length feature vector from an audio file for use in UMAP
dimensionality reduction. Features cover timbre (MFCCs), rhythm (BPM),
tonality (key/scale), dynamics (loudness), and spectral shape.

The feature vector is 41 dimensions:
  - MFCC mean (13) + std (13) = 26  — timbre
  - Spectral centroid (1)           — brightness
  - BPM (1), beat confidence (1)    — rhythm
  - Key (1), scale (1), strength (1) — tonality
  - Integrated loudness (1), range (1) — loudness
  - Dynamic complexity (1)          — dynamics
  - Danceability (1)                — groove
  - Energy (1), RMS (1)             — power
  - Zero crossing rate (1)          — noisiness
  - Spectral rolloff (1)            — high-freq energy
  - Spectral flatness (1)           — tonality vs noise
"""

import logging

import essentia
import essentia.standard as es
import numpy as np

# Silence Essentia's C++-layer warnings — the recurring "No network created"
# message is a known false positive when running the one-shot (standard) API.
essentia.log.warningActive = False
essentia.log.infoActive = False

logger = logging.getLogger(__name__)

FEATURE_DIM = 41
SAMPLE_RATE = 22050

# Human-readable names for each dimension in the feature vector.
# MFCCs are grouped since individual coefficients aren't meaningful to users.
FEATURE_NAMES: list[str] = [
    *[f"MFCC {i+1} (mean)" for i in range(13)],
    *[f"MFCC {i+1} (std)" for i in range(13)],
    "Brightness",       # spectral centroid
    "BPM",
    "Beat Strength",
    "Key",
    "Major/Minor",
    "Key Confidence",
    "Loudness",         # integrated loudness
    "Loudness Range",
    "Dynamic Range",    # dynamic complexity
    "Danceability",
    "Energy",
    "RMS",
    "Noisiness",        # zero crossing rate
    "High-Freq Energy", # spectral rolloff
    "Tonal vs Noise",   # spectral flatness
]

# Shorter labels for axis display — skip MFCCs since they rarely dominate
AXIS_FEATURE_NAMES: list[str] = [
    *["" for _ in range(26)],  # MFCCs (not useful as axis labels)
    "Brightness",
    "BPM",
    "Beat Strength",
    "Key",
    "Major/Minor",
    "Key Confidence",
    "Loudness",
    "Loudness Range",
    "Dynamic Range",
    "Danceability",
    "Energy",
    "RMS",
    "Noisiness",
    "High-Freq Energy",
    "Tonal vs Noise",
]

KEY_MAP = {
    "C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5,
    "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11,
}


def extract_features(file_path: str) -> list[float] | None:
    """Extract a 41-dimensional feature vector from an audio file.

    Returns None if extraction fails (corrupt file, too short, etc.).
    """
    try:
        audio = es.MonoLoader(filename=file_path, sampleRate=SAMPLE_RATE)()
    except Exception as e:
        logger.warning("Failed to load audio %s: %s", file_path, e)
        return None

    # Reject very short audio (<5 seconds)
    if len(audio) < SAMPLE_RATE * 5:
        logger.warning("Audio too short: %s (%.1fs)", file_path, len(audio) / SAMPLE_RATE)
        return None

    try:
        return _compute_features(audio)
    except Exception as e:
        logger.warning("Feature extraction failed for %s: %s", file_path, e)
        return None


def _compute_features(audio: np.ndarray) -> list[float]:
    w = es.Windowing(type="hann")
    spec = es.Spectrum()

    # 1. MFCCs (mean + std over frames) — 26 dims
    mfcc_algo = es.MFCC(numberCoefficients=13)
    mfcc_frames = []
    rolloff_frames = []
    flatness_frames = []
    rolloff_algo = es.RollOff()
    flatness_algo = es.Flatness()

    for frame in es.FrameGenerator(audio, frameSize=2048, hopSize=1024):
        s = spec(w(frame))
        _, coeffs = mfcc_algo(s)
        mfcc_frames.append(coeffs)
        rolloff_frames.append(rolloff_algo(s))
        flatness_frames.append(flatness_algo(s))

    mfcc_arr = np.array(mfcc_frames)
    mfcc_mean = mfcc_arr.mean(axis=0)  # 13
    mfcc_std = mfcc_arr.std(axis=0)    # 13

    # 2. Spectral centroid — 1 dim
    centroid = es.SpectralCentroidTime(sampleRate=SAMPLE_RATE)(audio)

    # 3. Rhythm — 2 dims
    bpm, _, beats_conf, _, _ = es.RhythmExtractor2013(method="multifeature")(audio)

    # 4. Key — 3 dims
    key, scale, key_strength = es.KeyExtractor()(audio)
    key_num = KEY_MAP.get(key, 0) / 11.0
    scale_num = 0.0 if scale == "minor" else 1.0

    # 5. Loudness — 2 dims
    stereo = np.column_stack([audio, audio])
    _, _, integrated, loudness_range = es.LoudnessEBUR128(sampleRate=SAMPLE_RATE)(stereo)

    # 6. Dynamic complexity — 1 dim
    dyn_complexity, _ = es.DynamicComplexity()(audio)

    # 7. Danceability — 1 dim
    danceability, _ = es.Danceability()(audio)

    # 8. Energy + RMS — 2 dims
    energy_val = float(np.log1p(es.Energy()(audio)))  # log-scale to tame huge values
    rms_val = es.RMS()(audio)

    # 9. Zero crossing rate — 1 dim
    zcr_val = es.ZeroCrossingRate()(audio)

    # 10. Spectral rolloff + flatness (mean over frames) — 2 dims
    rolloff_mean = float(np.mean(rolloff_frames))
    flatness_mean = float(np.mean(flatness_frames))

    features = np.concatenate([
        mfcc_mean,            # 13
        mfcc_std,             # 13
        [centroid],           # 1
        [bpm / 250.0],        # 1 (normalized to ~0-1 range)
        [beats_conf],         # 1
        [key_num],            # 1
        [scale_num],          # 1
        [key_strength],       # 1
        [integrated],         # 1
        [loudness_range],     # 1
        [dyn_complexity],     # 1
        [danceability],       # 1
        [energy_val],         # 1
        [rms_val],            # 1
        [zcr_val],            # 1
        [rolloff_mean],       # 1
        [flatness_mean],      # 1
    ])

    assert len(features) == FEATURE_DIM
    return features.tolist()
