// Offline only: npm install --prefix /tmp/gtl-assets sharp@0.35.5
// NODE_PATH=/tmp/gtl-assets/node_modules node scripts/prepare-player-assets.cjs cabbage.glb cupsey.glb cupsey-wide-run.glb
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
function read(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2)
    throw Error("Expected GLB 2: " + file);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  if (json.buffers.length !== 1) throw Error("Expected one embedded buffer");
  const bin = bytes.subarray(28 + length);
  return {
    json,
    bytes,
    views: json.bufferViews.map((v) =>
      Buffer.from(
        bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength),
      ),
    ),
  };
}
function transferRun(target, donor) {
  const a = target.json,
    b = donor.json;
  // Refuse to retarget a different skeleton. This donor is a corrected export of the same rig.
  const byName = new Map(a.nodes.map((n, i) => [n.name, i]));
  const nodeMap = b.nodes.map((n) => byName.get(n.name));
  for (let i = 0; i < b.nodes.length; i++) {
    const n = b.nodes[i],
      t = a.nodes[nodeMap[i]];
    if (!t) throw Error("Missing donor node: " + n.name);
    for (const [key, defaults] of [
      ["translation", [0, 0, 0]],
      ["rotation", [0, 0, 0, 1]],
      ["scale", [1, 1, 1]],
    ]) {
      if (
        (n[key] || defaults).some(
          (v, j) => Math.abs(v - (t[key] || defaults)[j]) > 0.00001,
        )
      )
        throw Error("Different bind transform: " + n.name);
    }
    if (
      JSON.stringify((n.children || []).map((j) => nodeMap[j]).sort()) !==
      JSON.stringify([...(t.children || [])].sort())
    )
      throw Error("Different hierarchy: " + n.name);
  }
  const accessorMap = new Map();
  function copyAccessor(index) {
    if (accessorMap.has(index)) return accessorMap.get(index);
    const acc = structuredClone(b.accessors[index]);
    if (acc.sparse || acc.bufferView === undefined)
      throw Error("Unsupported donor animation accessor");
    const view = structuredClone(b.bufferViews[acc.bufferView]);
    const data = donor.views[acc.bufferView];
    acc.bufferView = a.bufferViews.length;
    a.bufferViews.push(view);
    target.views.push(data);
    const mapped = a.accessors.length;
    a.accessors.push(acc);
    accessorMap.set(index, mapped);
    return mapped;
  }
  const clip = structuredClone(
    b.animations.find((x) => x.name === "Running_Wide"),
  );
  if (!clip) throw Error("Missing Running_Wide");
  clip.samplers.forEach((s) => {
    s.input = copyAccessor(s.input);
    s.output = copyAccessor(s.output);
  });
  clip.channels.forEach((c) => (c.target.node = nodeMap[c.target.node]));
  a.animations.push(clip);
}
async function optimize(source, destination, donorFile) {
  const data = read(source),
    g = data.json;
  if (donorFile) transferRun(data, read(donorFile));
  const colorTextures = new Set(
    g.materials
      .flatMap((m) => [m.pbrMetallicRoughness?.baseColorTexture?.index])
      .filter((x) => x !== undefined)
      .map((i) => g.textures[i].source),
  );
  for (let i = 0; i < g.images.length; i++) {
    const img = g.images[i],
      color = colorTextures.has(i);
    if (img.bufferView === undefined) throw Error("Expected embedded textures");
    let pipeline = sharp(data.views[img.bufferView]).resize(
      color ? 2048 : 1024,
      color ? 2048 : 1024,
      { fit: "inside", withoutEnlargement: true },
    );
    pipeline = color
      ? pipeline.jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
      : pipeline.png({ compressionLevel: 9 });
    data.views[img.bufferView] = await pipeline.toBuffer();
    img.mimeType = color ? "image/jpeg" : "image/png";
    delete img.uri;
  }
  const parts = [];
  let offset = 0;
  for (let i = 0; i < g.bufferViews.length; i++) {
    const bytes = data.views[i],
      pad = (4 - (bytes.length % 4)) % 4;
    Object.assign(g.bufferViews[i], {
      buffer: 0,
      byteOffset: offset,
      byteLength: bytes.length,
    });
    parts.push(bytes, Buffer.alloc(pad));
    offset += bytes.length + pad;
  }
  g.buffers = [{ byteLength: offset }];
  let json = Buffer.from(JSON.stringify(g));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + offset, 8);
  header.writeUInt32LE(json.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(offset, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const output = Buffer.concat([header, json, binHeader, ...parts]);
  fs.writeFileSync(destination, output);
  return {
    key: path.basename(destination, ".glb"),
    file: path.basename(destination),
    provider: "user-supplied",
    sourceTool: "Meshy",
    sourceFile: path.basename(source),
    sourceSha256: sha(data.bytes),
    outputSha256: sha(output),
    bytes: output.length,
    animations: g.animations.map((a) => a.name),
    joints: g.skins[0].joints.length,
    optimization:
      "Embedded color JPEG 2048px quality 90 4:4:4; normal/material PNG 1024px. Original geometry, skin weights and clips retained.",
    ...(donorFile
      ? {
          runningAnimationSource: path.basename(donorFile),
          runningAnimationSourceSha256: sha(fs.readFileSync(donorFile)),
        }
      : {}),
  };
}
(async () => {
  const [cabbage, cupsey, wide] = process.argv.slice(2);
  if (!cabbage || !cupsey || !wide)
    throw Error(
      "Usage: node scripts/prepare-player-assets.cjs cabbage.glb cupsey.glb cupsey-wide-run.glb",
    );
  const root = path.resolve(__dirname, "../public/assets");
  const report = [
    await optimize(cabbage, path.join(root, "cabbage.glb")),
    await optimize(cupsey, path.join(root, "cupsey.glb"), wide),
  ];
  const provenance = JSON.parse(
    fs.readFileSync(path.join(root, "provenance.json"), "utf8"),
  );
  provenance.assets = provenance.assets
    .filter((a) => !report.some((r) => r.key === a.key))
    .concat(report);
  fs.writeFileSync(
    path.join(root, "provenance.json"),
    JSON.stringify(provenance, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
