// The icons SetPopup can show (popupIcons.ts): each icon's texture, and the chosen one's model with its animation as the
// game plays it over a character's head.
import { useEffect, useState, type ReactNode } from 'react';
import { bchBytesRef } from '../bch/models';
import type { CgfxFile } from '../cgfx/cgfx';
import { ModelView } from '../ui/ModelView';
import { TextureThumb } from '../ui/TextureThumb';
import { lanaiPopupIcon, POPUP_ICONS } from './popupIcons';
import type { LanaiSession } from './session';

type Loaded = { body: Uint8Array; file: CgfxFile } | Error;

function Icons({ session }: { session: LanaiSession }): ReactNode {
  const [icons, setIcons] = useState<Loaded[] | null>(null);
  const [chosen, setChosen] = useState(0);
  useEffect(() => {
    let live = true;
    void Promise.all(POPUP_ICONS.map((p) => lanaiPopupIcon(session, p.icon).catch((e: unknown) => e as Error))).then(
      (r) => live && setIcons(r),
    );
    return () => {
      live = false;
    };
  }, [session]);
  if (!icons) return <p className="muted small">読み込み中…</p>;
  const shown = icons[chosen];
  return (
    <>
      <div className="bch-textures">
        {POPUP_ICONS.map((p, k) => {
          const x = icons[k]!;
          const t = x instanceof Error ? undefined : x.file.textures[0];
          return (
            <button
              key={p.icon}
              type="button"
              className={`popup-icon${k === chosen ? ' active' : ''}`}
              aria-pressed={k === chosen}
              title={x instanceof Error ? x.message : `${p.label}: 動きを見る`}
              onClick={() => setChosen(k)}
            >
              {t ? (
                <TextureThumb t={{ ...t, name: `${p.icon}: ${p.label}` }} />
              ) : (
                <span className="error small">{`${p.icon}: 読めません`}</span>
              )}
            </button>
          );
        })}
      </div>
      {shown && !(shown instanceof Error) && shown.file.models[0] && (
        <>
          <p className="small">{`だれに.SetPopup(2, ${chosen}, 1, 1, 0, vec(0, 0, 0)) ${POPUP_ICONS[chosen]!.label}: ゲームが頭の上に出す動き`}</p>
          <ModelView model={bchBytesRef(shown.body)} name={`popup-${chosen}`} />
        </>
      )}
    </>
  );
}

/** The icons, read when the list is opened. */
export function PopupIconList({ session }: { session: LanaiSession }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="small">{`SetPopup のアイコン (0〜${POPUP_ICONS.length - 1})`}</summary>
      <p className="muted small">
        名前は絵柄から付けたものです。13 以上の番号は 0 の絵になります。消すときは だれに.FinishPopupIcon() を使います。
      </p>
      {open && <Icons session={session} />}
    </details>
  );
}
