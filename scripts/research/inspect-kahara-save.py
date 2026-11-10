#!/usr/bin/env python3
"""Read-only inspector for Japanese kahara 1.1.0 saves and flagData tables.

No default save path, no writes, no user names or unit records in output.
Use --flags with the flagData.bin extracted from the same ROM as --code.
JSON can contain progress values: keep generated reports outside version control.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

BASE = 0x100000


def u32(data, offset):
    return struct.unpack_from('<I', data, offset)[0]


def flag_layout(data):
    count, stride = struct.unpack_from('<II', data)
    start, size = struct.unpack_from('<II', data, 0x10)
    if count != 150 or stride != 16 or size != count * stride or start + size > len(data):
        raise ValueError('not the expected Japanese kahara flagData layout')
    cursors = [0, 0]
    rows = []
    raw_bits = 0
    for key in range(count):
        off = start + key * stride
        maximum, stored_offset, elements, overflow, packed, components = struct.unpack_from('<IIHBBB', data, off)
        bank, raw_width = packed & 3, packed >> 2
        width = min(32, max(1, raw_width))
        if bank > 1:
            raise ValueError(f'unsupported bank {bank} at key {key}')
        bits = width * elements * components
        raw_bits += raw_width * elements * components
        mask = (1 << width) - 1
        effective_maximum = maximum if 0 < maximum <= mask else mask
        rows.append(dict(key=key, maximum=maximum, effective_maximum=effective_maximum, original_offset_word=stored_offset,
                         count=elements, components=components, width=width, bank=bank,
                         overflow=overflow, bit_offset=cursors[bank], total_bits=bits))
        cursors[bank] += bits
    # 0x2815e0..0x281604: ceil(raw total bits / 8) + 16, then 4-byte align.
    allocation = (((raw_bits + 7) // 8 + 16) + 3) & ~3
    return dict(count=count, allocation=allocation, raw_bits=raw_bits,
                bank_bits=cursors, bank_byte_offsets=[0, allocation - 4], rows=rows)


def read_flag(save, block, layout, key, index=0, component=0):
    row = layout['rows'][key]
    if not 0 <= index < row['count'] or not 0 <= component < row['components']:
        raise ValueError('flag index/component out of range')
    bit = row['bit_offset'] + (index * row['components'] + component) * row['width']
    byte = block + layout['bank_byte_offsets'][row['bank']] + bit // 8
    end = byte + (bit % 8 + row['width'] + 7) // 8
    if end > len(save):
        raise ValueError('flag outside save')
    return (int.from_bytes(save[byte:end], 'little') >> (bit % 8)) & ((1 << row['width']) - 1)


def inspect_save(data, layout=None):
    if len(data) < 0x178:
        raise ValueError('truncated header')
    blocks = []
    for name, header in [('flags', 8), ('units', 0x158), ('unknown_27b0', 0x168)]:
        for bank in range(2):
            offset, size = struct.unpack_from('<II', data, header + bank * 8)
            blocks.append(dict(kind=name, bank=bank, slot=None, offset=offset, size=size))
    for bank in range(2):
        for slot in range(16):
            blocks.append(dict(kind='small', bank=bank, slot=slot,
                               offset=u32(data, 0x18 + bank * 0x80 + slot * 4),
                               size=u32(data, 0x58 + slot * 4)))
    for block in blocks:
        start, end = block['offset'], block['offset'] + block['size']
        block['in_bounds'] = 0x178 <= start <= end <= len(data)
        if block['in_bounds']:
            block['sha256'] = hashlib.sha256(data[start:end]).hexdigest()
    ranges = sorted((b['offset'], b['offset'] + b['size']) for b in blocks if b['size'])
    gaps = []
    pos = 0x178
    for start, end in ranges:
        if start != pos:
            gaps.append(dict(expected_start=pos, actual_start=start))
        pos = max(pos, end)
    if pos != len(data):
        gaps.append(dict(expected_eof=pos, actual_eof=len(data)))
    differences = []
    for first in [b for b in blocks if b['bank'] == 0]:
        second = next(b for b in blocks if b['bank'] == 1 and b['kind'] == first['kind'] and b['slot'] == first['slot'])
        if first['in_bounds'] and second['in_bounds']:
            a = data[first['offset']:first['offset'] + first['size']]
            b = data[second['offset']:second['offset'] + second['size']]
            differences.append(dict(kind=first['kind'], slot=first['slot'], differing_bytes=sum(x != y for x, y in zip(a, b)), same_size=len(a) == len(b)))
    result = dict(size=len(data), sha256=hashlib.sha256(data).hexdigest(),
                  header_word0=u32(data, 0), header_flags=u32(data, 4),
                  secondary_small_sizes=[u32(data, 0xd8 + i * 4) for i in range(16)],
                  secondary_small_target_indices=[u32(data, 0x118 + i * 4) for i in range(16)],
                  blocks=blocks, layout_discontinuities=gaps, copy_differences=differences)
    if layout:
        result['flag_allocation_matches'] = u32(data, 0xc) == layout['allocation']
        result['flag_schema_ids'] = {str(bank): read_flag(data, u32(data, 8 + bank * 8), layout, 1) for bank in range(2)}
    return result


def disassemble(code, start, count):
    from capstone import Cs, CS_ARCH_ARM, CS_MODE_ARM
    md = Cs(CS_ARCH_ARM, CS_MODE_ARM)
    md.skipdata = True
    for ins in md.disasm(code[start-BASE:start-BASE+count*4], start):
        suffix = ''
        if ins.mnemonic.startswith('ldr') and '[pc, #' in ins.op_str:
            delta = int(ins.op_str.split('#')[-1].rstrip(']'), 0)
            literal = ins.address + 8 + delta - BASE
            if 0 <= literal <= len(code)-4:
                suffix = f' ; =0x{u32(code, literal):08x}'
        print(f'{ins.address:08x}: {ins.mnemonic:9} {ins.op_str}{suffix}')


def self_test():
    """Exercise cross-byte/word extraction independently of any personal save."""
    checks = 0
    for width in range(1, 33):
        for bit in range(0, 65):
            for value in (0, 1, (1 << width) - 1, ((1 << width) - 1) // 3):
                payload = (value << bit).to_bytes(16, 'little')
                layout = dict(bank_byte_offsets=[0, 12], rows=[dict(
                    bank=0, bit_offset=bit, count=1, components=1, width=width)])
                assert read_flag(payload, 0, layout, 0) == value
                checks += 1
    table = bytearray(0x40 + 150 * 16)
    struct.pack_into('<II', table, 0, 150, 16)
    struct.pack_into('<II', table, 0x10, 0x40, 150 * 16)
    for key in range(150):
        struct.pack_into('<IIHBBB', table, 0x40 + key * 16, 0, 0, 1, 2, 4, 1)
    parsed = flag_layout(table)
    assert parsed['raw_bits'] == 150 and parsed['allocation'] == 36
    assert parsed['rows'][-1]['bit_offset'] == 149
    struct.pack_into('<IIHBBB', table, 0x40 + 149 * 16, 99, 0, 750, 2, 28, 2)
    parsed = flag_layout(table)
    assert parsed['raw_bits'] == 149 + 750 * 7 * 2
    assert parsed['rows'][-1]['effective_maximum'] == 99
    try:
        inspect_save(bytes(0x177))
        raise AssertionError('truncated header accepted')
    except ValueError:
        pass
    print(json.dumps(dict(self_test='passed', bit_read_checks=checks,
                          table_layout_checks=5, truncated_header_rejected=True)))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--save', type=Path)
    p.add_argument('--flags', type=Path)
    p.add_argument('--code', type=Path)
    p.add_argument('--disasm', type=lambda s: int(s, 0))
    p.add_argument('--count', type=int, default=100)
    p.add_argument('--xrefs', type=lambda s: int(s, 0), help='direct ARM B/BL references (candidates, including possible data)')
    p.add_argument('--values', type=lambda s: int(s, 0), nargs='*', default=[])
    p.add_argument('--self-test', action='store_true', help='run synthetic checks; no files read or written')
    args = p.parse_args()
    if args.self_test:
        self_test()
        return
    if args.disasm is not None or args.xrefs is not None:
        if not args.code:
            p.error('--code required')
        code = args.code.read_bytes()
        if args.disasm is not None:
            disassemble(code, args.disasm, args.count)
        if args.xrefs is not None:
            for off in range(0, min(len(code), 0x3bf01c)-3, 4):
                word = u32(code, off)
                if word & 0x0e000000 == 0x0a000000:
                    delta = word & 0xffffff
                    if delta & 0x800000:
                        delta -= 0x1000000
                    if BASE + off + 8 + delta * 4 == args.xrefs:
                        print(hex(BASE + off), 'BL' if word & 0x01000000 else 'B')
        return
    result = {}
    layout = flag_layout(args.flags.read_bytes()) if args.flags else None
    if layout:
        result['flag_layout'] = layout
    if args.save:
        data = args.save.read_bytes()
        result['save'] = inspect_save(data, layout)
        if args.values:
            if not layout:
                p.error('--flags required with --values')
            result['values'] = {str(key): [[read_flag(data, u32(data, 8 + bank * 8), layout, key, index, component)
                                          for index in range(layout['rows'][key]['count'])
                                          for component in range(layout['rows'][key]['components'])]
                                         for bank in range(2)] for key in args.values}
    if not result:
        p.error('provide --save, --flags, or --code with --disasm/--xrefs')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
