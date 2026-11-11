# NoPixel map data

`src/renderer/np-map-data.js` (coastline, zone outlines and roads for the
NoPixel tab's map) is generated from GTA V game data dumps:

- zone bounds: `zones.json` from https://github.com/DurtyFree/gta-v-data-dumps
- road network: `nodes.zip` (vehicle path nodes) from the same repository

The coastline is worked out from where roads and boat routes are, limited by
the game's ocean zone boxes.

    unzip nodes.zip            # gives nodes.json
    python3 load.py nodes.json nodes.pkl
    python3 build.py nodes.pkl zones.json ../../src/renderer/np-map-data.js

Needs Python 3 with numpy, scipy and scikit-image.
