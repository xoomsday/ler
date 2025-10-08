// LER javascript

const DB_NAME = 'ler-books';
const DB_VERSION = 4;
const STORE_BOOKS_NAME = 'epubs';
const STORE_METADATA_NAME = 'metadata';
const STORE_BOOKMARKS_NAME = 'bookmarks';
const STORE_TAGS_NAME = 'tags';
const STORE_BOOK_TAGS_NAME = 'book_tags';

let db;
let currentBook;
let currentRendition;
let currentBookId = null;
let currentBookType = null;
let currentBookDirection = 'ltr';
let currentBookLanguage = 'en-US'; // Default language for TTS
let currentFontSize = 100;
let currentLineHeight = 1.5;
let currentFont = 'sans-serif';
let isDarkMode = false;
let controlsTimer = null;
let currentBookLocationsPromise = null;
let isClosing = false;
let comicBookPages = [];
let currentComicPage = 0;
let pagesCurrentlyDisplayed = 1;
let soloPageExceptions = [];
let comicInfoPageLayouts = new Map();
let synth = window.speechSynthesis;
let currentUtterance = null;
let isAutoReading = false;
let isSelectionModeActive = false;
let selectedBookIds = new Set();

function showControls() {
  const controls = document.getElementById('reader-controls');
  const prevPage = document.getElementById('prev-page-area');
  const nextPage = document.getElementById('next-page-area');

  controls.classList.remove('controls-hidden');
  prevPage.classList.remove('controls-hidden');
  nextPage.classList.remove('controls-hidden');

  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(hideControls, 3000);
}

function hideControls() {
  const controls = document.getElementById('reader-controls');
  const prevPage = document.getElementById('prev-page-area');
  const nextPage = document.getElementById('next-page-area');

  controls.classList.add('controls-hidden');
  prevPage.classList.add('controls-hidden');
  nextPage.classList.add('controls-hidden');
}

function addMouseHandlers(element) {
  element.addEventListener('mousemove', showControls);
  element.addEventListener('click', showControls);
}

function removeMouseHandlers(element) {
  element.removeEventListener('mousemove', showControls);
  element.removeEventListener('click', showControls);
}

function extractReadableText(bodyElement) {
  const clonedBody = bodyElement.cloneNode(true);
  const rubies = clonedBody.querySelectorAll('ruby');
  rubies.forEach(ruby => {
    const rts = ruby.querySelectorAll('rt');
    let pronunciation = '';
    rts.forEach(rt => {
      pronunciation += rt.textContent;
    });
    // Replace the ruby element with a text node containing the pronunciation
    if (pronunciation) {
      ruby.parentNode
      .replaceChild(bodyElement.ownerDocument.createTextNode(pronunciation), ruby);
    }  });
  return clonedBody.textContent;
}

function extractBaseText(bodyElement) {
  const clonedBody = bodyElement.cloneNode(true);
  const rubies = clonedBody.querySelectorAll('ruby');
  rubies.forEach(ruby => {
    // Remove rt and rp elements to leave only the base text within the ruby tag
    ruby.querySelectorAll('rt, rp').forEach(e => e.remove());
  });
  return clonedBody.textContent;
}

async function getCurrentPageText() {
  if (!currentRendition) {
    return '';
  }
  const location = currentRendition.currentLocation();
  if (!location || !location.start || !location.end) {
    return '';
  }

  const startCfi = location.start.cfi;
  const endCfi = location.end.cfi;

  try {
    const startRange = await currentBook.getRange(startCfi);
    const endRange = await currentBook.getRange(endCfi);

    // Check if the ranges are in the same document
    if (startRange.startContainer.ownerDocument !== endRange.endContainer.ownerDocument) {
      // This can happen in spread mode where two different chapter files are displayed.
      // We need to handle this by creating two ranges and combining their text.
      const doc1 = startRange.startContainer.ownerDocument;
      const range1 = doc1.createRange();
      range1.setStart(startRange.startContainer, startRange.startOffset);
      range1.setEnd(doc1.body, doc1.body.childNodes.length); // Go to the end of the first document
      const fragment1 = range1.cloneContents();
      const div1 = document.createElement('div');
      div1.appendChild(fragment1);
      const text1 = extractReadableText(div1);

      const doc2 = endRange.endContainer.ownerDocument;
      const range2 = doc2.createRange();
      range2.setStart(doc2.body, 0); // Start from the beginning of the second document
      range2.setEnd(endRange.endContainer, endRange.endOffset);
      const fragment2 = range2.cloneContents();
      const div2 = document.createElement('div');
      div2.appendChild(fragment2);
      const text2 = extractReadableText(div2);

      return text1 + " " + text2;
    }

    const range = startRange.startContainer.ownerDocument.createRange();
    range.setStart(startRange.startContainer, startRange.startOffset);
    range.setEnd(endRange.endContainer, endRange.endOffset);

    const fragment = range.cloneContents();
    const div = document.createElement('div');
    div.appendChild(fragment);
    return extractReadableText(div);

  } catch (e) {
    console.error("Error getting page text for TTS:", e);
    // Fallback to the old method if the new one fails
    const view = currentRendition.manager.views.last();
    if (view && view.iframe) {
      return extractReadableText(view.iframe.contentWindow.document.body);
    }
    return '';
  }
}

async function readCurrentPage() {
  if (!currentRendition || !isAutoReading) return;

  const text = await getCurrentPageText();
  if (!text || text.trim() === '') {
    // If page is blank, just go to the next one
    if (isAutoReading) {
      await nextEpubPage();
      readCurrentPage();
    }
    return;
  }

  console.log('lang: ', currentBookLanguage);

  currentUtterance = new SpeechSynthesisUtterance(text);
  currentUtterance.lang = currentBookLanguage; // Set the language for the utterance
  currentUtterance.onend = async () => {
    if (isAutoReading) {
      await nextEpubPage();
      // A small delay to allow the next page to render before reading
      setTimeout(readCurrentPage, 250);
    }
  };
  currentUtterance.onerror = (event) => {
    console.error('SpeechSynthesisUtterance.onerror', event);
    // Stop auto-reading on error
    stopReading();
  };

  synth.speak(currentUtterance);
}

function togglePlayPause() {
  if (!synth) {
    alert('Text-to-Speech is not supported in this browser.');
    return;
  }

  const playButton = document.getElementById('tts-play');
  const pauseButton = document.getElementById('tts-pause');

  if (synth.paused) { // It's paused, so resume
    synth.resume();
    playButton.style.display = 'none';
    pauseButton.style.display = 'inline-block';
  } else if (synth.speaking) { // It's speaking, so pause
    synth.pause();
    playButton.style.display = 'inline-block';
    pauseButton.style.display = 'none';
  } else { // It's not started, so play
    startReading();
  }
}

function startReading() {
  if (!synth) return;
  isAutoReading = true;
  readCurrentPage();

  document.getElementById('tts-play').style.display = 'none';
  document.getElementById('tts-pause').style.display = 'inline-block';
  document.getElementById('tts-stop').style.display = 'inline-block';
}

function stopReading() {
  isAutoReading = false;
  if (synth) {
    synth.cancel();
  }
  currentUtterance = null;

  document.getElementById('tts-play').style.display = 'inline-block';
  document.getElementById('tts-pause').style.display = 'none';
  document.getElementById('tts-stop').style.display = 'none';
}

function enterSelectionMode() {
  isSelectionModeActive = true;
  document.getElementById('book-management').classList.add('selection-mode');
  document.getElementById('library-controls').style.display = 'none';
  document.getElementById('bulk-actions-pane').style.display = 'flex';
  updateSelectionCount();
}

function exitSelectionMode() {
  isSelectionModeActive = false;
  document.getElementById('book-management').classList.remove('selection-mode');
  document.getElementById('library-controls').style.display = 'flex';
  document.getElementById('bulk-actions-pane').style.display = 'none';
  selectedBookIds.clear();
  // Remove 'selected' class from all tiles
  document.querySelectorAll('.book-tile.selected').forEach(tile => {
    tile.classList.remove('selected');
  });
}

