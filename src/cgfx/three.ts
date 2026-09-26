// Parsed CGFX -> three.js objects. Materials with a fragment shader use the PICA pipeline emulation
// (cgfx/tev.ts); the rest fall back to a diffuse texture x vertex colour. No lighting: the models bake
// their shading into the vertex colours.
import * as THREE from 'three';
import type { CgfxMaterial, CgfxMesh, CgfxModel, CgfxTexture } from './cgfx';
import { tevMaterial } from './tev';
import type { TilesetModels } from './tileset';

const WRAP = [THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.RepeatWrapping, THREE.MirroredRepeatWrapping];

export class ModelFactory {
  private readonly textures = new Map<string, THREE.DataTexture>();
  private readonly templates = new Map<number, THREE.Group>();
  /** Clipping planes applied to every material (to cut away ceilings). */
  clipping: THREE.Plane[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly ceilings: THREE.Material[] = [];
  private ceilingVisible = false;

  constructor(readonly set: TilesetModels) {}

  private texture(t: CgfxTexture, m: CgfxMaterial): THREE.DataTexture {
    const key = `${t.name}/${m.wrapS}/${m.wrapT}/${m.uv.scaleU}/${m.uv.scaleV}/${m.uv.translateU}/${m.uv.translateV}`;
    let tex = this.textures.get(key);
    if (!tex) {
      tex = new THREE.DataTexture(flipRows(t), t.width, t.height, THREE.RGBAFormat);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = WRAP[m.wrapS] ?? THREE.RepeatWrapping;
      tex.wrapT = WRAP[m.wrapT] ?? THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.flipY = false;
      tex.repeat.set(m.uv.scaleU || 1, m.uv.scaleV || 1);
      tex.offset.set(m.uv.translateU, m.uv.translateV);
      tex.needsUpdate = true;
      this.textures.set(key, tex);
    }
    return tex;
  }

  private readonly rawTextures = new Map<string, THREE.DataTexture>();

  /** Texture for the TEV shader: raw (no colour-space conversion), UV transform done in the shader. */
  private rawTexture(t: CgfxTexture, wrapS: number, wrapT: number): THREE.DataTexture {
    const key = `${t.name}/${wrapS}/${wrapT}`;
    let tex = this.rawTextures.get(key);
    if (!tex) {
      tex = new THREE.DataTexture(flipRows(t), t.width, t.height, THREE.RGBAFormat);
      tex.colorSpace = THREE.NoColorSpace;
      tex.wrapS = WRAP[wrapS] ?? THREE.RepeatWrapping;
      tex.wrapT = WRAP[wrapT] ?? THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      this.rawTextures.set(key, tex);
    }
    return tex;
  }

  private material(m: CgfxMaterial | undefined, hasColor: boolean): THREE.Material {
    if (m?.tev && m.units) {
      const maps = m.units.map((u) => (u.name && this.set.textures.has(u.name) ? this.rawTexture(this.set.textures.get(u.name)!, u.wrapS, u.wrapT) : null));
      return this.register(tevMaterial(m, { maps }, this.clipping));
    }
    const texName = m?.textures.find((t) => t && this.set.textures.has(t));
    const tex = m && texName ? this.texture(this.set.textures.get(texName)!, m) : null;
    // Shading is baked into the vertex colours (the models carry few or no normals), so no lighting.
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color: tex ? 0xffffff : 0x9a8f80,
      vertexColors: hasColor,
      side: THREE.DoubleSide,
      clippingPlanes: this.clipping,
    });
    const layer = m?.layer ?? 0;
    if (layer === 1) {
      mat.transparent = true;
      mat.depthWrite = false;
    } else if (layer === 2 || layer === 3) {
      mat.transparent = true;
      mat.depthWrite = false;
      mat.blending = layer === 3 ? THREE.AdditiveBlending : THREE.SubtractiveBlending;
      if (layer === 2) mat.premultipliedAlpha = true;
    } else {
      mat.alphaTest = 0.5;
    }
    mat.name = m?.name ?? '';
    return this.register(mat);
  }

  private register(mat: THREE.Material): THREE.Material {
    this.materials.push(mat);
    if (/ceil/i.test(mat.name)) {
      mat.visible = this.ceilingVisible;
      this.ceilings.push(mat);
    }
    return mat;
  }

  /**
   * A model with its own geometry and materials (for animating), and the source mesh of each three.js mesh.
   */
  buildOwn(hash: number): { model: CgfxModel; group: THREE.Group; parts: { mesh: THREE.Mesh; src: CgfxMesh }[] } | null {
    const model = this.set.models.get(hash);
    if (!model) return null;
    const parts: { mesh: THREE.Mesh; src: CgfxMesh }[] = [];
    const group = this.build(model, parts);
    for (const { mesh } of parts) {
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      mesh.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos.array as Float32Array), 3));
      mesh.frustumCulled = false;
    }
    return { model, group, parts };
  }

  private build(model: CgfxModel, parts?: { mesh: THREE.Mesh; src: CgfxMesh }[]): THREE.Group {
    const g = new THREE.Group();
    g.name = model.name;
    const mats = new Map<string, THREE.Material>();
    for (const me of model.meshes) {
      if (!me.visible || !me.indices.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(me.positions, 3));
      if (me.normals) geo.setAttribute('normal', new THREE.BufferAttribute(me.normals, 3));
      else geo.computeVertexNormals();
      if (me.uvs) geo.setAttribute('uv', new THREE.BufferAttribute(me.uvs, 2));
      const layer = model.materials[me.material]?.layer ?? 0;
      if (me.colors) {
        // Vertex alpha often feeds the texture combiners rather than opacity: only translucent layers use it.
        if (layer === 0) {
          const rgb = new Float32Array((me.colors.length / 4) * 3);
          for (let i = 0, j = 0; i < me.colors.length; i += 4, j += 3) {
            rgb[j] = me.colors[i]!;
            rgb[j + 1] = me.colors[i + 1]!;
            rgb[j + 2] = me.colors[i + 2]!;
          }
          geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
        } else geo.setAttribute('color', new THREE.BufferAttribute(me.colors, 4));
      }
      // Attributes of the TEV shader: full RGBA vertex colour (white when absent) and UV sets 1 / 2.
      const n = me.positions.length / 3;
      geo.setAttribute('aColor', new THREE.BufferAttribute(me.colors ?? new Float32Array(n * 4).fill(1), 4));
      const zeros = me.uvs ?? new Float32Array(n * 2);
      geo.setAttribute('aUv1', new THREE.BufferAttribute(me.uvs1 ?? zeros, 2));
      geo.setAttribute('aUv2', new THREE.BufferAttribute(me.uvs2 ?? zeros, 2));
      if (!me.uvs) geo.setAttribute('uv', new THREE.BufferAttribute(zeros, 2));
      geo.setIndex(new THREE.BufferAttribute(me.indices, 1));
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      const key = `${me.material}/${!!me.colors}`;
      let mat = mats.get(key);
      if (!mat) {
        mat = this.material(model.materials[me.material], !!me.colors);
        mats.set(key, mat);
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = me.name;
      mesh.renderOrder = me.priority;
      g.add(mesh);
      parts?.push({ mesh, src: me });
    }
    return g;
  }

  /** A new instance (shares geometry and materials) of a model, or null. */
  instance(hash: number): THREE.Group | null {
    let t = this.templates.get(hash);
    if (!t) {
      const m = this.set.models.get(hash);
      if (!m) return null;
      t = this.build(m);
      this.templates.set(hash, t);
    }
    return t.clone();
  }

  /** Ceilings (materials named *ceil*) hide the floor when seen from above. */
  setCeilingVisible(v: boolean): void {
    this.ceilingVisible = v;
    for (const m of this.ceilings) m.visible = v;
  }

  modelName(hash: number): string {
    return this.set.models.get(hash)?.name ?? '';
  }

  dispose(): void {
    for (const t of this.templates.values())
      t.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    for (const m of this.materials) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    for (const t of this.rawTextures.values()) t.dispose();
  }
}

/**
 * PICA textures are stored top row first, while the UVs use the GL convention (v = 0 at the bottom), so
 * hand the rows to GL bottom-up.
 */
function flipRows(t: CgfxTexture): Uint8Array {
  const out = new Uint8Array(t.rgba.length);
  const row = t.width * 4;
  for (let y = 0; y < t.height; y++) out.set(t.rgba.subarray(y * row, (y + 1) * row), (t.height - 1 - y) * row);
  return out;
}
