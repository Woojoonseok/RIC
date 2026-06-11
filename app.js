const ALIGN_COLUMNS = ["Step", "Layer", "Layer_Property", "Align", "Align_side"];
const RELATION_COLUMNS = ["Parent_Layer", "Child_Layer", "Relation_Type"];
const ALLOWED_SIDES = ["LEFT", "RIGHT", "CENTER", "TOP", "BOTTOM"];
const RELATION_TYPES = ["Align", "Overlay", "Reference", "Warning"];
const STORE_KEY = "align-tree-editor-projects";
const PORTS = ["top", "right", "bottom", "left"];
const DEFAULT_LAYER_STYLE = {
  fill: "#ffffff",
  stroke: "#30435f",
  strokeWidth: 1.5,
  textColor: "#18202c",
  fontSize: 13,
};
const DEFAULT_TEXT_STYLE = {
  fill: "transparent",
  stroke: "transparent",
  strokeWidth: 1,
  textColor: "#18202c",
  fontSize: 16,
};

const sampleProject = {
  project_id: crypto.randomUUID(),
  project_name: "Project_A",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  layers: [
    { layer_id: crypto.randomUUID(), step: "S01", layer_name: "WL", layer_property: "Main", align_name: "AA01", align_side: "LEFT" },
    { layer_id: crypto.randomUUID(), step: "S02", layer_name: "BL", layer_property: "Sub", align_name: "AA02", align_side: "RIGHT" },
    { layer_id: crypto.randomUUID(), step: "S03", layer_name: "CONTACT", layer_property: "Contact", align_name: "AA03", align_side: "CENTER" },
    { layer_id: crypto.randomUUID(), step: "S04", layer_name: "METAL", layer_property: "Route", align_name: "AA04", align_side: "LEFT" },
  ],
  relations: [],
  layouts: {},
  styles: {},
  textBoxes: [],
  history: [],
  validation: [],
};
sampleProject.relations = [
  { relation_id: crypto.randomUUID(), parent_layer: "WL", child_layer: "BL", relation_type: "Align" },
  { relation_id: crypto.randomUUID(), parent_layer: "BL", child_layer: "CONTACT", relation_type: "Overlay" },
  { relation_id: crypto.randomUUID(), parent_layer: "CONTACT", child_layer: "METAL", relation_type: "Align" },
];

let state = {
  projects: loadProjects(),
  currentId: null,
  selectedLayerId: null,
  selectedLayerIds: new Set(),
  selectedRelationId: null,
  selectedTextBoxId: null,
  selectedTextBoxIds: new Set(),
  mode: "select",
  pendingConnectLayerId: null,
  connectStart: null,
  pointerWorld: null,
  pasteTarget: "align",
  uploadTarget: "align",
  drag: null,
  resize: null,
  selectionBox: null,
  pan: { x: 0, y: 0 },
  scale: 1,
  isPanning: null,
  snapToGrid: true,
  layersCollapsed: false,
  propertiesCollapsed: false,
  search: "",
  undoStack: [],
  redoStack: [],
};

function currentProject() {
  const project = state.projects.find((project) => project.project_id === state.currentId) || null;
  if (project) normalizeProject(project);
  return project;
}

function normalizeProject(project) {
  project.styles ||= {};
  project.textBoxes ||= [];
  project.layouts ||= {};
  project.layers ||= [];
  project.relations ||= [];
  project.layers.forEach((layer, index) => {
    project.styles[layer.layer_id] = { ...DEFAULT_LAYER_STYLE, ...(project.styles[layer.layer_id] || {}) };
    project.layouts[layer.layer_id] ||= { x: 80 + index * 30, y: 80 + index * 30, width: 150, height: 64 };
    project.layouts[layer.layer_id].width ||= 150;
    project.layouts[layer.layer_id].height ||= 64;
  });
  project.relations.forEach((relation) => {
    relation.source_port ||= "right";
    relation.target_port ||= "left";
    relation.connector_type ||= "straight";
  });
  project.textBoxes.forEach((box) => {
    box.style = { ...DEFAULT_TEXT_STYLE, ...(box.style || {}) };
    box.width ||= 180;
    box.height ||= 52;
  });
}

function loadProjects() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
  } catch {
    return [];
  }
}

function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state.projects));
  renderProjectList();
  renderMeta();
}

function touch(project, message) {
  project.updated_at = new Date().toISOString();
  project.history.push({ at: project.updated_at, message });
  persist();
}

function snapshotProject(project) {
  return JSON.stringify({
    layers: project.layers,
    relations: project.relations,
    layouts: project.layouts,
    styles: project.styles,
    textBoxes: project.textBoxes,
    validation: project.validation,
  });
}

function restoreProject(project, snapshot) {
  const data = JSON.parse(snapshot);
  project.layers = data.layers || [];
  project.relations = data.relations || [];
  project.layouts = data.layouts || {};
  project.styles = data.styles || {};
  project.textBoxes = data.textBoxes || [];
  project.validation = data.validation || [];
  normalizeProject(project);
  project.updated_at = new Date().toISOString();
  persist();
}

function pushUndo(project) {
  state.undoStack.push(snapshotProject(project));
  if (state.undoStack.length > 80) state.undoStack.shift();
  state.redoStack = [];
}

function switchView(viewName) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === viewName));
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === viewName));
  if (viewName === "editor") renderCanvas();
}

function fitSoon() {
  setTimeout(() => fitViewToGraph(), 0);
}

function renderMeta() {
  const project = currentProject();
  document.querySelector("#projectMeta").textContent = project
    ? `${project.project_name} | Layers ${project.layers.length} | Relations ${project.relations.length}`
    : "No project loaded";
}

function renderProjectList() {
  const list = document.querySelector("#projectList");
  if (!state.projects.length) {
    list.className = "list empty";
    list.textContent = "No projects yet.";
    return;
  }
  list.className = "list";
  list.innerHTML = "";
  state.projects
    .slice()
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .forEach((project) => {
      const item = document.createElement("div");
      item.className = "project-item";
      item.innerHTML = `<div><strong>${escapeHtml(project.project_name)}</strong><br><small>${formatDate(project.updated_at)}</small></div>`;
      const open = document.createElement("button");
      open.textContent = "Open";
      open.addEventListener("click", () => {
        state.currentId = project.project_id;
        state.selectedLayerId = project.layers[0]?.layer_id || null;
        state.selectedLayerIds = new Set(state.selectedLayerId ? [state.selectedLayerId] : []);
        state.selectedRelationId = null;
        state.pendingConnectLayerId = null;
        state.selectedTextBoxId = null;
        state.selectedTextBoxIds = new Set();
        state.mode = "select";
        state.undoStack = [];
        state.redoStack = [];
        renderAll();
        switchView("editor");
      });
      item.append(open);
      list.append(item);
    });
}

function renderAll() {
  renderEditorLayout();
  renderMeta();
  renderProjectList();
  renderAlignTable();
  renderRelationTable();
  renderValidation();
  renderMiniTable();
  renderProperty();
  renderCanvas();
  renderToolbar();
}

function renderEditorLayout() {
  const editor = document.querySelector("#editor");
  if (!editor) return;
  editor.classList.toggle("layers-collapsed", state.layersCollapsed);
  editor.classList.toggle("properties-collapsed", state.propertiesCollapsed);
}

function ensureProject() {
  let project = currentProject();
  if (!project) {
    project = createProject("Untitled Project");
  }
  return project;
}

function createProject(name) {
  const project = {
    project_id: crypto.randomUUID(),
    project_name: name.trim() || "Untitled Project",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    layers: [],
    relations: [],
    layouts: {},
    styles: {},
    textBoxes: [],
    history: [],
    validation: [],
  };
  state.projects.push(project);
  state.currentId = project.project_id;
  if (!(event.ctrlKey || event.metaKey || event.shiftKey)) {
    state.selectedLayerId = null;
    state.selectedLayerIds = new Set();
    state.selectedRelationId = null;
    state.selectedTextBoxId = null;
    state.selectedTextBoxIds = new Set();
  }
  state.undoStack = [];
  state.redoStack = [];
  touch(project, "Project created");
  return project;
}

function renderAlignTable() {
  const project = currentProject();
  renderEditableTable(
    "#alignTable",
    ALIGN_COLUMNS,
    project?.layers || [],
    (layer, column) => {
      if (column === "Step") return layer.step || "";
      if (column === "Layer") return layer.layer_name || "";
      if (column === "Layer_Property") return layer.layer_property || "";
      if (column === "Align") return layer.align_name || "";
      return layer.align_side || "";
    },
    (rowIndex, column, value) => {
      const project = ensureProject();
      const layer = project.layers[rowIndex];
      if (!layer) return;
      pushUndo(project);
      const previousName = layer.layer_name;
      if (column === "Step") layer.step = value;
      if (column === "Layer") {
        layer.layer_name = value;
        project.relations.forEach((relation) => {
          if (relation.parent_layer === previousName) relation.parent_layer = value;
          if (relation.child_layer === previousName) relation.child_layer = value;
        });
      }
      if (column === "Layer_Property") layer.layer_property = value;
      if (column === "Align") layer.align_name = value;
      if (column === "Align_side") layer.align_side = value.toUpperCase();
      touch(project, `Updated ${column}`);
      renderAll();
    },
    (rowIndex) => {
      const project = ensureProject();
      deleteLayerWithConfirmation(project.layers[rowIndex]);
    },
    (rowIndex) => {
      const layer = project?.layers[rowIndex];
      if (layer) selectLayer(layer.layer_id, true, false);
    },
    (rowIndex) => state.selectedLayerIds.has(project?.layers[rowIndex]?.layer_id)
  );
}

