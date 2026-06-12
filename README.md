# Align Tree Editor

DB-centered Align Tree Editor MVP. The current app is now split into a real frontend, backend, and database structure.

## Structure

- `frontend/`: React + Vite editor UI
- `backend/`: FastAPI API server
- `docker-compose.yml`: optional local PostgreSQL database
- `index.html`, `styles.css`, `app.js`: legacy static prototype kept for reference

## Run

Default no-Docker mode uses SQLite. Start the backend first:

```powershell
cd D:\SW\RND_SW\RI
backend\.venv\Scripts\Activate.ps1
uvicorn app.main:app --app-dir backend --reload
```

If the virtual environment does not exist yet:

```powershell
cd D:\SW\RND_SW\RI
python -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -e backend
```

Start the frontend in another PowerShell window:

```powershell
cd D:\SW\RND_SW\RI\frontend
npm.cmd install
npm.cmd run dev
```

Open:

```text
http://127.0.0.1:5173
```

The SQLite database file is created at `D:\SW\RND_SW\RI\ric-dev.db`.

Optional PostgreSQL mode:

```powershell
cd D:\SW\RND_SW\RI
docker compose up -d db
backend\.venv\Scripts\python.exe -m pip install -e "backend[postgres]"
$env:DATABASE_URL = "postgresql+psycopg://ric:ric@localhost:5432/ric"
uvicorn app.main:app --app-dir backend --reload
```

For the legacy static prototype, open `index.html` in a browser.

## No-Docker Notes

Docker is not required for normal development. Use SQLite unless you specifically need to test PostgreSQL behavior.

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

The full-stack app stores the requested model in PostgreSQL:

- Project
- Layer
- AlignKey fields embedded with each Layer row
- LayerRelation
- GraphLayout
- ShapeStyle
- TextBox

The backend validates self-loop relations, duplicate relations, missing Layer references, and cycles before saving relation changes.

## API Shape

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/{project_id}/graph`
- `POST /api/projects/{project_id}/graph/layers`
- `PATCH /api/projects/{project_id}/graph/layers/{layer_id}/layout`
- `PATCH /api/projects/{project_id}/graph/layers/{layer_id}/style`
- `POST /api/projects/{project_id}/graph/relations`
- `PUT /api/projects/{project_id}/graph/relations/{relation_id}`
- `POST /api/projects/{project_id}/graph/text-boxes`
- `POST /api/projects/{project_id}/validate`
