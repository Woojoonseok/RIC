const ALIGN_COLUMNS = ["Step", "Layer", "Layer_Property", "Align", "Align_side"];
const RELATION_COLUMNS = ["Parent_Layer", "Child_Layer", "Relation_Type"];
const ALLOWED_SIDES = ["LEFT", "RIGHT", "CENTER", "TOP", "BOTTOM"];
const RELATION_TYPES = ["Align", "Overlay", "Reference", "Warning"];
const STORE_KEY = "align-tree-editor-projects";

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
  pasteTarget: "align",
  uploadTarget: "align",
  drag: null,
};

function currentProject() {
  return state.projects.find((project) => project.project_id === state.currentId) || null;
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

function switchView(viewName) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === viewName));
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === viewName));
  if (viewName === "editor") renderCanvas();
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
        renderAll();
        switchView("editor");
      });
      item.append(open);
      list.append(item);
    });
}

function renderAll() {
  renderMeta();
  renderProjectList();
  renderAlignTable();
  renderRelationTable();
  renderValidation();
  renderMiniTable();
  renderProperty();
  renderCanvas();
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
    history: [],
    validation: [],
  };
  state.projects.push(project);
  state.currentId = project.project_id;
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
      const [removed] = project.layers.splice(rowIndex, 1);
      if (removed) {
        project.relations = project.relations.filter((relation) => relation.parent_layer !== removed.layer_name && relation.child_layer !== removed.layer_name);
        delete project.layouts[removed.layer_id];
        touch(project, `Deleted layer ${removed.layer_name}`);
      }
      renderAll();
    }
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
      if (column === "Parent_Layer") relation.parent_layer = value;
      if (column === "Child_Layer") relation.child_layer = value;
      if (column === "Relation_Type") relation.relation_type = value;
      touch(project, `Updated ${column}`);
      renderAll();
    },
    (rowIndex) => {
      const project = ensureProject();
      project.relations.splice(rowIndex, 1);
      touch(project, "Deleted relation");
      renderAll();
    }
  );
}

function renderEditableTable(selector, columns, rows, getValue, onChange, onDelete) {
  const root = document.querySelector(selector);
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  thead.innerHTML = `<tr>${columns.map((column) => `<th>${column}</th>`).join("")}<th></th></tr>`;
  const tbody = document.createElement("tbody");
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
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
    remove.addEventListener("click", () => onDelete(rowIndex));
    action.append(remove);
    tr.append(action);
    tbody.append(tr);
  });
  table.append(thead, tbody);
  root.replaceChildren(table);
}

