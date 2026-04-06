// asktru.NoteGraph — graphEvents.js
// Force-directed graph simulation and SVG rendering

/* global sendMessageToPlugin, GRAPH_DATA */

var NS = 'http://www.w3.org/2000/svg';
var currentDepth = 1;
var showTags = false;
var showMentions = false;
var currentZoom = 1;
var nodes = [];
var edges = [];
var nodeMap = {};
var alpha = 1.0;
var animFrameId = null;
var dragNode = null;
var dragOffsetX = 0;
var dragOffsetY = 0;
var didDrag = false;
var svgEl = null;
var canvasW = 800;
var canvasH = 600;

// Force parameters
var K_REPEL = 8000;
var K_ATTRACT = 0.008;
var REST_LENGTH = 140;
var K_CENTER = 0.003;
var DAMPING = 0.88;
var MIN_ALPHA = 0.005;

// ============================================
// PLUGIN MESSAGE HANDLER
// ============================================

function onMessageFromPlugin(type, data) {
  switch (type) {
    case 'FULL_REFRESH':
      window.location.reload();
      break;
    case 'SHOW_TOAST':
      showToast(data.message);
      break;
  }
}

function showToast(msg) {
  var t = document.getElementById('ngToast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 2000);
}

// ============================================
// FORCE SIMULATION
// ============================================

function initGraph(data) {
  nodes = [];
  edges = [];
  nodeMap = {};

  var wrap = document.getElementById('ngCanvasWrap');
  if (wrap) {
    canvasW = wrap.clientWidth || 800;
    canvasH = wrap.clientHeight || 600;
  }

  var cx = canvasW / 2;
  var cy = canvasH / 2;

  for (var i = 0; i < data.nodes.length; i++) {
    var n = data.nodes[i];
    var angle = (i / data.nodes.length) * Math.PI * 2;
    var radius = Math.min(canvasW, canvasH) * 0.3;
    var node = {
      id: n.id,
      title: n.title || '',
      isGraphNote: n.isGraphNote,
      isSelected: n.isSelected,
      nodeType: n.nodeType || 'note',
      x: cx + Math.cos(angle) * radius + (Math.random() - 0.5) * 40,
      y: cy + Math.sin(angle) * radius + (Math.random() - 0.5) * 40,
      vx: 0,
      vy: 0,
      fixed: false,
    };
    // Selected node starts at center
    if (n.isSelected) { node.x = cx; node.y = cy; }
    nodes.push(node);
    nodeMap[n.id] = node;
  }

  for (var e = 0; e < data.edges.length; e++) {
    var edge = data.edges[e];
    if (nodeMap[edge.source] && nodeMap[edge.target]) {
      edges.push({ source: nodeMap[edge.source], target: nodeMap[edge.target] });
    }
  }

  alpha = 1.0;
  createSVGElements();
  startSimulation();
}

function tick() {
  // Repulsion between all pairs
  for (var i = 0; i < nodes.length; i++) {
    for (var j = i + 1; j < nodes.length; j++) {
      var dx = nodes[j].x - nodes[i].x;
      var dy = nodes[j].y - nodes[i].y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) dist = 1;
      var force = K_REPEL / (dist * dist);
      var fx = (dx / dist) * force;
      var fy = (dy / dist) * force;
      if (!nodes[i].fixed) { nodes[i].vx -= fx; nodes[i].vy -= fy; }
      if (!nodes[j].fixed) { nodes[j].vx += fx; nodes[j].vy += fy; }
    }
  }

  // Attraction along edges
  for (var e = 0; e < edges.length; e++) {
    var s = edges[e].source;
    var t = edges[e].target;
    var edx = t.x - s.x;
    var edy = t.y - s.y;
    var edist = Math.sqrt(edx * edx + edy * edy);
    if (edist < 1) edist = 1;
    // Tag/mention nodes have shorter rest length (stay closer to parent)
    var isMeta = (s.nodeType === 'tag' || s.nodeType === 'mention' || t.nodeType === 'tag' || t.nodeType === 'mention');
    var restLen = isMeta ? 80 : REST_LENGTH;
    var attractK = isMeta ? K_ATTRACT * 2 : K_ATTRACT;
    var eforce = attractK * (edist - restLen);
    var efx = (edx / edist) * eforce;
    var efy = (edy / edist) * eforce;
    if (!s.fixed) { s.vx += efx; s.vy += efy; }
    if (!t.fixed) { t.vx -= efx; t.vy -= efy; }
  }

  // Centering
  var cx = canvasW / 2;
  var cy = canvasH / 2;
  for (var c = 0; c < nodes.length; c++) {
    if (nodes[c].fixed) continue;
    nodes[c].vx += (cx - nodes[c].x) * K_CENTER;
    nodes[c].vy += (cy - nodes[c].y) * K_CENTER;
  }

  // Update positions
  for (var u = 0; u < nodes.length; u++) {
    if (nodes[u].fixed) continue;
    nodes[u].vx *= DAMPING;
    nodes[u].vy *= DAMPING;
    nodes[u].x += nodes[u].vx * alpha;
    nodes[u].y += nodes[u].vy * alpha;
    // Boundary
    var pad = 60;
    nodes[u].x = Math.max(pad, Math.min(canvasW - pad, nodes[u].x));
    nodes[u].y = Math.max(pad, Math.min(canvasH - pad, nodes[u].y));
  }

  alpha *= 0.995;
  renderSVG();

  if (alpha > MIN_ALPHA) {
    animFrameId = requestAnimationFrame(tick);
  }
}

