# Local Epub Reader (ler)

## Goal

The Local Epub Reader (ler) is a minimalist Progressive Web App (PWA)
designed for a simple, offline-first, and privacy-focused reading
experience. It allows users to upload and read their EPUB books
directly in the browser without needing any server-side processing or
complex software installation.

The core philosophy is to keep the application simple, using vanilla
JavaScript, HTML, and CSS, and to avoid reliance on heavy frameworks.
All user data, including the books themselves, is stored locally in
the browser's IndexedDB.

## Current Features

*   **Offline-First PWA**: Can be installed to the home screen and used
    entirely without a network connection after the initial visit.
*   **Book Management**:
    *   **Upload Books**: Add EPUB files from your local device with a
      clean, simple button.
    *   **Local Storage**: EPUB files and user metadata are stored
      persistently in the browser's IndexedDB.
    *   **Book Listing**: View a list of all uploaded books on the main
      management screen.
*   **Reader View**:
    *   **Remembers Your Place**: The application automatically saves
      your last reading position on every page turn and returns you to
      it when you reopen a book.
    *   **Per-Book Display Settings**: Font size and line height are
      saved for each book individually and restored when the book is
      reopened.
    *   **EPUB Rendering**: Opens and displays EPUB files using the
      `epub.js` library.
    *   **Table of Contents (TOC) & Bookmarking**: A unified overlay
      allows for easy navigation. Users can jump to chapters via the
      TOC or create/delete/navigate to bookmarks. The view can be
      switched between TOC and Bookmarks without closing the overlay.
    *   **Auto-Hiding Controls**: The main navigation buttons automatically
      fade out during reading. They reappear on mouse movement or a tap
      in the center of the screen.
    *   **Keyboard Navigation**:
        *   `ArrowLeft` / `ArrowRight`: Navigate between pages.
        *   `+` / `-`: Increase or decrease the font size.
        *   `[` / `]`: Increase or decrease the line spacing.
        *   `0`: Reset font size and line height to default.
    *   **Touch & Mouse Navigation**:
        *   Tap/click on the left or right 25% of the screen to turn
          pages.
        *   Tap/click on the center 50% of the screen to show the
          navigation controls.
    *   **On-Screen Display Controls**: Buttons are available to
      increase/decrease font size and line height.
    *   **Close Reader**: Return to the book management view.

## How to Use

1.  **Serve the Directory**: This application must be served from a web
    server (even a local one) for the Service Worker and other features
    to work correctly. A simple server can be run with `python3 -m
    http.server` or a similar tool.
2.  **Open the Application**: Navigate to `LocalEpubReader.html` in your
    browser.
3.  **Upload a Book**: Click the "Add a new book" button and select an
    `.epub` file. It will appear in the book list.
4.  **Read a Book**: Click the "Read" button next to a book's name. It
    will open to your last read position.
5.  **Navigate**:
    *   **Keyboard**: Use the `ArrowLeft` and `ArrowRight` keys.
    *   **Touch/Mouse**: Tap or click on the left/right edges of the
      screen.
6.  **Show Controls**: Move your mouse, or tap/click the center of the
    screen.
7.  **Adjust Display**: Use the on-screen `A+`/`A-` buttons for font
    size, `+`/`-` buttons for line height, or the corresponding
    keyboard shortcuts (`+`/`-`/`[`/`]`). Press `0` to reset.
8.  **Use TOC/Bookmarks**: Click the "TOC" or "Bookmark" buttons to
    access those features.
9.  **Close the Book**: Click the "Close" button to return to the book
    list. Your position will be saved.

## Planned and Missing Features

This section details features that are part of the project's vision but
are not yet implemented.

*   **Delete Books**: There is currently no way to remove a book from
    the library once it has been uploaded.
*   **Advanced Book Management**: The library view is a simple list.
    Features like sorting (by author, title, last read) or grouping are
    not available.
*   **Bookmark Migration**: The bookmark data is still stored in
    `localStorage` and should be migrated to `IndexedDB` for better
    performance and consistency.
*   **Full Page Progression and Writing Mode Support**: While basic RTL
    support is present, comprehensive testing and support for all
    `page-progression-direction` and `writing-mode` (e.g.,
    vertical-rl) CSS attributes are not yet implemented.
*   **Tracking Reading Time**: The application does not yet track when a
    book was last opened or read.

## Technology Stack

*   **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3
*   **Storage**: IndexedDB for storing EPUB file data.
*   **PWA**: Service Worker for offline capabilities.
*   **Core Library**: `epub.js` for EPUB parsing and rendering.
