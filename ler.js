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
let currentBookDirection = 'ltr';
let currentFontSize = 100;
let currentLineHeight = 1.5;
let controlsTimer = null;
let currentBookLocationsPromise = null;
let isClosing = false;

function showControls() {
  const controls = document.getElementById('reader-controls');
  controls.classList.remove('controls-hidden');

  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(hideControls, 3000);
}

function hideControls() {
  const controls = document.getElementById('reader-controls');
  controls.classList.add('controls-hidden');
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


  const prevPageArea = document.getElementById('prev-page-area');
  prevPageArea.addEventListener('click', () => {
    if (currentBookDirection === 'rtl') {
      nextPage();
    } else {
      prevPage();
    }
  });

  const nextPageArea = document.getElementById('next-page-area');
  nextPageArea.addEventListener('click', () => {
    if (currentBookDirection === 'rtl') {
      prevPage();
    } else {
      nextPage();
    }
  });

  const centerPageArea = document.getElementById('center-page-area');
  centerPageArea.addEventListener('click', showControls);

  const filterCheckboxes = document.querySelectorAll('#filters input[name="state"]');
  filterCheckboxes.forEach(cb => cb.addEventListener('change', displayBooks));

  const sortBy = document.getElementById('sort-by');
  sortBy.addEventListener('change', displayBooks);
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
  displayBooks(); // Refresh the book list
  currentRendition = null;
  currentBook = null;
  currentBookId = null;
  currentBookDirection = 'ltr';
  currentBookLocationsPromise = null;

  isClosing = false; // Release the lock
}

async function saveLastLocation() {
  if (!currentRendition || !currentBookId || !currentBook || !currentBookLocationsPromise) {
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

async function resetFontSettings() {
  if (!currentRendition) return;
  currentFontSize = 100;
  currentLineHeight = 1.5;
  currentRendition.themes.fontSize(currentFontSize + '%');
  currentRendition.themes.override('line-height', currentLineHeight);
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
  if (!currentRendition) return;

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
      // Reached the end of the book
      const transaction = db.transaction([STORE_METADATA_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_METADATA_NAME);
      const request = store.get(currentBookId);
      request.onsuccess = () => {
        const data = request.result;
        if (data) {
          data.state = 'finished';
          store.put(data);
        }
      };
      // Even at the end, we call saveLastLocation to correctly record the final progress
      await saveLastLocation();
    }
  } else {
    promise = currentRendition.next();
  }

  if (promise) {
    await promise;
    await saveLastLocation();
  }
}

async function prevPage() {
  if (!currentRendition) return;
  await currentRendition.prev();
  await saveLastLocation();
}

async function handleKeyPress(event) {
  if (document.getElementById('reader-view').style.display !== 'block' || !currentRendition) {
    return;
  }
  event.stopPropagation();

  switch (event.key) {
    case 'ArrowLeft':
      if (currentBookDirection === 'rtl') {
        nextPage();
      } else {
        prevPage();
      }
      break;
    case 'ArrowRight':
      if (currentBookDirection === 'rtl') {
        prevPage();
      } else {
        nextPage();
      }
      break;
    case '+':
    case '=': // Also handle '=' for keyboards where + is a shift key
      increaseFontSize();
      break;
    case '-':
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
        storeBook(file.name, bookData).then(resolve).catch(reject);
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

      const book = { name, data, coverImage };
      const request = booksStore.add(book);

      request.onsuccess = (event) => {
        const bookId = event.target.result;
        const metadata = { bookId: bookId, state: 'unopened', progress: 0 };
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
      if (state === 'unopened') {
        data.progress = 0;
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

        const states = ['unopened', 'reading', 'finished'];
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
      // Update state to 'reading' if it's 'unopened'
      if (metadataRecord.state === 'unopened') {
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
    openRendition(bookData, metadataRecord);
  }).catch(error => {
    console.error("Error opening book:", error);
    // Optionally, show an error to the user
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

  if (metadata) {
    if (metadata.fontSize) {
      currentFontSize = metadata.fontSize;
    }
    if (metadata.lineHeight) {
      currentLineHeight = metadata.lineHeight;
    }
  }

  document.getElementById('font-size-value').textContent = currentFontSize + '%';
  document.getElementById('line-height-value').textContent = currentLineHeight;

  const cfi = metadata ? metadata.lastLocation : null;

  document.getElementById('book-management').style.display = 'none';
  const readerView = document.getElementById('reader-view');
  readerView.style.display = 'block';

  window.addEventListener('keydown', handleKeyPress);
  addMouseHandlers(readerView);
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

    if (cfi) {
      await gotoCFI(cfi);
    } else {
      await currentRendition.display();
    }
    await saveLastLocation();
  });
}
