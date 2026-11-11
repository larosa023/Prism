# NoPixel map data

`src/renderer/np-map-data.js` (coastline, zone outlines and roads for the
NoPixel tab's map) is generated from GTA V game data dumps:

- zone bounds: `zones.json` from https://github.com/DurtyFree/gta-v-data-dumps
- road network and street names: `nodes.zip` (vehicle path nodes) from the same repository
- places: `mloInteriors.json` and `objectslocations/worldGasPumps.json`; railways: `traintracks.json`
- hills: heights of the road network, smoothed and shaded (`np-map-shade.webp`, and `np-map-shade-grey.webp` for the light map)
- light map land cover: sea shallows from distance to the coast; towns from street density; desert, beaches and golf from the game's zones; forest from hill height and steepness, with a little noise to break up straight edges (drawn by style, not tree-by-tree)

The coastline is worked out from where roads and boat routes are, limited by
the game's ocean zone boxes.

    unzip nodes.zip            # gives nodes.json
    python3 load.py nodes.json nodes.pkl
    python3 build.py nodes.pkl zones.json np-map-data.js <gta-v-data-dumps folder> ../../src/renderer/np-map-shade.webp np-streets.json
    python3 merge.py np-map-data.js np-streets.json ../../src/renderer/np-map-data.js ../../src/main/np-streets.json

Needs Python 3 with numpy, scipy and scikit-image.
