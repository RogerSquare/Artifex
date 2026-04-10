#!/usr/bin/env python3
"""
WaifuDiffusion Tagger v3 — standalone inference script.
Called by Node.js backend as a subprocess.

Usage:
  python wd-tagger.py <image_path> [--threshold 0.35] [--max-tags 30]
  python wd-tagger.py --server <port>   # persistent HTTP server mode

Output (stdout): JSON array of { name, category, score }
"""

import sys
import os
import json
import csv
import argparse
import numpy as np
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(SCRIPT_DIR, '..', 'models', 'wd-swinv2-tagger-v3')
MODEL_PATH = os.path.join(MODEL_DIR, 'model.onnx')
TAGS_PATH = os.path.join(MODEL_DIR, 'selected_tags.csv')

IMAGE_SIZE = 448

CATEGORY_MAP = {
    '0': 'general',
    '4': 'character',
    '9': 'rating',
}

# Tags that commonly hallucinate on non-anime content
BLOCKED_TAGS = {
    'implied fellatio', 'implied cunnilingus', 'implied sex',
    'implied anal', 'implied masturbation', 'implied oral',
    'sex', 'oral', 'fellatio', 'cunnilingus', 'anal',
    'nipples', 'pussy', 'penis', 'anus', 'topless',
    'cameltoe', 'pokies', 'areolae', 'cleft of venus',
    'spread legs', 'ass focus', 'breast focus', 'crotch focus',
    'pantyshot', 'upskirt', 'wardrobe malfunction',
}

# When 'no humans' scores high, suppress these person-related tags
NO_HUMANS_SUPPRESS = {
    '1girl', '1boy', '2girls', '2boys', 'multiple girls', 'multiple boys', 'solo', 'couple',
    'blonde hair', 'black hair', 'brown hair', 'red hair', 'white hair', 'blue hair', 'pink hair',
    'purple hair', 'green hair', 'grey hair', 'silver hair', 'multicolored hair',
    'long hair', 'short hair', 'twintails', 'ponytail', 'braid', 'bun', 'curly hair', 'bald',
    'smile', 'open mouth', 'closed eyes', 'looking at viewer', 'blush', 'frown',
    'dress', 'shirt', 'skirt', 'pants', 'hat', 'glasses', 'boots', 'gloves',
    'sitting', 'standing', 'lying', 'walking', 'running',
}

# When 'monochrome' scores high, suppress color-dependent tags
MONOCHROME_SUPPRESS = {
    'blue hair', 'red hair', 'pink hair', 'green hair', 'purple hair',
    'blonde hair', 'multicolored hair', 'aqua hair', 'orange hair',
}


