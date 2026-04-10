#!/usr/bin/env python3
"""
Image captioning using Salesforce/blip-image-captioning-large.
Called by Node.js backend as a subprocess.

Usage:
  python captioner.py <image_path>
  python captioner.py --server <port>   # persistent HTTP server mode

Output (stdout): JSON { "caption": "..." }
"""

import sys
import os
import json
import argparse
from PIL import Image

MODEL_ID = 'Salesforce/blip-image-captioning-large'

_processor = None
_model = None


def load_model():
    global _processor, _model
    if _processor is not None:
        return

    # Suppress HF warnings
    os.environ['HF_HUB_DISABLE_PROGRESS_BARS'] = '1'
    os.environ['TRANSFORMERS_NO_ADVISORY_WARNINGS'] = '1'

    from transformers import BlipProcessor, BlipForConditionalGeneration
    import logging
    logging.getLogger('transformers').setLevel(logging.ERROR)

    print(f'[Captioner] Loading {MODEL_ID}...', file=sys.stderr)
    _processor = BlipProcessor.from_pretrained(MODEL_ID)
    _model = BlipForConditionalGeneration.from_pretrained(MODEL_ID)
    print(f'[Captioner] Model loaded.', file=sys.stderr)


def caption_image(image_path, max_tokens=75):
    load_model()
    import torch

    img = Image.open(image_path).convert('RGB')

    # Conditional captioning with prompt for richer, more explicit descriptions
    prompt = "a detailed description:"
    inputs = _processor(img, text=prompt, return_tensors='pt')

    with torch.no_grad():
        out = _model.generate(
            **inputs,
            max_new_tokens=max_tokens,
            num_beams=3,
            repetition_penalty=1.5,
        )

    caption = _processor.decode(out[0], skip_special_tokens=True)
    # Strip the prompt prefix if echoed back
    caption = caption.strip()
    import re
    caption = re.sub(r'^a detailed description\s*:\s*(of\s+|image of\s+|photo of\s+)?', '', caption, flags=re.IGNORECASE).strip()
    # Capitalize first letter
    if caption:
        caption = caption[0].upper() + caption[1:]
    return caption


def run_server(port):
    """Persistent HTTP server for faster repeated calls."""
    from http.server import HTTPServer, BaseHTTPRequestHandler
    import urllib.parse

    load_model()
    print(f'[Captioner] Server listening on http://127.0.0.1:{port}', file=sys.stderr)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)

            image_path = params.get('image', [None])[0]
            if not image_path or not os.path.exists(image_path):
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'image path required'}).encode())
                return

            max_tokens = int(params.get('max_tokens', ['75'])[0])

            try:
                cap = caption_image(image_path, max_tokens)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'caption': cap}).encode())
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())

        def log_message(self, format, *args):
            pass

    server = HTTPServer(('127.0.0.1', port), Handler)
    server.serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='BLIP image captioning')
    parser.add_argument('image', nargs='?', help='Path to image file')
    parser.add_argument('--max-tokens', type=int, default=75)
    parser.add_argument('--server', type=int, metavar='PORT', help='Run as persistent HTTP server')
    args = parser.parse_args()

    if args.server:
        run_server(args.server)
    elif args.image:
        if not os.path.exists(args.image):
            print(json.dumps({'error': f'File not found: {args.image}'}))
            sys.exit(1)
        cap = caption_image(args.image, args.max_tokens)
        print(json.dumps({'caption': cap}))
    else:
        parser.print_help()
        sys.exit(1)
