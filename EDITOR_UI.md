# Shared map editing UI

The left panes of Kahara, Oahu and Lanai use `MapToolbox` (`src/editor/tools.tsx`): chip/part modes, compact accessible tools, and optional duplicate/delete actions. Selecting a brush or stamp updates the mode through `MapEditState.setTool`; switching modes preserves the brush and stamp. A game can replace the tile tool labels, such as Lanai's enemy-group cell tool.

`src/editor/partpalette.tsx` provides `PartSelection` (the clickable selected/empty card and optional facing controls), `PartPicker` (one searchable, categorized dialog), `PartPhoto` (visible-only asynchronous thumbnails), and `MapSettings` (collapsible settings). Choice keys are stable strings; the dialog maps them to GridPicker's numeric IDs internally. Miscellaneous objects and object/event templates share the ギミック category. Kahara's chest, damage floor, frozen floor, switch/gate and boss choices are peers in the basic-parts row.

`src/editor/recordparts.tsx` adapts prop/template placement for Oahu and Lanai. The games supply their templates, valid object rows, facing labels, model descriptors and placement state. The common component does not read binary offsets, infer game-specific object numbering, or create new event types. Numeric object selection remains available inside the dialog. Oahu and Lanai supply their existing record-model interpretation through `partLook` and their existing model loaders through `partThumb`.

`src/editor/part-thumbnails.ts` caches images and deduplicates in-flight requests. Temporary model factories are disposed after rendering, including failed renders and loads that finish after a map is closed. The cache belongs to the view, not a global game-independent cache, so identical numeric IDs from different games or contents cannot collide.

Oahu and Lanai retain their EventObject copy/undo/export semantics. Region-bound templates are cleared when opening a different dungeon/MapGroup; a prop remains selected. Lanai's enemy-cell controls appear directly under the tools when that tool is active; enemy settings, sounds/battle backgrounds and display settings otherwise stay in foldouts.

Honolulu remains view-only. Its existing viewer is unchanged and `MapToolbox` refuses a read-only state. Future editing can reuse these components by implementing its own state, model source and part/record adapters; no Kahara, Oahu or Lanai data layout is required by the shared components.

Checks: `bun test test/partpalette.test.ts test/toolbox.test.ts`, plus the existing map edit/ROM suites and browser verification with the relevant Base/Update dumps.