function updateSelectionCount() {
  const count = selectedBookIds.size;
  const countElement = document.getElementById('selection-count');
  countElement.textContent = `${count} book${count !== 1 ? 's' : ''} selected`;
}

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_BOOKS_NAME)) {
        db.createObjectStore(STORE_BOOKS_NAME, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_METADATA_NAME)) {
        db.createObjectStore(STORE_METADATA_NAME, { keyPath: 'bookId' });
      }
      if (!db.objectStoreNames.contains(STORE_BOOKMARKS_NAME)) {
        const bookmarksStore = db.createObjectStore(STORE_BOOKMARKS_NAME, { keyPath: 'id', autoIncrement: true });
        bookmarksStore.createIndex('by_bookId', 'bookId', { unique: false });
      }
      if (event.oldVersion < 4) {
        if (!db.objectStoreNames.contains(STORE_TAGS_NAME)) {
          const tagsStore = db.createObjectStore(STORE_TAGS_NAME, { keyPath: 'id', autoIncrement: true });
          tagsStore.createIndex('by_name', 'name', { unique: true });
        }
        if (!db.objectStoreNames.contains(STORE_BOOK_TAGS_NAME)) {
          const bookTagsStore = db.createObjectStore(STORE_BOOK_TAGS_NAME, { keyPath: 'id', autoIncrement: true });
          bookTagsStore.createIndex('by_bookId', 'bookId', { unique: false });
          bookTagsStore.createIndex('by_tagId', 'tagId', { unique: false });
        }
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = (event) => {
      console.error('IndexedDB error:', event.target.errorCode);
      reject(event.target.errorCode);
    };
  });
}

async function migrateBookmarksFromLocalStorage() {
    const bookmarksJSON = localStorage.getItem('ler-bookmarks');
    if (!bookmarksJSON) {
        return; // Nothing to migrate
    }

    const bookmarks = JSON.parse(bookmarksJSON);
    const bookIds = Object.keys(bookmarks);

    if (bookIds.length === 0) {
        localStorage.removeItem('ler-bookmarks');
        return;
    }

    const transaction = db.transaction([STORE_BOOKMARKS_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_BOOKMARKS_NAME);

    bookIds.forEach(bookId => {
        const bookBookmarks = bookmarks[bookId];
        bookBookmarks.forEach(bookmark => {
            const numericBookId = parseInt(bookId, 10);
            if (!isNaN(numericBookId)) {
                store.add({
                    bookId: numericBookId,
                    cfi: bookmark.cfi,
                    text: bookmark.text,
                    created: bookmark.created
                });
            }
        });
    });

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => {
            console.log('Bookmarks migrated successfully.');
            localStorage.removeItem('ler-bookmarks');
            resolve();
        };
        transaction.onerror = (event) => {
            console.error('Error migrating bookmarks:', event.target.error);
            reject(event.target.error);
        };
    });
}

window.addEventListener('load', async () => {
  if (localStorage.getItem('ler-dark-mode') === 'true') {
    isDarkMode = true;
    document.body.classList.add('dark-mode');
  }

  await initDB();
  await migrateBookmarksFromLocalStorage();
  displayBooks();

  const uploadInput = document.getElementById('epub-upload');
  uploadInput.addEventListener('change', handleFileUpload);

  const closeButton = document.getElementById('close-reader');
  closeButton.addEventListener('click', closeReader);

  const tocButton = document.getElementById('toc-button');
  tocButton.addEventListener('click', toggleToc);

  const bookmarkButton = document.getElementById('bookmark-button');
  bookmarkButton.addEventListener('click', toggleBookmarksOverlay);

  document.getElementById('font-size-dec').addEventListener('click', decreaseFontSize);
  document.getElementById('font-size-inc').addEventListener('click', increaseFontSize);
  document.getElementById('line-height-dec').addEventListener('click', decreaseLineHeight);
  document.getElementById('line-height-inc').addEventListener('click', increaseLineHeight);
  document.getElementById('dark-mode-toggle').addEventListener('click', toggleDarkMode);
  document.getElementById('font-toggle').addEventListener('click', toggleFont);
  document.getElementById('direction-toggle').addEventListener('click', toggleDirection);
  document.getElementById('spread-toggle').addEventListener('click', toggleSpread);

  document.getElementById('tts-play').addEventListener('click', togglePlayPause);
  document.getElementById('tts-pause').addEventListener('click', togglePlayPause);
  document.getElementById('tts-stop').addEventListener('click', stopReading);

  window.addEventListener('resize', () => {
    if (currentBookType === 'cbz' && document.getElementById('reader-view').style.display === 'block') {
      displayComicPage(currentComicPage);
    }
  });

  const prevPageArea = document.getElementById('prev-page-area');
  prevPageArea.addEventListener('click', (event) => {
    if (currentBookDirection === 'rtl') {
      nextPage();
    } else {
      prevPage();
    }
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(hideControls, 3000);
  });

  const nextPageArea = document.getElementById('next-page-area');
  nextPageArea.addEventListener('click', (event) => {
    if (currentBookDirection === 'rtl') {
      prevPage();
    } else {
      nextPage();
    }
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(hideControls, 3000);
  });

  const sortBy = document.getElementById('sort-by');
  sortBy.addEventListener('change', displayBooks);

  // --- New State Filter Dropdown Logic ---
  const stateFilterBtn = document.getElementById('state-filter-btn');
  const stateFilterOptions = document.getElementById('state-filter-options');

  stateFilterBtn.addEventListener('click', (event) => {
    event.stopPropagation(); // Prevent the window click listener from closing it immediately
    stateFilterOptions.classList.toggle('show');
  });

  // Close the dropdown if the user clicks outside of it
  window.addEventListener('click', (event) => {
    if (!event.target.matches('.filter-btn')) {
      if (stateFilterOptions.classList.contains('show')) {
        stateFilterOptions.classList.remove('show');
      }
    }
  });

  // Re-display books when a filter checkbox is changed
  stateFilterOptions.addEventListener('change', displayBooks);

  // --- New Tag Filter Dropdown Logic ---
  const tagFilterBtn = document.getElementById('tag-filter-btn');
  const tagFilterOptions = document.getElementById('tag-filter-options');

  tagFilterBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    tagFilterOptions.classList.toggle('show');
  });

  // We can reuse the window click listener to close this dropdown as well
  window.addEventListener('click', (event) => {
    if (!event.target.matches('.filter-btn')) {
      if (tagFilterOptions.classList.contains('show')) {
        tagFilterOptions.classList.remove('show');
      }
    }
  });

  tagFilterOptions.addEventListener('change', displayBooks);

  populateTagFilter(); // Populate tags on load


  // Bulk action event listeners
  document.getElementById('bulk-cancel').addEventListener('click', exitSelectionMode);
  document.getElementById('bulk-delete').addEventListener('click', bulkDelete);
  document.getElementById('bulk-state-change').addEventListener('change', bulkUpdateState);

  // Tag Editor buttons
  document.getElementById('tag-editor-cancel').addEventListener('click', closeTagEditor);
  document.getElementById('tag-editor-save').addEventListener('click', saveBookTags);
  document.getElementById('add-tag-btn').addEventListener('click', addNewTagFromInput);
  document.getElementById('new-tag-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addNewTagFromInput();
    }
  });
});

async function populateTagFilter() {
  const optionsContainer = document.getElementById('tag-filter-options');
  optionsContainer.innerHTML = ''; // Clear existing

  const transaction = db.transaction([STORE_TAGS_NAME], 'readonly');
  const tags = await new Promise(resolve => transaction.objectStore(STORE_TAGS_NAME).getAll().onsuccess = e => resolve(e.target.result));

  tags.sort((a, b) => a.name.localeCompare(b.name));

  tags.forEach(tag => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'tag';
    checkbox.value = tag.id;
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(` ${tag.name}`));
    optionsContainer.appendChild(label);
  });
}

async function bulkDelete() {
  const numSelected = selectedBookIds.size;
  if (numSelected === 0) return;
  if (confirm(`Are you sure you want to delete ${numSelected} book(s)?`)) {
    for (const bookId of selectedBookIds) {
      deleteBook(bookId, false); // Pass false to prevent re-displaying books each time
    }
    exitSelectionMode();
    displayBooks(); // Refresh the book list once at the end
  }
}

async function bulkUpdateState(event) {
  const state = event.target.value;
  if (!state) return;

  const promises = [];
  for (const bookId of selectedBookIds) {
    promises.push(updateBookState(bookId, state, false)); // Pass false to prevent re-displaying
  }
  await Promise.all(promises);

  event.target.value = ""; // Reset dropdown
  exitSelectionMode();
  displayBooks(); // Refresh list at the end
}

function updateProgressIndicator() {
  const indicator = document.getElementById('progress-indicator');
  if (!currentBookId || (currentBookType === 'epub' && !currentRendition)) {
    indicator.style.display = 'none';
    return;
  }

  indicator.style.display = 'block';

  if (currentBookType === 'cbz') {
    if (comicBookPages.length > 0) {
      indicator.textContent = `(${currentComicPage + 1}/${comicBookPages.length})`;
    } else {
      indicator.textContent = '';
    }
  } else { // epub
    if (currentBook && currentBook.locations && currentRendition && currentRendition.currentLocation()) {
      const location = currentRendition.currentLocation();
      const percentage = currentBook.locations.percentageFromCfi(location.start.cfi);
      if (percentage !== null && !isNaN(percentage)) {
        indicator.textContent = `(${(percentage * 100).toFixed(0)}%)`;
      } else {
        indicator.textContent = '';
      }
    } else {
      indicator.textContent = '';
    }
  }
}