function addRow(type) {
  const project = ensureProject();
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
  project.relations.forEach((relation, index) => {
    const row = index + 1;
    if (!relation.parent_layer || !relation.child_layer) results.push(error(row, "Parent_Layer and Child_Layer are required."));
    if (relation.parent_layer === relation.child_layer) results.push(error(row, `Self-loop relation '${relation.parent_layer}' is not allowed.`));
    if (relation.parent_layer && !knownLayers.has(relation.parent_layer)) results.push(error(row, `Parent_Layer '${relation.parent_layer}' does not exist in Align_Input.`));
    if (relation.child_layer && !knownLayers.has(relation.child_layer)) results.push(error(row, `Child_Layer '${relation.child_layer}' does not exist in Align_Input.`));
    if (!RELATION_TYPES.includes(relation.relation_type)) results.push(error(row, `Relation_Type '${relation.relation_type}' is not allowed.`));
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

function autoLayoutProject(project) {
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
    project.layouts[layer.layer_id] = { x: 90 + depth * 210, y: 70 + index * 135, width: 150, height: 92 };
    depthCounts.set(depth, index + 1);
  });
  touch(project, "Auto layout applied");
}

function renderMiniTable() {
  const project = currentProject();
  const root = document.querySelector("#miniTable");
  root.innerHTML = "";
  if (!project) return;
  project.layers.forEach((layer) => {
    const row = document.createElement("div");
    row.className = `mini-row ${layer.layer_id === state.selectedLayerId ? "active" : ""}`;
    row.innerHTML = `<strong>${escapeHtml(layer.step)} ${escapeHtml(layer.layer_name)}</strong><span>${escapeHtml(layer.align_name)} / ${escapeHtml(layer.align_side || "-")}</span>`;
    row.addEventListener("click", () => {
      state.selectedLayerId = layer.layer_id;
      renderMiniTable();
      renderProperty();
      renderCanvas();
    });
    root.append(row);
  });
}

function renderProperty() {
  const project = currentProject();
  const root = document.querySelector("#propertyPanel");
  const layer = project?.layers.find((item) => item.layer_id === state.selectedLayerId);
  if (!project || !layer) {
    root.className = "property-empty";
    root.textContent = "Select a node.";
    return;
  }
  root.className = "property-form";
  root.innerHTML = `
    <label>Layer<input id="propLayer" value="${escapeAttr(layer.layer_name)}"></label>
    <label>Step<input id="propStep" value="${escapeAttr(layer.step)}"></label>
    <label>Property<input id="propProperty" value="${escapeAttr(layer.layer_property)}"></label>
    <label>Align<input id="propAlign" value="${escapeAttr(layer.align_name)}"></label>
    <label>Side<select id="propSide">${["", ...ALLOWED_SIDES].map((side) => `<option ${side === layer.align_side ? "selected" : ""}>${side}</option>`).join("")}</select></label>
    <button id="applyProperty">Apply</button>
    <button id="deleteLayer">Delete</button>
  `;
  document.querySelector("#applyProperty").addEventListener("click", () => {
    const previousName = layer.layer_name;
    layer.layer_name = document.querySelector("#propLayer").value.trim();
    layer.step = document.querySelector("#propStep").value.trim();
    layer.layer_property = document.querySelector("#propProperty").value.trim();
    layer.align_name = document.querySelector("#propAlign").value.trim();
    layer.align_side = document.querySelector("#propSide").value;
    project.relations.forEach((relation) => {
      if (relation.parent_layer === previousName) relation.parent_layer = layer.layer_name;
      if (relation.child_layer === previousName) relation.child_layer = layer.layer_name;
    });
    touch(project, `Updated node ${layer.layer_name}`);
    renderAll();
  });
  document.querySelector("#deleteLayer").addEventListener("click", () => {
    project.layers = project.layers.filter((item) => item.layer_id !== layer.layer_id);
    project.relations = project.relations.filter((relation) => relation.parent_layer !== layer.layer_name && relation.child_layer !== layer.layer_name);
    delete project.layouts[layer.layer_id];
    state.selectedLayerId = project.layers[0]?.layer_id || null;
    touch(project, `Deleted node ${layer.layer_name}`);
    renderAll();
  });
}

function renderCanvas() {
  const project = currentProject();
  const svg = document.querySelector("#treeCanvas");
  svg.innerHTML = "";
  if (!project) return;
  if (!Object.keys(project.layouts).length && project.layers.length) autoLayoutProject(project);
  const defs = createSvgElement("defs");
  defs.innerHTML = `<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#53657d"></path></marker>`;
  svg.append(defs);

  const layerByName = new Map(project.layers.map((layer) => [layer.layer_name, layer]));
  project.relations.forEach((relation) => {
    const parent = layerByName.get(relation.parent_layer);
    const child = layerByName.get(relation.child_layer);
    if (!parent || !child) return;
    const a = project.layouts[parent.layer_id];
    const b = project.layouts[child.layer_id];
    if (!a || !b) return;
    const path = createSvgElement("path");
    const startX = a.x + a.width;
    const startY = a.y + a.height / 2;
    const endX = b.x;
    const endY = b.y + b.height / 2;
    const mid = Math.max(40, (endX - startX) / 2);
    path.setAttribute("d", `M ${startX} ${startY} C ${startX + mid} ${startY}, ${endX - mid} ${endY}, ${endX} ${endY}`);
    path.setAttribute("class", `edge ${relation.relation_type.toLowerCase()}`);
    path.setAttribute("marker-end", "url(#arrow)");
    svg.append(path);
  });

  project.layers.forEach((layer) => {
    const layout = project.layouts[layer.layer_id] || { x: 80, y: 80, width: 150, height: 92 };
    const node = createSvgElement("g");
    node.setAttribute("class", `node ${layer.layer_id === state.selectedLayerId ? "active" : ""}`);
    node.setAttribute("transform", `translate(${layout.x}, ${layout.y})`);
    node.dataset.layerId = layer.layer_id;
    node.innerHTML = `
      <rect width="${layout.width}" height="${layout.height}"></rect>
      <text x="12" y="23" font-weight="700">${escapeHtml(layer.layer_name || "(Layer)")}</text>
      <text x="12" y="43">${escapeHtml(layer.step || "-")}</text>
      <text x="12" y="62">${escapeHtml(layer.layer_property || "-")}</text>
      <text x="12" y="81">${escapeHtml(layer.align_name || "-")} / ${escapeHtml(layer.align_side || "-")}</text>
    `;
    node.addEventListener("mousedown", (event) => {
      state.selectedLayerId = layer.layer_id;
      state.drag = { layerId: layer.layer_id, startX: event.clientX, startY: event.clientY, x: layout.x, y: layout.y };
      renderMiniTable();
      renderProperty();
      renderCanvas();
    });
    svg.append(node);
  });
}

function createSvgElement(name) {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
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
  state.selectedLayerId = clone.layers[0].layer_id;
  autoLayoutProject(clone);
  renderAll();
  switchView("editor");
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
});
document.querySelector("#saveProject").addEventListener("click", () => touch(ensureProject(), "Project saved"));
document.querySelector("#autoLayout").addEventListener("click", () => {
  autoLayoutProject(ensureProject());
  renderAll();
});
document.querySelector("#exportExcel").addEventListener("click", exportExcel);
document.querySelector("#exportExcelTop").addEventListener("click", exportExcel);
document.querySelector("#exportSvg").addEventListener("click", () => exportSvg("ppt_image"));
document.querySelector("#exportPptTop").addEventListener("click", () => exportSvg("ppt_image"));
document.querySelector("#exportPpt").addEventListener("click", exportPptOutline);

window.addEventListener("mousemove", (event) => {
  if (!state.drag) return;
  const project = currentProject();
  const layout = project.layouts[state.drag.layerId];
  layout.x = Math.max(20, state.drag.x + event.clientX - state.drag.startX);
  layout.y = Math.max(20, state.drag.y + event.clientY - state.drag.startY);
  renderCanvas();
});

window.addEventListener("mouseup", () => {
  if (!state.drag) return;
  touch(ensureProject(), "Node position changed");
  state.drag = null;
});

renderAll();