function renderRelationTable() {
  const project = currentProject();
  renderEditableTable(
    "#relationTable",
    RELATION_COLUMNS,
    project?.relations || [],
    (relation, column) => {
      if (column === "Parent_Layer") return relation.parent_layer || "";
      if (column === "Child_Layer") return relation.child_layer || "";
      return relation.relation_type || "Align";
    },
    (rowIndex, column, value) => {
      const project = ensureProject();
      const relation = project.relations[rowIndex];
      if (!relation) return;
      const draft = { ...relation };
      if (column === "Parent_Layer") draft.parent_layer = value;
      if (column === "Child_Layer") draft.child_layer = value;
      if (column === "Relation_Type") draft.relation_type = value;
      const issue = validateRelationDraft(project, draft, relation.relation_id);
      if (issue) {
        alert(issue);
        renderAll();
        return;
      }
      pushUndo(project);
      if (column === "Parent_Layer") relation.parent_layer = value;
      if (column === "Child_Layer") relation.child_layer = value;
      if (column === "Relation_Type") relation.relation_type = value;
      state.selectedRelationId = relation.relation_id;
      state.selectedLayerId = null;
      touch(project, `Updated ${column}`);
      renderAll();
    },
    (rowIndex) => {
      const project = ensureProject();
      pushUndo(project);
      project.relations.splice(rowIndex, 1);
      state.selectedRelationId = null;
      touch(project, "Deleted relation");
      renderAll();
    },
    (rowIndex) => {
      const relation = project?.relations[rowIndex];
      if (relation) selectRelation(relation.relation_id);
    },
    (rowIndex) => project?.relations[rowIndex]?.relation_id === state.selectedRelationId
  );
}

function renderEditableTable(selector, columns, rows, getValue, onChange, onDelete, onRowSelect = null, isSelected = null) {
  const root = document.querySelector(selector);
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  thead.innerHTML = `<tr>${columns.map((column) => `<th>${column}</th>`).join("")}<th></th></tr>`;
  const tbody = document.createElement("tbody");
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    if (isSelected?.(rowIndex)) tr.className = "active-row";
    tr.addEventListener("click", () => onRowSelect?.(rowIndex));
    columns.forEach((column) => {
      const td = document.createElement("td");
      let input;
      if (column === "Align_side" || column === "Relation_Type") {
        input = document.createElement("select");
        const options = column === "Align_side" ? ["", ...ALLOWED_SIDES] : RELATION_TYPES;
        options.forEach((option) => input.append(new Option(option, option)));
      } else {
        input = document.createElement("input");
      }
      input.value = getValue(row, column);
      input.addEventListener("change", () => onChange(rowIndex, column, input.value.trim()));
      td.append(input);
      tr.append(td);
    });
    const action = document.createElement("td");
    action.className = "row-actions";
    const remove = document.createElement("button");
    remove.textContent = "X";
    remove.title = "Delete row";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      onDelete(rowIndex);
    });
    action.append(remove);
    tr.append(action);
    tbody.append(tr);
  });
  table.append(thead, tbody);
  root.replaceChildren(table);
}

function addRow(type) {
  const project = ensureProject();
  pushUndo(project);
  if (type === "align") {
    project.layers.push({ layer_id: crypto.randomUUID(), step: "", layer_name: "", layer_property: "", align_name: "", align_side: "" });
    touch(project, "Added align row");
  } else {
    project.relations.push({ relation_id: crypto.randomUUID(), parent_layer: "", child_layer: "", relation_type: "Align" });
    touch(project, "Added relation row");
  }
  renderAll();
}

function parsePaste(text, columns) {
  if (/<table[\s>]/i.test(text)) {
    return parseHtmlTable(text, columns);
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const first = lines[0].split(/\t|,/).map((cell) => cell.trim());
  const hasHeader = columns.every((column, index) => first[index]?.toLowerCase() === column.toLowerCase());
  return lines.slice(hasHeader ? 1 : 0).map((line) => {
    const cells = line.split(/\t|,/).map((cell) => cell.trim());
    return Object.fromEntries(columns.map((column, index) => [column, cells[index] || ""]));
  });
}

function parseHtmlTable(text, columns) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  const tables = [...doc.querySelectorAll("table")];
  const table = tables.find((candidate) => {
    const headers = [...candidate.querySelectorAll("tr:first-child th, tr:first-child td")].map((cell) => cell.textContent.trim());
    return columns.every((column, index) => headers[index] === column);
  });
  if (!table) return [];
  return [...table.querySelectorAll("tr")]
    .slice(1)
    .map((tr) => {
      const cells = [...tr.children].map((cell) => cell.textContent.trim());
      return Object.fromEntries(columns.map((column, index) => [column, cells[index] || ""]));
    })
    .filter((row) => Object.values(row).some(Boolean));
}

function replaceRowsFromText(target, text) {
  const project = ensureProject();
  pushUndo(project);
  if (target === "align") {
    project.layers = parsePaste(text, ALIGN_COLUMNS).map((row) => ({
      layer_id: crypto.randomUUID(),
      step: row.Step,
      layer_name: row.Layer,
      layer_property: row.Layer_Property,
      align_name: row.Align,
      align_side: row.Align_side.toUpperCase(),
    }));
  } else {
    project.relations = parsePaste(text, RELATION_COLUMNS).map((row) => ({
      relation_id: crypto.randomUUID(),
      parent_layer: row.Parent_Layer,
      child_layer: row.Child_Layer,
      relation_type: row.Relation_Type || "Align",
    }));
  }
  touch(project, `Imported ${target} data`);
  renderAll();
}

function applyPaste() {
  replaceRowsFromText(state.pasteTarget, document.querySelector("#pasteText").value);
}

async function applyUpload(file) {
  if (!file) return;
  const text = await file.text();
  replaceRowsFromText(state.uploadTarget, text);
}

function validateProject(project) {
  const results = [];
  const layerNames = new Map();
  const alignNames = new Map();
  const requiredLayerFields = ["step", "layer_name", "align_name"];

  project.layers.forEach((layer, index) => {
    requiredLayerFields.forEach((field) => {
      if (!String(layer[field] || "").trim()) results.push(error(index + 1, `${field} is required.`));
    });
    if (!layer.align_side) results.push(warn(index + 1, "Align_side is empty."));
    if (layer.align_side && !ALLOWED_SIDES.includes(layer.align_side)) results.push(error(index + 1, `Align_side '${layer.align_side}' is not allowed.`));
    addDuplicate(layerNames, layer.layer_name, index + 1, "Layer", results);
    addDuplicate(alignNames, layer.align_name, index + 1, "Align", results);
  });

  const knownLayers = new Set(project.layers.map((layer) => layer.layer_name).filter(Boolean));
  const adjacency = new Map([...knownLayers].map((name) => [name, []]));
  const connected = new Set();
  const relationPairs = new Map();
  project.relations.forEach((relation, index) => {
    const row = index + 1;
    if (!relation.parent_layer || !relation.child_layer) results.push(error(row, "Parent_Layer and Child_Layer are required."));
    if (relation.parent_layer === relation.child_layer) results.push(error(row, `Self-loop relation '${relation.parent_layer}' is not allowed.`));
    if (relation.parent_layer && !knownLayers.has(relation.parent_layer)) results.push(error(row, `Parent_Layer '${relation.parent_layer}' does not exist in Align_Input.`));
    if (relation.child_layer && !knownLayers.has(relation.child_layer)) results.push(error(row, `Child_Layer '${relation.child_layer}' does not exist in Align_Input.`));
    if (!RELATION_TYPES.includes(relation.relation_type)) results.push(error(row, `Relation_Type '${relation.relation_type}' is not allowed.`));
    const pairKey = `${relation.parent_layer}->${relation.child_layer}`;
    if (relation.parent_layer && relation.child_layer) {
      if (relationPairs.has(pairKey)) results.push(error(row, `Relation '${pairKey}' is duplicated with row ${relationPairs.get(pairKey)}.`));
      else relationPairs.set(pairKey, row);
    }
    if (knownLayers.has(relation.parent_layer) && knownLayers.has(relation.child_layer)) {
      adjacency.get(relation.parent_layer).push(relation.child_layer);
      connected.add(relation.parent_layer);
      connected.add(relation.child_layer);
    }
  });

  const cycle = findCycle(adjacency);
  if (cycle.length) results.push(error("-", `Layer Relation has a cycle: ${cycle.join(" -> ")}.`));
  knownLayers.forEach((name) => {
    if (!connected.has(name) && knownLayers.size > 1) results.push(warn("-", `Layer '${name}' is isolated from Align Tree.`));
  });

  if (!results.length) results.push({ level: "OK", row: "-", message: "Validation passed." });
  project.validation = results;
  return results;
}

function error(row, message) {
  return { level: "ERROR", row, message };
}

function warn(row, message) {
  return { level: "WARNING", row, message };
}

function validateRelationDraft(project, draft, currentRelationId = null) {
  const knownLayers = new Set(project.layers.map((layer) => layer.layer_name).filter(Boolean));
  if (!draft.parent_layer || !draft.child_layer) return "Parent Layer and Child Layer are required.";
  if (!knownLayers.has(draft.parent_layer)) return `Parent Layer '${draft.parent_layer}' does not exist.`;
  if (!knownLayers.has(draft.child_layer)) return `Child Layer '${draft.child_layer}' does not exist.`;
  if (draft.parent_layer === draft.child_layer) return "Self-loop relation is not allowed.";
  if (!RELATION_TYPES.includes(draft.relation_type)) return `Relation Type '${draft.relation_type}' is not allowed.`;
  const duplicated = project.relations.some(
    (relation) =>
      relation.relation_id !== currentRelationId &&
      relation.parent_layer === draft.parent_layer &&
      relation.child_layer === draft.child_layer
  );
  if (duplicated) return `Relation '${draft.parent_layer} -> ${draft.child_layer}' already exists.`;
  const adjacency = new Map(project.layers.map((layer) => [layer.layer_name, []]));
  project.relations.forEach((relation) => {
    if (relation.relation_id !== currentRelationId && adjacency.has(relation.parent_layer)) {
      adjacency.get(relation.parent_layer).push(relation.child_layer);
    }
  });
  adjacency.get(draft.parent_layer)?.push(draft.child_layer);
  const cycle = findCycle(adjacency);
  if (cycle.length) return `Cycle is not allowed: ${cycle.join(" -> ")}.`;
  return "";
}