async function closeReader() {
  if (isClosing) return; // Prevent re-entrancy
  isClosing = true;

  stopReading(); // Stop any active TTS
  await saveLastLocation();

  const readerView = document.getElementById('reader-view');
  window.removeEventListener('keydown', handleKeyPress);
  removeMouseHandlers(readerView);
  clearTimeout(controlsTimer);

  document.getElementById('reader-view').style.display = 'none';
  document.getElementById('viewer').innerHTML = '';
  document.getElementById('progress-indicator').style.display = 'none';
  document.getElementById('book-management').style.display = 'block';
  document.getElementById('help-overlay').style.display = 'none';

  // Reset comic book specific things
  readerView.classList.remove('comic-mode');
  comicBookPages = [];
  currentComicPage = 0;

  displayBooks(); // Refresh the book list
  currentRendition = null;
  currentBook = null;
  currentBookId = null;
  currentBookType = null;
  currentBookDirection = 'ltr';
  currentBookLocationsPromise = null;

  isClosing = false; // Release the lock
}

async function saveLastLocation(setFinished) {
  if (currentBookType === 'cbz') {
    if (!currentBookId || comicBookPages.length === 0) {
      return;
    }
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_METADATA_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_METADATA_NAME);
      const request = store.get(currentBookId);

      request.onsuccess = () => {
        const data = request.result || { bookId: currentBookId };
        data.lastLocation = currentComicPage.toString();
        if (setFinished) {
          data.state = 'finished';
        }
        data.progress = comicBookPages.length > 0 ? (currentComicPage + 1) / comicBookPages.length : 0;
        data.lastReadTimestamp = Date.now();
        store.put(data);
      };
      transaction.oncomplete = resolve;
      transaction.onerror = (event) => reject(event.target.error);
    });
  } else { // EPUB
    if (!currentRendition || !currentBookId || !currentBook ||
        !currentBookLocationsPromise) {
      return; // Nothing to save or generation not started
    }

    try {
      await currentBookLocationsPromise; // Ensure locations are ready

      let progress = null;
      const locations = currentBook.locations;
      const cfi = currentRendition.currentLocation().start.cfi;
      const locationIndex = locations.locationFromCfi(cfi);
      if (locationIndex !== -1 && locations.total > 0) {
        progress = locationIndex / locations.total;
      }

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_METADATA_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_METADATA_NAME);

        transaction.oncomplete = () => {
          resolve();
        };
        transaction.onerror = (event) => {
          console.error("Transaction error on saveLastLocation:", event.target.error);
          reject(event.target.error);
        };

        const request = store.get(currentBookId);
        request.onsuccess = () => {
          const data = request.result || { bookId: currentBookId };
          data.lastLocation = cfi;
      if (setFinished) {
            data.state = 'finished';
      }
          if (Number.isFinite(progress)) {
            data.progress = progress;
          }
          data.lastReadTimestamp = Date.now();
          store.put(data);
        };
      });
    } catch (e) {
      // This can happen if the rendition is not ready yet
      console.warn("Could not save last location:", e);
    }
  }
}

function saveBookSettings() {
  return new Promise((resolve, reject) => {
    if (!currentBookId) {
      return resolve(); // Nothing to save for
    }

    const transaction = db.transaction([STORE_METADATA_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_METADATA_NAME);

    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = (event) => {
      console.error("Transaction error on saveBookSettings:", event.target.error);
      reject(event.target.error);
    };

    const request = store.get(currentBookId);
    request.onsuccess = () => {
      const data = request.result || { bookId: currentBookId };
      data.fontSize = currentFontSize;
      data.lineHeight = currentLineHeight;
      data.font = currentFont;
      store.put(data);
    };
  });
}

async function increaseFontSize() {
  if (!currentRendition) return;
  currentFontSize += 10;
  currentRendition.themes.fontSize(currentFontSize + '%');
  document.getElementById('font-size-value').textContent = currentFontSize + '%';
  await saveBookSettings();
}

async function decreaseFontSize() {
  if (!currentRendition) return;
  if (currentFontSize > 10) {
    currentFontSize -= 10;
    currentRendition.themes.fontSize(currentFontSize + '%');
    document.getElementById('font-size-value').textContent = currentFontSize + '%';
    await saveBookSettings();
  }
}

async function increaseLineHeight() {
  if (!currentRendition) return;
  currentLineHeight = parseFloat((currentLineHeight + 0.1).toFixed(1));
  currentRendition.themes.override('line-height', currentLineHeight);
  document.getElementById('line-height-value').textContent = currentLineHeight;
  await saveBookSettings();
}

async function decreaseLineHeight() {
  if (!currentRendition) return;
  if (currentLineHeight > 1) {
    currentLineHeight = parseFloat((currentLineHeight - 0.1).toFixed(1));
    currentRendition.themes.override('line-height', currentLineHeight);
    document.getElementById('line-height-value').textContent = currentLineHeight;
    await saveBookSettings();
  }
}

async function toggleDarkMode() {
  isDarkMode = !isDarkMode;
  localStorage.setItem('ler-dark-mode', isDarkMode);

  if (isDarkMode) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }

  if (currentRendition) {
    if (isDarkMode) {
      currentRendition.themes.override('color', '#e0e0e0');
      currentRendition.themes.override('background', '#121212');
    } else {
      currentRendition.themes.override('color', ''); // Revert to default
      currentRendition.themes.override('background', ''); // Revert to default
    }
  }
}

async function toggleFont() {
  if (!currentRendition) return;
  if (currentFont === 'serif') {
    currentFont = 'sans-serif';
  } else {
    currentFont = 'serif';
  }
  await applyFont();
  await saveBookSettings();
}

async function applyFont() {
  if (!currentRendition) return;
  const fontToggleButton = document.getElementById('font-toggle');
  const serifFonts = '"MS PMincho", "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "serif-ja", serif';
  const sansFonts = '"Hiragino Kaku Gothic ProN", "Yu Gothic", "YuGothic", "sans-serif-ja", sans-serif';

  if (currentFont === 'serif') {
    currentRendition.themes.override('font-family', serifFonts);
    fontToggleButton.classList.add('serif');
  } else {
    currentRendition.themes.override('font-family', sansFonts);
    fontToggleButton.classList.remove('serif');
  }
}

async function toggleDirection() {
  if (currentBookType !== 'cbz') return;

  if (currentBookDirection === 'ltr') {
    currentBookDirection = 'rtl';
  } else {
    currentBookDirection = 'ltr';
  }
  updateDirectionButton();

  // Save the new direction to metadata
  const transaction = db.transaction([STORE_METADATA_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_METADATA_NAME);
  const request = store.get(currentBookId);
  request.onsuccess = () => {
    const data = request.result || { bookId: currentBookId };
    data.direction = currentBookDirection;
    store.put(data);
  };
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = reject;
  });
}

async function toggleSpread() {
  if (currentBookType !== 'cbz') return;

  const targetPage = currentComicPage;

  const exceptionIndex = soloPageExceptions.indexOf(targetPage);
  if (exceptionIndex > -1) {
    soloPageExceptions.splice(exceptionIndex, 1); // Rejoin
  } else {
    soloPageExceptions.push(targetPage); // Split
  }

  // Save metadata
  const transaction = db.transaction([STORE_METADATA_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_METADATA_NAME);
  const request = store.get(currentBookId);
  request.onsuccess = () => {
    const data = request.result || { bookId: currentBookId };
    data.soloPageExceptions = soloPageExceptions;
    store.put(data);
  };

  await new Promise(resolve => transaction.oncomplete = resolve);

  // Re-render the current page to reflect the change
  await displayComicPage(currentComicPage);
}

function updateDirectionButton() {
  const button = document.getElementById('direction-toggle');
  if (currentBookDirection === 'rtl') {
    button.textContent = 'RTL';
  } else {
    button.textContent = 'LTR';
  }
}

async function resetFontSettings() {
  if (!currentRendition) return;
  currentFontSize = 100;
  currentLineHeight = 1.5;
  currentFont = 'sans-serif';
  currentRendition.themes.fontSize(currentFontSize + '%');
  currentRendition.themes.override('line-height', currentLineHeight);
  await applyFont();
  document.getElementById('font-size-value').textContent = currentFontSize + '%';
  document.getElementById('line-height-value').textContent = currentLineHeight;
  await saveBookSettings();
}

function toggleOverlay(type) {
  const tocOverlay = document.getElementById('toc-overlay');
  const controls = document.getElementById('reader-controls');
  const currentContent = tocOverlay.dataset.content;
  const isVisible = tocOverlay.style.display !== 'none';

  if (isVisible && currentContent === type) {
    // Hide the overlay and restart the auto-hide timer
    tocOverlay.style.display = 'none';
    tocOverlay.dataset.content = '';
    showControls();
  } else {
    // Show the overlay, and cancel any pending auto-hide
    clearTimeout(controlsTimer);
    controls.classList.remove('controls-hidden');

    document.getElementById('help-overlay').style.display = 'none';
    tocOverlay.style.display = 'block';
    tocOverlay.dataset.content = type;
    if (type === 'toc') {
      generateToc();
    } else if (type === 'bookmarks') {
      generateBookmarksList();
    }
  }
}

function toggleToc() {
  toggleOverlay('toc');
}

function generateToc() {
  const tocOverlay = document.getElementById('toc-overlay');
  tocOverlay.innerHTML = '<h3>Table of Contents</h3>';

  currentBook.loaded.navigation.then((toc) => {
    const tocList = document.createElement('ul');
    toc.forEach((item) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.textContent = item.label;
      a.href = item.href;
      a.addEventListener('click', (event) => {
        event.preventDefault();
        currentRendition.display(item.href);
        toggleOverlay('toc'); // Close after selection
      });
      li.appendChild(a);
      tocList.appendChild(li);
    });
    tocOverlay.appendChild(tocList);
  });
}

