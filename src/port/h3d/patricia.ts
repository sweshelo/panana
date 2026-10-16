// H3D name trees (SPICA H3DPatriciaTree.RebuildTree / PatriciaTree.Insert): a root node and one node per name, in
// the order of the names; each node {u32 reference bit, u16 left, u16 right, name}.

export interface PatriciaNode {
  referenceBit: number;
  left: number;
  right: number;
  name: string | null;
}

const getBit = (name: string | null, bit: number): boolean => {
  const pos = bit >>> 3;
  return name !== null && pos < name.length ? ((name.charCodeAt(pos) >> (bit & 7)) & 1) !== 0 : false;
};

/** Index of the node a search for `name` ends at, and the last node it went through (SPICA Traverse). */
function traverse(name: string, nodes: PatriciaNode[], bit = 0): { out: number; root: number } {
  let root = 0;
  let out = nodes[0]!.left;
  let left = nodes[out]!;
  while (nodes[root]!.referenceBit > left.referenceBit && left.referenceBit > bit) {
    const next = getBit(name, left.referenceBit) ? left.right : left.left;
    root = out;
    out = next;
    left = nodes[out]!;
  }
  return { out, root };
}

export function buildPatriciaTree(names: string[]): PatriciaNode[] {
  const nodes: PatriciaNode[] = [{ referenceBit: names.length ? 0xffffffff : 0, left: 0, right: 0, name: null }];
  const maxLength = names.reduce((m, n) => Math.max(m, n.length), 0);
  for (const name of names) {
    let bit = maxLength * 8 - 1;
    const index = traverse(name, nodes).out;
    while (getBit(nodes[index]!.name, bit) === getBit(name, bit)) {
      if (--bit < 0) throw new Error(`duplicate name in a dictionary: ${name}`);
    }
    const node: PatriciaNode = { referenceBit: bit, left: 0, right: 0, name };
    const t = traverse(name, nodes, bit);
    if (getBit(name, bit)) {
      node.left = t.out;
      node.right = nodes.length;
    } else {
      node.left = nodes.length;
      node.right = t.out;
    }
    const root = nodes[t.root]!;
    if (getBit(name, root.referenceBit)) root.right = nodes.length;
    else root.left = nodes.length;
    nodes.push(node);
  }
  return nodes;
}
