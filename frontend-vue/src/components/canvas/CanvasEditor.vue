<script setup lang="ts">
import { useCanvasEditor } from "../../composables/useCanvasEditor";
const {
  app, svg, viewBox, snapEnabled, query, pointer, marquee, previewTexts, previewWaypoints, connect, portSnap, relationSnap,
  graph, relationPaths, layouts, styles, selectedLayers, selectedRelation, selectedTexts, ports, viewBoxString, portPoint, portHandlePoint, layerLabel,
  nodePointerDown, textPointerDown, canvasDown, pointerMove, pointerUp, wheel, startConnect, relationPointerDown,
  addWaypoint, waypointDown, deleteWaypoint, focusSearch, editLayer, fit, zoom,
} = useCanvasEditor();
</script>

<template>
  <div class="canvas-pane">
    <div class="canvas-float"><button @click="fit">Fit</button><button @click="zoom(.9)">＋</button><button @click="zoom(1.1)">－</button><input v-model="query" :placeholder="app.labelField === 'step' ? 'Step 검색' : 'Layer 검색'" @keydown.enter="focusSearch"><button @click="focusSearch">찾기</button><label><input v-model="snapEnabled" type="checkbox">20px Snap</label></div>
    <svg ref="svg" class="canvas" :class="`${app.mode}-mode`" :viewBox="viewBoxString" @pointerdown="canvasDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp" @wheel="wheel">
      <defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e9edf3" stroke-width="1"/></pattern><marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="context-stroke"/></marker></defs>
      <rect :x="viewBox.x" :y="viewBox.y" :width="viewBox.width" :height="viewBox.height" fill="url(#grid)"/>
      <g
        v-for="path in relationPaths"
        :key="path.relation.id"
        class="relation-group"
        :class="{ 'connect-target': Boolean(connect), 'selected-relation': selectedRelation === path.relation.id }"
        role="button"
        tabindex="0"
        :aria-label="`Relation ${path.relation.id.slice(0, 8)}`"
        @keydown.enter.prevent="app.select({ kind: 'relation', id: path.relation.id })"
        @keydown.space.prevent="app.select({ kind: 'relation', id: path.relation.id })"
        @dblclick="addWaypoint($event, path.relation)"
      >
        <polyline class="relation-hit" :points="path.polyline" @pointerdown="relationPointerDown($event, path.relation)"/>
        <polyline class="relation-line" :class="{ selected: selectedRelation === path.relation.id }" :points="path.polyline" fill="none" :stroke="path.appearance.stroke" :stroke-width="path.appearance.strokeWidth" :stroke-dasharray="path.appearance.strokeDasharray" :marker-end="path.appearance.markerEnd"/>
        <template v-if="selectedRelation === path.relation.id && !path.relation.attached_relation_id"><circle v-for="(point, index) in (previewWaypoints[path.relation.id] || path.relation.waypoints || [])" :key="index" class="waypoint" :cx="point.x" :cy="point.y" r="7" @pointerdown="waypointDown($event, path.relation, index)" @dblclick.stop="deleteWaypoint($event, path.relation, index)"/></template>
      </g>
      <polyline v-if="connect" class="connect-preview" :points="`${connect.start.x},${connect.start.y} ${portSnap?.point.x ?? relationSnap?.point.x ?? pointer.x},${portSnap?.point.y ?? relationSnap?.point.y ?? pointer.y}`"/>
      <circle v-if="portSnap || relationSnap" class="snap-dot" :cx="portSnap?.point.x ?? relationSnap!.point.x" :cy="portSnap?.point.y ?? relationSnap!.point.y" r="9"/>
      <g v-for="layer in graph?.layers" :key="layer.id" class="layer-node" :class="{ selected: selectedLayers.has(layer.id), 'connect-source': connect?.layerId === layer.id, 'connect-candidate': app.mode === 'connect' && Boolean(connect) && connect?.layerId !== layer.id }" @pointerdown="nodePointerDown($event, layer.id)" @dblclick.stop="editLayer(layer.id)">
        <template v-if="layouts.get(layer.id)"><rect :x="layouts.get(layer.id)!.x" :y="layouts.get(layer.id)!.y" :width="layouts.get(layer.id)!.width" :height="layouts.get(layer.id)!.height" rx="12" :fill="styles.get(layer.id)?.fill_color || '#fff'" :stroke="styles.get(layer.id)?.stroke_color || '#175cd3'" :stroke-width="styles.get(layer.id)?.stroke_width || 2"/><text :x="layouts.get(layer.id)!.x + layouts.get(layer.id)!.width / 2" :y="layouts.get(layer.id)!.y + layouts.get(layer.id)!.height / 2" text-anchor="middle" dominant-baseline="middle" :fill="styles.get(layer.id)?.text_color || '#101828'" :font-size="styles.get(layer.id)?.font_size || 14"><tspan v-for="(line, index) in layerLabel(layer).split('\n')" :key="index" :x="layouts.get(layer.id)!.x + layouts.get(layer.id)!.width / 2" :dy="index ? 18 : -(layerLabel(layer).split('\n').length - 1) * 9">{{ line }}</tspan></text>
          <template v-if="selectedLayers.has(layer.id)"><g v-for="port in ports" :key="port"><line class="port-stem" :x1="portPoint(layouts.get(layer.id)!, port).x" :y1="portPoint(layouts.get(layer.id)!, port).y" :x2="portHandlePoint(layouts.get(layer.id)!, port).x" :y2="portHandlePoint(layouts.get(layer.id)!, port).y"/><circle class="port" :cx="portHandlePoint(layouts.get(layer.id)!, port).x" :cy="portHandlePoint(layouts.get(layer.id)!, port).y" r="8" @pointerdown="startConnect($event, layer.id, port)"/></g></template>
          <rect v-if="selectedLayers.has(layer.id) && app.mode === 'select'" class="resize-handle" :x="layouts.get(layer.id)!.x + layouts.get(layer.id)!.width - 6" :y="layouts.get(layer.id)!.y + layouts.get(layer.id)!.height - 6" width="12" height="12" @pointerdown="nodePointerDown($event, layer.id, true)"/>
        </template>
      </g>
      <g v-for="text in graph?.text_boxes" :key="text.id" class="text-box" :class="{ selected: selectedTexts.has(text.id) }" @pointerdown="textPointerDown($event, previewTexts[text.id] || text)"><rect :x="(previewTexts[text.id] || text).x" :y="(previewTexts[text.id] || text).y" :width="(previewTexts[text.id] || text).width" :height="(previewTexts[text.id] || text).height" :fill="text.background_color" :stroke="text.border_color"/><text :x="(previewTexts[text.id] || text).x + 8" :y="(previewTexts[text.id] || text).y + (previewTexts[text.id] || text).height / 2" dominant-baseline="middle" :fill="text.text_color" :font-size="text.font_size">{{ text.text }}</text><rect v-if="selectedTexts.has(text.id) && !text.locked" class="resize-handle" :x="(previewTexts[text.id] || text).x + (previewTexts[text.id] || text).width - 6" :y="(previewTexts[text.id] || text).y + (previewTexts[text.id] || text).height - 6" width="12" height="12" @pointerdown.stop="textPointerDown($event, previewTexts[text.id] || text, true)"/></g>
      <rect v-if="marquee" class="marquee" :x="Math.min(marquee.start.x, marquee.end.x)" :y="Math.min(marquee.start.y, marquee.end.y)" :width="Math.abs(marquee.end.x - marquee.start.x)" :height="Math.abs(marquee.end.y - marquee.start.y)"/>
    </svg>
    <svg v-if="graph" class="minimap" viewBox="0 0 1600 1000"><rect width="1600" height="1000" fill="#f8fafc"/><rect v-for="layout in graph.layouts" :key="layout.id" :x="layout.x" :y="layout.y" :width="layout.width" :height="layout.height" rx="8" fill="#84adff"/><rect :x="viewBox.x" :y="viewBox.y" :width="viewBox.width" :height="viewBox.height" fill="none" stroke="#175cd3" stroke-width="10"/></svg>
    <div class="canvas-hint">Connect: Source 박스 클릭 → Target 박스 클릭 · Shift + 연결: 직각선 · Alt + 드래그 이동 · 휠 확대/축소</div>
  </div>
</template>