function toggleBookmarksOverlay() {
  toggleOverlay('bookmarks');
}

async function generateBookmarksList() {
  const tocOverlay = document.getElementById('toc-overlay');
  tocOverlay.innerHTML = '<h3>Bookmarks</h3>';

  const addButton = document.createElement('button');
  addButton.textContent = 'Add bookmark at current location';
  addButton.addEventListener('click', async () => {
    await addNewBookmark();
    await generateBookmarksList(); // Refresh list
  });
  tocOverlay.appendChild(addButton);

  const transaction = db.transaction([STORE_BOOKMARKS_NAME], 'readonly');
  const store = transaction.objectStore(STORE_BOOKMARKS_NAME);
  const index = store.index('by_bookId');
  const request = index.getAll(currentBookId);

  request.onsuccess = () => {
    const bookBookmarks = request.result || [];

    const ul = document.createElement('ul');
    bookBookmarks.sort((a, b) => a.created - b.created).forEach((bookmark) => {
      const li = document.createElement('li');

      const a = document.createElement('a');
      a.href = '#';

      const created = new Date(bookmark.created);
      const dateString = created.toLocaleString();
      let text = bookmark.text;
      if (text === 'Bookmark' || !text) {
        text = `Bookmark from ${dateString}`;
      } else {
        text = `${text}... (${dateString})`;
      }
      a.textContent = text;

      a.addEventListener('click', async (event) => {
        event.preventDefault();
        try {
          await gotoCFI(bookmark.cfi);
          toggleOverlay('bookmarks');
        } catch (e) {
          console.error("Error navigating to CFI:", e);
        }
      });

      const deleteButton = document.createElement('button');
      deleteButton.textContent = 'X';
      deleteButton.className = 'delete-bookmark';
      deleteButton.addEventListener('click', async () => {
        await deleteBookmark(bookmark.id);
        await generateBookmarksList(); // Refresh list
      });

      li.appendChild(a);
      li.appendChild(deleteButton);
      ul.appendChild(li);
    });
    tocOverlay.appendChild(ul);

    if (bookBookmarks.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No bookmarks for this book.';
      tocOverlay.appendChild(p);
    }
  };

  request.onerror = (event) => {
    console.error('Error fetching bookmarks:', event.target.error);
    const p = document.createElement('p');
    p.textContent = 'Error loading bookmarks.';
    tocOverlay.appendChild(p);
  };
}

async function gotoCFI(cfi) {
  if (!currentRendition) return;

  // First, display the section. This may not be the exact page.
  await currentRendition.display(cfi);

  // Now, loop until we are at the correct page or slightly past it.
  // A safety break is included to prevent infinite loops.
  for (let i = 0; i < 50; i++) {
    const currentLocation = currentRendition.currentLocation().start.cfi;
    const comparison = currentRendition.epubcfi.compare(cfi, currentLocation);

    if (comparison > 0) {
      // The target CFI is still ahead of us. Go to the next page and wait.
      await nextEpubPage();
    } else {
      // We have arrived at or moved just past the target CFI. Stop.
      return;
    }
  }

  console.warn('gotoCFI exited due to safety break.');
}

async function addNewBookmark() {
  if (!currentBookId || !currentRendition) return;

  const location = currentRendition.currentLocation();
  if (!location || !location.start || !location.end) {
    return;
  }
  const startCfi = location.start.cfi;
  const endCfi = location.end.cfi;

  const existing = await new Promise((resolve, reject) => {
    const trans = db.transaction([STORE_BOOKMARKS_NAME], 'readonly');
    const store = trans.objectStore(STORE_BOOKMARKS_NAME);
    const index = store.index('by_bookId');
    const request = index.openCursor(IDBKeyRange.only(currentBookId));
    let found = false;
    request.onsuccess = event => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.cfi === startCfi) {
          found = true;
        }
        cursor.continue();
      } else {
        resolve(found);
      }
    };
    request.onerror = event => reject(event.target.error);
  });

  if (existing) {
    alert("Bookmark for this location already exists.");
    return;
  }

  let textSnippet = "Bookmark"; // Default text
  try {
    const startRange = await currentBook.getRange(startCfi);
    const endRange = await currentBook.getRange(endCfi);
    const range = startRange.startContainer.ownerDocument.createRange();
    range.setStart(startRange.startContainer, startRange.startOffset);
    range.setEnd(endRange.endContainer, endRange.endOffset);

    const fragment = range.cloneContents();
    const div = document.createElement('div');
    div.appendChild(fragment);

    const text = extractBaseText(div).substring(0, 100);
    if (text) {
      textSnippet = text;
    }
  } catch (e) {
    console.error("Could not generate text snippet for bookmark:", e);
  }

  const newBookmark = {
    bookId: currentBookId,
    cfi: startCfi,
    text: textSnippet,
    created: Date.now()
  };

  const transaction = db.transaction([STORE_BOOKMARKS_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_BOOKMARKS_NAME);
  store.add(newBookmark);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = event => reject(event.target.error);
  });
}

async function deleteBookmark(bookmarkId) {
  if (!currentBookId) return;

  const transaction = db.transaction([STORE_BOOKMARKS_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_BOOKMARKS_NAME);
  store.delete(bookmarkId);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = event => reject(event.target.error);
  });
}

async function nextEpubPage() {
  if (!currentRendition) return;

  let setFinished = false;
  let atSectionEnd = false;
  if (currentRendition.location) {
    const { end } = currentRendition.location;
    atSectionEnd = (end.displayed.page >= end.displayed.total);
  }

  let promise;
  if (atSectionEnd) {
    const currentSection = currentRendition.manager.views.last().section;
    const nextSection = currentSection.next();
    if (nextSection) {
      promise = currentRendition.display(nextSection.href);
    } else {
      setFinished = true;
    }
  } else {
    promise = currentRendition.next();
  }

  if (promise) {
    await promise;
  }
  await saveLastLocation(setFinished);
}

async function prevEpubPage() {
  if (!currentRendition) return;
  await currentRendition.prev();
}

async function nextCbzPage() {
  const nextPageNum = currentComicPage + pagesCurrentlyDisplayed;
  if (nextPageNum < comicBookPages.length) {
    await displayComicPage(nextPageNum);
  } else {
    await saveLastLocation(true); // Mark as finished
  }
}

async function prevCbzPage() {
  let targetPage = currentComicPage - pagesCurrentlyDisplayed;
  if (currentComicPage > 0 && targetPage < 0) targetPage = 0;

  if (pagesCurrentlyDisplayed === 1 && currentComicPage > 0) {
    targetPage = currentComicPage - 2;
    if (targetPage < 0) targetPage = 0;
    if (soloPageExceptions.includes(targetPage + 1)) {
      targetPage = currentComicPage - 1;
    }
  } else {
    targetPage = currentComicPage - 2;
    if (targetPage < 0) targetPage = 0;
  }
  if (currentComicPage === 1) targetPage = 0;

  await displayComicPage(targetPage);
}

async function nextPage() {
  if (currentBookType === 'cbz') {
    await nextCbzPage();
  } else {
    await nextEpubPage();
  }
}

async function prevPage() {
  if (currentBookType === 'cbz') {
    await prevCbzPage();
  } else {
    await prevEpubPage();
  }
}

