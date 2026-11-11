"""Keep generated audio, credentials, and review records outside tracked source."""
import os
from pathlib import Path
REPO = Path(__file__).resolve().parents[2]
TOOLS = Path(__file__).resolve().parent
WORK = Path(os.environ.get('DIONYSUS_AUDIOBOOK_DIR', REPO/'editorial/audiobook')).resolve()
