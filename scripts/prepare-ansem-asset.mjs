// Offline only. Install the asset tools outside the game and expose them with NODE_PATH.
// node scripts/prepare-ansem-asset.mjs robot-clips.glb running-with-skin.glb [output.glb]
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as THREE from "three";

const require = createRequire(import.meta.url);
const { NodeIO } = require("@gltf-transform/core");
const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
const { prune, dedup, resample, weld, simplify, sortPrimitiveWeights } = require("@gltf-transform/functions");
const { MeshoptSimplifier } = require("meshoptimizer");
const draco = require("draco3d");
const [sourceFile, runFile, outputArg] = process.argv.slice(2);
if (!sourceFile || !runFile) throw Error("Expected the robot GLB and the running donor GLB");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = outputArg ?? path.join(root, "public/assets/ansemx.glb");
const sha = (data) => createHash("sha256").update(data).digest("hex");
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco.createDecoderModule(),
});
const target = await io.read(sourceFile);
const donor = await io.read(runFile);
const standing = target.getRoot().listAnimations().find((a) => a.getName() === "breathingIdle");
const run = donor.getRoot().listAnimations().find((a) => a.getName() === "Armature|running|baselayer");
if (!standing || !run) throw Error("The expected standing or running clip is missing");

function sample(channel) {
  const sampler = channel.getSampler();
  if (!["LINEAR", "STEP"].includes(sampler.getInterpolation()))
    throw Error("Unsupported animation interpolation");
  const times = sampler.getInput().getArray();
  const values = sampler.getOutput().getArray();
  const size = sampler.getOutput().getElementSize();
  return (time) => {
    let i = 0;
    while (i + 1 < times.length && times[i + 1] <= time) i++;
    const j = Math.min(i + 1, times.length - 1);
    const span = times[j] - times[i];
    const alpha = span > 0 && sampler.getInterpolation() !== "STEP"
      ? THREE.MathUtils.clamp((time - times[i]) / span, 0, 1) : 0;
    if (size === 4) return new THREE.Quaternion().fromArray(values, i * 4)
      .slerp(new THREE.Quaternion().fromArray(values, j * 4), alpha);
    return new THREE.Vector3().fromArray(values, i * 3)
      .lerp(new THREE.Vector3().fromArray(values, j * 3), alpha);
  };
}

function rig(document, reference) {
  const nodes = document.getRoot().listNodes();
  const byName = new Map(nodes.map((n) => [n.getName(), n]));
  const parent = new Map();
  for (const node of nodes) for (const child of node.listChildren()) parent.set(child, node);
  const channels = new Map();
  for (const channel of reference.listChannels()) {
    const node = channel.getTargetNode();
    if (!channels.has(node)) channels.set(node, {});
    channels.get(node)[channel.getTargetPath()] = sample(channel);
  }
  const local = (node, time) => {
    const c = time === undefined ? {} : channels.get(node) ?? {};
    return new THREE.Matrix4().compose(
      c.translation?.(time) ?? new THREE.Vector3(...node.getTranslation()),
      c.rotation?.(time) ?? new THREE.Quaternion(...node.getRotation()),
      c.scale?.(time) ?? new THREE.Vector3(...node.getScale()),
    );
  };
  const world = (node, time) => parent.has(node)
    ? world(parent.get(node), time).multiply(local(node, time)) : local(node, time);
  const position = (node, time) => new THREE.Vector3().setFromMatrixPosition(world(node, time));
  const rotation = (node, time) => {
    const q = new THREE.Quaternion();
    world(node, time).decompose(new THREE.Vector3(), q, new THREE.Vector3());
    return q;
  };
  const order = [];
  const walk = (node) => { order.push(node); node.listChildren().forEach(walk); };
  document.getRoot().listScenes()[0].listChildren().forEach(walk);
  return { nodes, byName, parent, channels, world, position, rotation, order };
}

const donorRig = rig(donor, run);
const robotRig = rig(target, standing);
const rigPrefix = "mixamorig:";
const sourceName = (targetName) => ({
  Spine: "Spine02", Spine1: "Spine01", Spine2: "Spine", Neck: "neck",
  HeadTop_End: "head_end",
}[targetName] ?? targetName);
const names = robotRig.nodes.filter((node) => node.getName().startsWith(rigPrefix))
  .filter((node) => donorRig.byName.has(sourceName(node.getName().slice(rigPrefix.length))));
