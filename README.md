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
- Node click, property editing, delete, drag layout, and save
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
