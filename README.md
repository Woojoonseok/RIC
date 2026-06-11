# Align Tree Editor

DB-centered Align Tree Editor MVP implemented as a local static web app.

## Run

Open `index.html` in a browser.

## Included

- Project creation and recent project storage through `localStorage`
- Align Input and Layer Relation editable grids
- Clipboard paste for Excel-style TSV/CSV rows
- CSV/TSV/TXT/HTML `.xls` upload for each table
- Validation with errors and warnings
- Auto-generated Align Tree SVG canvas
- PowerPoint/Visio-like Select and Connect modes
- Layer-only node rendering with details in the Property panel
- Visio-like connection points on each side of a selected Layer
- Port-based arrow creation, selection, editing, deletion, and validation
- Node click, property editing, confirmed delete, drag layout, resize handles, and save
- Shape formatting for fill, line, text color, line width, and font size
- Insert tools for new Layer shapes and free text boxes
- Zoom, pan, fit view, mini map, search, snap to grid, align/distribute, undo/redo, and auto layout
- Excel-readable `.xls` template and export
- SVG PPT image export and PowerPoint-readable outline export

## Data Model

The app keeps the requested DB-like model in browser state:

- Project
- Layer
- AlignKey fields embedded with each Layer row
- LayerRelation
- GraphLayout

Excel is treated as an input and output format. The browser state is the source of truth while editing.
