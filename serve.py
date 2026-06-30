import http.server, os, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
handler = http.server.SimpleHTTPRequestHandler
httpd = http.server.HTTPServer(('', 3000), handler)
print("Serving on http://localhost:3000")
httpd.serve_forever()