function startSimulation() {
  if (animFrameId) cancelAnimationFrame(animFrameId);
  animFrameId = requestAnimationFrame(tick);
}

function reheat() {
  alpha = Math.max(alpha, 0.3);
  startSimulation();
}

// ============================================
// SVG RENDERING
// ============================================

function getComputedColor(varName, fallback) {
  var style = getComputedStyle(document.documentElement);
  var val = style.getPropertyValue(varName).trim();
  return val || fallback;
}

function createSVGElements() {
  svgEl = document.getElementById('ngSVG');
  if (!svgEl) return;
  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

  svgEl.setAttribute('viewBox', '0 0 ' + canvasW + ' ' + canvasH);

  // Resolve CSS colors for SVG (SVG doesn't reliably inherit CSS custom properties)
  var nodeFill = getComputedColor('--ng-bg-card', '#16213e');
  var nodeStroke = getComputedColor('--ng-border-strong', '#333');
  var accentColor = getComputedColor('--ng-accent', '#8B5CF6');
  var textColor = getComputedColor('--ng-text', '#e0e0e0');
  var textMuted = getComputedColor('--ng-text-muted', '#888');
  var edgeColor = getComputedColor('--ng-text-faint', '#555');
  var tagColor = '#F97316'; // orange for tags
  var mentionColor = '#3B82F6'; // blue for mentions

  // Edges group
  var edgeGroup = document.createElementNS(NS, 'g');
  edgeGroup.id = 'ngEdges';
  for (var e = 0; e < edges.length; e++) {
    var line = document.createElementNS(NS, 'line');
    line.setAttribute('stroke', edgeColor);
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-opacity', '0.4');
    edgeGroup.appendChild(line);
  }
  svgEl.appendChild(edgeGroup);

  // Nodes group
  var nodeGroup = document.createElementNS(NS, 'g');
  nodeGroup.id = 'ngNodes';
  for (var n = 0; n < nodes.length; n++) {
    var nd = nodes[n];
    var g = document.createElementNS(NS, 'g');
    g.dataset.nodeId = nd.id;
    g.dataset.title = nd.title;
    g.style.cursor = 'grab';

    var isTag = nd.nodeType === 'tag';
    var isMention = nd.nodeType === 'mention';
    var isMetaNode = isTag || isMention;

    var rect = document.createElementNS(NS, 'rect');
    var titleLen = Math.min(nd.title.length, 25);
    var rectW = isMetaNode ? Math.max(titleLen * 6.5 + 14, 50) : Math.max(titleLen * 7 + 20, 60);
    var rectH = isMetaNode ? 22 : 28;
    rect.setAttribute('x', -rectW / 2);
    rect.setAttribute('y', -rectH / 2);
    rect.setAttribute('width', rectW);
    rect.setAttribute('height', rectH);
    rect.setAttribute('rx', isMetaNode ? '11' : '8');

    if (isTag) {
      rect.setAttribute('fill', 'transparent');
      rect.setAttribute('stroke', tagColor);
      rect.setAttribute('stroke-width', '1.5');
      rect.setAttribute('stroke-dasharray', '4 2');
    } else if (isMention) {
      rect.setAttribute('fill', 'transparent');
      rect.setAttribute('stroke', mentionColor);
      rect.setAttribute('stroke-width', '1.5');
      rect.setAttribute('stroke-dasharray', '4 2');
    } else if (nd.isSelected) {
      rect.setAttribute('fill', nodeFill);
      rect.setAttribute('stroke', accentColor);
      rect.setAttribute('stroke-width', '2.5');
    } else if (nd.isGraphNote) {
      rect.setAttribute('fill', nodeFill);
      rect.setAttribute('stroke', accentColor);
      rect.setAttribute('stroke-width', '1.5');
      rect.setAttribute('stroke-opacity', '0.6');
    } else {
      rect.setAttribute('fill', nodeFill);
      rect.setAttribute('stroke', nodeStroke);
      rect.setAttribute('stroke-width', '1');
    }
    g.appendChild(rect);

    var text = document.createElementNS(NS, 'text');
    var displayTitle = nd.title.length > 25 ? nd.title.substring(0, 23) + '...' : nd.title;
    text.textContent = displayTitle;
    var textFill = isTag ? tagColor : isMention ? mentionColor : nd.isSelected ? accentColor : textColor;
    text.setAttribute('fill', textFill);
    text.setAttribute('font-size', isMetaNode ? '10' : '11');
    text.setAttribute('font-weight', nd.isSelected ? '700' : isMetaNode ? '600' : '500');
    text.setAttribute('font-family', '-apple-system, system-ui, sans-serif');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.style.pointerEvents = 'none';
    g.appendChild(text);

    var titleEl = document.createElementNS(NS, 'title');
    titleEl.textContent = nd.title;
    g.appendChild(titleEl);

    nodeGroup.appendChild(g);
  }
  svgEl.appendChild(nodeGroup);
}

