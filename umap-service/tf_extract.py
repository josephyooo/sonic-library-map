"""Discogs-EffNet TensorFlow embedding extraction.

Extracts a 1280-dimensional embedding per track using the Discogs-EffNet model
(discogs-effnet-bs64-1). This model was trained on millions of tracks to capture
genre, style, mood, and instrumentation — songs that sound alike produce similar
embeddings. Used as UMAP input for perceptually meaningful clustering.

The raw 41-dim spectral features (feature_extract.py) are retained separately
for the "Color by" overlay (BPM, loudness, etc.).
"""

import logging
import os

import essentia
import numpy as np

# Silence Essentia's C++-layer warnings (shared with feature_extract).
essentia.log.warningActive = False
essentia.log.infoActive = False

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 1280
SAMPLE_RATE = 16000  # EffNet expects 16kHz

MODEL_PATH = os.environ.get(
    "EFFNET_MODEL_PATH",
    os.path.join(os.path.dirname(__file__), "models", "discogs-effnet-bs64-1.pb"),
)

# Lazy-loaded singleton to avoid loading the model on import
_model = None


def _get_model():
    global _model
    if _model is None:
        from essentia.standard import TensorflowPredictEffnetDiscogs

        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(
                f"Discogs-EffNet model not found at {MODEL_PATH}. "
                "Download it from https://essentia.upf.edu/models/feature-extractors/discogs-effnet/discogs-effnet-bs64-1.pb"
            )
        _model = TensorflowPredictEffnetDiscogs(
            graphFilename=MODEL_PATH,
            output="PartitionedCall:1",
        )
        logger.info("Loaded Discogs-EffNet model from %s", MODEL_PATH)
    return _model


def extract_embedding(file_path: str) -> list[float] | None:
    """Extract a 1280-dimensional Discogs-EffNet embedding from an audio file.

    The model produces one embedding per ~1s patch. We average across patches
    to get a single fixed-length vector per track.

    Returns None if extraction fails (corrupt file, too short, etc.).
    """
    try:
        from essentia.standard import MonoLoader

        audio = MonoLoader(filename=file_path, sampleRate=SAMPLE_RATE)()
    except Exception as e:
        logger.warning("Failed to load audio %s: %s", file_path, e)
        return None

    # Reject very short audio (<5 seconds)
    if len(audio) < SAMPLE_RATE * 5:
        logger.warning(
            "Audio too short: %s (%.1fs)", file_path, len(audio) / SAMPLE_RATE
        )
        return None

    try:
        model = _get_model()
        embeddings = model(audio)  # shape: (n_patches, 1280)

        if embeddings.ndim != 2 or embeddings.shape[1] != EMBEDDING_DIM:
            logger.warning(
                "Unexpected embedding shape %s for %s", embeddings.shape, file_path
            )
            return None

        # Average across patches for a single track-level embedding
        embedding = np.mean(embeddings, axis=0)
        return embedding.tolist()
    except Exception as e:
        logger.warning("TF embedding extraction failed for %s: %s", file_path, e)
        return None
