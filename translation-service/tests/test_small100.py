"""Run with .runtime/small100/venv/bin/python -m unittest discover -s tests -p 'test_small100.py'."""
import json
import sys
import unittest
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'src/models/small100'))
from tokenizer import Small100Tokenizer


class Small100VocabularyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tokenizer = Small100Tokenizer.from_pretrained(root / '.runtime/small100/source', local_files_only=True)

    def test_unknown_token_retains_its_weight_row(self):
        self.assertEqual(self.tokenizer.get_vocab()['<unk>'], 3)
        self.assertEqual(self.tokenizer.unk_token_id, 3)

    def test_converted_vocabulary_preserves_all_real_token_ids(self):
        vocabulary = json.loads((root / '.runtime/small100/int8/shared_vocabulary.json').read_text())
        self.assertEqual(len(vocabulary), 128112)
        for token, token_id in self.tokenizer.get_vocab().items():
            self.assertEqual(vocabulary[token_id], token, f'Wrong weight row for token {token}')

    def test_encoder_prefix_is_target_language_and_suffix_is_eos(self):
        for language in ['zh', 'ja', 'en', 'ar']:
            self.tokenizer.tgt_lang = language
            ids = self.tokenizer.encode('Hello world.')
            self.assertEqual(ids[0], self.tokenizer.get_lang_id(language))
            self.assertEqual(ids[-1], self.tokenizer.eos_token_id)


if __name__ == '__main__':
    unittest.main()