async function handleEpubKeyPress(event) {
  switch (event.key) {
    case 'ArrowLeft':
      if (currentBookDirection === 'rtl') nextEpubPage(); else prevEpubPage();
      break;
    case 'ArrowRight':
      if (currentBookDirection === 'rtl') prevEpubPage(); else nextEpubPage();
      break;
    case 'ArrowUp':
    case '+':
    case '=':
      increaseFontSize();
      break;
    case 'ArrowDown':
    case '-':
    case '_':
      decreaseFontSize();
      break;
    case '[':
      decreaseLineHeight();
      break;
    case ']':
      increaseLineHeight();
      break;
    case '0':
      resetFontSettings();
      break;
    case 'f':
    case 's':
      toggleFont();
      break;
    case 'd':
      toggleDarkMode();
      break;
    case 'm':
      toggleToc();
      break;
    case 'b':
      addNewBookmark();
      break;
    case '?':
      const helpOverlay = document.getElementById('help-overlay');
      if (helpOverlay.style.display === 'none') {
        generateHelpContent(currentBookType);
        helpOverlay.style.display = 'block';
      } else {
        helpOverlay.style.display = 'none';
      }
      break;
  }
}

async function handleCbzKeyPress(event) {
  switch (event.key) {
    case 'ArrowLeft':
      if (currentBookDirection === 'rtl') nextCbzPage(); else prevCbzPage();
      break;
    case 'ArrowRight':
      if (currentBookDirection === 'rtl') prevCbzPage(); else nextCbzPage();
      break;
    case 'd':
      toggleDirection();
      break;
    case 's':
      toggleSpread();
      break;
    case '?':
      const helpOverlay = document.getElementById('help-overlay');
      if (helpOverlay.style.display === 'none') {
        generateHelpContent(currentBookType);
        helpOverlay.style.display = 'block';
      } else {
        helpOverlay.style.display = 'none';
      }
      break;
  }
}

function generateHelpContent(bookType) {
  const contentDiv = document.getElementById('help-content');
  contentDiv.innerHTML = ''; // Clear existing content

  let shortcuts = [];
  if (bookType === 'cbz') {
    shortcuts = [
      { key: '←', description: 'Previous page' },
      { key: '→', description: 'Next page' },
      { key: 'd', description: 'Toggle reading direction (LTR/RTL)' },
      { key: 's', description: 'Toggle split/rejoin for current page' },
      { key: '?', description: 'Show/hide this help' }
    ];
  } else { // epub
    shortcuts = [
      { key: '←', description: 'Previous page' },
      { key: '→', description: 'Next page' },
      { key: '↑', description: 'Increase font size' },
      { key: '↓', description: 'Decrease font size' },
      { key: 's', description: 'Toggle font (serif/sans-serif)' },
      { key: 'd', description: 'Toggle dark mode' },
      { key: 'm', description: 'Toggle TOC/Bookmark' },
      { key: 'b', description: 'Add/remove bookmark' },
      { key: '?', description: 'Show/hide this help' }
    ];
  }

  shortcuts.forEach(shortcut => {
    const p = document.createElement('p');
    p.innerHTML = `<b>${shortcut.key}</b>: ${shortcut.description}`;
    contentDiv.appendChild(p);
  });
}

async function handleKeyPress(event) {
  if (document.getElementById('reader-view').style.display !== 'block' || (!currentRendition && currentBookType !== 'cbz')) {
    return;
  }
  event.stopPropagation();

  // Delegate to mode-specific handlers
  if (currentBookType === 'cbz') {
    await handleCbzKeyPress(event);
  } else {
    await handleEpubKeyPress(event);
  }
}

async function handleFileUpload(event) {
  const files = event.target.files;
  if (!files.length) {
    return;
  }

  const promises = [];
  for (const file of files) {
    const promise = new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const bookData = e.target.result;
        if (file.name.endsWith('.epub')) {
          storeBook(file.name, bookData).then(resolve).catch(reject);
        } else if (file.name.endsWith('.cbz')) {
          storeComicBook(file.name, bookData).then(resolve).catch(reject);
        } else {
          // Optional: handle unsupported file types
          console.warn(`Unsupported file type: ${file.name}`);
          resolve(); // Resolve to not block other uploads
        }
      };
      reader.onerror = (e) => {
        reject(new Error(`Error reading file: ${file.name}`));
      };
      reader.readAsArrayBuffer(file);
    });
    promises.push(promise);
  }

  try {
    await Promise.all(promises);
    displayBooks();
    // Reset the input so the user can upload the same file again
    event.target.value = null;
  } catch (error) {
    console.error("An error occurred during file upload:", error);
    // Optionally, display an error message to the user
  }
}

function storeBook(name, data) {
  return new Promise(async (resolve, reject) => {
    try {
      const bookInstance = ePub(data);
      const coverUrl = await bookInstance.coverUrl();
      let coverImage = null;

      if (coverUrl) {
        const response = await fetch(coverUrl);
        const originalBlob = await response.blob();
        coverImage = await resizeImageBlob(originalBlob);
        URL.revokeObjectURL(coverUrl); // Clean up blob URL
      }

      const transaction = db.transaction([STORE_BOOKS_NAME, STORE_METADATA_NAME], 'readwrite');
      const booksStore = transaction.objectStore(STORE_BOOKS_NAME);
      const metadataStore = transaction.objectStore(STORE_METADATA_NAME);

      const book = { name, data, coverImage, type: 'epub' };
      const request = booksStore.add(book);

      request.onsuccess = (event) => {
        const bookId = event.target.result;
        const metadata = { bookId: bookId, state: 'unread', progress: 0 };
        metadataStore.add(metadata);
      };

      transaction.oncomplete = () => {
        console.log('Book and metadata stored successfully');
        resolve();
      };

      transaction.onerror = (event) => {
        console.error('Transaction error in storeBook:', event.target.error);
        reject(event.target.error);
      };

    } catch (error) {
      console.error('Error processing book for storage:', error);
      reject(error);
    }
  });
}

async function storeComicBook(name, data) {
  return new Promise(async (resolve, reject) => {
    try {
      const zip = await JSZip.loadAsync(data);
      const imageFiles = Object.values(zip.files).filter(file =>
        !file.dir && /\.(jpe?g|png|gif|webp)$/i.test(file.name)
      ).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

      let coverImage = null;
      if (imageFiles.length > 0) {
        const firstImageFile = imageFiles[0];
        const blob = await firstImageFile.async('blob');
        coverImage = await resizeImageBlob(blob);
      }

      const transaction = db.transaction([STORE_BOOKS_NAME, STORE_METADATA_NAME], 'readwrite');
      const booksStore = transaction.objectStore(STORE_BOOKS_NAME);
      const metadataStore = transaction.objectStore(STORE_METADATA_NAME);

      const book = { name, data, coverImage, type: 'cbz' };
      const request = booksStore.add(book);

      request.onsuccess = (event) => {
        const bookId = event.target.result;
        const metadata = { bookId: bookId, state: 'unread', progress: 0 };
        metadataStore.add(metadata);
      };

      transaction.oncomplete = () => {
        console.log('Comic book and metadata stored successfully');
        resolve();
      };

      transaction.onerror = (event) => {
        console.error('Transaction error in storeComicBook:', event.target.error);
        reject(event.target.error);
      };

    } catch (error) {
      console.error('Error processing comic book for storage:', error);
      reject(error);
    }
  });
}

async function resizeImageBlob(blob, maxWidth = 400, maxHeight = 400) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      // Get the blob from the canvas
      canvas.toBlob((newBlob) => {
        URL.revokeObjectURL(img.src); // Clean up the object URL
        resolve(newBlob);
      }, blob.type);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(img.src);
      reject(err);
    };
    img.src = URL.createObjectURL(blob);
  });
}

function deleteBook(bookId, shouldRefresh = true) {
  const bookTx = db.transaction([STORE_BOOKS_NAME], 'readwrite');
  bookTx.objectStore(STORE_BOOKS_NAME).delete(bookId);

  const metaTx = db.transaction([STORE_METADATA_NAME], 'readwrite');
  metaTx.objectStore(STORE_METADATA_NAME).delete(bookId);

  const bookmarkTx = db.transaction([STORE_BOOKMARKS_NAME], 'readwrite');
  const bookmarkStore = bookmarkTx.objectStore(STORE_BOOKMARKS_NAME);
  const bookmarkIndex = bookmarkStore.index('by_bookId');
  const bookmarkRequest = bookmarkIndex.openCursor(IDBKeyRange.only(bookId));
  bookmarkRequest.onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };

  bookmarkTx.oncomplete = () => {
    console.log(`Bookmarks for book ${bookId} deleted.`);
    if (shouldRefresh) {
      displayBooks();
    }
  };
  bookmarkTx.onerror = (event) => {
    console.error('Error deleting bookmarks:', event.target.error);
  };
}

// --- Tag Editor Logic ---
let tagEditorState = {
  bookId: null,
  currentTagIds: new Set(),
  allTags: [],
};

