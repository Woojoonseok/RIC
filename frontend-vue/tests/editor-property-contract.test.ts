import { describe, expect, it } from "vitest";
import editorViewSource from "../src/views/EditorView.vue?raw";
import propertyPanelSource from "../src/components/editor/PropertyPanel.vue?raw";
import validationSource from "../src/views/ValidationView.vue?raw";
import alignKeySource from "../src/views/AlignKeyEditorView.vue?raw";
import apiSource from "../src/api/client.ts?raw";
import { readFileSync } from "node:fs";

const stylesSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("editor property UI regression contract", () => {
  it("closes expanded properties without clearing the selection", () => {
    expect(propertyPanelSource).toContain('if (props.expanded) emit("toggleExpanded")');
    expect(propertyPanelSource).toContain("else app.clearSelection()");
    expect(editorViewSource).toContain('aria-label="배경을 눌러 확대 속성 편집 닫기"');
  });

  it("keeps canvas settings separate from Layer master information", () => {
    expect(propertyPanelSource).toContain("LayerMasterPropertySection");
    expect(propertyPanelSource).toContain("LayerCanvasSettings");
    expect(validationSource).not.toMatch(/align_side|layer_property/);
    expect(validationSource).toContain("mask_main_fld");
  });

  it("persists Align Key rows through the project API", () => {
    expect(alignKeySource).toContain("api.alignKeyRows");
    expect(alignKeySource).toContain("api.updateAlignKeyRow");
    expect(alignKeySource).not.toContain("project.projectId");
    expect(apiSource).toContain("/align-key-rows");
  });

  it("keeps the Layer Relation command bar compact above the grid", () => {
    expect(stylesSource).toContain(".relation-data-panel { display: grid; grid-template-rows: auto auto minmax(0, 1fr);");
  });
});
