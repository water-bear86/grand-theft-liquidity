"""In a fresh Blender background process: --python this_file -- cannon.fbx parcel-cannon.glb."""
from math import cos, radians, sin
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector

source, output = map(Path, sys.argv[sys.argv.index("--") + 1:])
if not bpy.app.background or source.suffix.lower() != ".fbx" or output.suffix.lower() != ".glb":
    raise SystemExit("Run in a fresh Blender background process with an input FBX and an output GLB.")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(source.resolve()))
parts = [bpy.data.objects[name] for name in ("Solid1:1", "Solid1", "Solid1:2")]
barrel = parts[0]
# The source includes a backdrop and a loose ball. Only the assembled carriage and barrel are game props.
vertices = [obj.matrix_world @ v.co for obj in parts for v in obj.data.vertices]
low = Vector(min(v[axis] for v in vertices) for axis in range(3))
high = Vector(max(v[axis] for v in vertices) for axis in range(3))
origin = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
# The front rim is perpendicular to the barrel's 30-degree axis in this FBX.
axis = Vector((-cos(radians(30)), 0, sin(radians(30))))
gun = [barrel.matrix_world @ v.co for v in barrel.data.vertices]
front = max(v.dot(axis) for v in gun)
rim = [v for v in gun if v.dot(axis) >= front - 0.004]
mouth_position = Vector((min(v[i] for v in rim) + max(v[i] for v in rim)) / 2 for i in range(3))
# The FBX importer derives transparency from color on these solid metal and wood parts.
for material in {slot.material for obj in parts for slot in obj.material_slots if slot.material}:
    if material.node_tree:
        for node in material.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                alpha = node.inputs["Alpha"]
                for link in list(alpha.links):
                    material.node_tree.links.remove(link)
                alpha.default_value = 1.0
    material.diffuse_color[3] = 1.0
bpy.ops.object.select_all(action="DESELECT")
for obj, name in zip(parts, ("Barrel", "Carriage left", "Carriage right")):
    obj.data.transform(Matrix.Translation(-origin) @ obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    obj.name = name
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new("Game silhouette", "DECIMATE")
    modifier.ratio = 0.072
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(True)
mouth = bpy.data.objects.new("ParcelMouth", None)
bpy.context.collection.objects.link(mouth)
mouth.location = mouth_position - origin
mouth.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(output.resolve()), export_format="GLB", use_selection=True,
                          export_texcoords=False, export_tangents=False, export_animations=False)
print("Wrote", output, output.stat().st_size, "bytes with ParcelMouth at", tuple(mouth.location))
