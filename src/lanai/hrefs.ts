// The links to RPG FREE!'s books, in one place so that the pickers and the pages can link to each other without
// importing the pages.

/** An item of the item book: its ItemData row. */
export const lanaiItemHref = (row: number): string => `#/items/${row}`;
/** An action of the action book: its ActionData row. */
export const lanaiActionHref = (row: number): string => `#/actions/${row}`;

/**
 * A map of a content on the map page (#/maps/<content>.<name>), with a record of it as the anchor (`@section.index`):
 * the page selects the record, shows it in the inspector and brings it to the middle of the views.
 */
export const lanaiMapHref = (content: number, name?: string, rec?: { section: number; index: number }): string =>
  `#/maps/${content}${name ? `.${encodeURIComponent(name)}` : ''}${name && rec ? `@${rec.section}.${rec.index}` : ''}`;

/** A content's shops on the shop page (#/shops/<content>[.<Shop row>]). */
export const lanaiShopHref = (content: number, shop?: number): string =>
  `#/shops/${content}${shop === undefined ? '' : `.${shop}`}`;

/** A row of the sound book (#/sounds/<SoundData row>). */
export const lanaiSoundHref = (row: number): string => `#/sounds/${row}`;

const CENTER_KEY = 'panana.lanai.maps.centerOnAnchor';
let centerOnAnchor: boolean | undefined;

/** The map page's display setting: a link to a record brings it to the middle of the views (on unless turned off). */
export function lanaiCenterOnAnchor(): boolean {
  if (centerOnAnchor === undefined) {
    try {
      centerOnAnchor = localStorage.getItem(CENTER_KEY) !== '0';
    } catch {
      centerOnAnchor = true;
    }
  }
  return centerOnAnchor;
}

export function setLanaiCenterOnAnchor(on: boolean): void {
  centerOnAnchor = on;
  try {
    localStorage.setItem(CENTER_KEY, on ? '1' : '0');
  } catch {
    // the setting then lasts until the page is closed
  }
}
