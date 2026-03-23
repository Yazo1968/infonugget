import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { htmlToMarkdown } from '../utils/markdown';
import { marked } from 'marked';
import { sanitizeHtml } from '../utils/sanitize';

interface UseDocumentEditingDeps {
  editorRef: React.RefObject<HTMLDivElement | null>;
  editorObserverRef: React.MutableRefObject<MutationObserver | null>;
  initialContent: string;
  onSave: (markdown: string) => void;
  closeFindBar: () => void;
  clearFindHighlights: () => void;
}

export interface EditorHeading {
  id: string;
  text: string;
  level: number;
  selected: boolean;
}

export function useDocumentEditing({
  editorRef,
  editorObserverRef,
  initialContent,
  onSave,
  closeFindBar,
  clearFindHighlights,
}: UseDocumentEditingDeps) {
  const [isDirty, setIsDirty] = useState(false);
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set<string>());
  const [headings, setHeadings] = useState<EditorHeading[]>([]);
  const suppressDirtyRef = useRef(false);
  const initialContentRef = useRef(initialContent);

  // ── Custom undo/redo stack (captures ALL changes including promote/demote) ──
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const isUndoRedoing = useRef(false);
  const lastSnapshotRef = useRef<string>('');
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Snapshot helpers for custom undo/redo ──
  const pushUndo = useCallback(() => {
    if (!editorRef.current || isUndoRedoing.current) return;
    const html = editorRef.current.innerHTML;
    if (html === lastSnapshotRef.current) return; // no change
    undoStack.current.push(lastSnapshotRef.current);
    redoStack.current = []; // clear redo on new action
    lastSnapshotRef.current = html;
    // Cap stack size
    if (undoStack.current.length > 200) undoStack.current.shift();
  }, [editorRef]);

  /** Flush any pending debounced snapshot, then unconditionally push the
   *  current editor state onto the undo stack so it can be restored later.
   *  Use this BEFORE programmatic DOM mutations (promote/demote/reorder)
   *  where pushUndo() would skip because innerHTML hasn't changed yet. */
  const snapshotBeforeChange = useCallback(() => {
    if (!editorRef.current || isUndoRedoing.current) return;
    // Flush pending debounced snapshot so it doesn't fire after our change
    if (snapshotTimerRef.current) {
      clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
    }
    // First, capture any pending typing changes that haven't been snapshotted
    const html = editorRef.current.innerHTML;
    if (html !== lastSnapshotRef.current) {
      // There were unsaved typing changes — push the old snapshot first
      undoStack.current.push(lastSnapshotRef.current);
      if (undoStack.current.length > 200) undoStack.current.shift();
      lastSnapshotRef.current = html;
    }
    // Now push the current state as the undo point for the upcoming change
    undoStack.current.push(lastSnapshotRef.current);
    redoStack.current = [];
    if (undoStack.current.length > 200) undoStack.current.shift();
  }, [editorRef]);

  // Parse headings helper (used by undo/redo to reparse after innerHTML swap)
  const parseHeadingsInner = useCallback(() => {
    if (!editorRef.current) return;
    const els = editorRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6');
    setHeadings((prev) => {
      const prevMap = new Map(prev.map((h) => [h.id, h.selected]));
      const parsed: EditorHeading[] = [];
      els.forEach((el, index) => {
        if (!el.id) el.id = `doc-h-${index}-${Math.random().toString(36).substr(2, 4)}`;
        parsed.push({
          id: el.id,
          text: el.textContent || '',
          level: parseInt(el.tagName.substring(1)),
          selected: prevMap.get(el.id) ?? false,
        });
      });
      // Skip update if headings haven't changed (avoids unnecessary re-renders)
      if (prev.length === parsed.length &&
          prev.every((h, i) => h.id === parsed[i].id && h.text === parsed[i].text && h.level === parsed[i].level)) {
        return prev;
      }
      return parsed;
    });
  }, [editorRef]);

  const undo = useCallback(() => {
    if (!editorRef.current || undoStack.current.length === 0) return;
    isUndoRedoing.current = true;
    suppressDirtyRef.current = true;
    // Save current state for redo
    redoStack.current.push(editorRef.current.innerHTML);
    const prev = undoStack.current.pop()!;
    editorRef.current.innerHTML = sanitizeHtml(prev);
    lastSnapshotRef.current = prev;
    setIsDirty(prev !== sanitizeHtml(marked.parse(initialContentRef.current, { async: false }) as string));
    parseHeadingsInner();
    requestAnimationFrame(() => {
      isUndoRedoing.current = false;
      suppressDirtyRef.current = false;
    });
  }, [editorRef, parseHeadingsInner]);

  const redo = useCallback(() => {
    if (!editorRef.current || redoStack.current.length === 0) return;
    isUndoRedoing.current = true;
    suppressDirtyRef.current = true;
    // Save current state for undo
    undoStack.current.push(editorRef.current.innerHTML);
    const next = redoStack.current.pop()!;
    editorRef.current.innerHTML = sanitizeHtml(next);
    lastSnapshotRef.current = next;
    setIsDirty(next !== sanitizeHtml(marked.parse(initialContentRef.current, { async: false }) as string));
    parseHeadingsInner();
    requestAnimationFrame(() => {
      isUndoRedoing.current = false;
      suppressDirtyRef.current = false;
    });
  }, [editorRef, parseHeadingsInner]);

  // ── Parse headings from editor DOM (preserves selection state) ──
  const parseHeadings = useCallback(() => {
    if (!editorRef.current) return;
    const els = editorRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6');
    setHeadings((prev) => {
      const prevMap = new Map(prev.map((h) => [h.id, h.selected]));
      const parsed: EditorHeading[] = [];
      els.forEach((el, index) => {
        if (!el.id) el.id = `doc-h-${index}-${Math.random().toString(36).substr(2, 4)}`;
        parsed.push({
          id: el.id,
          text: el.textContent || '',
          level: parseInt(el.tagName.substring(1)),
          selected: prevMap.get(el.id) ?? false,
        });
      });
      // Skip update if headings haven't changed (avoids unnecessary re-renders)
      if (prev.length === parsed.length &&
          prev.every((h, i) => h.id === parsed[i].id && h.text === parsed[i].text && h.level === parsed[i].level)) {
        return prev;
      }
      return parsed;
    });
  }, [editorRef]);

  // ── Populate editor from markdown (useLayoutEffect to run before paint) ──
  const contentInitRef = useRef(false);
  const populateEditor = useCallback(() => {
    if (!editorRef.current || contentInitRef.current) return;
    contentInitRef.current = true;
    suppressDirtyRef.current = true;
    editorRef.current.innerHTML = sanitizeHtml(marked.parse(initialContentRef.current, { async: false }) as string);
    parseHeadings();
    setIsDirty(false);
    // Capture initial snapshot for undo baseline
    lastSnapshotRef.current = editorRef.current.innerHTML;
    undoStack.current = [];
    redoStack.current = [];
    requestAnimationFrame(() => {
      suppressDirtyRef.current = false;
    });
  }, [editorRef, parseHeadings]);

  useLayoutEffect(() => {
    populateEditor();
    // Fallback: if ref wasn't ready, retry on next frame
    if (!contentInitRef.current) {
      requestAnimationFrame(() => populateEditor());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  // ── MutationObserver for dirty tracking + heading re-parse + undo snapshots ──
  useEffect(() => {
    if (!editorRef.current) {
      editorObserverRef.current = null;
      return;
    }
    const editor = editorRef.current;
    const observer = new MutationObserver(() => {
      if (!suppressDirtyRef.current) setIsDirty(true);
      // Debounce heading parse — sidebar doesn't need instant updates during typing
      if (headingTimerRef.current) clearTimeout(headingTimerRef.current);
      headingTimerRef.current = setTimeout(() => {
        parseHeadings();
      }, 300);
      // Debounced undo snapshot — captures state after typing pauses (500ms)
      if (!isUndoRedoing.current && !suppressDirtyRef.current) {
        if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
        snapshotTimerRef.current = setTimeout(() => {
          pushUndo();
        }, 500);
      }
    });
    observer.observe(editor, { childList: true, subtree: true, characterData: true });
    editorObserverRef.current = observer;
    return () => {
      observer.disconnect();
      editorObserverRef.current = null;
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      if (headingTimerRef.current) clearTimeout(headingTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Selection change listener for active format detection ──
  const updateActiveFormatStates = useCallback(() => {
    const formats = new Set<string>();
    try {
      if (document.queryCommandState('bold')) formats.add('bold');
      if (document.queryCommandState('italic')) formats.add('italic');
      if (document.queryCommandState('insertUnorderedList')) formats.add('unorderedList');
      if (document.queryCommandState('insertOrderedList')) formats.add('orderedList');
    } catch (_e) {
      /* ignore */
    }

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      let node = selection.anchorNode as Node | null;
      while (node && node !== editorRef.current) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const tagName = (node as HTMLElement).tagName;
          if (
            ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'CODE', 'PRE', 'A', 'TABLE', 'UL', 'OL'].includes(
              tagName,
            )
          ) {
            formats.add(tagName);
          }
        }
        node = node.parentNode;
      }
    }
    setActiveFormats(formats);
  }, [editorRef]);

  useEffect(() => {
    const handleSelectionChange = () => {
      if (editorRef.current) updateActiveFormatStates();
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [updateActiveFormatStates, editorRef]);

  // ── Actions ──

  const saveEdits = useCallback(() => {
    if (!editorRef.current) return;
    clearFindHighlights();
    closeFindBar();
    const newMarkdown = htmlToMarkdown(editorRef.current.innerHTML);
    onSave(newMarkdown);
    setIsDirty(false);
  }, [editorRef, onSave, closeFindBar, clearFindHighlights]);

  const discardEdits = useCallback(() => {
    if (!editorRef.current) return;
    clearFindHighlights();
    closeFindBar();
    suppressDirtyRef.current = true;
    editorRef.current.innerHTML = sanitizeHtml(marked.parse(initialContentRef.current, { async: false }) as string);
    setIsDirty(false);
    requestAnimationFrame(() => {
      suppressDirtyRef.current = false;
    });
  }, [editorRef, closeFindBar, clearFindHighlights]);

  const executeCommand = useCallback(
    (command: string, value: string = '') => {
      // Route undo/redo through our custom stack
      if (command === 'undo') {
        undo();
        return;
      }
      if (command === 'redo') {
        redo();
        return;
      }

      // Push snapshot before any formatting change
      pushUndo();

      if (command === 'createLink') {
        const url = prompt('Enter the link URL:');
        if (url) document.execCommand(command, false, url);
      } else if (command === 'removeFormat') {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && editorRef.current) {
          const range = sel.getRangeAt(0);
          const fragment = range.cloneContents();
          // Walk the fragment, extract only text nodes and <br> elements
          const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ALL);
          const parts: string[] = [];
          const blockTags = new Set([
            'P',
            'DIV',
            'H1',
            'H2',
            'H3',
            'H4',
            'H5',
            'H6',
            'LI',
            'TR',
            'BLOCKQUOTE',
            'SECTION',
            'ARTICLE',
            'HEADER',
            'FOOTER',
          ]);
          let lastWasBlock = false;
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node.nodeType === Node.TEXT_NODE) {
              const text = node.textContent || '';
              if (text) {
                parts.push(text);
                lastWasBlock = false;
              }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as Element;
              if (el.tagName === 'BR') {
                parts.push('<br>');
                lastWasBlock = false;
              } else if (blockTags.has(el.tagName) && parts.length > 0 && !lastWasBlock) {
                parts.push('<br>');
                lastWasBlock = true;
              }
            }
          }
          // Replace selected content with plain text + line breaks wrapped in <p>
          range.deleteContents();
          const temp = document.createElement('span');
          temp.innerHTML = parts.join('');
          const frag = document.createDocumentFragment();
          while (temp.firstChild) frag.appendChild(temp.firstChild);
          range.insertNode(frag);
          // Collapse to end
          sel.collapseToEnd();
        } else {
          // No selection: just strip inline formatting via browser command
          document.execCommand('removeFormat', false);
          document.execCommand('formatBlock', false, 'p');
        }
      } else {
        document.execCommand(command, false, value);
      }
      lastSnapshotRef.current = editorRef.current?.innerHTML || '';
      updateActiveFormatStates();
      editorRef.current?.focus();
    },
    [updateActiveFormatStates, editorRef, pushUndo, undo, redo],
  );

  const insertTable = useCallback(
    (rows: number = 3, cols: number = 3) => {
      let tableHtml = '<table><thead><tr>';
      for (let c = 0; c < cols; c++) tableHtml += '<th>Header</th>';
      tableHtml += '</tr></thead><tbody>';
      for (let r = 0; r < rows - 1; r++) {
        tableHtml += '<tr>';
        for (let c = 0; c < cols; c++) tableHtml += '<td>Data</td>';
        tableHtml += '</tr>';
      }
      tableHtml += '</tbody></table><p><br></p>';
      executeCommand('insertHTML', tableHtml);
    },
    [executeCommand],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
          return;
        }
        if (e.key === 'z' && e.shiftKey) {
          e.preventDefault();
          redo();
          return;
        }
        if (e.key === 'y') {
          e.preventDefault();
          redo();
          return;
        }
        if (e.key === 'b') {
          e.preventDefault();
          executeCommand('bold');
        }
        if (e.key === 'i') {
          e.preventDefault();
          executeCommand('italic');
        }
        if (e.key === 's') {
          e.preventDefault();
          saveEdits();
        }
      }
    },
    [executeCommand, saveEdits, undo, redo],
  );

  // ── Heading selection ──
  const toggleSelection = useCallback((headingId: string) => {
    setHeadings((prev) => prev.map((h) => (h.id === headingId ? { ...h, selected: !h.selected } : h)));
  }, []);

  const deselectAll = useCallback(() => {
    setHeadings((prev) => prev.map((h) => (h.selected ? { ...h, selected: false } : h)));
  }, []);

  const selectByLevels = useCallback((levels: number[]) => {
    const levelSet = new Set(levels);
    setHeadings((prev) => {
      const targeted = prev.filter((h) => levelSet.has(h.level));
      const allSelected = targeted.length > 0 && targeted.every((h) => h.selected);
      return prev.map((h) => {
        if (levelSet.has(h.level)) return { ...h, selected: !allSelected };
        return h;
      });
    });
  }, []);

  /** Replace the entire selection set with the given IDs. */
  const setSelectedIds = useCallback((ids: Set<string>) => {
    setHeadings((prev) => prev.map((h) => ({ ...h, selected: ids.has(h.id) })));
  }, []);

  /** Select a contiguous range between two heading IDs (inclusive), additive to existing selection. */
  const selectRange = useCallback((fromId: string, toId: string) => {
    setHeadings((prev) => {
      const fromIdx = prev.findIndex((h) => h.id === fromId);
      const toIdx = prev.findIndex((h) => h.id === toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const lo = Math.min(fromIdx, toIdx);
      const hi = Math.max(fromIdx, toIdx);
      return prev.map((h, i) => (i >= lo && i <= hi ? { ...h, selected: true } : h));
    });
  }, []);

  const selectHeadingAndDescendants = useCallback((headingId: string) => {
    setHeadings((prev) => {
      const idx = prev.findIndex((h) => h.id === headingId);
      if (idx === -1) return prev;
      const parentLevel = prev[idx].level;
      const idsToSelect = new Set<string>([headingId]);
      for (let i = idx + 1; i < prev.length; i++) {
        if (prev[i].level <= parentLevel) break;
        idsToSelect.add(prev[i].id);
      }
      return prev.map((h) => (idsToSelect.has(h.id) ? { ...h, selected: true } : h));
    });
  }, []);

  const selectHeadingContent = useCallback(
    (headingId: string) => {
      if (!editorRef.current) return;
      const el = editorRef.current.querySelector(`#${CSS.escape(headingId)}`) as HTMLElement | null;
      if (!el) return;

      // Find the end of this heading's content (next sibling heading of same or lower level, or end of editor)
      const headingLevel = parseInt(el.tagName.substring(1));
      let endNode: Node | null = null;
      let sibling = el.nextSibling as Node | null;
      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE) {
          const tag = (sibling as HTMLElement).tagName;
          if (/^H[1-6]$/.test(tag) && parseInt(tag.substring(1)) <= headingLevel) {
            endNode = sibling;
            break;
          }
        }
        sibling = sibling.nextSibling;
      }

      const range = document.createRange();
      range.setStartBefore(el);
      if (endNode) {
        range.setEndBefore(endNode);
      } else {
        range.setEndAfter(editorRef.current.lastChild || el);
      }

      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    },
    [editorRef],
  );

  // ── Heading level change (promote/demote) ──
  const changeHeadingLevel = useCallback(
    (headingId: string, direction: 'promote' | 'demote') => {
      if (!editorRef.current) return;
      const el = editorRef.current.querySelector(`#${CSS.escape(headingId)}`) as HTMLElement | null;
      if (!el || !/^H[1-6]$/.test(el.tagName)) return;

      const currentLevel = parseInt(el.tagName.substring(1));
      const newLevel = direction === 'promote' ? Math.max(1, currentLevel - 1) : Math.min(6, currentLevel + 1);
      if (newLevel === currentLevel) return;

      // Capture current state as undo point before the DOM change
      snapshotBeforeChange();

      const newTag = `H${newLevel}`;
      const newEl = document.createElement(newTag);
      newEl.id = el.id;
      newEl.innerHTML = el.innerHTML;
      el.parentNode?.replaceChild(newEl, el);

      lastSnapshotRef.current = editorRef.current.innerHTML;
      parseHeadings();
    },
    [editorRef, parseHeadings, snapshotBeforeChange],
  );

  // ── Scroll to heading in editor ──
  const scrollToHeading = useCallback(
    (headingId: string) => {
      if (!editorRef.current) return;
      const el = editorRef.current.querySelector(`#${CSS.escape(headingId)}`) as HTMLElement | null;
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    [editorRef],
  );

  // ── Update the first H1 text in the live editor (used when card is renamed externally) ──
  const updateH1 = useCallback(
    (newTitle: string) => {
      if (!editorRef.current) return;
      const h1 = editorRef.current.querySelector('h1');
      if (h1 && h1.textContent !== newTitle) {
        suppressDirtyRef.current = true;
        h1.textContent = newTitle;
        lastSnapshotRef.current = editorRef.current.innerHTML;
        // Also update initialContentRef so dirty tracking stays correct
        initialContentRef.current = initialContentRef.current.replace(/^#\s+.+$/m, `# ${newTitle}`);
        parseHeadings();
        requestAnimationFrame(() => {
          suppressDirtyRef.current = false;
        });
      }
    },
    [editorRef, parseHeadings],
  );

  // ── Reorder heading (with all its content & descendants) in the editor DOM ──
  const reorderHeading = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!editorRef.current || fromIndex === toIndex) return;
      if (fromIndex < 0 || fromIndex >= headings.length) return;
      if (toIndex < 0 || toIndex >= headings.length) return;

      const editor = editorRef.current;
      const sourceHeading = headings[fromIndex];

      // Find the DOM element for the source heading
      const sourceEl = editor.querySelector(`#${CSS.escape(sourceHeading.id)}`) as HTMLElement | null;
      if (!sourceEl) return;

      // Collect all DOM nodes belonging to this heading's section:
      // the heading element + all siblings until the next heading of same or lower level
      const sourceLevel = sourceHeading.level;
      const nodesToMove: Node[] = [sourceEl];
      let sibling = sourceEl.nextSibling;
      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE) {
          const tag = (sibling as HTMLElement).tagName;
          if (/^H[1-6]$/.test(tag) && parseInt(tag.substring(1)) <= sourceLevel) break;
        }
        nodesToMove.push(sibling);
        sibling = sibling.nextSibling;
      }

      // Capture current state as undo point before the DOM change
      snapshotBeforeChange();

      // Determine the target heading and find its DOM element for insertion reference
      const targetHeading = headings[toIndex];
      const targetEl = editor.querySelector(`#${CSS.escape(targetHeading.id)}`) as HTMLElement | null;
      if (!targetEl) return;

      // Create a fragment with all nodes to move
      const fragment = document.createDocumentFragment();
      nodesToMove.forEach((n) => fragment.appendChild(n));

      // Insert before the target heading element
      if (fromIndex < toIndex) {
        // Moving down: insert after the target's section
        // Find end of target's section (target heading + its content + descendants)
        const targetLevel = targetHeading.level;
        let insertBefore: Node | null = targetEl.nextSibling;
        while (insertBefore) {
          if (insertBefore.nodeType === Node.ELEMENT_NODE) {
            const tag = (insertBefore as HTMLElement).tagName;
            if (/^H[1-6]$/.test(tag) && parseInt(tag.substring(1)) <= targetLevel) break;
          }
          insertBefore = insertBefore.nextSibling;
        }
        if (insertBefore) {
          editor.insertBefore(fragment, insertBefore);
        } else {
          editor.appendChild(fragment);
        }
      } else {
        // Moving up: insert before the target heading
        editor.insertBefore(fragment, targetEl);
      }

      lastSnapshotRef.current = editor.innerHTML;
      parseHeadings();
    },
    [editorRef, headings, snapshotBeforeChange, parseHeadings],
  );

  /** Swap editor content without unmounting. Resets dirty, undo/redo, headings. */
  const resetContent = useCallback((newMarkdown: string) => {
    if (!editorRef.current) return;
    suppressDirtyRef.current = true;
    initialContentRef.current = newMarkdown;
    // Disconnect observer to avoid spurious dirty/heading events during innerHTML swap
    editorObserverRef.current?.disconnect();
    editorRef.current.innerHTML = sanitizeHtml(marked.parse(newMarkdown, { async: false }) as string);
    undoStack.current = [];
    redoStack.current = [];
    lastSnapshotRef.current = editorRef.current.innerHTML;
    if (snapshotTimerRef.current) {
      clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
    }
    setIsDirty(false);
    parseHeadings();
    // Reconnect observer + unsuppress dirty after paint
    requestAnimationFrame(() => {
      if (editorRef.current && editorObserverRef.current) {
        editorObserverRef.current.observe(editorRef.current, { childList: true, subtree: true, characterData: true });
      }
      suppressDirtyRef.current = false;
    });
  }, [editorRef, editorObserverRef, parseHeadings]);

  return {
    isDirty,
    activeFormats,
    headings,
    saveEdits,
    discardEdits,
    executeCommand,
    insertTable,
    handleKeyDown,
    updateActiveFormatStates,
    changeHeadingLevel,
    scrollToHeading,
    updateH1,
    resetContent,
    toggleSelection,
    deselectAll,
    selectByLevels,
    setSelectedIds,
    selectRange,
    selectHeadingContent,
    selectHeadingAndDescendants,
    reorderHeading,
  };
}