def load_tags():
    tags = []
    with open(TAGS_PATH, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            tags.append({
                'name': row['name'].replace('_', ' '),
                'category': CATEGORY_MAP.get(row['category'], 'general'),
                'raw_category': row['category'],
            })
    return tags


def preprocess_image(image_path):
    """Resize to 448x448, pad with white, convert to BGR float32 NHWC."""
    img = Image.open(image_path).convert('RGB')

    # Fit inside 448x448 with white padding
    max_dim = max(img.size)
    scale = IMAGE_SIZE / max_dim
    new_w = int(img.size[0] * scale)
    new_h = int(img.size[1] * scale)
    img = img.resize((new_w, new_h), Image.LANCZOS)

    # Pad to 448x448
    canvas = Image.new('RGB', (IMAGE_SIZE, IMAGE_SIZE), (255, 255, 255))
    paste_x = (IMAGE_SIZE - new_w) // 2
    paste_y = (IMAGE_SIZE - new_h) // 2
    canvas.paste(img, (paste_x, paste_y))

    # Convert to numpy, RGB -> BGR, normalize to [0, 1]
    arr = np.array(canvas, dtype=np.float32) / 255.0
    arr = arr[:, :, ::-1]  # RGB to BGR
    return arr[np.newaxis, ...]  # Add batch dimension: (1, 448, 448, 3)


_session = None

def get_session():
    global _session
    if _session is None:
        import onnxruntime as ort
        _session = ort.InferenceSession(MODEL_PATH, providers=['CPUExecutionProvider'])
    return _session


def classify(image_path, general_threshold=0.35, character_threshold=0.85, max_tags=30, allow_nsfw=False):
    sess = get_session()
    tags = load_tags()
    input_tensor = preprocess_image(image_path)

    input_name = sess.get_inputs()[0].name
    output_name = sess.get_outputs()[0].name
    scores = sess.run([output_name], {input_name: input_tensor})[0][0]

    # Build score map for contradiction checks
    score_map = {}
    results = []
    rating_results = []

    for i, score in enumerate(scores):
        if i >= len(tags):
            break
        tag = tags[i]
        score = float(score)
        score_map[tag['name']] = score

        if tag['category'] == 'rating':
            rating_results.append({'name': tag['name'], 'category': 'rating', 'score': score})
            continue

        if not allow_nsfw and tag['name'] in BLOCKED_TAGS:
            continue

        threshold = character_threshold if tag['category'] == 'character' else general_threshold
        if score >= threshold:
            results.append({'name': tag['name'], 'category': tag['category'], 'score': score})

    # Apply contradiction rules
    suppressed = set()

    # no humans → suppress person tags
    no_humans_score = score_map.get('no humans', 0)
    if no_humans_score >= general_threshold:
        for tag_name in NO_HUMANS_SUPPRESS:
            if score_map.get(tag_name, 0) < no_humans_score:
                suppressed.add(tag_name)

    # monochrome → suppress color-dependent tags
    mono_score = score_map.get('monochrome', 0)
    if mono_score >= general_threshold:
        for tag_name in MONOCHROME_SUPPRESS:
            if score_map.get(tag_name, 0) < mono_score:
                suppressed.add(tag_name)

    # Filter and sort
    filtered = [t for t in results if t['name'] not in suppressed]
    filtered.sort(key=lambda t: t['score'], reverse=True)
    limited = filtered[:max_tags]

    # Skip WD rating — unreliable, handled by dedicated NSFW model

    return limited


def run_server(port):
    """Persistent HTTP server for faster repeated calls."""
    from http.server import HTTPServer, BaseHTTPRequestHandler
    import urllib.parse

    # Pre-load model
    print(f'[WD Tagger] Loading model...', file=sys.stderr)
    get_session()
    print(f'[WD Tagger] Model loaded. Server starting on port {port}', file=sys.stderr)

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

            threshold = float(params.get('threshold', ['0.35'])[0])
            max_tags = int(params.get('max_tags', ['30'])[0])
            allow_nsfw = params.get('allow_nsfw', ['false'])[0] == 'true'

            try:
                tags = classify(image_path, general_threshold=threshold, max_tags=max_tags, allow_nsfw=allow_nsfw)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(tags).encode())
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())

        def log_message(self, format, *args):
            pass  # Suppress request logs

    server = HTTPServer(('127.0.0.1', port), Handler)
    print(f'[WD Tagger] Server listening on http://127.0.0.1:{port}', file=sys.stderr)
    server.serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='WD Tagger v3 inference')
    parser.add_argument('image', nargs='?', help='Path to image file')
    parser.add_argument('--threshold', type=float, default=0.35, help='General tag threshold')
    parser.add_argument('--character-threshold', type=float, default=0.85, help='Character tag threshold')
    parser.add_argument('--max-tags', type=int, default=30, help='Max tags to return')
    parser.add_argument('--server', type=int, metavar='PORT', help='Run as persistent HTTP server')
    args = parser.parse_args()

    if args.server:
        run_server(args.server)
    elif args.image:
        if not os.path.exists(args.image):
            print(json.dumps({'error': f'File not found: {args.image}'}))
            sys.exit(1)
        tags = classify(args.image, args.threshold, args.character_threshold, args.max_tags)
        print(json.dumps(tags))
    else:
        parser.print_help()
        sys.exit(1)
