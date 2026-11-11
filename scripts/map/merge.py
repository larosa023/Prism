# Combines build.py's outputs into the files the app ships:
#   python3 merge.py np-map-data.js np-streets.json ../../src/renderer/np-map-data.js ../../src/main/np-streets.json
import json, sys
src, streets, out_js, out_names = sys.argv[1:5]
s = open(src).read(); i = s.index('='); d = json.loads(s[i + 1:].rstrip().rstrip(';'))
sz = json.load(open(streets))
d['streetZone'] = sz['streetZone']
open(out_js, 'w').write(s[:i] + '= ' + json.dumps(d, separators=(',', ':')) + ';\n')
json.dump(sz['streets'], open(out_names, 'w'))
