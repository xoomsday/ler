# Local Epub Reader (ler)

## Goal

The Local Epub Reader (ler) is a minimalist Progressive Web App (PWA)
designed for a simple, offline-first, and privacy-focused reading
experience. It allows users to upload and read their EPUB and CBZ
books directly in the browser without needing any server-side
processing or complex software installation.

The core philosophy is to keep the application simple, using vanilla
JavaScript, HTML, and CSS, and to avoid reliance on heavy frameworks.
All user data, including the books themselves, is stored locally in
the browser's IndexedDB.

## Current Features

*   **EPUB and CBZ Support**: Read both standard e-books and comic book
    archives.
*   **Advanced Comic Reader View**:
    *   **Automatic Facing-Page View**: To maximize screen real estate,
      the reader automatically displays one or two pages at a time based
      on the window's aspect ratio and the pages' dimensions,
      minimizing wasted space.
    *   **Manual Spread Control**: A "Split/Rejoin" button (and the `s`
      keyboard shortcut) allows you to manually override the automatic
      layout, forcing a two-page spread to display as single pages or
      rejoining pages you previously split.
*   **ComicInfo.xml Parsing**: For CBZ files, the application will parse
    an embedded `ComicInfo.xml` file to automatically set the correct
    reading direction (Left-to-Right or Right-to-Left) and to respect
    the creator's intended two-page spreads.

*   **Offline-First PWA**: Can be installed to the home screen and used
    entirely without a network connection after the initial visit.
*   **Modern Book Management**:
    *   **Grid View**: Displays your library as a grid of book tiles,
      each showing a cover thumbnail, title, and progress bar.
    *   **Upload Books**: Add EPUB or CBZ files from your local device
      with the `+` button. Multiple files can be selected and uploaded
      at once.
    *   **Cover Thumbnails**: Automatically extracts and displays a
      resized thumbnail of the book's cover for quick identification.
    *   **Reading Progress**: A progress bar on each tile shows your
      current position in the book.
    *   **Book States**: Each book is automatically tracked with one of
      three states, shown as an overlay on the cover:
        *   **Unread**: A newly added book.
        *   **Reading**: A book you have started reading.
        *   **Finished**: A book you have read to the end.
    *   **Filtering and Sorting**:
        *   Filter your library to show any combination of states
          (e.g., only "Reading" and "Finished" books).
        *   Sort books by title (with version-aware sorting for series)
          or by the last time they were read.
    *   **Book Actions**: A hamburger menu on each tile allows you to:
        *   **Delete** the book from your library.
        *   **Reset the state** manually to Unread, Reading, or
          Finished.
    *   **Local Storage**: Book files and user metadata are stored
      persistently in the browser's IndexedDB.
*   **Reader View**:
    *   **Remembers Your Place**: The application automatically saves
      your last reading position on every page turn and returns you to
      it when you reopen a book.
    *   **Per-Book Display Settings**:
        *   **For EPUBs**: Font size, line height, and font face
          (serif/sans-serif) are saved for each book individually.
        *   **For Comics**: The user's preferred reading direction and
          any manual spread overrides ("splits") are saved for each
          comic individually.
    *   **Dark Mode**: A simple toggle allows switching the entire
      application, including the book content, to a dark theme for
      comfortable night reading. The setting is saved globally.
    *   **EPUB Rendering**: Opens and displays EPUB files using the
      `epub.js` library.
    *   **Table of Contents (TOC) & Bookmarking**: A unified overlay
      (for EPUBs) allows for easy navigation. Users can jump to
      chapters via the TOC or create/delete/navigate to bookmarks. The
      view can be switched between TOC and Bookmarks without closing
      the overlay.
    *   **Immersive Reader Interface**:
        *   **Auto-Hiding Controls**: To minimize distractions, the top
          control bar and the side page-turn buttons automatically fade
          out during reading. They reappear on mouse movement or a tap
          on the main content area.
        *   **Book Title Display**: The title of the current book is
          shown in the center of the top control bar.
        *   **Intuitive Display Controls**: Font size, line height, and
          font face are managed with "pill" shaped controls that always
          show the current value.
    *   **Keyboard Navigation**:
        *   **For All Views**:
            *   `ArrowLeft` / `ArrowRight`: Navigate between pages.
        *   **For EPUB Reader**:
            *   `+` / `-`: Increase or decrease the font size.
            *   `[` / `]`: Increase or decrease the line spacing.
            *   `f`: Toggle between serif and sans-serif fonts.
            *   `0`: Reset font size, line height, and font face to
              default.
        *   **For Comic Reader**:
            *   `d`: Toggle reading **d**irection (LTR/RTL).
            *   `s`: **S**plit a two-page spread into single pages, or
              rejoin a previously split page.
    *   **Interactive Content**: The main content area of the book is
      fully interactive, allowing you to click on hyperlinks within
      the EPUB text (e.g., in a table of contents page).
    *   **Touch & Mouse Navigation**:
        *   Click the thumb-sized `‹` and `›` buttons on the left and
          right edges of the screen to turn pages.
        *   Move the mouse or tap/click on the book's main content
          area (but not on a link) to show the navigation controls.
    *   **Close Reader**: Return to the book management view.

## How to Use

1.  **Serve the Directory**: This application must be served from a web
    server (even a local one) for the Service Worker and other features
    to work correctly. A simple server can be run with `python3 -m
    http.server` or a similar tool.
2.  **Open the Application**: Navigate to `LocalEpubReader.html` in your
    browser.
3.  **Upload a Book**: Click the `+` button in the top pane and select
    one or more `.epub` or `.cbz` files. They will appear in the book
    grid.
4.  **Read a Book**: Click on a book's tile. It will open to your last
    read position.
5.  **Manage Books**: Use the filter and sort controls in the top pane
    to organize your library. Use the hamburger menu on a book tile to
    delete it or change its state.
6.  **Navigate**:
    *   **Keyboard**: Use the `ArrowLeft` and `ArrowRight` keys.
    *   **Touch/Mouse**: Click the `‹` and `›` buttons on the screen
      edges.
7.  **Show Controls**: Move your mouse, or tap/click the book's text.
8.  **Adjust Display (EPUB)**: Use the on-screen pill controls to
    adjust font size, line height, and font face, or use the
    corresponding keyboard shortcuts (`+`/`-`/`[`/`]`/`f`). Press `0`
    to reset.
9.  **Adjust Display (Comic)**: Use the on-screen pill controls to
    toggle reading direction (LTR/RTL) or to split/rejoin two-page
    spreads. Use the `d` and `s` keys for the same actions.
10. **Use TOC/Bookmarks (EPUB)**: Click the `☰` (Table of Contents) or
    `🔖` (Bookmark) buttons to access those features.
11. **Close the Book**: Click the `X` button to return to the book
    grid. Your position will be saved.

## Planned and Missing Features

This section details features that are part of the project's vision but
are not yet implemented.

*   **Full Page Progression and Writing Mode Support**: While basic RTL
    support is present, comprehensive testing and support for all
    `page-progression-direction` and `writing-mode` (e.g.,
    vertical-rl) CSS attributes are not yet implemented.

## Technology Stack

*   **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3
*   **Storage**: IndexedDB for storing EPUB file data.
*   **PWA**: Service Worker for offline capabilities.
*   **Core Library**: `epub.js` for EPUB parsing and rendering.