function addDuplicate(map, value, row, label, results) {
  if (!value) return;
  if (map.has(value)) results.push(error(row, `${label} '${value}' is duplicated with row ${map.get(value)}.`));
  else map.set(value, row);
}

function findCycle(adjacency) {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function dfs(node) {
    if (visiting.has(node)) return stack.slice(stack.indexOf(node)).concat(node);
    if (visited.has(node)) return [];
    visiting.add(node);
    stack.push(node);
    for (const next of adjacency.get(node) || []) {
      const cycle = dfs(next);
      if (cycle.length) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return [];
  }

  for (const node of adjacency.keys()) {
    const cycle = dfs(node);
    if (cycle.length) return cycle;
  }
  return [];
}

function renderValidation() {
  const project = currentProject();
  const list = document.querySelector("#validationList");
  const results = project?.validation || [];
  if (!results.length) {
    list.className = "validation-list empty";
    list.textContent = "Run validation.";
    return;
  }
  list.className = "validation-list";
  list.innerHTML = "";
  results.forEach((result) => {
    const item = document.createElement("div");
    item.className = `validation-item ${result.level === "ERROR" ? "error" : result.level === "OK" ? "ok" : ""}`;
    item.textContent = `[${result.level}] Row ${result.row}: ${result.message}`;
    list.append(item);
  });
}

function autoLayoutProject(project, record = true) {
  if (record) pushUndo(project);
  const children = new Map(project.layers.map((layer) => [layer.layer_name, []]));
  const incoming = new Set();
  project.relations.forEach((relation) => {
    if (children.has(relation.parent_layer)) children.get(relation.parent_layer).push(relation.child_layer);
    incoming.add(relation.child_layer);
  });
  const roots = project.layers.filter((layer) => !incoming.has(layer.layer_name));
  const ordered = [];
  const seen = new Set();
  function visit(layer, depth) {
    if (!layer || seen.has(layer.layer_name)) return;
    seen.add(layer.layer_name);
    ordered.push({ layer, depth });
    children.get(layer.layer_name)?.forEach((childName) => visit(project.layers.find((candidate) => candidate.layer_name === childName), depth + 1));
  }
  roots.forEach((layer) => visit(layer, 0));
  project.layers.forEach((layer) => {
    if (!seen.has(layer.layer_name)) ordered.push({ layer, depth: 0 });
  });
  const depthCounts = new Map();
  ordered.forEach(({ layer, depth }) => {
    const index = depthCounts.get(depth) || 0;
    project.layouts[layer.layer_id] = { x: 90 + depth * 210, y: 70 + index * 105, width: 150, height: 56 };
    depthCounts.set(depth, index + 1);
  });
  if (record) touch(project, "Auto layout applied");
}

function renderMiniTable() {
  const project = currentProject();
  const root = document.querySelector("#miniTable");
  root.innerHTML = "";
  if (!project) return;
  const query = state.search.trim().toLowerCase();
  project.layers.forEach((layer) => {
    const row = document.createElement("div");
    const searchable = `${layer.step} ${layer.layer_name} ${layer.layer_property} ${layer.align_name} ${layer.align_side}`.toLowerCase();
    row.className = `mini-row ${state.selectedLayerIds.has(layer.layer_id) ? "active" : ""} ${query && !searchable.includes(query) ? "hidden" : ""}`;
    row.innerHTML = `<strong>${escapeHtml(layer.step)} ${escapeHtml(layer.layer_name)}</strong><span>${escapeHtml(layer.align_name)} / ${escapeHtml(layer.align_side || "-")}</span>`;
    row.addEventListener("click", () => {
      selectLayer(layer.layer_id, true, false);
    });
    root.append(row);
  });
}

function renderProperty() {
  const project = currentProject();
  const root = document.querySelector("#propertyPanel");
  const layer = project?.layers.find((item) => item.layer_id === state.selectedLayerId);
  const selectedLayers = project?.layers.filter((item) => state.selectedLayerIds.has(item.layer_id)) || [];
  const relation = project?.relations.find((item) => item.relation_id === state.selectedRelationId);
  const textBox = project?.textBoxes.find((item) => item.id === state.selectedTextBoxId);
  if (project && textBox) {
    root.className = "property-form";
    root.innerHTML = `
      <div class="property-section">Text Box</div>
      <label>Text<textarea id="textBoxText" rows="4">${escapeHtml(textBox.text || "")}</textarea></label>
      <label>Font Size<input id="textFontSize" type="number" min="8" max="48" value="${textBox.style.fontSize}"></label>
      <label>Text Color<input id="textColor" type="color" value="${textBox.style.textColor}"></label>
      <label>Fill<input id="textFill" type="color" value="${textBox.style.fill === "transparent" ? "#ffffff" : textBox.style.fill}"></label>
      <label><input id="textTransparent" type="checkbox" ${textBox.style.fill === "transparent" ? "checked" : ""}> Transparent Fill</label>
      <div class="property-actions">
        <button id="applyTextBox">Apply</button>
        <button id="deleteTextBox" class="danger">Delete</button>
      </div>
    `;
    document.querySelector("#applyTextBox").addEventListener("click", () => {
      pushUndo(project);
      textBox.text = document.querySelector("#textBoxText").value;
      textBox.style.fontSize = Number(document.querySelector("#textFontSize").value) || 16;
      textBox.style.textColor = document.querySelector("#textColor").value;
      textBox.style.fill = document.querySelector("#textTransparent").checked ? "transparent" : document.querySelector("#textFill").value;
      touch(project, "Updated text box");
      renderAll();
    });
    document.querySelector("#deleteTextBox").addEventListener("click", () => {
      pushUndo(project);
      project.textBoxes = project.textBoxes.filter((item) => item.id !== textBox.id);
      state.selectedTextBoxId = null;
      state.selectedTextBoxIds = new Set();
      touch(project, "Deleted text box");
      renderAll();
    });
    ["#textBoxText", "#textFontSize", "#textColor", "#textFill", "#textTransparent"].forEach((selector) => {
      document.querySelector(selector).addEventListener("input", () => applyTextBoxStyleFromPanel(project, true));
      document.querySelector(selector).addEventListener("change", () => applyTextBoxStyleFromPanel(project, true));
    });
    return;
  }
  if (project && relation) {
    root.className = "property-form";
    root.innerHTML = `
      <div class="property-section">Selected Arrow</div>
      <label>Parent Layer<select id="relParent">${project.layers.map((item) => `<option ${item.layer_name === relation.parent_layer ? "selected" : ""}>${escapeHtml(item.layer_name)}</option>`).join("")}</select></label>
      <label>Child Layer<select id="relChild">${project.layers.map((item) => `<option ${item.layer_name === relation.child_layer ? "selected" : ""}>${escapeHtml(item.layer_name)}</option>`).join("")}</select></label>
      <label>Start Port<select id="relSourcePort">${PORTS.map((port) => `<option ${port === relation.source_port ? "selected" : ""}>${port}</option>`).join("")}</select></label>
      <label>End Port<select id="relTargetPort">${PORTS.map((port) => `<option ${port === relation.target_port ? "selected" : ""}>${port}</option>`).join("")}</select></label>
      <label>Relation Type<select id="relType">${RELATION_TYPES.map((type) => `<option ${type === relation.relation_type ? "selected" : ""}>${type}</option>`).join("")}</select></label>
      <div class="property-actions">
        <button id="applyRelation">Apply</button>
        <button id="deleteRelation" class="danger">Delete</button>
      </div>
    `;
    document.querySelector("#applyRelation").addEventListener("click", () => {
      const draft = {
        ...relation,
        parent_layer: document.querySelector("#relParent").value,
        child_layer: document.querySelector("#relChild").value,
        source_port: document.querySelector("#relSourcePort").value,
        target_port: document.querySelector("#relTargetPort").value,
        relation_type: document.querySelector("#relType").value,
      };
      const issue = validateRelationDraft(project, draft, relation.relation_id);
      if (issue) {
        alert(issue);
        return;
      }
      pushUndo(project);
      relation.parent_layer = draft.parent_layer;
      relation.child_layer = draft.child_layer;
      relation.source_port = draft.source_port;
      relation.target_port = draft.target_port;
      relation.relation_type = draft.relation_type;
      validateProject(project);
      touch(project, "Updated relation");
      renderAll();
    });
    document.querySelector("#deleteRelation").addEventListener("click", () => {
      pushUndo(project);
      project.relations = project.relations.filter((item) => item.relation_id !== relation.relation_id);
      state.selectedRelationId = null;
      validateProject(project);
      touch(project, "Deleted relation");
      renderAll();
    });
    ["#relType", "#relSourcePort", "#relTargetPort"].forEach((selector) => {
      document.querySelector(selector).addEventListener("change", () => {
        pushUndo(project);
        relation.relation_type = document.querySelector("#relType").value;
        relation.source_port = document.querySelector("#relSourcePort").value;
        relation.target_port = document.querySelector("#relTargetPort").value;
        validateProject(project);
        touch(project, "Updated relation format");
        renderRelationTable();
        renderCanvas();
      });
    });
    return;
  }
  if (!project || !layer) {
    root.className = "property-empty";
    root.textContent = state.mode === "connect" ? "Pick a connection point, then another shape point." : "Select a layer, arrow, or text box.";
    return;
  }
  const layout = project.layouts[layer.layer_id];
  const style = project.styles[layer.layer_id];
  root.className = "property-form";
  root.innerHTML = `
    <div class="property-section">${selectedLayers.length > 1 ? `${selectedLayers.length} Layers Selected` : "Selected Layer"}</div>
    <label>Layer<input id="propLayer" value="${escapeAttr(layer.layer_name)}"></label>
    <label>Step<input id="propStep" value="${escapeAttr(layer.step)}"></label>
    <label>Property<input id="propProperty" value="${escapeAttr(layer.layer_property)}"></label>
    <label>Align<input id="propAlign" value="${escapeAttr(layer.align_name)}"></label>
    <label>Side<select id="propSide">${["", ...ALLOWED_SIDES].map((side) => `<option ${side === layer.align_side ? "selected" : ""}>${side}</option>`).join("")}</select></label>
    <div class="property-section">Shape Format</div>
    <label>Width<input id="shapeWidth" type="number" min="70" value="${Math.round(layout.width)}"></label>
    <label>Height<input id="shapeHeight" type="number" min="36" value="${Math.round(layout.height)}"></label>
    <label>Fill<input id="shapeFill" type="color" value="${style.fill}"></label>
    <label>Line<input id="shapeStroke" type="color" value="${style.stroke}"></label>
    <label>Line Width<input id="shapeStrokeWidth" type="number" min="1" max="8" step="0.5" value="${style.strokeWidth}"></label>
    <label>Text Color<input id="shapeTextColor" type="color" value="${style.textColor}"></label>
    <label>Font Size<input id="shapeFontSize" type="number" min="9" max="28" value="${style.fontSize}"></label>
    <div class="swatches">
      ${["#ffffff", "#fef3c7", "#dbeafe", "#dcfce7", "#fee2e2"].map((color) => `<button class="swatch" data-fill="${color}" style="background:${color}"></button>`).join("")}
    </div>
    <div class="property-actions">
      <button id="applyProperty">Apply</button>
      <button id="deleteLayer" class="danger">Delete</button>
    </div>
  `;
  if (selectedLayers.length > 1) {
    ["#propLayer", "#propStep", "#propProperty", "#propAlign", "#propSide"].forEach((selector) => {
      const input = document.querySelector(selector);
      input.disabled = true;
    });
  }
  document.querySelector("#applyProperty").addEventListener("click", () => {
    pushUndo(project);
    const previousName = layer.layer_name;
    layer.layer_name = document.querySelector("#propLayer").value.trim();
    layer.step = document.querySelector("#propStep").value.trim();
    layer.layer_property = document.querySelector("#propProperty").value.trim();
    layer.align_name = document.querySelector("#propAlign").value.trim();
    layer.align_side = document.querySelector("#propSide").value;
    layout.width = Math.max(70, Number(document.querySelector("#shapeWidth").value) || layout.width);
    layout.height = Math.max(36, Number(document.querySelector("#shapeHeight").value) || layout.height);
    applyLayerStyleFromPanel(project);
    project.relations.forEach((relation) => {
      if (relation.parent_layer === previousName) relation.parent_layer = layer.layer_name;
      if (relation.child_layer === previousName) relation.child_layer = layer.layer_name;
    });
    touch(project, `Updated node ${layer.layer_name}`);
    renderAll();
  });
  document.querySelector("#deleteLayer").addEventListener("click", () => {
    deleteLayerWithConfirmation(layer);
  });
  ["#shapeFill", "#shapeStroke", "#shapeStrokeWidth", "#shapeTextColor", "#shapeFontSize", "#shapeWidth", "#shapeHeight"].forEach((selector) => {
    document.querySelector(selector).addEventListener("input", () => {
      applyLayerStyleFromPanel(project, true);
    });
  });
  document.querySelectorAll(".swatch").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector("#shapeFill").value = button.dataset.fill;
      applyLayerStyleFromPanel(project, true);
    });
  });
}

