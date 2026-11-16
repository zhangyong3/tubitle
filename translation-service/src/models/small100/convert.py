"""Convert pinned official weights with their own tokenizer, without remote code loading."""
import json
from pathlib import Path

from ctranslate2.converters import TransformersConverter

runtime = Path(__file__).resolve().parents[3] / '.runtime' / 'small100'
from tokenizer import Small100Tokenizer


class Small100Converter(TransformersConverter):
    def load_tokenizer(self, _tokenizer_class, model_name_or_path, **kwargs):
        return Small100Tokenizer.from_pretrained(model_name_or_path, local_files_only=True)


Small100Converter(str(runtime / 'source')).convert(str(runtime / 'int8'), quantization='int8', force=True)
tokenizer = Small100Tokenizer.from_pretrained(runtime / 'source', local_files_only=True)
vocabulary = json.loads((runtime / 'int8/shared_vocabulary.json').read_text())
expected_size = json.loads((runtime / 'source/config.json').read_text())['vocab_size']
if len(vocabulary) != expected_size or any(vocabulary[index] != token for token, index in tokenizer.get_vocab().items()):
    raise RuntimeError('Converted SMaLL-100 vocabulary does not match the official weight rows')
