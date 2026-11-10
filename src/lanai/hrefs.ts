// The links to RPG FREE!'s books, in one place so that the pickers and the pages can link to each other without
// importing the pages.

/** An item of the item book: its ItemData row. */
export const lanaiItemHref = (row: number): string => `#/items/${row}`;
/** An action of the action book: its ActionData row. */
export const lanaiActionHref = (row: number): string => `#/actions/${row}`;