if (names.length < 20) throw Error("The running donor does not contain the expected humanoid rig");
const offsets = new Map();
for (const node of names) {
  const name = node.getName().slice(rigPrefix.length);
  const source = donorRig.byName.get(sourceName(name));
  const child = node.listChildren().find((n) => donorRig.byName.has(sourceName(n.getName().slice(rigPrefix.length))));
  let alignment = new THREE.Quaternion();
  if (child && /(Shoulder|Arm|Hand|UpLeg|Leg)/.test(name)) {
    const sourceChild = donorRig.byName.get(sourceName(child.getName().slice(rigPrefix.length)));
    const sourceDirection = donorRig.position(sourceChild).sub(donorRig.position(source)).normalize();
    const targetDirection = robotRig.position(child).sub(robotRig.position(node)).normalize();
    alignment.setFromUnitVectors(sourceDirection, targetDirection);
  }
  // Transfer world-space motion, correcting both the bone axes and A/T rest-pose difference.
  offsets.set(node, donorRig.rotation(source).invert().multiply(alignment.invert()).multiply(robotRig.rotation(node)));
}
const hips = robotRig.byName.get("mixamorig:Hips");
const sourceHips = donorRig.byName.get("Hips");
const legLength = (skeleton, prefix) => skeleton.position(skeleton.byName.get(prefix + "LeftUpLeg"))
  .distanceTo(skeleton.position(skeleton.byName.get(prefix + "LeftLeg")))
  + skeleton.position(skeleton.byName.get(prefix + "LeftLeg"))
    .distanceTo(skeleton.position(skeleton.byName.get(prefix + "LeftFoot")));
const hipScale = legLength(robotRig, "mixamorig:") / legLength(donorRig, "");
const standingHip = robotRig.position(hips, 0);
const sourceRestHip = donorRig.position(sourceHips);
const hipParentInverse = robotRig.world(robotRig.parent.get(hips)).invert();
const duration = Math.max(...run.listSamplers().map((s) => s.getInput().getArray().at(-1)));
if (!(duration > 0 && Number.isFinite(hipScale) && hipScale > 0)) throw Error("Invalid running clip");
const frames = Math.round(duration * 60) + 1;
const times = Float32Array.from({ length: frames }, (_, i) => duration * i / (frames - 1));
const rotations = new Map(robotRig.nodes.filter((n) => n.getName().startsWith(rigPrefix))
  .map((n) => [n, new Float32Array(frames * 4)]));
const positions = new Float32Array(frames * 3);
for (let frame = 0; frame < frames; frame++) {
  const worldRotations = new Map();
  for (const node of robotRig.order) {
    const parent = robotRig.parent.get(node);
    const parentRotation = worldRotations.get(parent) ?? new THREE.Quaternion();
    const referenceRotation = robotRig.channels.get(node)?.rotation?.(0)
      ?? new THREE.Quaternion(...node.getRotation());
    let local = referenceRotation;
    if (offsets.has(node)) {
      const source = donorRig.byName.get(sourceName(node.getName().slice(rigPrefix.length)));
      local = parentRotation.clone().invert()
        .multiply(donorRig.rotation(source, times[frame])).multiply(offsets.get(node)).normalize();
    }
    worldRotations.set(node, parentRotation.clone().multiply(local));
    const track = rotations.get(node);
    if (track) {
      if (frame && new THREE.Quaternion().fromArray(track, (frame - 1) * 4).dot(local) < 0)
        local.set(-local.x, -local.y, -local.z, -local.w);
      local.toArray(track, frame * 4);
    }
  }
  const hip = donorRig.position(sourceHips, times[frame]).sub(sourceRestHip)
    .multiplyScalar(hipScale).add(standingHip);
  hip.x = standingHip.x;
  hip.z = standingHip.z;
  hip.applyMatrix4(hipParentInverse).toArray(positions, frame * 3);
}
// Close the donor loop explicitly; the controller can blend into it at any speed.
for (const values of rotations.values()) values.set(values.subarray(0, 4), values.length - 4);
positions.set(positions.subarray(0, 3), positions.length - 3);
const buffer = target.getRoot().listBuffers()[0];
const input = target.createAccessor().setType("SCALAR").setArray(times).setBuffer(buffer);
const running = target.createAnimation("Running");
const addTrack = (node, targetPath, type, values) => {
  const output = target.createAccessor().setType(type).setArray(values).setBuffer(buffer);
  const sampler = target.createAnimationSampler().setInput(input).setOutput(output).setInterpolation("LINEAR");
  running.addSampler(sampler).addChannel(target.createAnimationChannel()
    .setTargetNode(node).setTargetPath(targetPath).setSampler(sampler));
};
for (const [node, values] of rotations) addTrack(node, "rotation", "VEC4", values);
addTrack(hips, "translation", "VEC3", positions);

