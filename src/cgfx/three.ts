// Parsed CGFX -> three.js objects. Materials are approximated: diffuse texture x vertex colour, no
// lighting, translucency kinds mapped to blending (docs/map-editor-design.md §5).
import * as THREE from 'three';
import type { CgfxMaterial, CgfxModel, CgfxTexture } from './cgfx';
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
      tex = new THREE.DataTexture(t.rgba, t.width, t.height, THREE.RGBAFormat);
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

  private material(m: CgfxMaterial | undefined, hasColor: boolean): THREE.Material {
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
    this.materials.push(mat);
    if (/ceil/i.test(mat.name)) {
      mat.visible = this.ceilingVisible;
      this.ceilings.push(mat);
    }
    return mat;
  }

  private build(model: CgfxModel): THREE.Group {
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
  }
}
