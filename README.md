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
    *   **Upload Books**: Add EPUB files from your local device using
      the file picker.
    *   **Local Storage**: EPUB files are stored persistently in the
      browser's IndexedDB.
    *   **Book Listing**: View a list of all uploaded books on the main
      management screen.
*   **Reader View**:
    *   **EPUB Rendering**: Opens and displays EPUB files using the
      `epub.js` library.
    *   **Table of Contents (TOC) & Bookmarking**: A unified overlay
      allows for easy navigation. Users can jump to chapters via the
      TOC or create/delete/navigate to bookmarks. The view can be
      switched between TOC and Bookmarks without closing the overlay.
    *   **Auto-Hiding Controls**: The main navigation buttons (TOC,
      Bookmark, Close) automatically fade out during reading to provide
      an unobstructed view. They reappear on mouse movement or a tap in
      the center of the screen.
    *   **Keyboard Navigation**:
        *   `ArrowLeft` / `ArrowRight`: Navigate between pages, with
          support for right-to-left (RTL) page progression.
        *   `+` / `-`: Increase or decrease the font size.
        *   `[` / `]`: Increase or decrease the line spacing.
    *   **Touch Navigation**:
        *   Tap on the left or right 25% of the screen to turn pages.
        *   Tap on the center 50% of the screen to show the navigation
          controls.
    *   **Close Reader**: Return to the book management view from the
      reader.

## How to Use

1.  **Serve the Directory**: This application must be served from a web
    server (even a local one) for the Service Worker and other features
    to work correctly. A simple server can be run with `python3 -m
    http.server` or a similar tool.
2.  **Open the Application**: Navigate to `LocalEpubReader.html` in your
    browser.
3.  **Upload a Book**: Click the "Add a new book" input field and
    select an `.epub` file from your device. It will appear in the book
    list.
4.  **Read a Book**: Click the "Read" button next to a book's name to
    open the reader view.
5.  **Navigate**:
    *   **Keyboard**: Use the `ArrowLeft` and `ArrowRight` keys.
    *   **Touch/Mouse**: Tap or click on the left/right edges of the
      screen.
6.  **Show Controls**: Move your mouse, or tap/click the center of the
    screen.
7.  **Adjust Display**: Use `+`, `-`, `[`, and `]` to change font size
    and line height.
8.  **Use TOC/Bookmarks**: Click the "TOC" or "Bookmark" buttons to
    access those features.
9.  **Close the Book**: Click the "Close" button to return to the book
    list.

## Planned and Missing Features

This section details features that are part of the project's vision but
are not yet implemented.

### Planned but Missing

These features are planned but have not been implemented at all:

*   **Delete Books**: There is currently no way to remove a book from
    the library once it has been uploaded.
*   **Save Last Reading Position**: The application does not remember
    where you left off in a book. When you reopen a book, it starts
    from the beginning.
*   **Advanced Book Management**: The library view is a simple list.
    Features like sorting (by author, title, last read) or grouping are
    not available.
*   **Full Page Progression and Writing Mode Support**: While basic RTL
    support is present for keyboard and touch navigation, comprehensive
    testing and support for all `page-progression-direction` and
    `writing-mode` (e.g., vertical-rl) CSS attributes are not yet
    implemented.
*   **Tracking Reading Time**: The application does not yet track when a
    book was last opened or read.

## Technology Stack

*   **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3
*   **Storage**: IndexedDB for storing EPUB file data.
*   **PWA**: Service Worker for offline capabilities.
*   **Core Library**: `epub.js` for EPUB parsing and rendering.
