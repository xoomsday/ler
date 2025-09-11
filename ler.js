// LER javascript

const DB_NAME = 'ler-books';
const DB_VERSION = 1;
const STORE_NAME = 'epubs';

let db;
let currentBook;
let currentRendition;
let currentBookId = null;
let currentBookDirection = 'ltr';
let currentFontSize = 100;
let currentLineHeight = 1.5;

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);


    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
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
});

function closeReader() {
  document.getElementById('reader-view').style.display = 'none';
  document.getElementById('viewer').innerHTML = '';
  document.getElementById('book-management').style.display = 'block';
  currentRendition = null;
  currentBook = null;
  currentBookId = null;
  currentBookDirection = 'ltr';
}

function toggleToc() {
  const tocOverlay = document.getElementById('toc-overlay');
  if (tocOverlay.style.display === 'none') {
    tocOverlay.style.display = 'block';
    generateToc();
  } else {
    tocOverlay.style.display = 'none';
  }
}

function generateToc() {
  const tocOverlay = document.getElementById('toc-overlay');
  tocOverlay.innerHTML = '';

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
        toggleToc();
      });
      li.appendChild(a);
      tocList.appendChild(li);
    });
    tocOverlay.appendChild(tocList);
  });
}

function toggleBookmarksOverlay() {
  const tocOverlay = document.getElementById('toc-overlay');
  if (tocOverlay.style.display === 'none') {
    tocOverlay.style.display = 'block';
    generateBookmarksList();
  } else {
    tocOverlay.style.display = 'none';
  }
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
        toggleBookmarksOverlay();
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

  if (atSectionEnd) {
    const currentSection = currentRendition.manager.views.last().section;
    const nextSection = currentSection.next();
    if (nextSection) {
      return currentRendition.display(nextSection.href);
    }
  } else {
    return currentRendition.next();
  }
}

async function prevPage() {
  if (!currentRendition) return;
  return currentRendition.prev();
}

function handleKeyPress(event) {
  if (document.getElementById('reader-view').style.display !== 'block' || !currentRendition) {
    return;
  }

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
      currentFontSize += 10;
      currentRendition.themes.fontSize(currentFontSize + '%');
      break;
    case '-':
      if (currentFontSize > 10) {
        currentFontSize -= 10;
        currentRendition.themes.fontSize(currentFontSize + '%');
      }
      break;
    case '[':
      if (currentLineHeight > 1) {
        currentLineHeight -= 0.1;
        currentRendition.themes.override('line-height', currentLineHeight);
      }
      break;
    case ']':
      currentLineHeight += 0.1;
      currentRendition.themes.override('line-height', currentLineHeight);
      break;
  }
}

window.addEventListener('keydown', handleKeyPress);

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
  const transaction = db.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
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

  const transaction = db.transaction([STORE_NAME], 'readonly');
  const store = transaction.objectStore(STORE_NAME);
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

function openBook(bookId, cfi) {
  currentBookId = bookId;
  const transaction = db.transaction([STORE_NAME], 'readonly');
  const store = transaction.objectStore(STORE_NAME);
  const request = store.get(bookId);

  request.onsuccess = () => {
    const bookData = request.result.data;
    document.getElementById('book-management').style.display = 'none';
    const readerView = document.getElementById('reader-view');
    readerView.style.display = 'block';

    currentBook = ePub(bookData);

    currentBook.ready.then(async () => {
      currentBookDirection = currentBook.packaging.metadata.direction || 'ltr';

      currentRendition = currentBook.renderTo('viewer', { width: '100%', height: '100%' });

      currentRendition.on('rendered', () => {
        const view = currentRendition.manager.views.last();
        if (view && view.iframe) {
          view.iframe.contentWindow.addEventListener('keydown', handleKeyPress);
        }
      });

      // Apply themes that might have been set before rendition was ready
      currentRendition.themes.fontSize(currentFontSize + '%');
      currentRendition.themes.override('line-height', currentLineHeight);

      return currentRendition.display(cfi);
    });
  };

  request.onerror = (event) => {
    console.error('Error fetching book:', event.target.errorCode);
  };
}
