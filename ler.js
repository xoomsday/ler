// LER javascript

const DB_NAME = 'ler-books';
const DB_VERSION = 2;
const STORE_BOOKS_NAME = 'epubs';
const STORE_METADATA_NAME = 'metadata';
const STORE_BOOKMARKS_NAME = 'bookmarks';

let db;
let currentBook;
let currentRendition;
let currentBookId = null;
let currentBookType = null;
let currentBookDirection = 'ltr';
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

  const filterCheckboxes = document.querySelectorAll('#filters input[name="state"]');
  filterCheckboxes.forEach(cb => cb.addEventListener('change', displayBooks));

  const sortBy = document.getElementById('sort-by');
  sortBy.addEventListener('change', displayBooks);

  const helpOverlay = document.getElementById('help-overlay');
  const helpClose = document.getElementById('help-close');
  helpClose.addEventListener('click', () => {
    helpOverlay.style.display = 'none';
  });
});

async function closeReader() {
  if (isClosing) return; // Prevent re-entrancy
  isClosing = true;

  await saveLastLocation();

  const readerView = document.getElementById('reader-view');
  window.removeEventListener('keydown', handleKeyPress);
  removeMouseHandlers(readerView);
  clearTimeout(controlsTimer);

  document.getElementById('reader-view').style.display = 'none';
  document.getElementById('viewer').innerHTML = '';
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
      await nextPage();
    } else {
      // We have arrived at or moved just past the target CFI. Stop.
      return;
    }
  }

  console.warn('gotoCFI exited due to safety break.');
}

