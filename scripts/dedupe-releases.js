// Removes duplicate GitHub releases left behind when electron-builder's
// parallel uploads each created their own release for the same tag.
// For every tag with more than one release, keeps the one holding latest.yml
// and deletes the others (the files they hold are copied over first).
const { execFileSync } = require('child_process');
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
const repo = process.env.GITHUB_REPOSITORY;

const releases = JSON.parse(gh('api', `repos/${repo}/releases?per_page=100`));
const byTag = new Map();
for (const r of releases) {
  if (!byTag.has(r.tag_name)) byTag.set(r.tag_name, []);
  byTag.get(r.tag_name).push(r);
}
for (const [tag, list] of byTag) {
  if (list.length < 2) continue;
  const keep = list.find((r) => r.assets.some((a) => a.name === 'latest.yml')) || list[0];
  const have = new Set(keep.assets.map((a) => a.name));
  for (const r of list) {
    if (r.id === keep.id) continue;
    for (const a of r.assets) {
      if (have.has(a.name)) continue;
      // Move the missing file onto the release we keep.
      gh('api', `repos/${repo}/releases/assets/${a.id}`, '-H', 'Accept: application/octet-stream', '--output', a.name);
      execFileSync('gh', ['release', 'upload', tag, a.name, '--clobber', '-R', repo], { stdio: 'inherit' });
      have.add(a.name);
    }
    gh('api', '-X', 'DELETE', `repos/${repo}/releases/${r.id}`);
    console.log(`Removed duplicate release ${r.id} for ${tag}`);
  }
}
