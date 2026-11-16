"""Official SMaLL-100 tokenization with a vocabulary export compatibility fix."""
import sys
from pathlib import Path

runtime = Path(__file__).resolve().parents[3] / '.runtime' / 'small100'
sys.path.insert(0, str(runtime / 'source'))
from tokenization_small100 import SMALL100Tokenizer as OfficialTokenizer


class Small100Tokenizer(OfficialTokenizer):
    def get_vocab(self):
        # The upstream implementation exports eight reserved IDs as <unk>,
        # overwriting <unk>'s real ID (3) with 128111. CTranslate2 then shifts
        # every token after ID 3. Export only real tokens; its M2M100 converter
        # appends the eight madeupword slots itself, matching the weight rows.
        return {**self.encoder, **self.lang_token_to_id}