async function openTagEditor(bookId, bookName) {
  tagEditorState.bookId = bookId;

  // Set title
  document.getElementById('tag-editor-title').textContent = `Edit Tags for: ${bookName}`;

  // Fetch all tags and the book's current tags in parallel
  const transaction = db.transaction([STORE_TAGS_NAME, STORE_BOOK_TAGS_NAME], 'readonly');
  const tagsStore = transaction.objectStore(STORE_TAGS_NAME);
  const bookTagsStore = transaction.objectStore(STORE_BOOK_TAGS_NAME);
  const bookTagsIndex = bookTagsStore.index('by_bookId');

  const allTagsPromise = new Promise(resolve => tagsStore.getAll().onsuccess = e => resolve(e.target.result));
  const bookTagsPromise = new Promise(resolve => bookTagsIndex.getAll(bookId).onsuccess = e => resolve(e.target.result));

  const [allTags, bookTags] = await Promise.all([allTagsPromise, bookTagsPromise]);

  tagEditorState.allTags = allTags;
  tagEditorState.currentTagIds = new Set(bookTags.map(bt => bt.tagId));

  renderTagsInEditor();

  // Show the modal
  document.getElementById('tag-editor-overlay').style.display = 'flex';
}

function renderTagsInEditor() {
  const currentTagsContainer = document.getElementById('current-tags');
  const allTagsContainer = document.getElementById('all-tags');
  currentTagsContainer.innerHTML = '';
  allTagsContainer.innerHTML = '';

  const tagsById = new Map(tagEditorState.allTags.map(t => [t.id, t]));

  tagEditorState.allTags.forEach(tag => {
    const isCurrent = tagEditorState.currentTagIds.has(tag.id);
    const pill = document.createElement('div');
    pill.className = 'tag-pill';
    pill.textContent = tag.name;

    if (isCurrent) {
      pill.dataset.tagId = tag.id;
      const removeBtn = document.createElement('span');
      removeBtn.className = 'remove-tag';
      removeBtn.textContent = 'x';
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        tagEditorState.currentTagIds.delete(tag.id);
        renderTagsInEditor();
      };
      pill.appendChild(removeBtn);
      currentTagsContainer.appendChild(pill);
    } else {
      pill.classList.add('add-tag');
      pill.onclick = () => {
        tagEditorState.currentTagIds.add(tag.id);
        renderTagsInEditor();
      };
      allTagsContainer.appendChild(pill);
    }
  });
}

async function addNewTagFromInput() {
  const input = document.getElementById('new-tag-name');
  const tagName = input.value.trim().toLowerCase();
  if (!tagName) return;

  // Check if tag already exists
  const existingTag = tagEditorState.allTags.find(t => t.name === tagName);
  if (existingTag) {
    tagEditorState.currentTagIds.add(existingTag.id);
    input.value = '';
    renderTagsInEditor();
    return;
  }

  // Tag doesn't exist, create it
  const transaction = db.transaction([STORE_TAGS_NAME], 'readwrite');
  const request = transaction.objectStore(STORE_TAGS_NAME).add({ name: tagName });

  request.onsuccess = (event) => {
    const newTagId = event.target.result;
    tagEditorState.allTags.push({ id: newTagId, name: tagName });
    tagEditorState.currentTagIds.add(newTagId);
    input.value = '';
    renderTagsInEditor();
  };
}

async function saveBookTags() {
  const bookId = tagEditorState.bookId;
  const newTagIds = tagEditorState.currentTagIds;

  const transaction = db.transaction([STORE_BOOK_TAGS_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_BOOK_TAGS_NAME);
  const index = store.index('by_bookId');

  // 1. Get all existing associations for this book
  const existingAssocs = await new Promise(resolve => index.getAll(bookId).onsuccess = e => resolve(e.target.result));

  // 2. Delete associations that are no longer needed
  existingAssocs.forEach(assoc => {
    if (!newTagIds.has(assoc.tagId)) {
      store.delete(assoc.id);
    }
  });

  // 3. Add new associations
  const existingTagIds = new Set(existingAssocs.map(a => a.tagId));
  newTagIds.forEach(tagId => {
    if (!existingTagIds.has(tagId)) {
      store.add({ bookId: bookId, tagId: tagId });
    }
  });

  transaction.oncomplete = () => {
    closeTagEditor();
  };
}

function closeTagEditor() {
  document.getElementById('tag-editor-overlay').style.display = 'none';
  tagEditorState = { bookId: null, currentTagIds: new Set(), allTags: [] }; // Reset state
}

// Hook up tag editor event listeners in the main load event
window.addEventListener('load', async () => {
  // ... (existing load event code)

  // Tag Editor buttons
  document.getElementById('tag-editor-cancel').addEventListener('click', closeTagEditor);
  document.getElementById('tag-editor-save').addEventListener('click', saveBookTags);
  document.getElementById('add-tag-btn').addEventListener('click', addNewTagFromInput);
  document.getElementById('new-tag-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addNewTagFromInput();
    }
  });
});


async function downloadBook(bookId) {
  try {
    const book = await getFromDB(STORE_BOOKS_NAME, bookId);
    if (!book || !book.data) {
      console.error('Book data not found for ID:', bookId);
      alert('Could not find book data to download.');
      return;
    }

    const blob = new Blob([book.data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = book.name;
    document.body.appendChild(a);
    a.click();

    // Cleanup
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);

  } catch (error) {
    console.error('Error downloading book:', error);
    alert('An error occurred while trying to download the book.');
  }
}

function updateBookState(bookId, state, shouldRefresh = true) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_METADATA_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_METADATA_NAME);
    const request = store.get(bookId);

    request.onerror = event => reject(event.target.error);

    request.onsuccess = () => {
      const data = request.result;
      if (data) {
        data.state = state;
        if (state === 'unread') {
          data.progress = 0;
          delete data.lastLocation;
        } else if (state === 'finished') {
          data.progress = 1;
        }
        store.put(data);
      }
    };

    transaction.oncomplete = () => {
      if (shouldRefresh) {
        displayBooks();
      }
      resolve();
    };

    transaction.onerror = event => reject(event.target.error);
  });
}



