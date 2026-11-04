// Removes duplicate GitHub releases left behind when electron-builder's
// parallel uploads each created their own release for the same tag.
// For every tag with more than one release, keeps the one holding latest.yml
// and deletes the others (the files they hold are copied over first).
const { execFileSync } = require('child_process');
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
const fs = require('fs');
const repo = process.env.GITHUB_REPOSITORY;

async function downloadAsset(id, name) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/assets/${id}`, {
    headers: { Accept: 'application/octet-stream', Authorization: `Bearer ${process.env.GH_TOKEN}` }
  });
  if (!res.ok) throw new Error(`download ${name}: HTTP ${res.status}`);
  fs.writeFileSync(name, Buffer.from(await res.arrayBuffer()));
}

(async () => {
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
    // Save the files the kept release is missing, delete the duplicate
    // (so the tag points at one release), then upload them to the kept one.
    const moving = r.assets.filter((a) => !have.has(a.name));
    for (const a of moving) await downloadAsset(a.id, a.name);
    gh('api', '-X', 'DELETE', `repos/${repo}/releases/${r.id}`);
    console.log(`Removed duplicate release ${r.id} for ${tag}`);
    for (const a of moving) {
      execFileSync('gh', ['release', 'upload', tag, a.name, '--clobber', '-R', repo], { stdio: 'inherit' });
      have.add(a.name);
    }
  }
}
})().catch((e) => { console.error(e.message); process.exit(1); });
