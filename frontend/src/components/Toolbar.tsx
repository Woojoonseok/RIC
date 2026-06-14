import type { BoxPreset, EditorMode, RelationStyle } from "../types";

interface Props {
  mode: EditorMode;
  busy: boolean;
  status: string;
  projectId: string;
  relationStyles: RelationStyle[];
  selectedRelationStyleId: string;
  boxPresets: BoxPreset[];
  selectedBoxPresetId: string;
  selectedLayerCount: number;
  canUndo: boolean;
  canRedo: boolean;
  canSplitLayer: boolean;
  onRelationStyleChange: (styleId: string) => void;
  onBoxPresetChange: (presetId: string) => void;
  onCreateRelationStyle: () => void;
  onModeChange: (mode: EditorMode) => void;
  onCreateLayer: () => void;
  onCreateTextBox: () => void;
  onMergeLayers: () => void;
  onSplitLayer: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onAutoLayout: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}

export default function Toolbar({
  mode,
  busy,
  status,
  projectId,
  relationStyles,
  selectedRelationStyleId,
  boxPresets,
  selectedBoxPresetId,
  selectedLayerCount,
  canUndo,
  canRedo,
  canSplitLayer,
  onRelationStyleChange,
  onBoxPresetChange,
  onCreateRelationStyle,
  onModeChange,
  onCreateLayer,
  onCreateTextBox,
  onMergeLayers,
  onSplitLayer,
  onUndo,
  onRedo,
  onAutoLayout,
  onDelete,
  onRefresh
}: Props) {
  return (
    <header className="toolbar">
      <select value={selectedRelationStyleId} onChange={(event) => onRelationStyleChange(event.target.value)} aria-label="Arrow style">
        {relationStyles.map((style) => (
          <option key={style.id} value={style.id}>
            {style.name}
          </option>
        ))}
      </select>
      <button type="button" onClick={onCreateRelationStyle} disabled={!projectId}>Add Arrow</button>
      <div className="divider" />
      <button type="button" onClick={onUndo} disabled={!canUndo}>Undo</button>
      <button type="button" onClick={onRedo} disabled={!canRedo}>Redo</button>
      <div className="divider" />
      <select value={selectedBoxPresetId} onChange={(event) => onBoxPresetChange(event.target.value)} aria-label="Box preset">
        {boxPresets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>
      <button type="button" className={mode === "select" ? "active" : ""} onClick={() => onModeChange("select")}>
        Select
      </button>
      <button type="button" className={mode === "connect" ? "active" : ""} onClick={() => onModeChange("connect")}>
        Connect
      </button>
      <button type="button" className={mode === "text" ? "active" : ""} onClick={() => onModeChange("text")}>
        Text
      </button>
      <div className="divider" />
      <button type="button" onClick={onCreateLayer}>Add Layer</button>
      <button type="button" onClick={onCreateTextBox}>Add Text</button>
      <button type="button" onClick={onMergeLayers} disabled={selectedLayerCount < 2}>Merge Layers</button>
      <button type="button" onClick={onSplitLayer} disabled={!canSplitLayer}>Split Layer</button>
      <button type="button" onClick={onAutoLayout} disabled={!projectId}>Auto Layout</button>
      <button type="button" onClick={onDelete}>Delete</button>
      <button type="button" onClick={onRefresh}>Refresh</button>
      <div className="toolbar-status" data-busy={busy}>
        {busy ? "Saving..." : status}
      </div>
    </header>
  );
}
