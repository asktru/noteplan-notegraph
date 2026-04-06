// asktru.NoteGraph — script.js
// Interactive graph visualization of note connections

var PLUGIN_ID = 'asktru.NoteGraph';
var WINDOW_ID = 'asktru.NoteGraph.dashboard';

function getSettings() {
  var s = DataStore.settings || {};
  var excl = (s.foldersToExclude || '@Archive, @Trash, @Templates').split(',').map(function(f) { return f.trim(); }).filter(Boolean);
  return { foldersToExclude: excl, lastSelectedNote: s.lastSelectedNote || '' };
}

function saveLastSelected(filename) {
  var s = DataStore.settings || {};
  s.lastSelectedNote = filename || '';
  DataStore.settings = s;
}

// ============================================
// UTILITIES
// ============================================

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function npColor(c) {
  if (!c) return null;
  if (c.match && c.match(/^#[0-9A-Fa-f]{8}$/)) return '#' + c.slice(3, 9) + c.slice(1, 3);
  return c;
}

function isLightTheme() {
  try {
    var theme = Editor.currentTheme;
    if (!theme) return false;
    if (theme.mode === 'light') return true;
    if (theme.mode === 'dark') return false;
  } catch (e) {}
  return false;
}

function getThemeCSS() {
  try {
    var theme = Editor.currentTheme;
    if (!theme) return '';
    var vals = theme.values || {};
    var editor = vals.editor || {};
    var styles = [];
    var bg = npColor(editor.backgroundColor);
    var altBg = npColor(editor.altBackgroundColor);
    var text = npColor(editor.textColor);
    var tint = npColor(editor.tintColor);
    if (bg) styles.push('--bg-main-color: ' + bg);
    if (altBg) styles.push('--bg-alt-color: ' + altBg);
    if (text) styles.push('--fg-main-color: ' + text);
    if (tint) styles.push('--tint-color: ' + tint);
    if (styles.length > 0) return ':root { ' + styles.join('; ') + '; }';
  } catch (e) {}
  return '';
}

// ============================================
// FRONTMATTER
// ============================================

function parseFrontmatter(content) {
  if (!content) return { frontmatter: {}, body: content || '' };
  var lines = content.split('\n');
  if (lines[0].trim() !== '---') return { frontmatter: {}, body: content };
  var endIdx = -1;
  for (var i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { endIdx = i; break; }
  }
  if (endIdx < 0) return { frontmatter: {}, body: content };
  var fm = {};
  for (var j = 1; j < endIdx; j++) {
    var colonIdx = lines[j].indexOf(':');
    if (colonIdx < 0) continue;
    var key = lines[j].substring(0, colonIdx).trim();
    var val = lines[j].substring(colonIdx + 1).trim();
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"')))
      val = val.substring(1, val.length - 1);
    fm[key] = val;
  }
  return { frontmatter: fm, body: lines.slice(endIdx + 1).join('\n') };
}

function setFrontmatterKey(note, key, value) {
  var content = note.content || '';
  var lines = content.split('\n');
  if (lines[0].trim() === '---') {
    var endIdx = -1;
    for (var i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') { endIdx = i; break; }
    }
    if (endIdx > 0) {
      var found = false;
      for (var j = 1; j < endIdx; j++) {
        if (lines[j].match(new RegExp('^' + key + '\\s*:'))) {
          lines[j] = key + ': ' + value; found = true; break;
        }
      }
      if (!found) lines.splice(endIdx, 0, key + ': ' + value);
      note.content = lines.join('\n');
      return;
    }
  }
  lines.unshift('---', key + ': ' + value, '---');
  note.content = lines.join('\n');
}

function removeFrontmatterKey(content, key) {
  var lines = content.split('\n');
  if (lines[0].trim() !== '---') return content;
  var endIdx = -1;
  for (var i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { endIdx = i; break; }
  }
  if (endIdx < 0) return content;
  for (var j = 1; j < endIdx; j++) {
    if (lines[j].match(new RegExp('^' + key + '\\s*:'))) {
      lines.splice(j, 1); endIdx--; break;
    }
  }
  var hasContent = false;
  for (var k = 1; k < endIdx; k++) {
    if (lines[k].trim() !== '') { hasContent = true; break; }
  }
  if (!hasContent) {
    lines.splice(0, endIdx + 1);
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  }
  return lines.join('\n');
}

// ============================================
// NOTE SCANNING
// ============================================

function getGraphNotes() {
  var notes = DataStore.projectNotes;
  var result = [];
  for (var i = 0; i < notes.length; i++) {
    var note = notes[i];
    var content = note.content || '';
    if (content.indexOf('graph:') < 0 && content.indexOf('graph :') < 0) continue;
    var fm = parseFrontmatter(content).frontmatter;
    if (fm.graph === 'true' || fm.graph === true) {
      result.push({
        filename: note.filename,
        title: note.title || note.filename.replace(/\.md$/, ''),
        folder: (note.filename || '').replace(/\/[^/]+$/, ''),
      });
    }
  }
  return result;
}

function findNoteByTitle(title) {
  if (!title) return null;
  var notes = DataStore.projectNotes;
  var lowerTitle = title.toLowerCase();
  for (var i = 0; i < notes.length; i++) {
    if ((notes[i].title || '').toLowerCase() === lowerTitle) return notes[i];
  }
  return null;
}

function findNoteByFilename(filename) {
  var notes = DataStore.projectNotes;
  for (var i = 0; i < notes.length; i++) {
    if (notes[i].filename === filename) return notes[i];
  }
  var cal = DataStore.calendarNotes;
  for (var j = 0; j < cal.length; j++) {
    if (cal[j].filename === filename) return cal[j];
  }
  return null;
}

// ============================================
// LINK DISCOVERY — using NotePlan native API
// note.linkedNoteTitles: array of titles this note links to
// note.backlinks: array of ParagraphObjects from notes linking TO this note
// ============================================

function getOutgoingLinks(note) {
  var titles = [];
  try {
    // Native API: note.linkedNoteTitles returns array of linked note titles
    var linked = note.linkedNoteTitles;
    if (linked && linked.length > 0) {
      for (var i = 0; i < linked.length; i++) {
        titles.push(linked[i]);
      }
      return titles;
    }
  } catch (e) {
    console.log('NoteGraph: linkedNoteTitles not available, using regex fallback');
  }

  // Fallback: regex parse [[...]] from content
  var content = note.content || '';
  var regex = /\[\[([^\]]+)\]\]/g;
  var match;
  var seen = {};
  while ((match = regex.exec(content)) !== null) {
    var t = match[1];
    if (!seen[t]) { seen[t] = true; titles.push(t); }
  }
  return titles;
}

function getBacklinks(note) {
  var results = [];
  try {
    // Native API: note.backlinks returns array of ParagraphObjects
    // Each ParagraphObject has .note property pointing to the source note
    var backlinks = note.backlinks;
    if (backlinks && backlinks.length > 0) {
      var seen = {};
      for (var i = 0; i < backlinks.length; i++) {
        var bl = backlinks[i];
        // ParagraphObject may have .note or .filename
        var blNote = bl.note;
        if (blNote && blNote.filename && !seen[blNote.filename]) {
          seen[blNote.filename] = true;
          results.push({
            filename: blNote.filename,
            title: blNote.title || blNote.filename.replace(/\.md$/, ''),
          });
        }
      }
      return results;
    }
  } catch (e) {
    console.log('NoteGraph: backlinks not available, using fallback');
  }

  // Fallback: scan all notes for [[noteTitle]]
  var noteTitle = note.title || '';
  if (!noteTitle) return results;
  var searchStr = '[[' + noteTitle + ']]';
  var allNotes = DataStore.projectNotes;
  for (var j = 0; j < allNotes.length; j++) {
    var n = allNotes[j];
    if (n.filename === note.filename) continue;
    var c = n.content || '';
    if (c.indexOf(searchStr) >= 0) {
      results.push({ filename: n.filename, title: n.title || n.filename.replace(/\.md$/, '') });
    }
  }
  return results;
}

// ============================================
// GRAPH DATA BUILDER
// ============================================

function buildGraphData(graphNotes, selectedFilename, depth, showTags, showMentions) {
  var nodesMap = {};
  var edges = [];
  var edgeSet = {};

  function addNode(filename, title, isGraphNote, isSelected) {
    if (!nodesMap[filename]) {
      nodesMap[filename] = { id: filename, title: title, isGraphNote: isGraphNote, isSelected: isSelected };
    }
    if (isGraphNote) nodesMap[filename].isGraphNote = true;
    if (isSelected) nodesMap[filename].isSelected = true;
  }

  function addEdge(sourceFile, targetFile) {
    var key = sourceFile + '>' + targetFile;
    if (edgeSet[key]) return;
    edgeSet[key] = true;
    edges.push({ source: sourceFile, target: targetFile });
  }

  // Build a lookup for graph notes
  var graphNoteSet = {};
  for (var g = 0; g < graphNotes.length; g++) {
    graphNoteSet[graphNotes[g].filename] = graphNotes[g];
  }

  var notesToProcess = [];
  if (selectedFilename) {
    // Start with only the selected note — other nodes discovered via links
    var selGN = graphNoteSet[selectedFilename];
    addNode(selectedFilename, selGN ? selGN.title : (findNoteByFilename(selectedFilename) || {}).title || selectedFilename, !!selGN, true);
    notesToProcess.push(selectedFilename);
  } else {
    // No selection — show all graph notes
    for (var gn = 0; gn < graphNotes.length; gn++) {
      addNode(graphNotes[gn].filename, graphNotes[gn].title, true, false);
      notesToProcess.push(graphNotes[gn].filename);
    }
  }

  var processed = {};

  function processNoteLinks(filename, currentDepth) {
    if (processed[filename] || currentDepth > depth) return;
    processed[filename] = true;

    var note = findNoteByFilename(filename);
    if (!note) return;

    var outgoing = getOutgoingLinks(note);
    for (var o = 0; o < outgoing.length; o++) {
      var targetNote = findNoteByTitle(outgoing[o]);
      if (targetNote) {
        addNode(targetNote.filename, targetNote.title || outgoing[o], !!graphNoteSet[targetNote.filename], false);
        addEdge(filename, targetNote.filename);
        if (currentDepth < depth) processNoteLinks(targetNote.filename, currentDepth + 1);
      }
    }

    var incoming = getBacklinks(note);
    for (var b = 0; b < incoming.length; b++) {
      addNode(incoming[b].filename, incoming[b].title, !!graphNoteSet[incoming[b].filename], false);
      addEdge(incoming[b].filename, filename);
      if (currentDepth < depth) processNoteLinks(incoming[b].filename, currentDepth + 1);
    }

    // Hashtags
    if (showTags) {
      try {
        var tags = note.hashtags || [];
        for (var ti = 0; ti < tags.length; ti++) {
          var tag = tags[ti];
          if (!tag) continue;
          var tagId = 'tag:#' + tag;
          if (!nodesMap[tagId]) {
            nodesMap[tagId] = { id: tagId, title: '#' + tag, isGraphNote: false, isSelected: false, nodeType: 'tag' };
          }
          addEdge(filename, tagId);
        }
      } catch (te) {}
    }

    // Mentions
    if (showMentions) {
      try {
        var mentions = note.mentions || [];
        for (var mi = 0; mi < mentions.length; mi++) {
          var mention = mentions[mi];
          if (!mention) continue;
          // Skip system mentions
          if (mention.startsWith('done(') || mention.startsWith('review(') || mention.startsWith('reviewed(') ||
              mention.startsWith('repeat(') || mention.startsWith('due(') || mention.startsWith('start(')) continue;
          var mentionId = 'mention:@' + mention;
          if (!nodesMap[mentionId]) {
            nodesMap[mentionId] = { id: mentionId, title: '@' + mention, isGraphNote: false, isSelected: false, nodeType: 'mention' };
          }
          addEdge(filename, mentionId);
        }
      } catch (me) {}
    }
  }

  for (var p = 0; p < notesToProcess.length; p++) processNoteLinks(notesToProcess[p], 1);

  var nodes = [];
  for (var nk in nodesMap) nodes.push(nodesMap[nk]);
  return { nodes: nodes, edges: edges };
}

// ============================================
// HTML GENERATION
// ============================================

function buildLeftSidebar(graphNotes, selectedFilename) {
  var html = '<div class="ng-sidebar" id="ngSidebar">';
  html += '<div class="ng-sidebar-header"><span class="ng-sidebar-title">Graph Notes</span></div>';
  html += '<div class="ng-sidebar-list">';
  if (graphNotes.length === 0) {
    html += '<div class="ng-sidebar-empty">No notes added.<br>Use /Add or remove note from graph</div>';
  }
  for (var i = 0; i < graphNotes.length; i++) {
    var n = graphNotes[i];
    var active = n.filename === selectedFilename ? ' active' : '';
    html += '<button class="ng-sidebar-item' + active + '" data-action="selectNote" data-filename="' + esc(n.filename) + '">';
    html += '<span class="ng-item-title">' + esc(n.title) + '</span>';
    html += '<span class="ng-item-folder">' + esc(n.folder) + '</span>';
    html += '</button>';
  }
  html += '</div></div>';
  return html;
}

function buildGraphArea() {
  var html = '<div class="ng-graph-area">';
  html += '<div class="ng-toolbar">';
  html += '<div class="ng-depth-btns">';
  html += '<button class="ng-depth-btn active" data-depth="1">1-level</button>';
  html += '<button class="ng-depth-btn" data-depth="2">2-level</button>';
  html += '<button class="ng-depth-btn" data-depth="3">3-level</button>';
  html += '</div>';
  html += '<div class="ng-toggle-btns">';
  html += '<button class="ng-toggle-btn" data-toggle="tags"><i class="fa-solid fa-hashtag"></i></button>';
  html += '<button class="ng-toggle-btn" data-toggle="mentions"><i class="fa-solid fa-at"></i></button>';
  html += '</div>';
  html += '<div class="ng-zoom-btns">';
  html += '<button class="ng-zoom-btn" data-zoom="in"><i class="fa-solid fa-plus"></i></button>';
  html += '<button class="ng-zoom-btn" data-zoom="out"><i class="fa-solid fa-minus"></i></button>';
  html += '<button class="ng-zoom-btn" data-zoom="fit"><i class="fa-solid fa-expand"></i></button>';
  html += '</div>';
  html += '</div>';
  html += '<div class="ng-canvas-wrap" id="ngCanvasWrap"><svg id="ngSVG"></svg></div>';
  html += '</div>';
  return html;
}

function getInlineCSS() {
  return '\n' +
':root, [data-theme="dark"] {\n' +
'  --ng-bg: var(--bg-main-color, #1a1a2e);\n' +
'  --ng-bg-card: var(--bg-alt-color, #16213e);\n' +
'  --ng-bg-elevated: color-mix(in srgb, var(--ng-bg-card) 85%, white 15%);\n' +
'  --ng-text: var(--fg-main-color, #e0e0e0);\n' +
'  --ng-text-muted: color-mix(in srgb, var(--ng-text) 55%, transparent);\n' +
'  --ng-text-faint: color-mix(in srgb, var(--ng-text) 35%, transparent);\n' +
'  --ng-accent: var(--tint-color, #8B5CF6);\n' +
'  --ng-accent-soft: color-mix(in srgb, var(--ng-accent) 15%, transparent);\n' +
'  --ng-border: color-mix(in srgb, var(--ng-text) 10%, transparent);\n' +
'  --ng-border-strong: color-mix(in srgb, var(--ng-text) 18%, transparent);\n' +
'  --ng-node-fill: var(--ng-bg-card);\n' +
'  --ng-node-stroke: var(--ng-border-strong);\n' +
'  --ng-node-selected: var(--ng-accent);\n' +
'  --ng-node-graph: color-mix(in srgb, var(--ng-accent) 20%, var(--ng-bg-card));\n' +
'  --ng-edge-color: color-mix(in srgb, var(--ng-text) 20%, transparent);\n' +
'  --ng-radius: 8px;\n' +
'}\n' +
'[data-theme="light"] {\n' +
'  --ng-bg-elevated: color-mix(in srgb, var(--ng-bg-card) 92%, black 8%);\n' +
'  --ng-text-muted: color-mix(in srgb, var(--ng-text) 60%, transparent);\n' +
'  --ng-text-faint: color-mix(in srgb, var(--ng-text) 40%, transparent);\n' +
'}\n' +
'* { box-sizing: border-box; margin: 0; padding: 0; }\n' +
'body { font-family: -apple-system, system-ui, sans-serif; background: var(--ng-bg); color: var(--ng-text); font-size: 13px; overflow: hidden; height: 100vh; }\n' +
'.ng-layout { display: flex; height: 100vh; }\n' +
'.ng-sidebar { width: 200px; flex-shrink: 0; background: var(--ng-bg-card); border-right: 1px solid var(--ng-border); display: flex; flex-direction: column; }\n' +
'.ng-sidebar-header { padding: 12px 12px 8px; border-bottom: 1px solid var(--ng-border); }\n' +
'.ng-sidebar-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ng-text-faint); }\n' +
'.ng-sidebar-list { flex: 1; overflow-y: auto; padding: 4px; }\n' +
'.ng-sidebar-empty { padding: 16px 12px; font-size: 11px; text-align: center; color: var(--ng-text-faint); line-height: 1.6; }\n' +
'.ng-sidebar-item { display: block; width: 100%; text-align: left; padding: 7px 10px; border: none; background: transparent; border-radius: 6px; cursor: pointer; }\n' +
'.ng-sidebar-item:hover { background: var(--ng-border); }\n' +
'.ng-sidebar-item.active { background: var(--ng-accent-soft); }\n' +
'.ng-item-title { display: block; font-size: 12px; font-weight: 600; color: var(--ng-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n' +
'.ng-sidebar-item.active .ng-item-title { color: var(--ng-accent); }\n' +
'.ng-item-folder { display: block; font-size: 10px; color: var(--ng-text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n' +
'.ng-graph-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }\n' +
'.ng-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--ng-border); }\n' +
'.ng-depth-btns, .ng-zoom-btns { display: flex; gap: 4px; }\n' +
'.ng-depth-btn { padding: 4px 12px; font-size: 11px; font-weight: 500; border-radius: 100px; border: none; background: transparent; color: var(--ng-text-muted); cursor: pointer; }\n' +
'.ng-depth-btn:hover { background: var(--ng-border); color: var(--ng-text); }\n' +
'.ng-depth-btn.active { background: var(--ng-accent-soft); color: var(--ng-accent); font-weight: 600; }\n' +
'.ng-toggle-btns { display: flex; gap: 4px; }\n' +
'.ng-toggle-btn { width: 28px; height: 28px; border-radius: 6px; border: none; background: transparent; color: var(--ng-text-faint); cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; }\n' +
'.ng-toggle-btn:hover { background: var(--ng-border); color: var(--ng-text); }\n' +
'.ng-toggle-btn.active { background: var(--ng-accent-soft); color: var(--ng-accent); }\n' +
'.ng-zoom-btn { width: 28px; height: 28px; border-radius: 6px; border: none; background: transparent; color: var(--ng-text-muted); cursor: pointer; font-size: 11px; display: flex; align-items: center; justify-content: center; }\n' +
'.ng-zoom-btn:hover { background: var(--ng-border); color: var(--ng-text); }\n' +
'.ng-canvas-wrap { flex: 1; position: relative; overflow: hidden; }\n' +
'#ngSVG { width: 100%; height: 100%; }\n' +
'.ng-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%) translateY(60px); padding: 10px 20px; border-radius: 6px; background: var(--ng-bg-elevated); color: var(--ng-text); border: 1px solid var(--ng-border); font-size: 13px; opacity: 0; transition: all 0.3s; z-index: 200; pointer-events: none; }\n' +
'.ng-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }\n' +
'@media (max-width: 700px) { .ng-sidebar { display: none; } }\n';
}

function buildFullHTML(bodyContent, graphDataJSON) {
  var themeCSS = getThemeCSS();
  var pluginCSS = getInlineCSS();
  var themeAttr = isLightTheme() ? 'light' : 'dark';
  var faLinks = '\n    <link href="../np.Shared/fontawesome.css" rel="stylesheet">\n' +
    '    <link href="../np.Shared/regular.min.flat4NP.css" rel="stylesheet">\n' +
    '    <link href="../np.Shared/solid.min.flat4NP.css" rel="stylesheet">\n';

  return '<!DOCTYPE html>\n<html data-theme="' + themeAttr + '">\n<head>\n' +
    '  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '  <title>Note Graph</title>\n' + faLinks +
    '  <style>' + themeCSS + '\n' + pluginCSS + '</style>\n' +
    '</head>\n<body>\n' + bodyContent + '\n' +
    '  <div class="ng-toast" id="ngToast"></div>\n' +
    '  <script>var receivingPluginID="asktru.NoteGraph";\nvar GRAPH_DATA=' + graphDataJSON + ';\n<\/script>\n' +
    '  <script type="text/javascript" src="graphEvents.js"><\/script>\n' +
    '  <script type="text/javascript" src="../np.Shared/pluginToHTMLCommsBridge.js"><\/script>\n' +
    '</body>\n</html>';
}

// ============================================
// MAIN ENTRY
// ============================================

async function showNoteGraph(selectedFilename) {
  try {
    CommandBar.showLoading(true, 'Building graph...');
    await CommandBar.onAsyncThread();

    var config = getSettings();
    var graphNotes = getGraphNotes();
    var filename = selectedFilename || config.lastSelectedNote || '';
    if (!filename && graphNotes.length > 0) filename = graphNotes[0].filename;
    if (filename) saveLastSelected(filename);

    // Pre-build all depth × tags × mentions combinations
    var allData = {};
    var depths = [1, 2, 3];
    var toggleCombos = [
      { tags: false, mentions: false, key: 'nn' },
      { tags: true, mentions: false, key: 'tn' },
      { tags: false, mentions: true, key: 'nm' },
      { tags: true, mentions: true, key: 'tm' },
    ];
    for (var di = 0; di < depths.length; di++) {
      for (var ci = 0; ci < toggleCombos.length; ci++) {
        var combo = toggleCombos[ci];
        var dataKey = 'd' + depths[di] + '_' + combo.key;
        allData[dataKey] = buildGraphData(graphNotes, filename, depths[di], combo.tags, combo.mentions);
      }
    }
    allData.selectedFilename = filename;
    var graphDataJSON = JSON.stringify(allData);

    var bodyHTML = '<div class="ng-layout">';
    bodyHTML += buildLeftSidebar(graphNotes, filename);
    bodyHTML += buildGraphArea();
    bodyHTML += '</div>';

    var fullHTML = buildFullHTML(bodyHTML, graphDataJSON);

    await CommandBar.onMainThread();
    CommandBar.showLoading(false);

    var winOptions = {
      customId: WINDOW_ID,
      savedFilename: '../../asktru.NoteGraph/note_graph.html',
      shouldFocus: true, reuseUsersWindowRect: true,
      headerBGColor: 'transparent', autoTopPadding: true,
      showReloadButton: true, reloadPluginID: PLUGIN_ID, reloadCommandName: 'Note Graph',
      icon: 'fa-diagram-project', iconColor: '#8B5CF6',
    };

    var result = await HTMLView.showInMainWindow(fullHTML, 'Note Graph', winOptions);
    if (!result || !result.success) await HTMLView.showWindowWithOptions(fullHTML, 'Note Graph', winOptions);
  } catch (err) {
    CommandBar.showLoading(false);
    console.log('NoteGraph error: ' + String(err));
  }
}

async function refreshNoteGraph() { await showNoteGraph(); }

async function sendToHTMLWindow(windowId, type, data) {
  try {
    if (typeof HTMLView === 'undefined' || typeof HTMLView.runJavaScript !== 'function') return;
    var payload = {};
    var keys = Object.keys(data);
    for (var k = 0; k < keys.length; k++) payload[keys[k]] = data[keys[k]];
    payload.NPWindowID = windowId;
    var s = JSON.stringify(payload);
    var ds = JSON.stringify(s);
    await HTMLView.runJavaScript('(function(){try{var p=JSON.parse(' + ds + ');window.postMessage({type:"' + type + '",payload:p},"*")}catch(e){}})();', windowId);
  } catch (err) {}
}

async function onMessageFromHTMLView(actionType, data) {
  try {
    var msg = typeof data === 'string' ? JSON.parse(data) : data;

    switch (actionType) {
      case 'selectNote':
        if (msg.filename) {
          saveLastSelected(msg.filename);
          await showNoteGraph(msg.filename);
        }
        break;

      case 'openNote':
        if (msg.title) {
          await CommandBar.onMainThread();
          NotePlan.openURL('noteplan://x-callback-url/openNote?noteTitle=' + encodeURIComponent(msg.title) + '&splitView=yes&reuseSplitView=yes');
        }
        break;

      default:
        console.log('NoteGraph: unknown action: ' + actionType);
    }
  } catch (err) {
    console.log('NoteGraph onMessage error: ' + String(err));
  }
}

// ============================================
// SLASH COMMAND
// ============================================

async function toggleGraphCommand() {
  var note = Editor.note;
  if (!note) { await CommandBar.prompt('No note open', 'Open a note first.'); return; }
  var content = note.content || '';
  var fm = parseFrontmatter(content).frontmatter;
  if (fm.graph === 'true' || fm.graph === true) {
    note.content = removeFrontmatterKey(content, 'graph');
    DataStore.updateCache(note, true);
    await Editor.openNoteByFilename(note.filename);
    await CommandBar.prompt('Removed', 'Note removed from Note Graph.');
  } else {
    setFrontmatterKey(note, 'graph', 'true');
    DataStore.updateCache(note, true);
    await showNoteGraph(note.filename);
  }
}

// ============================================
// EXPORTS
// ============================================

globalThis.showNoteGraph = showNoteGraph;
globalThis.onMessageFromHTMLView = onMessageFromHTMLView;
globalThis.refreshNoteGraph = refreshNoteGraph;
globalThis.toggleGraphCommand = toggleGraphCommand;