function renderSVG() {
  // Update edge positions
  var edgeEls = document.querySelectorAll('#ngEdges line');
  for (var e = 0; e < edges.length && e < edgeEls.length; e++) {
    edgeEls[e].setAttribute('x1', edges[e].source.x);
    edgeEls[e].setAttribute('y1', edges[e].source.y);
    edgeEls[e].setAttribute('x2', edges[e].target.x);
    edgeEls[e].setAttribute('y2', edges[e].target.y);
  }

  // Update node positions
  var nodeEls = document.querySelectorAll('#ngNodes g');
  for (var n = 0; n < nodes.length && n < nodeEls.length; n++) {
    nodeEls[n].setAttribute('transform', 'translate(' + nodes[n].x + ',' + nodes[n].y + ')');
  }
}

// ============================================
// DRAG INTERACTION
// ============================================

function getSVGPoint(e) {
  var wrap = document.getElementById('ngCanvasWrap');
  var rect = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0 };
  return {
    x: (e.clientX - rect.left) / currentZoom,
    y: (e.clientY - rect.top) / currentZoom,
  };
}

function onNodeMouseDown(e) {
  var g = e.target.closest('g[data-node-id]');
  if (!g) return;
  e.preventDefault();
  var nodeId = g.dataset.nodeId;
  dragNode = nodeMap[nodeId];
  if (!dragNode) return;
  dragNode.fixed = true;
  didDrag = false;
  var pt = getSVGPoint(e);
  dragOffsetX = dragNode.x - pt.x;
  dragOffsetY = dragNode.y - pt.y;
  g.style.cursor = 'grabbing';
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}

function onDragMove(e) {
  if (!dragNode) return;
  didDrag = true;
  var pt = getSVGPoint(e);
  dragNode.x = pt.x + dragOffsetX;
  dragNode.y = pt.y + dragOffsetY;
  dragNode.vx = 0;
  dragNode.vy = 0;
  reheat();
}

function onDragEnd(e) {
  if (dragNode) {
    dragNode.fixed = false;
    var g = document.querySelector('g[data-node-id="' + dragNode.id + '"]');
    if (g) g.style.cursor = 'grab';
    dragNode = null;
  }
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  // Reset didDrag after a short delay so the click event (which fires after mouseup) can check it
  setTimeout(function() { didDrag = false; }, 50);
}

// ============================================
// ZOOM
// ============================================

function setZoom(level) {
  currentZoom = Math.max(0.3, Math.min(3, level));
  var svg = document.getElementById('ngSVG');
  if (svg) svg.style.transform = 'scale(' + currentZoom + ')';
  if (svg) svg.style.transformOrigin = 'center center';
}