function renderCanvas() {
  const project = currentProject();
  const svg = document.querySelector("#treeCanvas");
  svg.innerHTML = "";
  if (!project) return;
  if (!Object.keys(project.layouts).length && project.layers.length) autoLayoutProject(project, false);
  svg.classList.toggle("connecting", state.mode === "connect");
  svg.classList.toggle("text-tool", state.mode === "text");
  svg.classList.toggle("panning", Boolean(state.isPanning));
  const defs = createSvgElement("defs");
  defs.innerHTML = `<marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#53657d"></path></marker>`;
  svg.append(defs);

  const viewport = createSvgElement("g");
  viewport.setAttribute("transform", `translate(${state.pan.x}, ${state.pan.y}) scale(${state.scale})`);
  svg.append(viewport);

  const bounds = getGraphBounds(project);
  const grid = createSvgElement("g");
  const gridMinX = Math.floor((bounds.minX - 200) / 40) * 40;
  const gridMaxX = Math.ceil((bounds.maxX + 200) / 40) * 40;
  const gridMinY = Math.floor((bounds.minY - 200) / 40) * 40;
  const gridMaxY = Math.ceil((bounds.maxY + 200) / 40) * 40;
  for (let x = gridMinX; x <= gridMaxX; x += 40) {
    const line = createSvgElement("line");
    line.setAttribute("x1", x);
    line.setAttribute("x2", x);
    line.setAttribute("y1", gridMinY);
    line.setAttribute("y2", gridMaxY);
    line.setAttribute("class", "grid-line");
    grid.append(line);
  }
  for (let y = gridMinY; y <= gridMaxY; y += 40) {
    const line = createSvgElement("line");
    line.setAttribute("x1", gridMinX);
    line.setAttribute("x2", gridMaxX);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.setAttribute("class", "grid-line");
    grid.append(line);
  }
  viewport.append(grid);

  const layerByName = new Map(project.layers.map((layer) => [layer.layer_name, layer]));
  project.relations.forEach((relation) => {
    const parent = layerByName.get(relation.parent_layer);
    const child = layerByName.get(relation.child_layer);
    if (!parent || !child) return;
    const a = project.layouts[parent.layer_id];
    const b = project.layouts[child.layer_id];
    if (!a || !b) return;
    const path = createSvgElement("path");
    const start = getPortPoint(a, relation.source_port || "right");
    const end = getPortPoint(b, relation.target_port || "left");
    const d = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    path.setAttribute("d", d);
    path.setAttribute("class", `edge ${relation.relation_type.toLowerCase()} ${relation.relation_id === state.selectedRelationId ? "active" : ""}`);
    const hit = createSvgElement("path");
    hit.setAttribute("d", d);
    hit.setAttribute("class", "edge-hit");
    hit.addEventListener("mousedown", (event) => event.stopPropagation());
    hit.addEventListener("click", (event) => {
      event.stopPropagation();
      selectRelation(relation.relation_id);
    });
    viewport.append(path, hit);
  });

  project.layers.forEach((layer) => {
    const layout = project.layouts[layer.layer_id] || { x: 80, y: 80, width: 150, height: 64 };
    const style = project.styles[layer.layer_id] || DEFAULT_LAYER_STYLE;
    const isActive = state.selectedLayerIds.has(layer.layer_id);
    const isConnectSource = state.connectStart?.layerId === layer.layer_id;
    layout.width = layout.width || 150;
    layout.height = layout.height || 64;
    const node = createSvgElement("g");
    node.setAttribute(
      "class",
      `node ${isActive ? "active" : ""} ${isConnectSource ? "connect-source" : ""}`
    );
    node.setAttribute("transform", `translate(${layout.x}, ${layout.y})`);
    node.dataset.layerId = layer.layer_id;
    node.innerHTML = `
      <rect width="${layout.width}" height="${layout.height}" style="fill:${isConnectSource ? "#f0fbf5" : style.fill};stroke:${isConnectSource ? "#157a52" : isActive ? "#2457d6" : style.stroke};stroke-width:${isActive || isConnectSource ? 3 : style.strokeWidth}"></rect>
      <text x="${layout.width / 2}" y="${layout.height / 2}" font-weight="700" text-anchor="middle" style="fill:${style.textColor};font-size:${style.fontSize}px">${escapeHtml(layer.layer_name || "(Layer)")}</text>
    `;
    node.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      if (state.mode === "connect") {
        selectLayer(layer.layer_id, false, false);
        return;
      }
      const additive = event.ctrlKey || event.metaKey || event.shiftKey;
      if (additive || !state.selectedLayerIds.has(layer.layer_id)) {
        selectLayer(layer.layer_id, false, additive);
      }
      if (event.altKey && state.selectedLayerIds.has(layer.layer_id)) startSelectionDrag(event);
    });
    viewport.append(node);
    if (layer.layer_id === state.selectedLayerId || state.mode === "connect" || state.connectStart) {
      renderPortHandles(viewport, layer, layout);
    }
    if (layer.layer_id === state.selectedLayerId) {
      renderResizeHandles(viewport, layer, layout);
    }
  });
  project.textBoxes.forEach((box) => {
    const group = createSvgElement("g");
    const isActive = state.selectedTextBoxIds.has(box.id);
    group.setAttribute("class", `text-box ${isActive ? "active" : ""}`);
    group.setAttribute("transform", `translate(${box.x}, ${box.y})`);
    group.dataset.textBoxId = box.id;
    group.innerHTML = `
      <rect width="${box.width}" height="${box.height}" style="fill:${box.style.fill};stroke:${isActive ? "#2457d6" : box.style.stroke};stroke-width:${isActive ? 1.5 : box.style.strokeWidth};stroke-dasharray:${isActive ? "4 3" : "none"}"></rect>
      <text x="8" y="${box.style.fontSize + 8}" style="fill:${box.style.textColor};font-size:${box.style.fontSize}px">${escapeHtml(box.text || "Text Box")}</text>
    `;
    group.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      const additive = event.ctrlKey || event.metaKey || event.shiftKey;
      if (additive || !state.selectedTextBoxIds.has(box.id)) {
        selectTextBox(box.id, additive);
      }
      if (event.altKey && state.selectedTextBoxIds.has(box.id)) startSelectionDrag(event);
    });
    viewport.append(group);
    if (box.id === state.selectedTextBoxId) renderTextResizeHandles(viewport, box);
  });
  if (state.connectStart && state.pointerWorld) {
    const sourceLayer = project.layers.find((layer) => layer.layer_id === state.connectStart.layerId);
    const sourceLayout = sourceLayer ? project.layouts[sourceLayer.layer_id] : null;
    if (sourceLayout) {
      const start = getPortPoint(sourceLayout, state.connectStart.port);
      const preview = createSvgElement("path");
      preview.setAttribute("d", `M ${start.x} ${start.y} L ${state.pointerWorld.x} ${state.pointerWorld.y}`);
      preview.setAttribute("class", "connector-preview");
      viewport.append(preview);
    }
  }
  if (state.selectionBox) {
    const box = normalizeBox(state.selectionBox.start, state.selectionBox.current);
    const rect = createSvgElement("rect");
    rect.setAttribute("x", box.x);
    rect.setAttribute("y", box.y);
    rect.setAttribute("width", box.width);
    rect.setAttribute("height", box.height);
    rect.setAttribute("class", "selection-box");
    viewport.append(rect);
  }
  renderMiniMap();
}

