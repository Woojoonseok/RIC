import { useMemo, useRef, useState } from "react";
import type React from "react";
import type { EditorMode, Graph, Layout, PortName, SelectionItem, TextBox } from "../types";

interface Props {
  graph: Graph | null;
  selection: SelectionItem[];
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onSelectionChange: (selection: SelectionItem[]) => void;
  onSelectItem: (item: SelectionItem, additive?: boolean) => void;
  onCreateLayer: (x: number, y: number) => void;
  onCreateTextBox: (x: number, y: number) => void;
  onUpdateLayout: (layerId: string, payload: Partial<Layout>) => Promise<void>;
  onUpdateTextBox: (textBoxId: string, payload: Partial<TextBox>) => Promise<void>;
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

function portPoint(layout: Layout, port: PortName): Point {
  if (port === "top") return { x: layout.x + layout.width / 2, y: layout.y };
  if (port === "right") return { x: layout.x + layout.width, y: layout.y + layout.height / 2 };
  if (port === "bottom") return { x: layout.x + layout.width / 2, y: layout.y + layout.height };
  return { x: layout.x, y: layout.y + layout.height / 2 };
}

function intersects(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function relationStroke(type: string) {
  if (type === "reference") return { strokeDasharray: "6 6", stroke: "#7c3aed" };
  if (type === "optional") return { strokeDasharray: "2 5", stroke: "#0891b2" };
  return { strokeDasharray: undefined, stroke: "#334155" };
}

export default function CanvasEditor({
  graph,
  selection,
  mode,
  onModeChange,
  onSelectionChange,
  onSelectItem,
  onCreateLayer,
  onCreateTextBox,
  onUpdateLayout,
  onUpdateTextBox,
  onCreateRelation
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: 1600, height: 1000 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [connectStart, setConnectStart] = useState<ConnectStart | null>(null);

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

  const styleByLayer = useMemo(() => {
    const map = new Map();
    graph?.styles.forEach((style) => map.set(style.layer_id, style));
    return map;
  }, [graph]);

  const toCanvasPoint = (event: React.PointerEvent<SVGElement>): Point => {
    const svg = svgRef.current;
    if (!svg) {
      return { x: 0, y: 0 };
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
    if (event.target !== event.currentTarget) return;
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
      void Promise.all([
        ...Object.values(drag.layerOrigins).map((layout) =>
          onUpdateLayout(layout.layer_id, { x: Math.round(layout.x + dx), y: Math.round(layout.y + dy) })
        ),
        ...Object.values(drag.textOrigins).map((textBox) =>
          onUpdateTextBox(textBox.id, { x: Math.round(textBox.x + dx), y: Math.round(textBox.y + dy) })
        )
      ]);
    }

    if (drag.type === "resize-layer") {
      const width = Math.round(Math.max(60, drag.origin.width + drag.current.x - drag.start.x));
      const height = Math.round(Math.max(36, drag.origin.height + drag.current.y - drag.start.y));
      void onUpdateLayout(drag.layerId, { width, height });
    }

    if (drag.type === "resize-text") {
      const width = Math.round(Math.max(40, drag.origin.width + drag.current.x - drag.start.x));
      const height = Math.round(Math.max(24, drag.origin.height + drag.current.y - drag.start.y));
      void onUpdateTextBox(drag.textBoxId, { width, height });
    }

    setDrag(null);
  };

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.08 : 0.92;
    const point = toCanvasPoint(event as unknown as React.PointerEvent<SVGElement>);
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
        relation_type: "parent_child"
      });
    }
    setConnectStart(null);
    onModeChange("select");
  };

  const fitView = () => {
    if (!graph || graph.layouts.length === 0) return;
    const boxes = [...graph.layouts, ...graph.text_boxes];
    const minX = Math.min(...boxes.map((box) => box.x));
    const minY = Math.min(...boxes.map((box) => box.y));
    const maxX = Math.max(...boxes.map((box) => box.x + box.width));
    const maxY = Math.max(...boxes.map((box) => box.y + box.height));
    setViewBox({ x: minX - 160, y: minY - 120, width: Math.max(800, maxX - minX + 320), height: Math.max(520, maxY - minY + 240) });
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
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#e5e7eb" strokeWidth="1" />
          </pattern>
          <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="strokeWidth">
            <path d="M 1 1 L 11 6 L 1 11 z" fill="#334155" />
          </marker>
        </defs>
        <rect x={viewBox.x - 2000} y={viewBox.y - 2000} width={viewBox.width + 4000} height={viewBox.height + 4000} fill="url(#grid)" />
        {graph?.relations.map((relation) => {
          const source = layoutByLayer.get(relation.parent_layer_id);
          const target = layoutByLayer.get(relation.child_layer_id);
          if (!source || !target) return null;
          const sourceLayout = displayLayout(source);
          const targetLayout = displayLayout(target);
          const a = portPoint(sourceLayout, relation.source_port);
          const b = portPoint(targetLayout, relation.target_port);
          const style = relationStroke(relation.relation_type);
          return (
            <line
              key={relation.id}
              className={selectedRelationIds.has(relation.id) ? "relation selected" : "relation"}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={style.stroke}
              strokeDasharray={style.strokeDasharray}
              markerEnd="url(#arrow)"
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectItem({ kind: "relation", id: relation.id }, event.ctrlKey || event.metaKey || event.shiftKey);
              }}
            />
          );
        })}
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
                  const point = portPoint(layout, port);
                  return (
                    <circle
                      key={port}
                      className={connectStart ? "port connectable" : "port"}
                      cx={point.x}
                      cy={point.y}
                      r="7"
                      onPointerDown={(event) => handlePortClick(event, layer.id, port)}
                    />
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
    </section>
  );
}
