import { useMemo, useRef, useState } from "react";
import type React from "react";
import type { EditorMode, Graph, GraphBatchUpdate, Layout, PortName, RelationStyle, SelectionItem, TextBox } from "../types";

interface Props {
  graph: Graph | null;
  selection: SelectionItem[];
  mode: EditorMode;
  selectedRelationStyleId: string;
  onModeChange: (mode: EditorMode) => void;
  onSelectionChange: (selection: SelectionItem[]) => void;
  onSelectItem: (item: SelectionItem, additive?: boolean) => void;
  onCreateLayer: (x: number, y: number) => void;
  onCreateTextBox: (x: number, y: number) => void;
  onUpdateLayout: (layerId: string, payload: Partial<Layout>) => Promise<void>;
  onUpdateTextBox: (textBoxId: string, payload: Partial<TextBox>) => Promise<void>;
  onUpdateBatch: (payload: GraphBatchUpdate) => Promise<void>;
  onCreateRelation: (payload: Record<string, unknown>) => Promise<void>;
}

interface Point {
  x: number;
  y: number;
}

type DragState =
  | { type: "pan"; clientStart: Point; viewStart: Point }
  | { type: "marquee"; start: Point; current: Point }
  | {
      type: "move";
      start: Point;
      current: Point;
      layerIds: string[];
      textIds: string[];
      layerOrigins: Record<string, Layout>;
      textOrigins: Record<string, TextBox>;
    }
  | { type: "resize-layer"; start: Point; current: Point; layerId: string; origin: Layout }
  | { type: "resize-text"; start: Point; current: Point; textBoxId: string; origin: TextBox };

interface ConnectStart {
  layerId: string;
  port: PortName;
}

const PORTS: PortName[] = ["top", "right", "bottom", "left"];
const GRID_SIZE = 20;

function portPoint(layout: Layout, port: PortName): Point {
  if (port === "top") return { x: layout.x + layout.width / 2, y: layout.y };
  if (port === "right") return { x: layout.x + layout.width, y: layout.y + layout.height / 2 };
  if (port === "bottom") return { x: layout.x + layout.width / 2, y: layout.y + layout.height };
  return { x: layout.x, y: layout.y + layout.height / 2 };
}

function portHandlePoint(layout: Layout, port: PortName): Point {
  const point = portPoint(layout, port);
  const offset = 18;
  if (port === "top") return { x: point.x, y: point.y - offset };
  if (port === "right") return { x: point.x + offset, y: point.y };
  if (port === "bottom") return { x: point.x, y: point.y + offset };
  return { x: point.x - offset, y: point.y };
}

function snap(value: number, enabled: boolean) {
  return enabled ? Math.round(value / GRID_SIZE) * GRID_SIZE : value;
}

