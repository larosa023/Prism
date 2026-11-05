// Builds the ad-blocking engine from the filter lists in its own short-lived
// process, so the app stays responsive and all the memory used for parsing
// goes back to the system when it exits. Writes the engine to a file.
const fs = require('fs');
const { FiltersEngine } = require('@ghostery/adblocker');

process.parentPort.once('message', (e) => {
  const { files, extra, resourcesFile, outFile } = e.data;
  try {
    const parts = [];
    for (const f of files) { try { parts.push(fs.readFileSync(f, 'utf8')); } catch {} }
    parts.push(extra || '');
    const engine = FiltersEngine.parse(parts.join('\n'), { loadCosmeticFilters: true, loadNetworkFilters: true, enableHtmlFiltering: true });
    let resources = null;
    try { resources = fs.readFileSync(resourcesFile, 'utf8'); } catch {}
    if (resources) engine.updateResources(resources, String(resources.length));
    const f = engine.getFilters();
    const rules = f.networkFilters.length + f.cosmeticFilters.length;
    fs.writeFileSync(outFile + '.tmp', engine.serialize());
    fs.renameSync(outFile + '.tmp', outFile);
    process.parentPort.postMessage({ rules });
  } catch (err) {
    process.parentPort.postMessage({ error: String(err && err.message || err) });
  }
  process.exit(0);
});
