"""Static server for local development that refuses to be cached.

Browsers cache ES modules aggressively, so an ordinary http.server hands back
a stale module after every edit. Everything here is served with no-store.
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))


if __name__ == "__main__":
    port = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 8731))
    root = os.path.dirname(os.path.abspath(__file__))
    handler = partial(NoCacheHandler, directory=root)
    print(f"serving {root} on http://localhost:{port} (no-store)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
