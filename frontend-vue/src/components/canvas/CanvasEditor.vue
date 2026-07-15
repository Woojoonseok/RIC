<script setup lang="ts">
import { useCanvasEditor } from "../../composables/useCanvasEditor";
const {
  app, svg, viewBox, snapEnabled, query, pointer, marquee, previewTexts, previewWaypoints, connect, relationSnap,
  graph, layouts, styles, selectedLayers, selectedRelation, selectedTexts, ports, viewBoxString, portPoint, portHandlePoint, layerLabel,
  nodePointerDown, textPointerDown, canvasDown, pointerMove, pointerUp, wheel, startConnect, finishPort,
  relationPolyline, relationAppearance, addWaypoint, waypointDown, deleteWaypoint, focusSearch, editLayer, fit, zoom,
} = useCanvasEditor();
</script>

<template>
  <div class="canvas-pane">
    <div class="canvas-float"><button @click="fit">Fit</button><button @click="zoom(.9)">＋</button><button @click="zoom(1.1)">－</button><input v-model="query" placeholder="Layer 검색" @keydown.enter="focusSearch"><button @click="focusSearch">찾기</button><label><input v-model="snapEnabled" type="checkbox">20px Snap</label></div>
    <svg ref="svg" class="canvas" :class="`${app.mode}-mode`" :viewBox="viewBoxString" @pointerdown="canvasDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp" @wheel="wheel">
      <defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e9edf3" stroke-width="1"/></pattern><marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="context-stroke"/></marker></defs>
      <rect :x="viewBox.x" :y="viewBox.y" :width="viewBox.width" :height="viewBox.height" fill="url(#grid)"/>
      <g v-for="relation in graph?.relations" :key="relation.id" class="relation-group" @click.stop="app.select({ kind: 'relation', id: relation.id })" @dblclick="addWaypoint($event, relation)">
        <polyline class="relation-hit" :points="relationPolyline(relation)"/>
        <polyline class="relation-line" :class="{ selected: selectedRelation === relation.id }" :points="relationPolyline(relation)" fill="none" :stroke="relationAppearance(relation).stroke" :stroke-width="relationAppearance(relation).strokeWidth" :stroke-dasharray="relationAppearance(relation).strokeDasharray" :marker-end="relationAppearance(relation).markerEnd"/>
        <circle v-for="(point, index) in (previewWaypoints[relation.id] || relation.waypoints || [])" :key="index" class="waypoint" :cx="point.x" :cy="point.y" r="7" @pointerdown="waypointDown($event, relation, index)" @dblclick.stop="deleteWaypoint($event, relation, index)"/>
      </g>
      <polyline v-if="connect" class="connect-preview" :points="`${connect.start.x},${connect.start.y} ${relationSnap?.point.x ?? pointer.x},${relationSnap?.point.y ?? pointer.y}`"/>
      <circle v-if="relationSnap" class="snap-dot" :cx="relationSnap.point.x" :cy="relationSnap.point.y" r="9"/>
      <g v-for="layer in graph?.layers" :key="layer.id" class="layer-node" :class="{ selected: selectedLayers.has(layer.id) }" @pointerdown="nodePointerDown($event, layer.id)" @dblclick.stop="editLayer(layer.id)">
        <template v-if="layouts.get(layer.id)"><rect :x="layouts.get(layer.id)!.x" :y="layouts.get(layer.id)!.y" :width="layouts.get(layer.id)!.width" :height="layouts.get(layer.id)!.height" rx="12" :fill="styles.get(layer.id)?.fill_color || '#fff'" :stroke="styles.get(layer.id)?.stroke_color || '#175cd3'" :stroke-width="styles.get(layer.id)?.stroke_width || 2"/><text :x="layouts.get(layer.id)!.x + layouts.get(layer.id)!.width / 2" :y="layouts.get(layer.id)!.y + layouts.get(layer.id)!.height / 2" text-anchor="middle" dominant-baseline="middle" :fill="styles.get(layer.id)?.text_color || '#101828'" :font-size="styles.get(layer.id)?.font_size || 14"><tspan v-for="(line, index) in layerLabel(layer).split('\n')" :key="index" :x="layouts.get(layer.id)!.x + layouts.get(layer.id)!.width / 2" :dy="index ? 18 : -(layerLabel(layer).split('\n').length - 1) * 9">{{ line }}</tspan></text>
          <template v-if="selectedLayers.has(layer.id) || app.mode === 'connect'"><g v-for="port in ports" :key="port"><line class="port-stem" :x1="portPoint(layouts.get(layer.id)!, port).x" :y1="portPoint(layouts.get(layer.id)!, port).y" :x2="portHandlePoint(layouts.get(layer.id)!, port).x" :y2="portHandlePoint(layouts.get(layer.id)!, port).y"/><circle class="port" :cx="portHandlePoint(layouts.get(layer.id)!, port).x" :cy="portHandlePoint(layouts.get(layer.id)!, port).y" r="8" @pointerdown="startConnect($event, layer.id, port)" @pointerup="finishPort($event, layer.id, port)"/></g></template>
          <rect v-if="selectedLayers.has(layer.id) && app.mode === 'select'" class="resize-handle" :x="layouts.get(layer.id)!.x + layouts.get(layer.id)!.width - 6" :y="layouts.get(layer.id)!.y + layouts.get(layer.id)!.height - 6" width="12" height="12" @pointerdown="nodePointerDown($event, layer.id, true)"/>
        </template>
      </g>
      <g v-for="text in graph?.text_boxes" :key="text.id" class="text-box" :class="{ selected: selectedTexts.has(text.id) }" @pointerdown="textPointerDown($event, previewTexts[text.id] || text)"><rect :x="(previewTexts[text.id] || text).x" :y="(previewTexts[text.id] || text).y" :width="(previewTexts[text.id] || text).width" :height="(previewTexts[text.id] || text).height" :fill="text.background_color" :stroke="text.border_color"/><text :x="(previewTexts[text.id] || text).x + 8" :y="(previewTexts[text.id] || text).y + (previewTexts[text.id] || text).height / 2" dominant-baseline="middle" :fill="text.text_color" :font-size="text.font_size">{{ text.text }}</text><rect v-if="selectedTexts.has(text.id) && !text.locked" class="resize-handle" :x="(previewTexts[text.id] || text).x + (previewTexts[text.id] || text).width - 6" :y="(previewTexts[text.id] || text).y + (previewTexts[text.id] || text).height - 6" width="12" height="12" @pointerdown.stop="textPointerDown($event, previewTexts[text.id] || text, true)"/></g>
      <rect v-if="marquee" class="marquee" :x="Math.min(marquee.start.x, marquee.end.x)" :y="Math.min(marquee.start.y, marquee.end.y)" :width="Math.abs(marquee.end.x - marquee.start.x)" :height="Math.abs(marquee.end.y - marquee.start.y)"/>
    </svg>
    <svg v-if="graph" class="minimap" viewBox="0 0 1600 1000"><rect width="1600" height="1000" fill="#f8fafc"/><rect v-for="layout in graph.layouts" :key="layout.id" :x="layout.x" :y="layout.y" :width="layout.width" :height="layout.height" rx="8" fill="#84adff"/><rect :x="viewBox.x" :y="viewBox.y" :width="viewBox.width" :height="viewBox.height" fill="none" stroke="#175cd3" stroke-width="10"/></svg>
    <div class="canvas-hint">Alt + 드래그 이동 · 휠 확대/축소 · 관계선 더블클릭 waypoint · 우클릭 waypoint 삭제</div>
  </div>
</template>