function getPortPoint(layout, port) {
  const points = {
    top: { x: layout.x + layout.width / 2, y: layout.y },
    right: { x: layout.x + layout.width, y: layout.y + layout.height / 2 },
    bottom: { x: layout.x + layout.width / 2, y: layout.y + layout.height },
    left: { x: layout.x, y: layout.y + layout.height / 2 },
  };
  return points[port] || points.right;
}

function getPortHandlePoint(layout, port) {
  const point = getPortPoint(layout, port);
  const offset = 14;
  if (port === "top") return { x: point.x, y: point.y - offset };
  if (port === "right") return { x: point.x + offset, y: point.y };
  if (port === "bottom") return { x: point.x, y: point.y + offset };
  return { x: point.x - offset, y: point.y };
}

function renderPortHandles(viewport, layer, layout) {
  PORTS.forEach((port) => {
    const point = getPortHandlePoint(layout, port);
    const handle = createSvgElement("circle");
    handle.setAttribute("cx", point.x);
    handle.setAttribute("cy", point.y);
    handle.setAttribute("r", 7);
    handle.dataset.layerId = layer.layer_id;
    handle.dataset.port = port;
    handle.setAttribute("class", `port-handle ${state.connectStart?.layerId === layer.layer_id && state.connectStart?.port === port ? "active" : ""}`);
    const startConnection = (event) => {
      event.stopPropagation();
      event.preventDefault();
      startOrFinishConnection(layer, port);
    };
    handle.addEventListener("mousedown", startConnection);
    viewport.append(handle);
  });
}

function renderResizeHandles(viewport, layer, layout) {
  const handles = [
    ["nw", layout.x, layout.y],
    ["n", layout.x + layout.width / 2, layout.y],
    ["ne", layout.x + layout.width, layout.y],
    ["e", layout.x + layout.width, layout.y + layout.height / 2],
    ["se", layout.x + layout.width, layout.y + layout.height],
    ["s", layout.x + layout.width / 2, layout.y + layout.height],
    ["sw", layout.x, layout.y + layout.height],
    ["w", layout.x, layout.y + layout.height / 2],
  ];
  handles.forEach(([handleName, x, y]) => {
    const handle = createSvgElement("rect");
    handle.setAttribute("x", x - 4);
    handle.setAttribute("y", y - 4);
    handle.setAttribute("width", 8);
    handle.setAttribute("height", 8);
    handle.setAttribute("class", `resize-handle ${handleName}`);
    handle.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      pushUndo(currentProject());
      state.resize = {
        type: "layer",
        id: layer.layer_id,
        handle: handleName,
        startX: event.clientX,
        startY: event.clientY,
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      };
    });
    viewport.append(handle);
  });
}

function renderTextResizeHandles(viewport, box) {
  [["se", box.x + box.width, box.y + box.height], ["e", box.x + box.width, box.y + box.height / 2], ["s", box.x + box.width / 2, box.y + box.height]].forEach(([handleName, x, y]) => {
    const handle = createSvgElement("rect");
    handle.setAttribute("x", x - 4);
    handle.setAttribute("y", y - 4);
    handle.setAttribute("width", 8);
    handle.setAttribute("height", 8);
    handle.setAttribute("class", `resize-handle ${handleName}`);
    handle.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      pushUndo(currentProject());
      state.resize = {
        type: "text",
        id: box.id,
        handle: handleName,
        startX: event.clientX,
        startY: event.clientY,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      };
    });
    viewport.append(handle);
  });
}

function startSelectionDrag(event) {
  const project = currentProject();
  if (!project) return;
  const layerPositions = {};
  state.selectedLayerIds.forEach((id) => {
    const layout = project.layouts[id];
    if (layout) layerPositions[id] = { x: layout.x, y: layout.y };
  });
  const textPositions = {};
  state.selectedTextBoxIds.forEach((id) => {
    const box = project.textBoxes.find((item) => item.id === id);
    if (box) textPositions[id] = { x: box.x, y: box.y };
  });
  pushUndo(project);
  state.drag = {
    type: "selection",
    startX: event.clientX,
    startY: event.clientY,
    layerPositions,
    textPositions,
    moved: false,
  };
}

function startMarqueeSelection(event) {
  const start = screenToWorld(event.clientX, event.clientY);
  state.selectionBox = {
    start,
    current: start,
    additive: event.ctrlKey || event.metaKey || event.shiftKey,
    moved: false,
  };
}

function updateMarqueeSelection(event) {
  if (!state.selectionBox) return;
  state.selectionBox.current = screenToWorld(event.clientX, event.clientY);
  const dx = state.selectionBox.current.x - state.selectionBox.start.x;
  const dy = state.selectionBox.current.y - state.selectionBox.start.y;
  state.selectionBox.moved = Math.abs(dx) > 4 || Math.abs(dy) > 4;
  renderCanvas();
}

function finishMarqueeSelection() {
  const project = currentProject();
  if (!project || !state.selectionBox) return;
  const box = normalizeBox(state.selectionBox.start, state.selectionBox.current);
  const selectedLayers = project.layers
    .filter((layer) => intersects(box, project.layouts[layer.layer_id]))
    .map((layer) => layer.layer_id);
  const selectedTextBoxes = project.textBoxes
    .filter((textBox) => intersects(box, textBox))
    .map((textBox) => textBox.id);

  if (state.selectionBox.additive) {
    selectedLayers.forEach((id) => state.selectedLayerIds.add(id));
    selectedTextBoxes.forEach((id) => state.selectedTextBoxIds.add(id));
  } else {
    state.selectedLayerIds = new Set(selectedLayers);
    state.selectedTextBoxIds = new Set(selectedTextBoxes);
  }
  state.selectedLayerId = [...state.selectedLayerIds][0] || null;
  state.selectedTextBoxId = state.selectedLayerId ? null : [...state.selectedTextBoxIds][0] || null;
  state.selectedRelationId = null;
  state.selectionBox = null;
  renderAll();
}

