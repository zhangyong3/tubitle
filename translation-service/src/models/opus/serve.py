"""Local OPUS-MT inference server backed by CTranslate2."""
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from queue import SimpleQueue

import ctranslate2
from transformers import MarianTokenizer


runtime = Path(__file__).resolve().parents[3] / '.runtime' / 'opus'
workers = int(os.getenv('OPUS_WORKERS', '4'))
threads = int(os.getenv('OPUS_THREADS', '2'))
beam = int(os.getenv('OPUS_BEAM', '1'))
model = 'opus-mt-en-zh-int8'
tokenizers = [MarianTokenizer.from_pretrained(runtime / 'source', local_files_only=True) for _ in range(workers)]
translator = ctranslate2.Translator(str(runtime / 'int8'), device='cpu', compute_type='int8',
                                   inter_threads=workers, intra_threads=threads)
available = SimpleQueue()
for tokenizer in tokenizers:
    available.put(tokenizer)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    disable_nagle_algorithm = True

    def log_message(self, *_):
        pass

    def respond(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            self.respond(200, dict(ready=True, model=model, beam=beam,
                                   computeType=translator.compute_type, workers=workers, threadsPerWorker=threads))
        else:
            self.respond(404, {'error': 'Not found'})

    def do_POST(self):
        if self.path != '/v1/translate':
            self.respond(404, {'error': 'Not found'})
            return
        try:
            size = int(self.headers['Content-Length'])
            if not 0 < size <= 16 * 1024:
                self.close_connection = True
                raise ValueError('Invalid request body size')
            body = json.loads(self.rfile.read(size))
            source = body['text'].strip()
            if not 1 <= len(source) <= 1200 or body.get('target', 'zh') != 'zh':
                raise ValueError('Expected English text (1–1200 characters) and target zh')
        except (KeyError, AttributeError, TypeError, ValueError) as error:
            self.respond(400, {'error': str(error)})
            return
        start = time.perf_counter()
        tokenizer = available.get()
        try:
            source_tokens = tokenizer.convert_ids_to_tokens(tokenizer.encode(f'>>cmn_Hans<< {source}'))
            if len(source_tokens) > 512:
                self.respond(400, {'error': 'Input exceeds 512 tokens'})
                return
            hypothesis = translator.translate_batch([source_tokens], beam_size=beam, max_input_length=0,
                                                    max_decoding_length=511, return_end_token=True)[0].hypotheses[0]
            translated = tokenizer.decode(tokenizer.convert_tokens_to_ids(hypothesis), skip_special_tokens=True)
            stopped = bool(hypothesis) and hypothesis[-1] == tokenizer.eos_token
        finally:
            available.put(tokenizer)
        self.respond(200, dict(translation=translated, model=model, target='zh',
                               finishReason='stop' if stopped else 'length',
                               latencyMs=round((time.perf_counter() - start) * 1000),
                               usage={'prompt_tokens': len(source_tokens), 'completion_tokens': len(hypothesis) - int(stopped)}))


with ThreadingHTTPServer(('127.0.0.1', int(os.getenv('PORT', '18092'))), Handler) as http:
    print(f'Listening on {http.server_address}; {translator.compute_type}, beam {beam}, {workers} workers × {threads}', flush=True)
    http.serve_forever()