async function addNewBookmark() {
  if (!currentBookId || !currentRendition) return;

  const cfi = currentRendition.currentLocation().start.cfi;

  const existing = await new Promise((resolve, reject) => {
    const trans = db.transaction([STORE_BOOKMARKS_NAME], 'readonly');
    const store = trans.objectStore(STORE_BOOKMARKS_NAME);
    const index = store.index('by_bookId');
    const request = index.openCursor(IDBKeyRange.only(currentBookId));
    let found = false;
    request.onsuccess = event => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.cfi === cfi) {
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
    const range = await currentBook.getRange(cfi);
    if (range && range.commonAncestorContainer && range.commonAncestorContainer.textContent) {
        const content = range.commonAncestorContainer.textContent.trim().replace(/\s+/g, ' ');
        const startIndex = Math.max(0, range.startOffset - 50);
        const text = content.substring(startIndex, startIndex + 100);
        if (text) {
            textSnippet = text;
        }
    }
  } catch (e) {
    console.error("Could not generate text snippet for bookmark:", e);
  }

  const newBookmark = {
    bookId: currentBookId,
    cfi: cfi,
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

async function nextPage() {
  if (currentBookType === 'cbz') {
    const nextPageNum = currentComicPage + pagesCurrentlyDisplayed;
    if (nextPageNum < comicBookPages.length) {
      await displayComicPage(nextPageNum);
    } else {
      await saveLastLocation(true); // Mark as finished
    }
  } else { // EPUB
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
}

async function prevPage() {
  if (currentBookType === 'cbz') {
    let prevPageNum = currentComicPage - 2; // Assume we came from a 2-page spread
    if (prevPageNum < 0) prevPageNum = 0;

    // If the previous page is a solo exception, we might only need to go back 1
    if (soloPageExceptions.includes(prevPageNum)) {
       prevPageNum = currentComicPage - 1;
    }
    // A more robust way is needed, but for now, this is a simple heuristic.
    // A truly robust solution would require knowing the layout of the previous page.
    // Let's refine: just go back 1 or 2 pages.
    let targetPage = currentComicPage - pagesCurrentlyDisplayed;
    if (currentComicPage > 0 && targetPage < 0) targetPage = 0; // Don't go before the start

    // A simple heuristic to handle jumping back from a solo page to a spread
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

  } else { // EPUB
    if (!currentRendition) return;
    await currentRendition.prev();
    await saveLastLocation();
  }
}

async function handleEpubKeyPress(event) {
  switch (event.key) {
    case 'ArrowUp':
    case '-':
    case '_':
      decreaseFontSize();
      break;
    case 'ArrowDown':
    case '+':
    case '=':
      increaseFontSize();
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
        helpOverlay.style.display = 'block';
      } else {
        helpOverlay.style.display = 'none';
      }
      break;
  }
}

async function handleCbzKeyPress(event) {
  switch (event.key) {
    case 'd':
      toggleDirection();
      break;
    case 's':
      toggleSpread();
      break;
    case '?':
      const helpOverlay = document.getElementById('help-overlay');
      if (helpOverlay.style.display === 'none') {
        helpOverlay.style.display = 'block';
      } else {
        helpOverlay.style.display = 'none';
      }
      break;
  }
}

async function handleKeyPress(event) {
  if (document.getElementById('reader-view').style.display !== 'block' || (!currentRendition && currentBookType !== 'cbz')) {
    return;
  }
  event.stopPropagation();

  // Handle shared keys first
  switch (event.key) {
    case 'ArrowLeft':
      if (currentBookDirection === 'rtl') {
        nextPage();
      } else {
        prevPage();
      }
      return; // Consume event
    case 'ArrowRight':
      if (currentBookDirection === 'rtl') {
        prevPage();
      } else {
        nextPage();
      }
      return; // Consume event
  }

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

function deleteBook(bookId) {
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
    displayBooks();
  };
  bookmarkTx.onerror = (event) => {
    console.error('Error deleting bookmarks:', event.target.error);
  };
}

function updateBookState(bookId, state) {
  const transaction = db.transaction([STORE_METADATA_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_METADATA_NAME);
  const request = store.get(bookId);
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
    displayBooks();
  };
}



function displayBooks() {
  const bookGrid = document.getElementById('book-grid');
  while (bookGrid.firstChild) {
    bookGrid.removeChild(bookGrid.firstChild);
  }

  const transaction = db.transaction([STORE_BOOKS_NAME], 'readonly');
  const store = transaction.objectStore(STORE_BOOKS_NAME);
  const request = store.getAll();

  request.onsuccess = () => {
    const books = request.result;
    const metadataTransaction = db.transaction([STORE_METADATA_NAME], 'readonly');
    const metadataStore = metadataTransaction.objectStore(STORE_METADATA_NAME);
    const metadataRequest = metadataStore.getAll();

    metadataRequest.onsuccess = () => {
      const metadataResults = metadataRequest.result;
      const metadataMap = new Map(metadataResults.map(m => [m.bookId, m]));

      const filterStateCheckboxes = document.querySelectorAll('#filters input[name="state"]');
      const activeFilters = [...filterStateCheckboxes].filter(cb => cb.checked).map(cb => cb.value);

      const filteredBooks = books.filter(book => {
        const meta = metadataMap.get(book.id);
        return meta && activeFilters.includes(meta.state);
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
        tile.addEventListener('click', () => openBook(book.id));

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

        const resetMenu = document.createElement('div');
        resetMenu.innerHTML = '<hr><span>Reset State:</span>';
        menuContent.appendChild(resetMenu);

        const states = ['unread', 'reading', 'finished'];
        states.forEach(state => {
          const link = document.createElement('a');
          link.href = '#';
          link.textContent = state.charAt(0).toUpperCase() + state.slice(1);
          link.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            updateBookState(book.id, state);
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

function openBook(bookId) {
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
      openComicBook(bookData, metadataRecord);
    } else {
      openRendition(bookData, metadataRecord);
    }
  }).catch(error => {
    console.error("Error opening book:", error);
    // Optionally, show an error to the user
  });
}

async function openComicBook(bookData, metadata) {
  soloPageExceptions = (metadata && metadata.soloPageExceptions) ? metadata.soloPageExceptions : [];
  comicInfoPageLayouts = new Map(); // Clear for new book

  document.getElementById('book-management').style.display = 'none';
  const readerView = document.getElementById('reader-view');
  readerView.style.display = 'block';
  readerView.classList.add('comic-mode'); // Add class to hide epub controls

  window.addEventListener('keydown', handleKeyPress);
  readerView.addEventListener('mousemove', showControls);
  showControls();

  document.getElementById('book-title-display').textContent = "Comic Book"; // Placeholder

  const zip = await JSZip.loadAsync(bookData);

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
  imageUrls.forEach(url => {
    const img = document.createElement('img');
    img.src = url;
    img.style.objectFit = 'contain';
    img.style.maxWidth = `${100 / imageUrls.length}%`;
    img.style.maxHeight = '100%';
    img.onload = () => URL.revokeObjectURL(url); // Revoke on load
    fragment.appendChild(img);
  });

  if (currentBookDirection === 'rtl') {
      Array.from(fragment.children).reverse().forEach(child => viewer.appendChild(child));
  } else {
      viewer.appendChild(fragment);
  }

  await saveLastLocation();
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
  });

  currentBook.ready.then(async () => {
    currentBookLocationsPromise = currentBook.locations.generate();
    currentBookDirection = currentBook.packaging.metadata.direction || 'ltr';

    currentRendition = currentBook.renderTo('viewer', { width: '100%', height: '100%' });

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
