// Form pieces of the map editor's panes: a labelled field, number / hex / raw-bytes boxes that apply their
// value when they are left or Enter is pressed (like the DOM's change event).
import { useState, type ReactNode } from 'react';
import { hex8 } from '../util/bytes';
import { NumberInput } from '../ui/book';
import { bytesToHex, hexToBytes, parseHex } from './dom';

export function Field({ label, children }: { label: ReactNode; children: ReactNode }): ReactNode {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** An integer box (any 32-bit value unless min / max are given). */
export function Num({ value, onChange, min = -0x80000000, max = 0xffffffff, title }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; title?: string;
}): ReactNode {
  return <NumberInput value={value} min={min} max={max} className="" title={title} onCommit={onChange} />;
}

/** A u32 as 8 hex digits; a bad value is marked and not applied. */
export function HexInput({ value, onChange }: { value: number; onChange: (v: number) => void }): ReactNode {
  return <TextCommit key={value} className="hex" initial={hex8(value)} parse={parseHex} onCommit={onChange} />;
}

/** The raw bytes of a record or row as hex; applied only when the length is `size`. */
export function RawBytes({ bytes, rows, onChange }: { bytes: Uint8Array; rows: number; onChange: (b: Uint8Array) => void }): ReactNode {
  const text = bytesToHex(bytes);
  const parse = (s: string): Uint8Array | null => {
    const b = hexToBytes(s);
    return b && b.length === bytes.length ? b : null;
  };
  return <TextCommit key={text} multiline rows={rows} className="raw" initial={text} parse={parse} onCommit={onChange} />;
}

function TextCommit<T>({ initial, parse, onCommit, className, multiline = false, rows }: {
  initial: string; parse: (s: string) => T | null; onCommit: (v: T) => void; className: string; multiline?: boolean; rows?: number;
}): ReactNode {
  const [text, setText] = useState(initial);
  const [bad, setBad] = useState(false);
  const commit = (): void => {
    if (text === initial) return setBad(false);
    const v = parse(text);
    setBad(v === null);
    if (v !== null) onCommit(v);
  };
  const cls = className + (bad ? ' bad' : '');
  return multiline
    ? <textarea className={cls} rows={rows} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} />
    : <input type="text" className={cls} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}