function displayBooks() {
  const bookGrid = document.getElementById('book-grid');
  while (bookGrid.firstChild) {
    bookGrid.removeChild(bookGrid.firstChild);
  }

  const transaction = db.transaction([STORE_BOOKS_NAME, STORE_METADATA_NAME, STORE_BOOK_TAGS_NAME], 'readonly');
  const store = transaction.objectStore(STORE_BOOKS_NAME);
  const request = store.getAll();

  request.onsuccess = async () => {
    const books = request.result;
    const metadataTransaction = db.transaction([STORE_METADATA_NAME], 'readonly');
    const metadataStore = metadataTransaction.objectStore(STORE_METADATA_NAME);
    const metadataRequest = metadataStore.getAll();

    metadataRequest.onsuccess = async () => {
      const metadataResults = metadataRequest.result;
      const metadataMap = new Map(metadataResults.map(m => [m.bookId, m]));

      // --- State Filtering ---
      const filterStateCheckboxes = document.querySelectorAll('#state-filter-options input[name="state"]');
      const activeStateFilters = [...filterStateCheckboxes].filter(cb => cb.checked).map(cb => cb.value);

      // --- Tag Filtering ---
      const filterTagCheckboxes = document.querySelectorAll('#tag-filter-options input[name="tag"]');
      const activeTagFilters = [...filterTagCheckboxes].filter(cb => cb.checked).map(cb => parseInt(cb.value, 10));

      let booksMatchingTags = null;
      if (activeTagFilters.length > 0) {
        const bookTagsTx = db.transaction([STORE_BOOK_TAGS_NAME], 'readonly');
        const bookTagsStore = bookTagsTx.objectStore(STORE_BOOK_TAGS_NAME);
        booksMatchingTags = new Set();

        for (const tagId of activeTagFilters) {
          const tagIndex = bookTagsStore.index('by_tagId');
          const booksForTag = await new Promise(resolve => tagIndex.getAll(tagId).onsuccess = e => resolve(e.target.result));
          booksForTag.forEach(bookTag => {
            booksMatchingTags.add(bookTag.bookId);
          });
        }
      }

      const filteredBooks = books.filter(book => {
        const meta = metadataMap.get(book.id);
        // State filter check
        if (!meta || !activeStateFilters.includes(meta.state)) {
          return false;
        }
        // Tag filter check
        if (booksMatchingTags && !booksMatchingTags.has(book.id)) {
          return false;
        }
        return true;
      });

      const sortBy = document.getElementById('sort-by').value;
      if (sortBy === 'title') {
        filteredBooks.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      } else if (sortBy === 'last-read') {
        filteredBooks.sort((a, b) => {
          const metaA = metadataMap.get(a.id);
          const metaB = metadataMap.get(b.id);
          const timeA = metaA ? metaA.lastReadTimestamp || 0 : 0;
          const timeB = metaB ? metaB.lastReadTimestamp || 0 : 0;
          return timeB - timeA;
        });
      }

      if (filteredBooks.length === 0) {
        bookGrid.innerHTML = '<p>No books match the current filters.</p>';
        return;
      }

      filteredBooks.forEach((book) => {
        const tile = document.createElement('div');
        tile.className = 'book-tile';
        tile.dataset.bookId = book.id;

        // --- Selection Logic ---
        let pressTimer;

        const startPress = (e) => {
          if (isSelectionModeActive) return;
          pressTimer = setTimeout(() => {
            e.preventDefault();
            enterSelectionMode();
          }, 500); // 500ms for long press
        };

        const cancelPress = () => {
          clearTimeout(pressTimer);
        };

        tile.addEventListener('mousedown', startPress);
        tile.addEventListener('mouseup', cancelPress);
        tile.addEventListener('mouseleave', cancelPress);
        tile.addEventListener('touchstart', startPress);
        tile.addEventListener('touchend', cancelPress);
        tile.addEventListener('touchcancel', cancelPress);

        tile.addEventListener('click', () => {
          if (isSelectionModeActive) {
            toggleSelection(book.id, tile);
          } else {
            openBook(book.id);
          }
        });

        const selectionIndicator = document.createElement('div');
        selectionIndicator.className = 'selection-indicator';
        tile.appendChild(selectionIndicator);

        const cover = document.createElement('div');
        cover.className = 'book-cover';
        tile.appendChild(cover);

        const title = document.createElement('div');
        title.className = 'book-title';
        title.textContent = book.name;
        tile.appendChild(title);

        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';
        const progress = document.createElement('div');
        progress.className = 'progress';
        progressBar.appendChild(progress);
        tile.appendChild(progressBar);

        const bookMeta = metadataMap.get(book.id);
        if (bookMeta && bookMeta.progress) {
          progress.style.width = `${bookMeta.progress * 100}%`;
        }

        if (bookMeta && bookMeta.state) {
          const stateOverlay = document.createElement('div');
          stateOverlay.className = 'state-overlay';
          stateOverlay.textContent = bookMeta.state.charAt(0).toUpperCase() + bookMeta.state.slice(1);
          cover.appendChild(stateOverlay);
        }

        const menu = document.createElement('div');
        menu.className = 'hamburger-menu';
        menu.innerHTML = `<div class="menu-dot"></div><div class="menu-dot"></div><div class="menu-dot"></div>`;
        tile.appendChild(menu);

        const menuContent = document.createElement('div');
        menuContent.className = 'menu-content';
        const deleteLink = document.createElement('a');
        deleteLink.href = '#';
        deleteLink.textContent = 'Delete';
        menuContent.appendChild(deleteLink);

        const downloadLink = document.createElement('a');
        downloadLink.href = '#';
        downloadLink.textContent = 'Download';
        menuContent.appendChild(downloadLink);

        const tagLink = document.createElement('a');
        tagLink.href = '#';
        tagLink.textContent = 'Edit Tags';
        tagLink.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openTagEditor(book.id, book.name);
          menuContent.classList.remove('show-menu');
        });
        menuContent.appendChild(tagLink);

        const resetMenu = document.createElement('div');
        resetMenu.innerHTML = '<hr><span>Reset State:</span>';
        menuContent.appendChild(resetMenu);

        const states = ['unread', 'reading', 'finished'];
        states.forEach(state => {
          const link = document.createElement('a');
          link.href = '#';
          link.textContent = state.charAt(0).toUpperCase() + state.slice(1);
          link.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await updateBookState(book.id, state);
            menuContent.classList.remove('show-menu');
          });
          resetMenu.appendChild(link);
        });

        menu.appendChild(menuContent);

        menu.addEventListener('click', (event) => {
          event.stopPropagation();
          menuContent.classList.toggle('show-menu');
        });

        deleteLink.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (confirm(`Are you sure you want to delete "${book.name}"?`)) {
            deleteBook(book.id);
          }
        });

        downloadLink.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          downloadBook(book.id);
          menuContent.classList.remove('show-menu');
        });

        bookGrid.appendChild(tile);

        // Handle cover image display
        if (book.coverImage instanceof Blob) {
          const imageUrl = URL.createObjectURL(book.coverImage);
          const img = document.createElement('img');
          img.src = imageUrl;
          cover.appendChild(img);
        } else {
          const bookInstance = ePub(book.data);
          bookInstance.coverUrl().then(async (url) => {
            if (url) {
              const response = await fetch(url);
              const originalBlob = await response.blob();
              const blob = await resizeImageBlob(originalBlob);

              // Save the blob back to the database
              const readwriteTx = db.transaction([STORE_BOOKS_NAME], 'readwrite');
              const store = readwriteTx.objectStore(STORE_BOOKS_NAME);
              const getReq = store.get(book.id);
              getReq.onsuccess = () => {
                const bookToUpdate = getReq.result;
                bookToUpdate.coverImage = blob;
                store.put(bookToUpdate);
              };

              const imageUrl = URL.createObjectURL(blob);
              const img = document.createElement('img');
              img.src = imageUrl;
              cover.appendChild(img);
            } else {
              cover.textContent = 'No cover';
            }
          });
        }
      });
    };
  };

  request.onerror = (event) => {
    console.error('Error fetching books:', event.target.errorCode);
  };
}

function toggleSelection(bookId, tileElement) {
  if (selectedBookIds.has(bookId)) {
    selectedBookIds.delete(bookId);
    tileElement.classList.remove('selected');
  } else {
    selectedBookIds.add(bookId);
    tileElement.classList.add('selected');
  }
  updateSelectionCount();
}