function fitZoom() {
  currentZoom = 1;
  var svg = document.getElementById('ngSVG');
  if (svg) svg.style.transform = '';
}

// ============================================
// DEPTH SWITCHING
// ============================================

function getDataKey() {
  var toggleKey = (showTags ? 't' : 'n') + (showMentions ? 'm' : 'n');
  return 'd' + currentDepth + '_' + toggleKey;
}

function reloadGraph() {
  var key = getDataKey();
  var data = GRAPH_DATA[key];
  if (data) initGraph(data);
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', function() {
  // Restore saved prefs
  if (typeof SAVED_PREFS !== 'undefined' && SAVED_PREFS) {
    currentDepth = SAVED_PREFS.depth || 1;
    showTags = !!SAVED_PREFS.showTags;
    showMentions = !!SAVED_PREFS.showMentions;
  }

  // Initialize graph with saved settings
  var initialKey = getDataKey();
  var initialData = GRAPH_DATA[initialKey] || { nodes: [], edges: [] };
  initGraph(initialData);

  // Event delegation
  document.body.addEventListener('click', function(e) {
    // Depth buttons
    var depthBtn = e.target.closest('.ng-depth-btn');
    if (depthBtn) {
      document.querySelectorAll('.ng-depth-btn').forEach(function(b) { b.classList.remove('active'); });
      depthBtn.classList.add('active');
      currentDepth = parseInt(depthBtn.dataset.depth) || 1;
      reloadGraph();
      sendMessageToPlugin('savePrefs', JSON.stringify({ depth: currentDepth, showTags: showTags, showMentions: showMentions }));
      return;
    }

    // Toggle buttons (tags/mentions)
    var toggleBtn = e.target.closest('.ng-toggle-btn');
    if (toggleBtn) {
      var toggle = toggleBtn.dataset.toggle;
      if (toggle === 'tags') showTags = !showTags;
      if (toggle === 'mentions') showMentions = !showMentions;
      toggleBtn.classList.toggle('active');
      reloadGraph();
      sendMessageToPlugin('savePrefs', JSON.stringify({ depth: currentDepth, showTags: showTags, showMentions: showMentions }));
      return;
    }

    // Zoom buttons
    var zoomBtn = e.target.closest('.ng-zoom-btn');
    if (zoomBtn) {
      var z = zoomBtn.dataset.zoom;
      if (z === 'in') setZoom(currentZoom * 1.2);
      else if (z === 'out') setZoom(currentZoom / 1.2);
      else if (z === 'fit') fitZoom();
      return;
    }

    // Sidebar items
    var sidebarItem = e.target.closest('.ng-sidebar-item');
    if (sidebarItem) {
      sendMessageToPlugin('selectNote', JSON.stringify({ filename: sidebarItem.dataset.filename }));
      return;
    }

    // Node click (only if not a drag)
    var nodeG = e.target.closest('g[data-node-id]');
    if (nodeG && !dragNode && !didDrag) {
      var nodeId = nodeG.dataset.nodeId || '';
      var nodeTitle = nodeG.dataset.title || '';
      if (nodeId.startsWith('tag:') || nodeId.startsWith('mention:')) {
        // Tags/mentions: open NotePlan's tag filter
        sendMessageToPlugin('openTag', JSON.stringify({ name: nodeTitle }));
      } else {
        sendMessageToPlugin('openNote', JSON.stringify({ title: nodeTitle }));
      }
      return;
    }
  });

  // Node drag
  var svg = document.getElementById('ngSVG');
  if (svg) {
    svg.addEventListener('mousedown', onNodeMouseDown);
  }

  // Scroll wheel zoom
  var wrap = document.getElementById('ngCanvasWrap');
  if (wrap) {
    wrap.addEventListener('wheel', function(e) {
      e.preventDefault();
      var delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(currentZoom * delta);
    }, { passive: false });
  }

  // Resize handler
  window.addEventListener('resize', function() {
    var w = document.getElementById('ngCanvasWrap');
    if (w) {
      canvasW = w.clientWidth || 800;
      canvasH = w.clientHeight || 600;
      var s = document.getElementById('ngSVG');
      if (s) s.setAttribute('viewBox', '0 0 ' + canvasW + ' ' + canvasH);
      reheat();
    }
  });
});
