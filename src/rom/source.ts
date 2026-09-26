// Random-access byte sources. A dump is ~170 MB, so we only read the ranges we need (Blob.slice).

export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export class BlobSource implements ByteSource {
  constructor(private readonly blob: Blob) {}
  get size(): number {
    return this.blob.size;
  }
  async read(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || offset + length > this.blob.size) throw new RangeError(`read out of range: ${offset}+${length}`);
    return new Uint8Array(await this.blob.slice(offset, offset + length).arrayBuffer());
  }
}

export class BytesSource implements ByteSource {
  constructor(private readonly bytes: Uint8Array) {}
  get size(): number {
    return this.bytes.length;
  }
  async read(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || offset + length > this.bytes.length) throw new RangeError(`read out of range: ${offset}+${length}`);
    return this.bytes.subarray(offset, offset + length);
  }
}

/** A window [offset, offset + size) of another source. */
export class SubSource implements ByteSource {
  constructor(
    private readonly parent: ByteSource,
    private readonly offset: number,
    readonly size: number,
  ) {}
  read(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || offset + length > this.size) throw new RangeError(`read out of range: ${offset}+${length}`);
    return this.parent.read(this.offset + offset, length);
  }
}