function openBook(bookId) {
  if (isSelectionModeActive) return;
  currentBookId = bookId;

  Promise.all([
    getFromDB(STORE_BOOKS_NAME, bookId),
    getFromDB(STORE_METADATA_NAME, bookId)
  ]).then(([bookRecord, metadataRecord]) => {
    let needsUpdate = false;
    if (metadataRecord) {
      // Repair existing data if progress is missing
      if (typeof metadataRecord.progress === 'undefined') {
        metadataRecord.progress = 0;
        needsUpdate = true;
      }
      // Update state to 'reading' if it's 'unread'
      if (metadataRecord.state === 'unread') {
        metadataRecord.state = 'reading';
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      const transaction = db.transaction([STORE_METADATA_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_METADATA_NAME);
      store.put(metadataRecord);
    }

    const bookData = bookRecord.data;
    currentBookType = bookRecord.type || 'epub'; // Default to epub for older data

    if (currentBookType === 'cbz') {
      openComicBook(bookRecord, metadataRecord);
    } else {
      openRendition(bookData, metadataRecord);
    }
  }).catch(error => {
    console.error("Error opening book:", error);
    // Optionally, show an error to the user
  });
}

async function openComicBook(bookRecord, metadata) {
  soloPageExceptions = (metadata && metadata.soloPageExceptions) ? metadata.soloPageExceptions : [];
  comicInfoPageLayouts = new Map(); // Clear for new book

  document.getElementById('book-management').style.display = 'none';
  const readerView = document.getElementById('reader-view');
  readerView.style.display = 'block';
  readerView.classList.add('comic-mode'); // Add class to hide epub controls

  window.addEventListener('keydown', handleKeyPress);
  readerView.addEventListener('mousemove', showControls);
  showControls();

  let title = bookRecord.name || ''; // Default to an empty string if name is null/undefined
  document.getElementById('book-title-display').textContent = title.replace(/\.(cbz|epub)$/i, ''); // Use filename as default, remove extension

  const zip = await JSZip.loadAsync(bookRecord.data);

  // Look for ComicInfo.xml
  const comicInfoFile = Object.values(zip.files).find(file => file.name.toLowerCase().endsWith('comicinfo.xml'));
  let directionFromComicInfo = 'rtl'; // Default

  if (comicInfoFile) {
    const xmlString = await comicInfoFile.async('string');
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    const title = xmlDoc.getElementsByTagName('Title')[0]?.textContent;
    if (title) {
      document.getElementById('book-title-display').textContent = title;
    }
    const direction = xmlDoc.getElementsByTagName('ReadingDirection')[0]?.textContent;
    if (direction && direction.toLowerCase() !== 'righttoleft') {
      directionFromComicInfo = 'ltr';
    }

    // Parse page layout information
    const pagesElement = xmlDoc.getElementsByTagName('Pages')[0];
    if (pagesElement) {
      const pageElements = pagesElement.getElementsByTagName('Page');
      for (let i = 0; i < pageElements.length; i++) {
        const pageElement = pageElements[i];
        const imageAttribute = pageElement.getAttribute('Image');
        const doublePageAttribute = pageElement.getAttribute('DoublePage');

        if (imageAttribute && doublePageAttribute === 'true') {
          comicInfoPageLayouts.set(imageAttribute, 'double');
        }
      }
    }
  }

  // Set direction based on priority: 1. Saved Metadata, 2. ComicInfo, 3. Default
  if (metadata && metadata.direction) {
    currentBookDirection = metadata.direction;
  } else {
    currentBookDirection = directionFromComicInfo;
  }

  updateDirectionButton();


  comicBookPages = Object.values(zip.files).filter(file =>
    !file.dir && /\.(jpe?g|png|gif|webp)$/i.test(file.name)
  ).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  // Now that comicBookPages is populated, resolve filenames to indices for comicInfoPageLayouts
  const resolvedComicInfoPageLayouts = new Map();
  comicBookPages.forEach((file, index) => {
    if (comicInfoPageLayouts.get(file.name)) {
      resolvedComicInfoPageLayouts.set(index, comicInfoPageLayouts.get(file.name));
    }
  });
  comicInfoPageLayouts = resolvedComicInfoPageLayouts;

  currentComicPage = 0;
  if (metadata && metadata.lastLocation) {
    currentComicPage = parseInt(metadata.lastLocation, 10) || 0;
  }

  displayComicPage(currentComicPage);
}

async function displayComicPage(pageNumber) {
  if (pageNumber < 0 || pageNumber >= comicBookPages.length) {
    return;
  }
  currentComicPage = pageNumber;
  const viewer = document.getElementById('viewer');
  viewer.innerHTML = ''; // Clear previous content
  viewer.style.display = 'flex'; // Use flexbox for layout

  const readerView = document.getElementById('reader-view');
  const spreadToggleButton = document.getElementById('spread-toggle');

  // --- Layout Decision Logic ---
  const page1File = comicBookPages[pageNumber];
  const page2File = (pageNumber + 1 < comicBookPages.length) ? comicBookPages[pageNumber + 1] : null;

  const [page1Dims, page2Dims] = await Promise.all([
    getImageDimensions(page1File),
    getImageDimensions(page2File)
  ]);

  const viewerDims = { width: viewer.clientWidth, height: viewer.clientHeight };

  let layout = 'single'; // Default layout

  // 1. Level 1: Manual User Override (Highest Priority)
  if (soloPageExceptions.includes(pageNumber)) {
    layout = 'single';
  } else if (pageNumber === 0 || !page2File) {
    // Edge cases: Cover page or no next page always single
    layout = 'single';
  } else if (comicInfoPageLayouts.get(pageNumber) === 'double') {
    // 2. Level 2: Explicit Metadata from ComicInfo.xml (Second Priority)
    layout = 'double';
  } else if (viewerDims.width > viewerDims.height) { // Only consider two-page layout in landscape
    // 3. Level 3: Automatic "Wasted Pixel" Calculation (Lowest Priority)
    // Calculate wasted pixels for single page
    const scaleSingle = Math.min(viewerDims.width / page1Dims.width, viewerDims.height / page1Dims.height);
    const areaSingle = (page1Dims.width * scaleSingle) * (page1Dims.height * scaleSingle);
    const wastedSingle = (viewerDims.width * viewerDims.height) - areaSingle;

    // Calculate wasted pixels for double page
    const combinedWidth = page1Dims.width + page2Dims.width;
    const combinedHeight = Math.max(page1Dims.height, page2Dims.height);
    const scaleDouble = Math.min(viewerDims.width / combinedWidth, viewerDims.height / combinedHeight);
    const areaDouble = (combinedWidth * scaleDouble) * (combinedHeight * scaleDouble);
    const wastedDouble = (viewerDims.width * viewerDims.height) - areaDouble;

    if (wastedDouble < wastedSingle) {
      layout = 'double';
    }
  }

  // --- Rendering Logic ---
  pagesCurrentlyDisplayed = 0;
  readerView.classList.remove('show-spread-toggle');
  spreadToggleButton.textContent = 'Split';

  const isSoloException = soloPageExceptions.includes(pageNumber);
  if (isSoloException) {
      readerView.classList.add('show-spread-toggle');
      spreadToggleButton.textContent = 'Rejoin';
  }


  const filesToRender = [];
  if (layout === 'double') {
    filesToRender.push(page1File, page2File);
    pagesCurrentlyDisplayed = 2;
    readerView.classList.add('show-spread-toggle');
  } else {
    filesToRender.push(page1File);
    pagesCurrentlyDisplayed = 1;
  }

  const imagePromises = filesToRender.map(file => file.async('blob').then(blob => URL.createObjectURL(blob)));
  const imageUrls = await Promise.all(imagePromises);

  const fragment = document.createDocumentFragment();
  const imageElements = [];
  imageUrls.forEach(url => {
    const img = document.createElement('img');
    img.src = url;
    img.style.objectFit = 'contain';
    img.style.maxHeight = '100%'; // Keep this to handle edge cases
    img.onload = () => URL.revokeObjectURL(url); // Revoke on load
    fragment.appendChild(img);
    imageElements.push(img);
  });

  // --- New Scaling Logic ---
  // Get dimensions of all images that will be rendered
  const allDims = await Promise.all(imageElements.map(img => new Promise(resolve => {
    if (img.complete) {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    } else {
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    }
  })));

  // Calculate the total dimensions of the spread
  const totalWidth = allDims.reduce((sum, dim) => sum + dim.width, 0);
  const maxHeight = Math.max(...allDims.map(dim => dim.height));

  // Calculate the scale factor to fit the spread in the viewer
  const viewerWidth = viewer.clientWidth;
  const viewerHeight = viewer.clientHeight;
  const scale = Math.min(viewerWidth / totalWidth, viewerHeight / maxHeight);

  // Apply the calculated dimensions to each image
  allDims.forEach((dim, index) => {
    imageElements[index].style.width = `${dim.width * scale}px`;
    imageElements[index].style.height = `${dim.height * scale}px`;
  });


  if (currentBookDirection === 'rtl') {
      Array.from(fragment.children).reverse().forEach(child => viewer.appendChild(child));
  } else {
      viewer.appendChild(fragment);
  }

  await saveLastLocation();
  updateProgressIndicator();
}

function getImageDimensions(pageFile) {
  return new Promise((resolve, reject) => {
    if (!pageFile) {
      return resolve(null);
    }
    pageFile.async('blob').then(blob => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        reject(new Error('Could not load image dimensions'));
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  });
}

function getFromDB(storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

function openRendition(bookData, metadata) {
  // Reset settings to default before applying book-specific ones
  currentFontSize = 100;
  currentLineHeight = 1.5;
  currentFont = 'sans-serif';

  if (metadata) {
    if (metadata.fontSize) {
      currentFontSize = metadata.fontSize;
    }
    if (metadata.lineHeight) {
      currentLineHeight = metadata.lineHeight;
    }
    if (metadata.font) {
      currentFont = metadata.font;
    }
  }

  document.getElementById('font-size-value').textContent = currentFontSize + '%';
  document.getElementById('line-height-value').textContent = currentLineHeight;

  const cfi = metadata ? metadata.lastLocation : null;

  document.getElementById('book-management').style.display = 'none';
  const readerView = document.getElementById('reader-view');
  readerView.style.display = 'block';

  window.addEventListener('keydown', handleKeyPress);
  readerView.addEventListener('mousemove', showControls);
  showControls(); // Show controls when book is opened

  currentBook = ePub(bookData);

  currentBook.loaded.metadata.then(meta => {
    document.getElementById('book-title-display').textContent = meta.title;
    currentBookLanguage = meta.language || 'en-US'; // Store the book's language
  });

  currentBook.ready.then(async () => {
    currentBookLocationsPromise = currentBook.locations.generate();
    currentBookDirection = currentBook.packaging.metadata.direction || 'ltr';

    currentRendition = currentBook.renderTo('viewer', { width: '100%', height: '100%' });

    currentRendition.on('relocated', (location) => {
      updateProgressIndicator();
      saveLastLocation();
    });

    currentRendition.on('rendered', () => {
      const view = currentRendition.manager.views.last();
      if (view && view.iframe) {
        view.iframe.contentWindow.addEventListener('keydown', handleKeyPress);
        addMouseHandlers(view.iframe.contentWindow);
        view.iframe.contentWindow.focus();
      }
    });

    // Apply themes that might have been set before rendition was ready
    currentRendition.themes.fontSize(currentFontSize + '%');
    currentRendition.themes.override('line-height', currentLineHeight);
    applyFont();
    if (isDarkMode) {
      currentRendition.themes.override('color', '#e0e0e0');
      currentRendition.themes.override('background', '#121212');
    }

    if (cfi) {
      await gotoCFI(cfi);
    } else {
      await currentRendition.display();
    }
    await saveLastLocation();
  });
}