// Use the shoe geometry to keep planted feet on the same floor as the native idle.
// During the flight phase the donor's clearance is preserved.
const skinNode = robotRig.nodes.find((node) => node.getSkin() && node.getMesh());
const skin = skinNode.getSkin();
const joints = skin.listJoints();
const inverseBinds = joints.map((_, index) => new THREE.Matrix4().fromArray(
  skin.getInverseBindMatrices().getElement(index, []),
));
const footJoints = joints.map((joint) => /Foot|Toe/.test(joint.getName()));
const shoeVertices = [];
for (const primitive of skinNode.getMesh().listPrimitives()) {
  const coords = primitive.getAttribute("POSITION");
  const bones = primitive.getAttribute("JOINTS_0");
  const weights = primitive.getAttribute("WEIGHTS_0");
  for (let index = 0; index < coords.getCount(); index++) {
    const indices = bones.getElement(index, []);
    const influence = weights.getElement(index, []);
    if (indices.some((joint, slot) => footJoints[joint] && influence[slot] > 0)) {
      shoeVertices.push({ point: coords.getElement(index, []), indices, influence });
    }
  }
}
if (!shoeVertices.length) throw Error("The robot has no skinned shoe vertices");
function soleHeight(pose, time) {
  const transforms = joints.map((joint, index) => pose.world(joint, time).multiply(inverseBinds[index]).elements);
  let lowest = Infinity;
  for (const { point: [x, y, z], indices, influence } of shoeVertices) {
    let height = 0;
    for (let slot = 0; slot < indices.length; slot++) {
      const m = transforms[indices[slot]];
      height += influence[slot] * (m[1] * x + m[5] * y + m[9] * z + m[13]);
    }
    lowest = Math.min(lowest, height);
  }
  return lowest;
}
const floor = soleHeight(robotRig, 0);
const runningRig = rig(target, running);
const hipParentWorld = robotRig.world(robotRig.parent.get(hips));
for (let frame = 0; frame < frames; frame++) {
  const lift = Math.max(0, floor - soleHeight(runningRig, times[frame]));
  const hip = new THREE.Vector3().fromArray(positions, frame * 3).applyMatrix4(hipParentWorld);
  hip.y += lift;
  hip.applyMatrix4(hipParentInverse).toArray(positions, frame * 3);
}

const keep = new Map([["breathingIdle", "Standing"], ["walking", "Walking"], ["jump", "Jump"], ["Running", "Running"]]);
for (const animation of target.getRoot().listAnimations()) {
  if (!keep.has(animation.getName())) {
    for (const channel of animation.listChannels()) channel.dispose();
    for (const sampler of animation.listSamplers()) sampler.dispose();
    animation.dispose();
    continue;
  }
  const usedSamplers = new Set(animation.listChannels().map((channel) => channel.getSampler()));
  for (const sampler of animation.listSamplers()) {
    if (!usedSamplers.has(sampler)) sampler.dispose();
  }
  animation.setName(keep.get(animation.getName()));
  const channel = animation.listChannels().find((c) => c.getTargetNode() === hips && c.getTargetPath() === "translation");
  if (!channel) throw Error("Missing hip channel: " + animation.getName());
  const values = new Float32Array(channel.getSampler().getOutput().getArray());
  const parentWorld = robotRig.world(robotRig.parent.get(hips));
  for (let i = 0; i < values.length; i += 3) {
    const position = new THREE.Vector3().fromArray(values, i).applyMatrix4(parentWorld);
    position.x = standingHip.x; position.z = standingHip.z;
    // Rapier owns jump height; preserve only the limb motion from the jump clip.
    if (animation.getName() === "Jump") position.y = standingHip.y;
    position.applyMatrix4(hipParentInverse).toArray(values, i);
  }
  channel.getSampler().setOutput(target.createAccessor().setType("VEC3").setArray(values).setBuffer(buffer));
}
// Decode Draco offline so the existing GLTFLoader needs no new browser decoder.
for (const extension of target.getRoot().listExtensionsUsed()) {
  if (extension.extensionName === "KHR_draco_mesh_compression") extension.dispose();
}
await target.transform(
  weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.65, error: 0.001 }),
  resample({ tolerance: 1e-5 }), prune({ keepLeaves: true }), dedup(),
);
for (const primitive of skinNode.getMesh().listPrimitives()) sortPrimitiveWeights(primitive);
// Joint matrices already carry the armature transform into the skinned mesh.
robotRig.parent.get(skinNode).removeChild(skinNode);
target.getRoot().listScenes()[0].addChild(skinNode);
await io.write(outputFile, target);
const output = await readFile(outputFile);
const report = {
  key: "ansemx", file: path.basename(outputFile), provider: "user-supplied",
  sourceTool: "Meshy robot with existing Mixamo animations",
  sourceFile: path.basename(sourceFile), sourceSha256: sha(await readFile(sourceFile)),
  runningAnimationSource: path.basename(runFile), runningAnimationSourceSha256: sha(await readFile(runFile)),
  outputSha256: sha(output), bytes: output.length,
  animations: target.getRoot().listAnimations().map((a) => a.getName()),
  joints: target.getRoot().listSkins()[0].listJoints().length,
  triangles: target.getRoot().listMeshes().flatMap((m) => m.listPrimitives())
    .reduce((sum, p) => sum + p.getIndices().getCount() / 3, 0),
  optimization: "Four gameplay clips with original textures. Mesh simplified to 65% with 0.001 error tolerance. Draco decoded offline.",
  animationPreparation: "Running retargeted in world space with bone-axis, rest-pose and sole-height correction. Clips play in place. Ansem uses his supplied jump with height controlled by game physics.",
  mappedRunningBones: names.length,
};
const provenancePath = path.join(path.dirname(outputFile), "provenance.json");
const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
provenance.assets = provenance.assets.filter((a) => a.key !== report.key).concat(report);
await writeFile(provenancePath, JSON.stringify(provenance, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