function intersects(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function relationStroke(type: string, style?: RelationStyle) {
  if (style) {
    const dash =
      style.line_pattern === "dashed"
        ? "8 6"
        : style.line_pattern === "dotted"
          ? "2 6"
          : style.line_pattern === "reference"
            ? "10 4 2 4"
            : undefined;
    return {
      strokeDasharray: dash,
      stroke: style.stroke_color,
      strokeWidth: style.stroke_width,
      markerEnd: style.marker_type === "arrow" ? `url(#arrow-${style.id})` : undefined
    };
  }
  const normalized = type.toLowerCase();
  if (normalized === "reference") return { strokeDasharray: "10 4 2 4", stroke: "#7c3aed", strokeWidth: 2, markerEnd: "url(#arrow-reference)" };
  if (normalized === "optional" || normalized === "warning") return { strokeDasharray: "2 5", stroke: "#0891b2", strokeWidth: 2, markerEnd: "url(#arrow-optional)" };
  if (normalized === "overlay") return { strokeDasharray: undefined, stroke: "#f97316", strokeWidth: 2, markerEnd: "url(#arrow-overlay)" };
  return { strokeDasharray: undefined, stroke: "#334155", strokeWidth: 2, markerEnd: "url(#arrow-default)" };
}

export default function CanvasEditor({
  graph,
  selection,
  mode,
  selectedRelationStyleId,
  onModeChange,
  onSelectionChange,
  onSelectItem,
  onCreateLayer,
  onCreateTextBox,
  onUpdateLayout,
  onUpdateTextBox,
  onUpdateBatch,
  onCreateRelation
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: 1600, height: 1000 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [connectStart, setConnectStart] = useState<ConnectStart | null>(null);
  const [pointerCanvas, setPointerCanvas] = useState<Point | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [search, setSearch] = useState("");

  const selectedLayerIds = useMemo(
    () => new Set(selection.filter((item) => item.kind === "layer").map((item) => item.id)),
    [selection]
  );
  const selectedTextIds = useMemo(
    () => new Set(selection.filter((item) => item.kind === "text").map((item) => item.id)),
    [selection]
  );
  const selectedRelationIds = useMemo(
    () => new Set(selection.filter((item) => item.kind === "relation").map((item) => item.id)),
    [selection]
  );

  const layoutByLayer = useMemo(() => {
    const map = new Map<string, Layout>();
    graph?.layouts.forEach((layout) => map.set(layout.layer_id, layout));
    return map;
  }, [graph]);

  const graphBounds = useMemo(() => {
    const boxes = [...(graph?.layouts ?? []), ...(graph?.text_boxes ?? [])];
    if (!boxes.length) {
      return { x: 0, y: 0, width: 1600, height: 1000 };
    }
    const minX = Math.min(...boxes.map((box) => box.x));
    const minY = Math.min(...boxes.map((box) => box.y));
    const maxX = Math.max(...boxes.map((box) => box.x + box.width));
    const maxY = Math.max(...boxes.map((box) => box.y + box.height));
    return {
      x: minX - 120,
      y: minY - 120,
      width: Math.max(500, maxX - minX + 240),
      height: Math.max(320, maxY - minY + 240)
    };
  }, [graph]);

  const styleByLayer = useMemo(() => {
    const map = new Map();
    graph?.styles.forEach((style) => map.set(style.layer_id, style));
    return map;
  }, [graph]);

  const relationStyleById = useMemo(() => {
    const map = new Map<string, RelationStyle>();
    graph?.relation_styles.forEach((style) => map.set(style.id, style));
    return map;
  }, [graph]);

  const zoomPercent = Math.round((1600 / viewBox.width) * 100);

  const toCanvasPoint = (event: React.PointerEvent<SVGElement> | React.WheelEvent<SVGSVGElement>): Point => {
    const svg = svgRef.current;
    if (!svg) {
      return { x: 0, y: 0 };
    }
    const transform = svg.getScreenCTM();
    if (transform) {
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
      return { x: point.x, y: point.y };
    }
    const rect = svg.getBoundingClientRect();
    return {
      x: viewBox.x + ((event.clientX - rect.left) / rect.width) * viewBox.width,
      y: viewBox.y + ((event.clientY - rect.top) / rect.height) * viewBox.height
    };
  };

  const displayLayout = (layout: Layout): Layout => {
    if (drag?.type === "move" && drag.layerOrigins[layout.layer_id]) {
      const origin = drag.layerOrigins[layout.layer_id];
      return { ...origin, x: origin.x + drag.current.x - drag.start.x, y: origin.y + drag.current.y - drag.start.y };
    }
    if (drag?.type === "resize-layer" && drag.layerId === layout.layer_id) {
      return {
        ...layout,
        width: Math.max(60, drag.origin.width + drag.current.x - drag.start.x),
        height: Math.max(36, drag.origin.height + drag.current.y - drag.start.y)
      };
    }
    return layout;
  };

  const displayTextBox = (textBox: TextBox): TextBox => {
    if (drag?.type === "move" && drag.textOrigins[textBox.id]) {
      const origin = drag.textOrigins[textBox.id];
      return { ...origin, x: origin.x + drag.current.x - drag.start.x, y: origin.y + drag.current.y - drag.start.y };
    }
    if (drag?.type === "resize-text" && drag.textBoxId === textBox.id) {
      return {
        ...textBox,
        width: Math.max(40, drag.origin.width + drag.current.x - drag.start.x),
        height: Math.max(24, drag.origin.height + drag.current.y - drag.start.y)
      };
    }
    return textBox;
  };

  const beginMove = (event: React.PointerEvent<SVGElement>, item: SelectionItem) => {
    if (!graph) return;
    if (event.altKey) {
      event.stopPropagation();
      setDrag({ type: "pan", clientStart: { x: event.clientX, y: event.clientY }, viewStart: { x: viewBox.x, y: viewBox.y } });
      return;
    }
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const isAlreadySelected = selection.some((selected) => selected.kind === item.kind && selected.id === item.id);
    if (!isAlreadySelected || additive) {
      onSelectItem(item, additive);
    }
    const activeSelection = isAlreadySelected ? selection : additive ? [...selection, item] : [item];
    const layerIds = activeSelection.filter((selected) => selected.kind === "layer").map((selected) => selected.id);
    const textIds = activeSelection.filter((selected) => selected.kind === "text").map((selected) => selected.id);
    const layerOrigins = Object.fromEntries(
      layerIds
        .map((id) => layoutByLayer.get(id))
        .filter((layout): layout is Layout => Boolean(layout))
        .map((layout) => [layout.layer_id, layout])
    ) as Record<string, Layout>;
    const textOrigins = Object.fromEntries(
      textIds
        .map((id) => graph.text_boxes.find((textBox) => textBox.id === id))
        .filter((textBox): textBox is TextBox => Boolean(textBox))
        .map((textBox) => [textBox.id, textBox])
    ) as Record<string, TextBox>;
    const point = toCanvasPoint(event);
    setDrag({ type: "move", start: point, current: point, layerIds, textIds, layerOrigins, textOrigins });
  };

  const handleBackgroundPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget && !(event.target instanceof SVGRectElement && event.target.classList.contains("canvas-bg"))) return;
    const point = toCanvasPoint(event);
    if (event.altKey) {
      setDrag({ type: "pan", clientStart: { x: event.clientX, y: event.clientY }, viewStart: { x: viewBox.x, y: viewBox.y } });
      return;
    }
    if (mode === "text") {
      onCreateTextBox(point.x, point.y);
      onModeChange("select");
      return;
    }
    setConnectStart(null);
    onSelectionChange([]);
    setDrag({ type: "marquee", start: point, current: point });
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    setPointerCanvas(toCanvasPoint(event));
    if (!drag) return;
    if (drag.type === "pan") {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = ((event.clientX - drag.clientStart.x) / rect.width) * viewBox.width;
      const dy = ((event.clientY - drag.clientStart.y) / rect.height) * viewBox.height;
      setViewBox((current) => ({ ...current, x: drag.viewStart.x - dx, y: drag.viewStart.y - dy }));
      return;
    }
    setDrag({ ...drag, current: toCanvasPoint(event) } as DragState);
  };

  const handlePointerUp = () => {
    if (!graph || !drag) {
      setDrag(null);
      return;
    }

    if (drag.type === "marquee") {
      const rect = {
        x: Math.min(drag.start.x, drag.current.x),
        y: Math.min(drag.start.y, drag.current.y),
        width: Math.abs(drag.current.x - drag.start.x),
        height: Math.abs(drag.current.y - drag.start.y)
      };
      const nextSelection: SelectionItem[] = [];
      graph.layers.forEach((layer) => {
        const layout = layoutByLayer.get(layer.id);
        if (layout && intersects(rect, layout)) {
          nextSelection.push({ kind: "layer", id: layer.id });
        }
      });
      graph.text_boxes.forEach((textBox) => {
        if (intersects(rect, textBox)) {
          nextSelection.push({ kind: "text", id: textBox.id });
        }
      });
      onSelectionChange(nextSelection);
    }

    if (drag.type === "move") {
      const dx = drag.current.x - drag.start.x;
      const dy = drag.current.y - drag.start.y;
      void onUpdateBatch({
        layouts: Object.values(drag.layerOrigins).map((layout) => ({
          layer_id: layout.layer_id,
          x: Math.round(snap(layout.x + dx, snapToGrid)),
          y: Math.round(snap(layout.y + dy, snapToGrid))
        })),
        text_boxes: Object.values(drag.textOrigins).map((textBox) => ({
          id: textBox.id,
          x: Math.round(snap(textBox.x + dx, snapToGrid)),
          y: Math.round(snap(textBox.y + dy, snapToGrid))
        }))
      });
    }

    if (drag.type === "resize-layer") {
      const width = Math.round(snap(Math.max(60, drag.origin.width + drag.current.x - drag.start.x), snapToGrid));
      const height = Math.round(snap(Math.max(36, drag.origin.height + drag.current.y - drag.start.y), snapToGrid));
      void onUpdateLayout(drag.layerId, { width, height });
    }

    if (drag.type === "resize-text") {
      const width = Math.round(snap(Math.max(40, drag.origin.width + drag.current.x - drag.start.x), snapToGrid));
      const height = Math.round(snap(Math.max(24, drag.origin.height + drag.current.y - drag.start.y), snapToGrid));
      void onUpdateTextBox(drag.textBoxId, { width, height });
    }

    setDrag(null);
  };

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.08 : 0.92;
    const point = toCanvasPoint(event);
    setViewBox((current) => {
      const width = Math.min(3600, Math.max(360, current.width * factor));
      const height = Math.min(2400, Math.max(240, current.height * factor));
      return {
        x: point.x - ((point.x - current.x) / current.width) * width,
        y: point.y - ((point.y - current.y) / current.height) * height,
        width,
        height
      };
    });
  };

  const handlePortClick = (event: React.PointerEvent<SVGCircleElement>, layerId: string, port: PortName) => {
    event.stopPropagation();
    if (!connectStart) {
      setConnectStart({ layerId, port });
      onSelectionChange([{ kind: "layer", id: layerId }]);
      onModeChange("connect");
      return;
    }
    if (connectStart.layerId !== layerId) {
      void onCreateRelation({
        parent_layer_id: connectStart.layerId,
        child_layer_id: layerId,
        source_port: connectStart.port,
        target_port: port,
        relation_type: relationStyleById.get(selectedRelationStyleId)?.name ?? "Align",
        relation_style_id: selectedRelationStyleId || null
      });
    }
    setConnectStart(null);
    onModeChange("select");
  };

  const fitView = () => {
    if (!graph || graph.layouts.length === 0) return;
    setViewBox({ ...graphBounds });
  };

  const focusLayer = (layerId: string) => {
    const layout = layoutByLayer.get(layerId);
    if (!layout) return;
    onSelectionChange([{ kind: "layer", id: layerId }]);
    setViewBox((current) => ({
      ...current,
      x: layout.x + layout.width / 2 - current.width / 2,
      y: layout.y + layout.height / 2 - current.height / 2
    }));
  };

  const searchLayer = () => {
    const normalized = search.trim().toLowerCase();
    if (!normalized || !graph) return;
    const layer = graph.layers.find((item) => item.name.toLowerCase().includes(normalized));
    if (layer) focusLayer(layer.id);
  };

  const marquee =
    drag?.type === "marquee"
      ? {
          x: Math.min(drag.start.x, drag.current.x),
          y: Math.min(drag.start.y, drag.current.y),
          width: Math.abs(drag.current.x - drag.start.x),
          height: Math.abs(drag.current.y - drag.start.y)
        }
      : null;

  return (
    <section className="canvas-pane">
      <div className="canvas-actions">
        <button type="button" onClick={fitView}>Fit</button>
        <button type="button" onClick={() => setViewBox((current) => ({ ...current, width: current.width * 0.9, height: current.height * 0.9 }))}>
          Zoom In
        </button>
        <button type="button" onClick={() => setViewBox((current) => ({ ...current, width: current.width * 1.1, height: current.height * 1.1 }))}>
          Zoom Out
        </button>
        <span className="zoom-label">{zoomPercent}%</span>
        <label className="snap-toggle"><input type="checkbox" checked={snapToGrid} onChange={(event) => setSnapToGrid(event.target.checked)} /> Snap</label>
        <input
          className="canvas-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") searchLayer();
          }}
          placeholder="Search layer"
        />
        <button type="button" onClick={searchLayer}>Find</button>
      </div>
      <div className="mode-hint">
        {connectStart ? "Connector: choose target point" : mode === "connect" ? "Connector Mode" : "Select Mode"}
      </div>
      <svg
        ref={svgRef}
        className={mode === "connect" ? "canvas connect-mode" : "canvas"}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
      >
        <defs>
          <pattern id="grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
            <path d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`} fill="none" stroke="#e5e7eb" strokeWidth="1" />
          </pattern>
          {[
            ["default", "#334155"],
            ["reference", "#7c3aed"],
            ["optional", "#0891b2"],
            ["overlay", "#f97316"]
          ].map(([id, color]) => (
            <marker key={id} id={`arrow-${id}`} markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
            </marker>
          ))}
          {graph?.relation_styles.map((style) => (
            <marker key={style.id} id={`arrow-${style.id}`} markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={style.stroke_color} />
            </marker>
          ))}
        </defs>
        <rect className="canvas-bg" x={viewBox.x - 2000} y={viewBox.y - 2000} width={viewBox.width + 4000} height={viewBox.height + 4000} fill="url(#grid)" />
        {graph?.relations.map((relation) => {
          const source = layoutByLayer.get(relation.parent_layer_id);
          const target = layoutByLayer.get(relation.child_layer_id);
          if (!source || !target) return null;
          const sourceLayout = displayLayout(source);
          const targetLayout = displayLayout(target);
          const a = portPoint(sourceLayout, relation.source_port);
          const b = portPoint(targetLayout, relation.target_port);
          const style = relationStroke(relation.relation_type, relation.relation_style_id ? relationStyleById.get(relation.relation_style_id) : undefined);
          return (
            <g key={relation.id}>
              <line
                className={selectedRelationIds.has(relation.id) ? "relation selected" : "relation"}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={style.stroke}
                strokeWidth={style.strokeWidth}
                strokeDasharray={style.strokeDasharray}
                markerEnd={style.markerEnd}
              />
              <line
                className="relation-hit"
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelectItem({ kind: "relation", id: relation.id }, event.ctrlKey || event.metaKey || event.shiftKey);
                }}
              />
            </g>
          );
        })}
        {connectStart && pointerCanvas && (() => {
          const source = layoutByLayer.get(connectStart.layerId);
          if (!source) return null;
          const start = portHandlePoint(displayLayout(source), connectStart.port);
          return <line className="connector-preview" x1={start.x} y1={start.y} x2={pointerCanvas.x} y2={pointerCanvas.y} />;
        })()}
        {graph?.text_boxes.map((textBox) => {
          const box = displayTextBox(textBox);
          const selected = selectedTextIds.has(textBox.id);
          return (
            <g key={textBox.id} className={selected ? "text-box selected" : "text-box"} onPointerDown={(event) => beginMove(event, { kind: "text", id: textBox.id })}>
              <rect x={box.x} y={box.y} width={box.width} height={box.height} fill={box.background_color} stroke={box.border_color} rx="3" />
              <text x={box.x + 12} y={box.y + box.height / 2 + box.font_size / 3} fill={box.text_color} fontSize={box.font_size}>
                {box.text}
              </text>
              {selected && (
                <rect
                  className="resize-handle"
                  x={box.x + box.width - 8}
                  y={box.y + box.height - 8}
                  width="12"
                  height="12"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    const point = toCanvasPoint(event);
                    setDrag({ type: "resize-text", start: point, current: point, textBoxId: textBox.id, origin: textBox });
                  }}
                />
              )}
            </g>
          );
        })}
        {graph?.layers.map((layer) => {
          const baseLayout = layoutByLayer.get(layer.id);
          if (!baseLayout) return null;
          const layout = displayLayout(baseLayout);
          const style = styleByLayer.get(layer.id);
          const selected = selectedLayerIds.has(layer.id);
          const showPorts = selected || mode === "connect" || Boolean(connectStart);
          return (
            <g key={layer.id} className={selected ? "layer-node selected" : "layer-node"} onPointerDown={(event) => beginMove(event, { kind: "layer", id: layer.id })}>
              <rect
                x={layout.x}
                y={layout.y}
                width={layout.width}
                height={layout.height}
                rx="6"
                fill={style?.fill_color ?? "#ffffff"}
                stroke={style?.stroke_color ?? "#2563eb"}
                strokeWidth={style?.stroke_width ?? 2}
              />
              <text
                x={layout.x + layout.width / 2}
                y={layout.y + layout.height / 2 + (style?.font_size ?? 14) / 3}
                textAnchor="middle"
                fill={style?.text_color ?? "#111827"}
                fontSize={style?.font_size ?? 14}
              >
                {layer.name}
              </text>
              {showPorts &&
                PORTS.map((port) => {
                  const anchor = portPoint(layout, port);
                  const point = portHandlePoint(layout, port);
                  return (
                    <g key={port}>
                      <line className="port-stem" x1={anchor.x} y1={anchor.y} x2={point.x} y2={point.y} />
                      <circle
                        className={connectStart ? "port connectable" : "port"}
                        cx={point.x}
                        cy={point.y}
                        r="7"
                        onPointerDown={(event) => handlePortClick(event, layer.id, port)}
                      />
                    </g>
                  );
                })}
              {selected && (
                <rect
                  className="resize-handle"
                  x={layout.x + layout.width - 8}
                  y={layout.y + layout.height - 8}
                  width="12"
                  height="12"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    const point = toCanvasPoint(event);
                    setDrag({ type: "resize-layer", start: point, current: point, layerId: layer.id, origin: baseLayout });
                  }}
                />
              )}
            </g>
          );
        })}
        {marquee && <rect className="marquee" x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} />}
      </svg>
      <svg className="mini-map" viewBox={`${graphBounds.x} ${graphBounds.y} ${graphBounds.width} ${graphBounds.height}`} aria-label="Mini map">
        <rect x={graphBounds.x} y={graphBounds.y} width={graphBounds.width} height={graphBounds.height} fill="#f8fafc" />
        {graph?.relations.map((relation) => {
          const source = layoutByLayer.get(relation.parent_layer_id);
          const target = layoutByLayer.get(relation.child_layer_id);
          if (!source || !target) return null;
          return (
            <line
              key={relation.id}
              x1={source.x + source.width / 2}
              y1={source.y + source.height / 2}
              x2={target.x + target.width / 2}
              y2={target.y + target.height / 2}
              stroke="#94a3b8"
              strokeWidth="6"
            />
          );
        })}
        {graph?.layouts.map((layout) => (
          <rect
            key={layout.layer_id}
            x={layout.x}
            y={layout.y}
            width={layout.width}
            height={layout.height}
            fill={selectedLayerIds.has(layout.layer_id) ? "#38bdf8" : "#cbd5e1"}
            stroke="#64748b"
            strokeWidth="4"
          />
        ))}
        <rect className="mini-viewport" x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} />
      </svg>
      <div className="relation-legend">
        <div className="panel-title">Legend</div>
        {(graph?.relation_styles ?? []).map((style) => {
          const preview = relationStroke(style.name, style);
          return (
            <div key={style.id} className="legend-row">
              <svg viewBox="0 0 74 16" aria-hidden="true">
                <defs>
                  <marker id={`legend-arrow-${style.id}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse">
                    <path d="M 0 0 L 7 3.5 L 0 7 z" fill={preview.stroke} />
                  </marker>
                </defs>
                <line
                  x1="4"
                  y1="8"
                  x2="66"
                  y2="8"
                  stroke={preview.stroke}
                  strokeWidth={Math.max(2, Math.min(4, preview.strokeWidth))}
                  strokeDasharray={preview.strokeDasharray}
                  markerEnd={style.marker_type === "arrow" ? `url(#legend-arrow-${style.id})` : undefined}
                />
              </svg>
              <span>{style.name}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
