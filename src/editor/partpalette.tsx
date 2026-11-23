// Shared part controls. Games supply labels, thumbnails and placement actions, never format offsets here.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GridPicker } from '../ui/GridPicker';
import { InfoTip, useInfoTooltipId } from '../ui/InfoTip';

export interface PartThumbnailSource<T> {
  partThumb(part: T): Promise<string | null>;
}
export function PartPhoto<T>({
  source,
  part,
  partKey,
}: {
  source: PartThumbnailSource<T>;
  part: T;
  partKey: string;
}): ReactNode {
  const ref = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    let live = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      source
        .partThumb(part)
        .then((image) => {
          if (live) setUrl(image);
        })
        .catch(() => {});
    });
    if (ref.current) observer.observe(ref.current);
    return () => {
      live = false;
      observer.disconnect();
    };
    // The part's stable key identifies it; object-valued adapters may recreate the descriptor.
  }, [source, partKey]);
  return (
    <span ref={ref} className="photo photo-lg object-photo">
      {url ? (
        <img src={url} alt="" />
      ) : part === null ? (
        <span className="small">見た目未設定</span>
      ) : (
        <span aria-hidden="true">◇</span>
      )}
    </span>
  );
}

export function PartSelection({
  label,
  description,
  icon,
  help,
  onChoose,
  directions,
}: {
  label: string;
  description?: string;
  icon?: ReactNode;
  help: string;
  onChoose: () => void;
  directions?: { labels: readonly string[]; value: number; onChange: (value: number) => void };
}): ReactNode {
  const tooltipId = useInfoTooltipId();
  return (
    <>
      <div className="selected-part">
        <button
          className="selected-part-pick"
          onClick={onChoose}
          aria-haspopup="dialog"
          data-tooltip-id={tooltipId}
          data-tooltip-content={[label, description, 'クリックしてパーツを選ぶ・選び直す'].filter(Boolean).join('\n')}
        >
          {icon ?? (
            <span className="photo photo-lg stamp-badge" aria-hidden="true">
              ◇
            </span>
          )}
          <span className="selected-part-label">{label}</span>
          <span aria-hidden="true">▾</span>
        </button>
        <InfoTip text={help} />
      </div>
      {directions && (
        <div className="part-directions" role="group" aria-label="置き物の向き">
          {directions.labels.map((label, index) => (
            <button
              key={index}
              aria-label={`向き ${label}`}
              aria-pressed={directions.value === index}
              className={directions.value === index ? 'active' : ''}
              title={label}
              onClick={() => directions.onChange(index)}
            >
              {label.slice(0, 1)}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export interface PartChoice {
  key: string;
  name: string;
  category: string;
  icon?: ReactNode;
  sub?: string;
  title?: string;
  tooltip?: string;
  keywords?: string;
  unavailable?: string | null;
  /** Maps that use the part (the right-click menu); `placesTotal` is how many there are when the list is cut short. */
  places?: readonly PartPlace[];
  placesTotal?: number;
  /** Other pages about the part, listed first in the right-click menu (its model). */
  links?: readonly PartPlace[];
}

/** A record of a map that uses a part: the right-click menu of the picker links to it. */
export interface PartPlace {
  label: string;
  href: string;
}

/** The right-click menu of a choice: the maps that use it, each a link that closes the picker. */
function PlacesMenu({
  choice,
  x,
  y,
  onDone,
}: {
  choice: PartChoice;
  x: number;
  y: number;
  onDone: () => void;
}): ReactNode {
  const places = choice.places ?? [];
  const total = choice.placesTotal ?? places.length;
  return (
    <div
      className="part-places-menu"
      role="menu"
      aria-label={`${choice.name} の使用例`}
      style={{
        left: Math.max(0, Math.min(x, window.innerWidth - 300)),
        top: Math.max(0, Math.min(y, window.innerHeight - 340)),
      }}
    >
      {choice.links?.map((link) => (
        <a key={link.href} role="menuitem" href={link.href} onClick={onDone}>
          {link.label}
        </a>
      ))}
      <div className="muted small">
        {places.length
          ? `使用例 ${total} 件${total > places.length ? ` (先頭 ${places.length} 件)` : ''}`
          : 'ROM のマップでは使われていません'}
      </div>
      {places.map((place) => (
        <a key={place.href} role="menuitem" href={place.href} onClick={onDone}>
          {place.label}
        </a>
      ))}
    </div>
  );
}

/** Stable string keys keep asynchronously added templates separate from object row numbers. */
export function PartPicker({
  title = 'パーツを選ぶ',
  choices,
  current,
  onPick,
  onClose,
  controls,
}: {
  title?: string;
  choices: readonly PartChoice[];
  current?: string;
  onPick: (key: string) => void;
  onClose: () => void;
  controls?: ReactNode;
}): ReactNode {
  const categoryIds = new Map<string, number>();
  const categories: Record<number, string> = {};
  const entries = choices.map((choice, index) => {
    if (!categoryIds.has(choice.category)) {
      const id = categoryIds.size + 1;
      categoryIds.set(choice.category, id);
      categories[id] = choice.category;
    }
    return {
      ...choice,
      id: index + 1,
      category: categoryIds.get(choice.category),
      icon: choice.icon ?? (
        <span className="photo photo-lg stamp-badge" aria-hidden="true">
          ◇
        </span>
      ),
    };
  });
  const selected = choices.findIndex((choice) => choice.key === current);
  const [menu, setMenu] = useState<{ choice: PartChoice; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.target instanceof Element && e.target.closest('.part-places-menu')) return;
      // Escape closes the menu, not the picker
      if (e instanceof KeyboardEvent) e.preventDefault();
      setMenu(null);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
    };
  }, [menu]);
  return (
    <GridPicker
      title={title}
      entries={entries}
      categories={categories}
      groupByCategory
      cellClassName="part-choice"
      current={selected < 0 ? undefined : selected + 1}
      placeholder="名前・種類・番号で絞り込み"
      controls={
        <>
          {controls}
          {/* inside the modal dialog: an element outside it would be inert */}
          {menu && (
            <PlacesMenu
              {...menu}
              onDone={() => {
                setMenu(null);
                onClose();
              }}
            />
          )}
        </>
      }
      onClose={onClose}
      onPick={(id) => {
        const choice = choices[id - 1];
        if (choice) onPick(choice.key);
      }}
      onContext={(id, at) => {
        const choice = choices[id - 1];
        if (!choice?.places && !choice?.links) return false;
        setMenu({ choice, ...at });
        return true;
      }}
    />
  );
}

export function MapSettings({ title = '表示設定', children }: { title?: string; children: ReactNode }): ReactNode {
  return (
    <details className="map-display-settings">
      <summary>{title}</summary>
      {children}
    </details>
  );
}
