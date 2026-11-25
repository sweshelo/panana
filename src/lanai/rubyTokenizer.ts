// lindera's IPADIC tokenizer for autoRuby, loaded on first use from jsDelivr (lindera-wasm's web build with the
// dictionary in the wasm, 13 MB): GitHub's release zips of the dictionary have no CORS header and Cloudflare Pages
// takes no file over 25 MiB, so neither the site nor the executable carries it. The version is pinned to the
// devDependency (its types and the tests' local copy).
import type { Morpheme, RubyTokenizer } from './autoRuby';

type Lindera = typeof import('lindera-wasm-web-ipadic');

export const LINDERA_CDN = 'https://cdn.jsdelivr.net/npm/lindera-wasm-web-ipadic@2.0.0/';

/** A tokenizer from an initialised module (the CDN's in the browser, the package's in the tests). */
export function rubyTokenizerOf(m: Pick<Lindera, 'TokenizerBuilder'>): RubyTokenizer {
  const b = new m.TokenizerBuilder();
  b.setDictionary('embedded://ipadic');
  b.setMode('normal');
  b.setKeepWhitespace(true);
  const t = b.build();
  return (text) =>
    (t.tokenize(text) as { surface: string; reading?: string }[]).map((w): Morpheme => ({
      surface: w.surface,
      reading: w.reading,
    }));
}

let loading: Promise<RubyTokenizer> | undefined;

/** The tokenizer, loaded once; a failed load is tried again on the next call. */
export function loadRubyTokenizer(): Promise<RubyTokenizer> {
  loading ??= (async () => {
    try {
      const m = (await import(/* @vite-ignore */ `${LINDERA_CDN}lindera_wasm.js`)) as Lindera;
      await m.default({ module_or_path: `${LINDERA_CDN}lindera_wasm_bg.wasm` });
      return rubyTokenizerOf(m);
    } catch (e) {
      loading = undefined;
      throw new Error(`ルビの辞書を読み込めませんでした (ネット接続が必要です): ${(e as Error).message}`);
    }
  })();
  return loading;
}
