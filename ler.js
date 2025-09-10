// LER javascript

const DB_NAME = 'ler-books';
const DB_VERSION = 1;
const STORE_NAME = 'epubs';

let db;
let currentBook;
let currentRendition;
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
  bookmarkButton.addEventListener('click', addBookmark);
});

function closeReader() {
  document.getElementById('reader-view').style.display = 'none';
  document.getElementById('viewer').innerHTML = '';
  document.getElementById('book-management').style.display = 'block';
  currentRendition = null;
  currentBook = null;
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

function addBookmark() {
  const cfi = currentRendition.currentLocation().start.cfi;
  const bookName = currentBook.packaging.metadata.title;
  let bookmarks = JSON.parse(localStorage.getItem('ler-bookmarks')) || {};
  if (!bookmarks[bookName]) {
    bookmarks[bookName] = [];
  }
  bookmarks[bookName].push(cfi);
  localStorage.setItem('ler-bookmarks', JSON.stringify(bookmarks));
  alert('Bookmark added!');
}

function showBookmarks(bookId, bookName) {
  const bookmarks = JSON.parse(localStorage.getItem('ler-bookmarks')) || {};
  const bookBookmarks = bookmarks[bookName] || [];
  const tocOverlay = document.getElementById('toc-overlay');
  tocOverlay.innerHTML = '';
  document.getElementById('book-management').style.display = 'none';
  document.getElementById('reader-view').style.display = 'block';
  tocOverlay.style.display = 'block';


  if (bookBookmarks.length === 0) {
    tocOverlay.innerHTML = '<p>No bookmarks for this book.</p>';
    return;
  }

  const ul = document.createElement('ul');
  bookBookmarks.forEach((cfi) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.textContent = cfi;
    a.href = '#';
    a.addEventListener('click', (event) => {
      event.preventDefault();
      openBook(bookId, cfi);
    });
    li.appendChild(a);
    ul.appendChild(li);
  });
  tocOverlay.appendChild(ul);
}

function handleKeyPress(event) {
  if (document.getElementById('reader-view').style.display !== 'block' || !currentRendition) {
    return;
  }

  let atSectionStart = false;
  let atSectionEnd = false;
  if (currentRendition.location) {
    const { start, end } = currentRendition.location;
    atSectionStart = (start.displayed.page === 1);
    atSectionEnd = (end.displayed.page >= end.displayed.total);
  }

  switch (event.key) {
    case 'ArrowLeft':
      if (currentBookDirection === 'rtl') {
        if (atSectionEnd) {
          const currentSection = currentRendition.manager.views.last().section;
          const nextSection = currentSection.next();
          if (nextSection) {
            currentRendition.display(nextSection.href);
          }
        } else {
          currentRendition.next();
        }
      } else {
        if (atSectionStart) {
          const currentSection = currentRendition.manager.views.first().section;
          const prevSection = currentSection.prev();
          if (prevSection) {
            currentRendition.display(prevSection.href);
          }
        } else {
          currentRendition.prev();
        }
      }
      break;
    case 'ArrowRight':
      if (currentBookDirection === 'rtl') {
        if (atSectionStart) {
          const currentSection = currentRendition.manager.views.first().section;
          const prevSection = currentSection.prev();
          if (prevSection) {
            currentRendition.display(prevSection.href);
          }
        } else {
          currentRendition.prev();
        }
      } else {
        if (atSectionEnd) {
          const currentSection = currentRendition.manager.views.last().section;
          const nextSection = currentSection.next();
          if (nextSection) {
            currentRendition.display(nextSection.href);
          }
        } else {
          currentRendition.next();
        }
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

window.addEventListener('keydown', handleKeyPress, true);

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

      const bookmarksButton = document.createElement('button');
      bookmarksButton.textContent = 'Bookmarks';
      bookmarksButton.addEventListener('click', () => showBookmarks(book.id, book.name));
      li.appendChild(bookmarksButton);
      ul.appendChild(li);
    });
    bookList.appendChild(ul);
  };

  request.onerror = (event) => {
    console.error('Error fetching books:', event.target.errorCode);
  };
}

function openBook(bookId, cfi) {
  const transaction = db.transaction([STORE_NAME], 'readonly');
  const store = transaction.objectStore(STORE_NAME);
  const request = store.get(bookId);

  request.onsuccess = () => {
    const bookData = request.result.data;
    document.getElementById('book-management').style.display = 'none';
    const readerView = document.getElementById('reader-view');
    readerView.style.display = 'block';

    currentBook = ePub(bookData);

    currentBook.ready.then(() => {
      currentBookDirection = currentBook.packaging.metadata.direction || 'ltr';

      currentRendition = currentBook.renderTo('viewer', { width: '100%', height: '100%' });

      currentRendition.on('rendered', () => {
        const view = currentRendition.manager.views.last();
        if (view && view.iframe) {
          view.iframe.contentWindow.addEventListener('keydown', handleKeyPress, true);
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