function normalizeBox(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function intersects(box, item) {
  if (!item) return false;
  return (
    item.x < box.x + box.width &&
    item.x + item.width > box.x &&
    item.y < box.y + box.height &&
    item.y + item.height > box.y
  );
}

function createSvgElement(name) {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}

function selectLayer(layerId, center = false, additive = false) {
  if (additive) {
    if (state.selectedLayerIds.has(layerId)) state.selectedLayerIds.delete(layerId);
    else state.selectedLayerIds.add(layerId);
    state.selectedLayerId = state.selectedLayerIds.has(layerId) ? layerId : [...state.selectedLayerIds][0] || null;
  } else {
    state.selectedLayerIds = new Set(layerId ? [layerId] : []);
    state.selectedLayerId = layerId;
  }
  state.selectedRelationId = null;
  state.selectedTextBoxId = null;
  state.selectedTextBoxIds = additive ? state.selectedTextBoxIds : new Set();
  if (center) centerNode(layerId);
  renderMiniTable();
  renderRelationTable();
  renderProperty();
  renderCanvas();
  renderToolbar();
}

function selectRelation(relationId) {
  state.selectedRelationId = relationId;
  state.selectedLayerId = null;
  state.selectedLayerIds = new Set();
  state.selectedTextBoxId = null;
  state.selectedTextBoxIds = new Set();
  renderAlignTable();
  renderRelationTable();
  renderMiniTable();
  renderProperty();
  renderCanvas();
  renderToolbar();
}

function selectTextBox(textBoxId, additive = false) {
  if (additive) {
    if (state.selectedTextBoxIds.has(textBoxId)) state.selectedTextBoxIds.delete(textBoxId);
    else state.selectedTextBoxIds.add(textBoxId);
    state.selectedTextBoxId = state.selectedTextBoxIds.has(textBoxId) ? textBoxId : [...state.selectedTextBoxIds][0] || null;
  } else {
    state.selectedTextBoxIds = new Set(textBoxId ? [textBoxId] : []);
    state.selectedTextBoxId = textBoxId;
    state.selectedLayerIds = new Set();
    state.selectedLayerId = null;
  }
  state.selectedRelationId = null;
  renderAlignTable();
  renderRelationTable();
  renderMiniTable();
  renderProperty();
  renderCanvas();
  renderToolbar();
}

function applyLayerStyleFromPanel(project, live = false) {
  const targetIds = state.selectedLayerIds.size ? [...state.selectedLayerIds] : state.selectedLayerId ? [state.selectedLayerId] : [];
  if (!targetIds.length) return;
  if (live) pushUndo(project);
  const width = Math.max(70, Number(document.querySelector("#shapeWidth")?.value) || 150);
  const height = Math.max(36, Number(document.querySelector("#shapeHeight")?.value) || 64);
  const nextStyle = {
    fill: document.querySelector("#shapeFill")?.value || DEFAULT_LAYER_STYLE.fill,
    stroke: document.querySelector("#shapeStroke")?.value || DEFAULT_LAYER_STYLE.stroke,
    strokeWidth: Number(document.querySelector("#shapeStrokeWidth")?.value) || DEFAULT_LAYER_STYLE.strokeWidth,
    textColor: document.querySelector("#shapeTextColor")?.value || DEFAULT_LAYER_STYLE.textColor,
    fontSize: Number(document.querySelector("#shapeFontSize")?.value) || DEFAULT_LAYER_STYLE.fontSize,
  };
  targetIds.forEach((id) => {
    project.styles[id] = { ...project.styles[id], ...nextStyle };
    if (project.layouts[id]) {
      project.layouts[id].width = width;
      project.layouts[id].height = height;
    }
  });
  if (live) {
    project.updated_at = new Date().toISOString();
    persist();
    renderCanvas();
    renderMiniTable();
  }
}

function applyTextBoxStyleFromPanel(project, live = false) {
  const targetIds = state.selectedTextBoxIds.size ? [...state.selectedTextBoxIds] : state.selectedTextBoxId ? [state.selectedTextBoxId] : [];
  if (!targetIds.length) return;
  if (live) pushUndo(project);
  targetIds.forEach((id) => {
    const box = project.textBoxes.find((item) => item.id === id);
    if (!box) return;
    box.text = document.querySelector("#textBoxText")?.value || "";
    box.style.fontSize = Number(document.querySelector("#textFontSize")?.value) || 16;
    box.style.textColor = document.querySelector("#textColor")?.value || DEFAULT_TEXT_STYLE.textColor;
    box.style.fill = document.querySelector("#textTransparent")?.checked ? "transparent" : document.querySelector("#textFill")?.value || "transparent";
  });
  if (live) {
    project.updated_at = new Date().toISOString();
    persist();
    renderCanvas();
  }
}

function handleConnectNode(layer) {
  const project = ensureProject();
  if (!state.pendingConnectLayerId) {
    state.pendingConnectLayerId = layer.layer_id;
    state.selectedLayerId = layer.layer_id;
    state.selectedRelationId = null;
    renderAll();
    return;
  }
  const parent = project.layers.find((item) => item.layer_id === state.pendingConnectLayerId);
  const draft = {
    relation_id: crypto.randomUUID(),
    parent_layer: parent?.layer_name || "",
    child_layer: layer.layer_name,
    relation_type: "Align",
  };
  const issue = validateRelationDraft(project, draft);
  if (issue) {
    alert(issue);
    state.pendingConnectLayerId = null;
    state.mode = "select";
    renderAll();
    return;
  }
  pushUndo(project);
  project.relations.push(draft);
  state.selectedRelationId = draft.relation_id;
  state.selectedLayerId = null;
  state.pendingConnectLayerId = null;
  state.mode = "select";
  validateProject(project);
  touch(project, `Added relation ${draft.parent_layer} -> ${draft.child_layer}`);
  renderAll();
}

function startOrFinishConnection(layer, port) {
  const project = ensureProject();
  if (!state.connectStart) {
    state.mode = "connect";
    state.connectStart = { layerId: layer.layer_id, port };
    state.selectedLayerId = layer.layer_id;
    state.selectedLayerIds = new Set([layer.layer_id]);
    state.selectedRelationId = null;
    state.selectedTextBoxId = null;
    state.selectedTextBoxIds = new Set();
    renderAll();
    return;
  }
  const parent = project.layers.find((item) => item.layer_id === state.connectStart.layerId);
  const draft = {
    relation_id: crypto.randomUUID(),
    parent_layer: parent?.layer_name || "",
    child_layer: layer.layer_name,
    relation_type: "Align",
    source_port: state.connectStart.port,
    target_port: port,
    connector_type: "straight",
  };
  const issue = validateRelationDraft(project, draft);
  if (issue) {
    alert(issue);
    state.connectStart = null;
    state.mode = "select";
    renderAll();
    return;
  }
  pushUndo(project);
  project.relations.push(draft);
  state.selectedRelationId = draft.relation_id;
  state.selectedLayerId = null;
  state.selectedLayerIds = new Set();
  state.selectedTextBoxId = null;
  state.selectedTextBoxIds = new Set();
  state.connectStart = null;
  state.pendingConnectLayerId = null;
  state.mode = "select";
  validateProject(project);
  touch(project, `Added relation ${draft.parent_layer} -> ${draft.child_layer}`);
  renderAll();
}

function deleteLayerWithConfirmation(layer) {
  const project = currentProject();
  if (!project || !layer) return;
  const linked = project.relations.filter((relation) => relation.parent_layer === layer.layer_name || relation.child_layer === layer.layer_name);
  const relationLines = linked.length
    ? linked.map((relation) => `- ${relation.parent_layer} -> ${relation.child_layer} (${relation.relation_type})`).join("\n")
    : "- No incoming/outgoing relations.";
  const ok = confirm(`Delete layer '${layer.layer_name}'?\n\nIncoming / Outgoing Relations:\n${relationLines}`);
  if (!ok) return;
  pushUndo(project);
  project.layers = project.layers.filter((item) => item.layer_id !== layer.layer_id);
  project.relations = project.relations.filter((relation) => relation.parent_layer !== layer.layer_name && relation.child_layer !== layer.layer_name);
  delete project.layouts[layer.layer_id];
  state.selectedLayerId = project.layers[0]?.layer_id || null;
  state.selectedLayerIds = new Set(state.selectedLayerId ? [state.selectedLayerId] : []);
  state.selectedRelationId = null;
  validateProject(project);
  touch(project, `Deleted layer ${layer.layer_name}`);
  renderAll();
}

function canvasCenterWorld() {
  const svg = document.querySelector("#treeCanvas");
  const rect = svg.getBoundingClientRect();
  return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function addLayerShape() {
  const project = ensureProject();
  pushUndo(project);
  const next = project.layers.length + 1;
  let name = `LAYER_${String(next).padStart(2, "0")}`;
  let suffix = next;
  const existing = new Set(project.layers.map((layer) => layer.layer_name));
  while (existing.has(name)) {
    suffix += 1;
    name = `LAYER_${String(suffix).padStart(2, "0")}`;
  }
  const layer = {
    layer_id: crypto.randomUUID(),
    step: `S${String(next).padStart(2, "0")}`,
    layer_name: name,
    layer_property: "",
    align_name: `AA${String(next).padStart(2, "0")}`,
    align_side: "CENTER",
  };
  const center = canvasCenterWorld();
  project.layers.push(layer);
  project.layouts[layer.layer_id] = { x: snap(center.x - 75), y: snap(center.y - 32), width: 150, height: 64 };
  project.styles[layer.layer_id] = { ...DEFAULT_LAYER_STYLE };
  state.selectedLayerId = layer.layer_id;
  state.selectedLayerIds = new Set([layer.layer_id]);
  state.selectedRelationId = null;
  state.selectedTextBoxId = null;
  state.selectedTextBoxIds = new Set();
  validateProject(project);
  touch(project, `Added layer ${name}`);
  renderAll();
}

function addTextBoxShape() {
  const project = ensureProject();
  pushUndo(project);
  const center = canvasCenterWorld();
  const box = {
    id: crypto.randomUUID(),
    text: "Text Box",
    x: snap(center.x - 90),
    y: snap(center.y - 26),
    width: 180,
    height: 52,
    style: { ...DEFAULT_TEXT_STYLE },
  };
  project.textBoxes.push(box);
  state.selectedTextBoxId = box.id;
  state.selectedTextBoxIds = new Set([box.id]);
  state.selectedLayerId = null;
  state.selectedLayerIds = new Set();
  state.selectedRelationId = null;
  state.mode = "select";
  touch(project, "Added text box");
  renderAll();
}

function getGraphBounds(project) {
  const boxes = [
    ...project.layers.map((layer) => project.layouts[layer.layer_id]).filter(Boolean),
    ...(project.textBoxes || []),
  ];
  if (!boxes.length) return { minX: 0, minY: 0, maxX: 800, maxY: 500, width: 800, height: 500 };
  const minX = Math.min(...boxes.map((layout) => layout.x));
  const minY = Math.min(...boxes.map((layout) => layout.y));
  const maxX = Math.max(...boxes.map((layout) => layout.x + layout.width));
  const maxY = Math.max(...boxes.map((layout) => layout.y + layout.height));
  return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function centerNode(layerId) {
  const project = currentProject();
  const svg = document.querySelector("#treeCanvas");
  const layout = project?.layouts[layerId];
  if (!layout) return;
  const rect = svg.getBoundingClientRect();
  state.pan.x = rect.width / 2 - (layout.x + layout.width / 2) * state.scale;
  state.pan.y = rect.height / 2 - (layout.y + layout.height / 2) * state.scale;
}

function fitViewToGraph() {
  const project = currentProject();
  const svg = document.querySelector("#treeCanvas");
  if (!project || !project.layers.length) return;
  const rect = svg.getBoundingClientRect();
  const bounds = getGraphBounds(project);
  const padding = 90;
  state.scale = Math.min(2, Math.max(0.25, Math.min((rect.width - padding) / bounds.width, (rect.height - padding) / bounds.height)));
  state.pan.x = rect.width / 2 - (bounds.minX + bounds.width / 2) * state.scale;
  state.pan.y = rect.height / 2 - (bounds.minY + bounds.height / 2) * state.scale;
  renderCanvas();
  renderToolbar();
}

function zoomAt(factor) {
  const svg = document.querySelector("#treeCanvas");
  const rect = svg.getBoundingClientRect();
  const center = { x: rect.width / 2, y: rect.height / 2 };
  const world = screenToWorld(center.x + rect.left, center.y + rect.top);
  state.scale = Math.min(2.5, Math.max(0.25, state.scale * factor));
  state.pan.x = center.x - world.x * state.scale;
  state.pan.y = center.y - world.y * state.scale;
  renderCanvas();
  renderToolbar();
}

function screenToWorld(clientX, clientY) {
  const rect = document.querySelector("#treeCanvas").getBoundingClientRect();
  return {
    x: (clientX - rect.left - state.pan.x) / state.scale,
    y: (clientY - rect.top - state.pan.y) / state.scale,
  };
}

function snap(value) {
  return state.snapToGrid ? Math.round(value / 20) * 20 : value;
}

function renderMiniMap() {
  const project = currentProject();
  const mini = document.querySelector("#miniMap");
  if (!mini || !project) return;
  mini.innerHTML = "";
  const bounds = getGraphBounds(project);
  const width = 180;
  const height = 120;
  mini.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const pad = 10;
  const scale = Math.min((width - pad * 2) / Math.max(1, bounds.width), (height - pad * 2) / Math.max(1, bounds.height));
  project.layers.forEach((layer) => {
    const layout = project.layouts[layer.layer_id];
    if (!layout) return;
    const rect = createSvgElement("rect");
    rect.setAttribute("x", pad + (layout.x - bounds.minX) * scale);
    rect.setAttribute("y", pad + (layout.y - bounds.minY) * scale);
    rect.setAttribute("width", Math.max(4, layout.width * scale));
    rect.setAttribute("height", Math.max(4, layout.height * scale));
    rect.setAttribute("class", `minimap-node ${state.selectedLayerIds.has(layer.layer_id) ? "active" : ""}`);
    mini.append(rect);
  });
  const canvasRect = document.querySelector("#treeCanvas").getBoundingClientRect();
  const view = createSvgElement("rect");
  view.setAttribute("x", pad + ((-state.pan.x / state.scale) - bounds.minX) * scale);
  view.setAttribute("y", pad + ((-state.pan.y / state.scale) - bounds.minY) * scale);
  view.setAttribute("width", (canvasRect.width / state.scale) * scale);
  view.setAttribute("height", (canvasRect.height / state.scale) * scale);
  view.setAttribute("class", "minimap-view");
  mini.append(view);
}

function renderToolbar() {
  document.querySelector("#selectMode")?.classList.toggle("active", state.mode === "select");
  document.querySelector("#connectMode")?.classList.toggle("active", state.mode === "connect");
  document.querySelector("#toggleLayers")?.classList.toggle("active", !state.layersCollapsed);
  document.querySelector("#toggleProperties")?.classList.toggle("active", !state.propertiesCollapsed);
  const zoomLabel = document.querySelector("#zoomLabel");
  if (zoomLabel) zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;
  const snapInput = document.querySelector("#snapToGrid");
  if (snapInput) snapInput.checked = state.snapToGrid;
  const hint = document.querySelector("#modeHint");
  if (hint) {
    if (state.connectStart) hint.textContent = "Connector: choose target point";
    else hint.textContent = state.mode === "connect" ? "Connector: choose start point" : "Drag canvas to select. Alt+drag selection to move.";
  }
}

function undoAction() {
  const project = currentProject();
  if (!project || !state.undoStack.length) return;
  state.redoStack.push(snapshotProject(project));
  restoreProject(project, state.undoStack.pop());
  state.selectedLayerId = project.layers.find((layer) => layer.layer_id === state.selectedLayerId)?.layer_id || project.layers[0]?.layer_id || null;
  state.selectedRelationId = null;
  state.selectedTextBoxId = null;
  renderAll();
}

function redoAction() {
  const project = currentProject();
  if (!project || !state.redoStack.length) return;
  state.undoStack.push(snapshotProject(project));
  restoreProject(project, state.redoStack.pop());
  state.selectedLayerId = project.layers.find((layer) => layer.layer_id === state.selectedLayerId)?.layer_id || project.layers[0]?.layer_id || null;
  state.selectedRelationId = null;
  state.selectedTextBoxId = null;
  renderAll();
}

function alignSelectedHorizontal() {
  const project = currentProject();
  if (!project || !state.selectedLayerId) return;
  const target = project.layouts[state.selectedLayerId];
  if (!target) return;
  const targetIds = state.selectedLayerIds.size > 1 ? [...state.selectedLayerIds] : project.layers.map((layer) => layer.layer_id);
  pushUndo(project);
  targetIds.forEach((id) => {
    if (id !== state.selectedLayerId && project.layouts[id]) project.layouts[id].y = target.y;
  });
  touch(project, "Aligned nodes horizontally");
  renderAll();
}

function distributeVertical() {
  const project = currentProject();
  if (!project || project.layers.length < 3) return;
  const sourceLayers = state.selectedLayerIds.size > 2 ? project.layers.filter((layer) => state.selectedLayerIds.has(layer.layer_id)) : project.layers;
  const ordered = sourceLayers
    .map((layer) => ({ layer, layout: project.layouts[layer.layer_id] }))
    .filter((item) => item.layout)
    .sort((a, b) => a.layout.y - b.layout.y);
  if (ordered.length < 3) return;
  pushUndo(project);
  const top = ordered[0].layout.y;
  const bottom = ordered[ordered.length - 1].layout.y;
  const step = (bottom - top) / (ordered.length - 1);
  ordered.forEach((item, index) => {
    item.layout.y = snap(top + step * index);
  });
  touch(project, "Distributed nodes vertically");
  renderAll();
}

function downloadTemplate() {
  const guide = [
    ["Column", "Description", "Example"],
    ["Step", "Process step", "S01"],
    ["Layer", "Unique layer name", "WL"],
    ["Layer_Property", "Layer property", "Main"],
    ["Align", "Unique align key", "AA01"],
    ["Align_side", `Allowed: ${ALLOWED_SIDES.join(", ")}`, "LEFT"],
  ];
  downloadWorkbook("align_tree_template.xls", {
    Align_Input: [ALIGN_COLUMNS, ["S01", "WL", "Main", "AA01", "LEFT"]],
    Layer_Relation: [RELATION_COLUMNS, ["WL", "BL", "Align"]],
    Guide: guide,
  });
}

function exportExcel() {
  const project = ensureProject();
  const sheets = {
    Align_Input: [ALIGN_COLUMNS, ...project.layers.map((layer) => [layer.step, layer.layer_name, layer.layer_property, layer.align_name, layer.align_side])],
    Layer_Relation: [RELATION_COLUMNS, ...project.relations.map((relation) => [relation.parent_layer, relation.child_layer, relation.relation_type])],
  };
  if (document.querySelector("#includeValidation").checked) {
    sheets.Validation_Result = [["Level", "Row", "Message"], ...(project.validation || []).map((result) => [result.level, result.row, result.message])];
  }
  if (document.querySelector("#includeHistory").checked) {
    sheets.Change_History = [["At", "Message"], ...project.history.map((item) => [item.at, item.message])];
  }
  downloadWorkbook(`${project.project_name}_align_tree.xls`, sheets);
}

function downloadWorkbook(filename, sheets) {
  const sheetNames = Object.keys(sheets);
  const worksheetCss = sheetNames
    .map((name, index) => `mso-worksheets:${index === 0 ? "1" : "0"};`)
    .join("");
  const html = `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><xml><x:ExcelWorkbook><x:ExcelWorksheets>${sheetNames
    .map((name) => `<x:ExcelWorksheet><x:Name>${escapeHtml(name)}</x:Name><x:WorksheetOptions/></x:ExcelWorksheet>`)
    .join("")}</x:ExcelWorksheets></x:ExcelWorkbook></xml><style>${worksheetCss} table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px}</style></head><body>${sheetNames
    .map((name) => `<h1>${escapeHtml(name)}</h1>${arrayToTable(sheets[name])}`)
    .join("<br>")}</body></html>`;
  downloadBlob(filename, html, "application/vnd.ms-excel");
}

function arrayToTable(rows) {
  return `<table>${rows
    .map((row, rowIndex) => `<tr>${row.map((cell) => `<${rowIndex === 0 ? "th" : "td"}>${escapeHtml(String(cell ?? ""))}</${rowIndex === 0 ? "th" : "td"}>`).join("")}</tr>`)
    .join("")}</table>`;
}

function exportSvg(filenameSuffix = "tree") {
  const project = ensureProject();
  const svg = document.querySelector("#treeCanvas").cloneNode(true);
  svg.querySelectorAll(".port-handle,.resize-handle,.edge-hit,.grid-line,.connector-preview").forEach((item) => item.remove());
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", "1280");
  svg.setAttribute("height", "720");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = ".node rect{fill:#fff;stroke:#30435f;stroke-width:1.5;rx:6}.node.active rect{stroke:#2457d6;stroke-width:3;fill:#f7fbff}.node text{fill:#18202c;font:12px Segoe UI,Arial}.edge{fill:none;stroke:#53657d;stroke-width:2}.edge.overlay{stroke-dasharray:7 5}.edge.reference{stroke-dasharray:2 5}.edge.warning{stroke:#bd2d2d}";
  svg.prepend(style);
  downloadBlob(`${project.project_name}_${filenameSuffix}.svg`, new XMLSerializer().serializeToString(svg), "image/svg+xml");
}

function exportPptOutline() {
  const project = ensureProject();
  const rows = project.layers.map((layer) => `<li>${escapeHtml(layer.step)} ${escapeHtml(layer.layer_name)} - ${escapeHtml(layer.align_name)} / ${escapeHtml(layer.align_side || "-")}</li>`).join("");
  const html = `<html><head><meta charset="utf-8"><title>${escapeHtml(project.project_name)}</title></head><body><h1>${escapeHtml(project.project_name)} Align Tree</h1><ul>${rows}</ul><p>Use PPT Image Export SVG as the slide image source.</p></body></html>`;
  downloadBlob(`${project.project_name}_ppt_outline.ppt`, html, "application/vnd.ms-powerpoint");
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
document.querySelector("#createProject").addEventListener("click", () => {
  createProject(document.querySelector("#projectName").value);
  renderAll();
  switchView("import");
});
document.querySelector("#loadSample").addEventListener("click", () => {
  const clone = structuredClone(sampleProject);
  clone.project_id = crypto.randomUUID();
  clone.created_at = new Date().toISOString();
  clone.updated_at = clone.created_at;
  clone.layers.forEach((layer) => (layer.layer_id = crypto.randomUUID()));
  clone.relations.forEach((relation) => (relation.relation_id = crypto.randomUUID()));
  clone.layouts = {};
  clone.history = [{ at: clone.created_at, message: "Sample loaded" }];
  state.projects.push(clone);
  state.currentId = clone.project_id;
  normalizeProject(clone);
  state.selectedLayerId = clone.layers[0].layer_id;
  state.selectedLayerIds = new Set([state.selectedLayerId]);
  state.selectedRelationId = null;
  state.selectedTextBoxId = null;
  state.selectedTextBoxIds = new Set();
  state.mode = "select";
  state.pendingConnectLayerId = null;
  state.undoStack = [];
  state.redoStack = [];
  autoLayoutProject(clone, false);
  renderAll();
  switchView("editor");
  fitSoon();
});
document.querySelector("#downloadTemplate").addEventListener("click", downloadTemplate);
document.querySelectorAll("[data-add-row]").forEach((button) => button.addEventListener("click", () => addRow(button.dataset.addRow)));
document.querySelectorAll("[data-paste-target]").forEach((button) => {
  button.addEventListener("click", () => {
    state.pasteTarget = button.dataset.pasteTarget;
    document.querySelector("#pasteTitle").textContent = `${state.pasteTarget === "align" ? "Align Input" : "Layer Relation"} Paste`;
    document.querySelector("#pasteText").value = "";
    document.querySelector("#pasteDialog").showModal();
  });
});
document.querySelectorAll("[data-upload-target]").forEach((button) => {
  button.addEventListener("click", () => {
    state.uploadTarget = button.dataset.uploadTarget;
    const input = document.querySelector("#fileUpload");
    input.value = "";
    input.click();
  });
});
document.querySelector("#fileUpload").addEventListener("change", (event) => applyUpload(event.target.files[0]));
document.querySelector("#applyPaste").addEventListener("click", applyPaste);
document.querySelector("#validateImport").addEventListener("click", () => {
  const project = ensureProject();
  validateProject(project);
  touch(project, "Validation executed");
  renderAll();
});
document.querySelector("#validateEditor").addEventListener("click", () => {
  const project = ensureProject();
  validateProject(project);
  touch(project, "Validation executed");
  renderAll();
  switchView("import");
});
document.querySelector("#buildTree").addEventListener("click", () => {
  const project = ensureProject();
  validateProject(project);
  autoLayoutProject(project);
  state.selectedLayerId = project.layers[0]?.layer_id || null;
  renderAll();
  switchView("editor");
  fitSoon();
});
document.querySelector("#saveProject").addEventListener("click", () => touch(ensureProject(), "Project saved"));
document.querySelector("#selectMode").addEventListener("click", () => {
  state.mode = "select";
  state.pendingConnectLayerId = null;
  state.connectStart = null;
  renderAll();
});
document.querySelector("#connectMode").addEventListener("click", () => {
  state.mode = "connect";
  state.pendingConnectLayerId = null;
  state.connectStart = null;
  state.selectedRelationId = null;
  state.selectedTextBoxId = null;
  renderAll();
});
document.querySelector("#addLayer").addEventListener("click", addLayerShape);
document.querySelector("#addTextBox").addEventListener("click", addTextBoxShape);
document.querySelector("#undoAction").addEventListener("click", undoAction);
document.querySelector("#redoAction").addEventListener("click", redoAction);
document.querySelector("#zoomOut").addEventListener("click", () => zoomAt(0.85));
document.querySelector("#zoomIn").addEventListener("click", () => zoomAt(1.15));
document.querySelector("#fitView").addEventListener("click", fitViewToGraph);
document.querySelector("#toggleLayers").addEventListener("click", () => {
  state.layersCollapsed = !state.layersCollapsed;
  renderEditorLayout();
  fitSoon();
});
document.querySelector("#toggleProperties").addEventListener("click", () => {
  state.propertiesCollapsed = !state.propertiesCollapsed;
  renderEditorLayout();
  fitSoon();
});
document.querySelector("#snapToGrid").addEventListener("change", (event) => {
  state.snapToGrid = event.target.checked;
  renderToolbar();
});
document.querySelector("#alignHorizontal").addEventListener("click", alignSelectedHorizontal);
document.querySelector("#distributeVertical").addEventListener("click", distributeVertical);
document.querySelector("#layerSearch").addEventListener("input", (event) => {
  state.search = event.target.value;
  renderMiniTable();
});
document.querySelector("#autoLayout").addEventListener("click", () => {
  autoLayoutProject(ensureProject());
  renderAll();
  fitSoon();
});
document.querySelector("#exportExcel").addEventListener("click", exportExcel);
document.querySelector("#exportExcelTop").addEventListener("click", exportExcel);
document.querySelector("#exportSvg").addEventListener("click", () => exportSvg("ppt_image"));
document.querySelector("#exportPptTop").addEventListener("click", () => exportSvg("ppt_image"));
document.querySelector("#exportPpt").addEventListener("click", exportPptOutline);
document.querySelector(".property-side").addEventListener("mousedown", (event) => event.stopPropagation());
document.querySelector(".property-side").addEventListener("click", (event) => event.stopPropagation());
document.querySelector(".property-side").addEventListener("pointerdown", (event) => event.stopPropagation());

document.querySelector("#treeCanvas").addEventListener("mousedown", (event) => {
  if (
    event.target.closest?.(".node") ||
    event.target.closest?.(".text-box") ||
    event.target.classList.contains("edge-hit") ||
    event.target.classList.contains("port-handle") ||
    event.target.classList.contains("resize-handle")
  ) {
    return;
  }
  state.selectedLayerId = null;
  state.selectedLayerIds = new Set();
  state.selectedRelationId = null;
  state.selectedTextBoxId = null;
  state.selectedTextBoxIds = new Set();
  state.pendingConnectLayerId = null;
  state.connectStart = null;
  if (state.mode === "connect") {
    state.mode = "select";
    renderAll();
    return;
  }
  startMarqueeSelection(event);
  renderProperty();
  renderCanvas();
});

document.querySelector("#treeCanvas").addEventListener("wheel", (event) => {
  event.preventDefault();
  const before = screenToWorld(event.clientX, event.clientY);
  state.scale = Math.min(2.5, Math.max(0.25, state.scale * (event.deltaY > 0 ? 0.9 : 1.1)));
  const rect = event.currentTarget.getBoundingClientRect();
  state.pan.x = event.clientX - rect.left - before.x * state.scale;
  state.pan.y = event.clientY - rect.top - before.y * state.scale;
  renderCanvas();
  renderToolbar();
});

window.addEventListener("mousemove", (event) => {
  if (state.connectStart) {
    state.pointerWorld = screenToWorld(event.clientX, event.clientY);
    renderCanvas();
    return;
  }
  if (state.selectionBox) {
    updateMarqueeSelection(event);
    return;
  }
  if (state.isPanning) {
    state.pan.x = state.isPanning.x + event.clientX - state.isPanning.startX;
    state.pan.y = state.isPanning.y + event.clientY - state.isPanning.startY;
    renderCanvas();
    return;
  }
  if (state.resize) {
    const project = currentProject();
    const dx = (event.clientX - state.resize.startX) / state.scale;
    const dy = (event.clientY - state.resize.startY) / state.scale;
    const target = state.resize.type === "layer" ? project.layouts[state.resize.id] : project.textBoxes.find((box) => box.id === state.resize.id);
    if (!target) return;
    const minWidth = state.resize.type === "layer" ? 70 : 50;
    const minHeight = state.resize.type === "layer" ? 36 : 24;
    const movesLeft = state.resize.handle.includes("w");
    const movesRight = state.resize.handle.includes("e");
    const movesTop = state.resize.handle.includes("n");
    const movesBottom = state.resize.handle.includes("s");
    if (movesLeft) {
      target.x = snap(state.resize.x + dx);
      target.width = Math.max(minWidth, snap(state.resize.width - dx));
    }
    if (movesRight) target.width = Math.max(minWidth, snap(state.resize.width + dx));
    if (movesTop) {
      target.y = snap(state.resize.y + dy);
      target.height = Math.max(minHeight, snap(state.resize.height - dy));
    }
    if (movesBottom) target.height = Math.max(minHeight, snap(state.resize.height + dy));
    renderCanvas();
    return;
  }
  if (state.drag) {
    const project = currentProject();
    const dx = (event.clientX - state.drag.startX) / state.scale;
    const dy = (event.clientY - state.drag.startY) / state.scale;
    if (state.drag.type === "selection") {
      Object.entries(state.drag.layerPositions).forEach(([id, position]) => {
        const layout = project.layouts[id];
        if (!layout) return;
        layout.x = Math.max(20, snap(position.x + dx));
        layout.y = Math.max(20, snap(position.y + dy));
      });
      Object.entries(state.drag.textPositions).forEach(([id, position]) => {
        const box = project.textBoxes.find((item) => item.id === id);
        if (!box) return;
        box.x = Math.max(20, snap(position.x + dx));
        box.y = Math.max(20, snap(position.y + dy));
      });
    }
    state.drag.moved = true;
    renderCanvas();
  }
});

window.addEventListener("mouseup", () => {
  if (state.selectionBox) {
    finishMarqueeSelection();
  }
  if (state.isPanning) {
    state.isPanning = null;
    renderCanvas();
  }
  if (state.drag) {
    if (state.drag.moved) touch(ensureProject(), "Node position changed");
    state.drag = null;
    renderAll();
  }
  if (state.resize) {
    touch(ensureProject(), "Shape resized");
    state.resize = null;
    renderAll();
  }
});

renderAll();
