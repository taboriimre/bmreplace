"use strict";

Cu.import("resource://gre/modules/PlacesUIUtils.jsm");

let bms = Cc["@mozilla.org/browser/nav-bookmarks-service;1"]
      .getService(Ci.nsINavBookmarksService);
let fs = Cc["@mozilla.org/browser/favicon-service;1"]
      .getService(Ci.nsIFaviconService);
let hs = Cc["@mozilla.org/browser/nav-history-service;1"]
      .getService(Ci.nsINavHistoryService);
let ts = Cc["@mozilla.org/browser/tagging-service;1"]
      .getService(Ci.nsITaggingService);
let as = Cc["@mozilla.org/browser/annotation-service;1"]
      .getService(Ci.nsIAnnotationService);
let ios = Services.io;

let bm = {
  DOMAIN_REGEX: /:\/\/([^/]*)/,
  KEEP_TITLE_ANN: "bmreplace/keep-title",
  WRONG_TITLE: 10,

  /**
   * Checks if there is a bookmark with given URL and title.
   * @param {String} url
   * @param {String} title
   * @return true if both match, WRONG_TITLE if the title doesn't match.
   */
  isBookmarked: function(url, title) {
    let id = this.firstBookmarkFor(url);
    if (id) {
      if (title == bms.getItemTitle(id)) {
        return true;
      } else {
        return this.WRONG_TITLE;
      }
    }
    return false;
  },

  /**
   * Finds bookmarks related to the given url, sorts them by
   * the length of the common substring (starting from the beginning).
   * @return [{title, uri, id, weight}, ...].
   */
  getRelatedBookmarks: function(url) {
    let domain = this.DOMAIN_REGEX.exec(url)[1],
        altDomain = /^www\./.test(domain) ? domain.slice(4) : "www." + domain;
    let lst = this.getBookmarksOn(domain).concat(this.getBookmarksOn(altDomain));
    lst.forEach(function(item) item.weight = bm.matchWeight(url, item.uri));
    lst.sort(function(a, b) b.weight - a.weight); // better matches first
    return lst;
  },

  getBookmarksOn: function(domain) {
    try {
      var keepTitleDefault = PREFS_BRANCH.getBoolPref(PREF_KEEP_TITLE);
    } catch(e) {}
    let query = hs.getNewQuery();
    query.domain = domain;
    query.domainIsHost = true;
    query.onlyBookmarked = true;
    let options = hs.getNewQueryOptions();
    options.queryType = Ci.nsINavHistoryQueryOptions.QUERY_TYPE_BOOKMARKS;
    let root = hs.executeQuery(query, options).root;
    root.containerOpen = true;
    let lst = [];
    for (var i = 0, len = root.childCount; i < len; ++i) {
      let child = root.getChild(i),
          id = child.itemId;
      lst.push({
        title: child.title,
        uri: child.uri,
        id: id,
        checked: bm.shouldKeepTitle(id, keepTitleDefault)
      });
    };
    root.containerOpen = false;
    return lst;
  },

  matchWeight: function(u, v) {
    u = this.urlPath(u);
    v = this.urlPath(v);
    let max = Math.min(u.length, v.length);
    for (var i = 0; i < max && u[i] == v[i]; ++i) {}
    return i;
  },

  urlPath: function(url) {
    let match = this.DOMAIN_REGEX.exec(url);
    return url.slice(match.index + match[0].length);
  },

  /**
   * Replaces bookmark's title and URL with new ones.
   * Retains the folder, bookmark's position in it, and
   * moves the tags from the old URI to the new one.
   * @param id Bookmark ID.
   * @param url URL string.
   * @param title New title. Optional.
   * @param description New description. Optional.
   */
  replaceBookmark: function(id, url, title, description) {
    let oldUri = bms.getBookmarkURI(id),
        tags = ts.getTagsForURI(oldUri, {}),
        uri = ios.newURI(url, null, null);
    ts.tagURI(uri, tags);
    ts.untagURI(oldUri, tags);
    bms.changeBookmarkURI(id, uri);
    if (title) {
      bms.setItemTitle(id, title);
    }
    if (description) {
      this.setDescription(id, description);
    }
    try {
      let favUri = fs.getFaviconForPage(oldUri);
      fs.setAndLoadFaviconForPage(uri, favUri, false);
    } catch (e) {/*NS_ERROR_NOT_AVAILABLE*/}
  },

  firstBookmarkFor: function(url) {
    let uri = ios.newURI(url, null, null),
        ids = bms.getBookmarkIdsForURI(uri);
    return ids && ids[0];
  },

  setTitle: function(url, title) {
    bms.setItemTitle(this.firstBookmarkFor(url), title);
  },

  /*
   * Shows Places "Add Bookmark" dialog.
   */
  showAddBookmark: function(url, title, parentWindow) {
    PlacesUIUtils.showBookmarkDialog({
      uri: ios.newURI(url, null, null),
      title: title,
      action: "add",
      type: "bookmark",
      hiddenRows: ["description", "location", "keyword", "loadInSidebar"]
    }, parentWindow);
  },

  /*
   * Checks if we should keep the old bookmark title when replacing.
   */
  shouldKeepTitle: function(id, defaultValue) {
    try {
      return as.getItemAnnotation(id, bm.KEEP_TITLE_ANN);
    } catch(e) {
      return defaultValue;
    }
  },

  setKeepTitle: function(id, value) {
    as.setItemAnnotation(id, bm.KEEP_TITLE_ANN, value,
                         0, Ci.nsIAnnotationService.EXPIRE_NEVER);
  },

  setDescription: function(id, value) {
    as.setItemAnnotation(id, PlacesUIUtils.DESCRIPTION_ANNO, value,
                         0, Ci.nsIAnnotationService.EXPIRE_NEVER);
  }
};
