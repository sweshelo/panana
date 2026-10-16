// CGFX dictionaries (DICT): a patricia tree over the entry names (SPICA Formats/Common/PatriciaTree.cs and
// CtrGfx/GfxDictionary.cs). Entries keep their order; the tree only speeds up lookups by name.

export interface GfxDictNode {
  referenceBit: number;
  leftNodeIndex: number;
  rightNodeIndex: number;
  /** null for the root node. */
  name: string | null;
}

function getBit(name: string | null, bit: number): boolean {
  const position = bit >>> 3;
  const charBit = bit & 7;
  if (name !== null && position < name.length) return ((name.charCodeAt(position) >> charBit) & 1) !== 0;
  return false;
}

function traverse(name: string | null, nodes: GfxDictNode[], bit = 0): { index: number; root: number } {
  let root = 0;
  let output = nodes[0]!.leftNodeIndex;
  let left = nodes[output]!;
  // Reference bits are unsigned (the root has 0xFFFFFFFF).
  while (nodes[root]!.referenceBit >>> 0 > left.referenceBit >>> 0 && left.referenceBit >>> 0 > bit >>> 0) {
    root = output;
    output = getBit(name, left.referenceBit) ? left.rightNodeIndex : left.leftNodeIndex;
    left = nodes[output]!;
  }
  return { index: output, root };
}

/** Tree nodes (root first) of a dictionary with these names, in order. */
export function buildDictTree(names: readonly string[]): GfxDictNode[] {
  const nodes: GfxDictNode[] = [{ referenceBit: names.length ? 0xffffffff : 0, leftNodeIndex: 0, rightNodeIndex: 0, name: null }];
  let maxLength = 0;
  for (const n of names) maxLength = Math.max(maxLength, n.length);
  for (const name of names) {
    let bit = ((maxLength << 3) - 1) >>> 0;
    const { index } = traverse(name, nodes);
    while (getBit(nodes[index]!.name, bit) === getBit(name, bit)) {
      bit = (bit - 1) >>> 0;
      if (bit === 0xffffffff) throw new Error(`CGFX: duplicate dictionary key ${JSON.stringify(name)}`);
    }
    const node: GfxDictNode = { referenceBit: bit, leftNodeIndex: 0, rightNodeIndex: 0, name };
    const t = traverse(name, nodes, bit);
    if (getBit(name, bit)) {
      node.leftNodeIndex = t.index;
      node.rightNodeIndex = nodes.length;
    } else {
      node.leftNodeIndex = nodes.length;
      node.rightNodeIndex = t.index;
    }
    const root = nodes[t.root]!;
    if (getBit(name, root.referenceBit)) root.rightNodeIndex = nodes.length;
    else root.leftNodeIndex = nodes.length;
    nodes.push(node);
  }
  return nodes;
}

/** Index (in entry order) of a name, or -1. */
export function dictFind(nodes: GfxDictNode[], name: string): number {
  if (nodes.length < 2) return -1;
  const { index } = traverse(name, nodes);
  return nodes[index]!.name === name ? index - 1 : -1;
}
