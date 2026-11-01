import type * as THREE from 'three';
import type { ModelFactory } from '../cgfx/three';
import { renderObjectThumb } from './thumbs';
export interface ThumbnailModel { factory: ModelFactory; hash: number; pose?: THREE.Object3D | null }
/** Cache PNGs, not GPU resources. Adapters use their existing game model loaders. */
export class PartThumbnails<T> {
  private readonly images = new Map<string,Promise<string | null>>();
  private disposed=false;
  constructor(private readonly load: (part: T) => Promise<ThumbnailModel | null>, private readonly renderModel=renderObjectThumb) {}
  get(key: string, part: T): Promise<string | null> {
    if(this.disposed) return Promise.resolve(null);
    let pending=this.images.get(key);
    if(!pending) {
      pending=this.render(part).catch(() => null);
      this.images.set(key,pending);
    }
    return pending;
  }
  private async render(part: T): Promise<string | null> {
    const loaded=await this.load(part);
    if(!loaded) return null;
    try {
      if(this.disposed) return null;
      const model=loaded.pose?.clone() ?? loaded.factory.instance(loaded.hash);
      return model ? this.renderModel(loaded.factory,model) : null;
    } finally {loaded.factory.dispose();}
  }
  dispose(): void {this.disposed=true;this.images.clear();}
}
