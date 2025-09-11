// LER javascript

const DB_NAME = 'ler-books';
const DB_VERSION = 1;
const STORE_BOOKS_NAME = 'epubs';
const STORE_METADATA_NAME = 'metadata';

let db;
let currentBook;
let currentRendition;
let currentBookId = null;
let currentBookDirection = 'ltr';
let currentFontSize = 100;
let currentLineHeight = 1.5;
let controlsTimer = null;

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

window.addEventListener('load', async () => {
  await initDB();
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
});

async function closeReader() {
  await saveLastLocation();

  const readerView = document.getElementById('reader-view');
  window.removeEventListener('keydown', handleKeyPress);
  removeMouseHandlers(readerView);
  clearTimeout(controlsTimer);

  document.getElementById('reader-view').style.display = 'none';
  document.getElementById('viewer').innerHTML = '';
  document.getElementById('book-management').style.display = 'block';
  currentRendition = null;
  currentBook = null;
  currentBookId = null;
  currentBookDirection = 'ltr';
}

function saveLastLocation() {
  return new Promise((resolve, reject) => {
    if (!currentRendition || !currentBookId) {
      return resolve(); // Nothing to save
    }

    try {
      const cfi = currentRendition.currentLocation().start.cfi;
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
        store.put(data);
      };
    } catch (e) {
      // This can happen if the rendition is not ready yet
      console.warn("Could not save last location:", e);
      resolve(); // Resolve anyway so we don't block closing
    }
  });
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
  await saveBookSettings();
}

async function decreaseFontSize() {
  if (!currentRendition) return;
  if (currentFontSize > 10) {
    currentFontSize -= 10;
    currentRendition.themes.fontSize(currentFontSize + '%');
    await saveBookSettings();
  }
}

async function increaseLineHeight() {
  if (!currentRendition) return;
  currentLineHeight += 0.1;
  currentRendition.themes.override('line-height', currentLineHeight);
  await saveBookSettings();
}

async function decreaseLineHeight() {
  if (!currentRendition) return;
  if (currentLineHeight > 1) {
    currentLineHeight -= 0.1;
    currentRendition.themes.override('line-height', currentLineHeight);
    await saveBookSettings();
  }
}

async function resetFontSettings() {
  if (!currentRendition) return;
  currentFontSize = 100;
  currentLineHeight = 1.5;
  currentRendition.themes.fontSize(currentFontSize + '%');
  currentRendition.themes.override('line-height', currentLineHeight);
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

  const bookmarks = JSON.parse(localStorage.getItem('ler-bookmarks')) || {};
  const bookBookmarks = bookmarks[currentBookId] || [];

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
      // The gotoCFI function now returns a promise that resolves when
      // navigation is complete. We wait for it, and then hide the overlay.
      try {
        await gotoCFI(bookmark.cfi);
        toggleOverlay('bookmarks');
      } catch (e) {
        console.error("Error navigating to CFI:", e);
        // On error, we leave the overlay open as a visual indicator.
      }
    });

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'X';
    deleteButton.className = 'delete-bookmark';
    deleteButton.addEventListener('click', async () => {
      await deleteBookmark(bookmark.cfi);
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

  const bookmarks = JSON.parse(localStorage.getItem('ler-bookmarks')) || {};
  const bookBookmarks = bookmarks[currentBookId] || [];
  if (bookBookmarks.some(b => b.cfi === cfi)) {
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
    cfi: cfi,
    text: textSnippet,
    created: Date.now()
  };

  if (!bookmarks[currentBookId]) {
    bookmarks[currentBookId] = [];
  }
  bookmarks[currentBookId].push(newBookmark);
  localStorage.setItem('ler-bookmarks', JSON.stringify(bookmarks));
}

async function deleteBookmark(cfi) {
  if (!currentBookId) return;

  const bookmarks = JSON.parse(localStorage.getItem('ler-bookmarks')) || {};
  let bookBookmarks = bookmarks[currentBookId] || [];

  bookBookmarks = bookBookmarks.filter(b => b.cfi !== cfi);

  bookmarks[currentBookId] = bookBookmarks;
  localStorage.setItem('ler-bookmarks', JSON.stringify(bookmarks));
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

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const bookData = e.target.result;
    storeBook(file.name, bookData);
  };
  reader.readAsArrayBuffer(file);
}

function storeBook(name, data) {
  const transaction = db.transaction([STORE_BOOKS_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_BOOKS_NAME);
  const book = { name, data };
  const request = store.add(book);

  request.onsuccess = () => {
    console.log('Book stored successfully');
    displayBooks();
  };

  request.onerror = (event) => {
    console.error('Error storing book:', event.target.errorCode);
  };
}

function displayBooks() {
  const bookList = document.getElementById('book-list');
  bookList.innerHTML = '';

  const transaction = db.transaction([STORE_BOOKS_NAME], 'readonly');
  const store = transaction.objectStore(STORE_BOOKS_NAME);
  const request = store.getAll();

  request.onsuccess = () => {
    const books = request.result;
    if (books.length === 0) {
      bookList.innerHTML = '<p>No books uploaded yet.</p>';
      return;
    }

    const ul = document.createElement('ul');
    books.forEach((book) => {
      const li = document.createElement('li');
      const openButton = document.createElement('button');
      openButton.textContent = 'Read ' + book.name;
      openButton.addEventListener('click', () => openBook(book.id));
      li.appendChild(openButton);
      ul.appendChild(li);
    });
    bookList.appendChild(ul);
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

  const cfi = metadata ? metadata.lastLocation : null;

  document.getElementById('book-management').style.display = 'none';
  const readerView = document.getElementById('reader-view');
  readerView.style.display = 'block';

  window.addEventListener('keydown', handleKeyPress);
  addMouseHandlers(readerView);
  showControls(); // Show controls when book is opened

  currentBook = ePub(bookData);

  currentBook.ready.then(async () => {
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
