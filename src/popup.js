/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* jshint browser:true, devel:true */
/* globals chrome, get_crx_url, get_zip_name, can_viewsource_crx_url, openCRXasZip */
/* globals encodeQueryString */
/* globals getPlatformInfoAsync */
'use strict';
var cws_url;
var crx_url;
var filename;

// See bg-contextmenu for potential values, at MENU_ID_ACTION_MENU.
var gActionClickAction = 'popup';

initialize();

function initialize() {
    var storageIsReady = false;

    getPlatformInfoAsync(function() {
        // Hack: although not guaranteed by the API, the getPlatformInfoAsync
        // call resolves ealier than the later tabs.query call, in practice.
        console.assert(!crx_url, 'getPlatformInfoAsync() should run first');
    });

    // Get CWS URL. On failure, close the popup
    chrome.tabs.query({
        active: true,
        currentWindow: true
    }, function(tabs) {
        cws_url = tabs[0].url;
        // Note: Assuming getPlatformInfoAsync() to have resolved first.
        crx_url = get_crx_url(cws_url);
        filename = get_zip_name(crx_url);
        if (!can_viewsource_crx_url(crx_url)) {
//#if FIREFOX
            chrome.pageAction.hide(tabs[0].id);
//#else
            chrome.action.disable(tabs[0].id);
//#endif
            window.close();
            return;
        }
        ready();
        if (storageIsReady) {
            ready2();
        }
    });
    chrome.storage.sync.get({
        actionClickAction: gActionClickAction,
    }, function(items) {
        gActionClickAction = items && items.actionClickAction || gActionClickAction;
        storageIsReady = true;
        if (crx_url) {
            ready2();
        }
    });
}

function ready() {
    document.getElementById('download').onclick = doDownload;
    document.getElementById('view-source').onclick = doViewSource;
//#if OPERA
    document.getElementById('install-as-nex').onclick = doInstall;
//#endif
    // When the settings have been read, ready2 will run to finish.
}
function ready2() {
    if (gActionClickAction == 'popup') {
        // Default action is keeping this popup open.
        // Nothing else left to do.
    } else if (gActionClickAction == 'download') {
        doDownload();
    } else if (gActionClickAction == 'view-source') {
        doViewSource();
        return;
    }
    showPermissionPromptIfMissingHostPermission();
}
function showPermissionPromptIfMissingHostPermission() {
    if (!crx_url.startsWith('http')) {
        return; // Permissions only needed and available for http(s).
    }
    var hostPermission = new URL(crx_url).origin + '/*';
    chrome.permissions.contains({ origins: [hostPermission] }, function(ok) {
        // The API will report OK if the user accepted the full permission
        // request, or manually specified a subset.
        if (!ok) {
            showPermissionPrompt();
        }
    });
}
function showPermissionPrompt() {
    var form = document.getElementById('permission_missing_form');
    form.hidden = false;
    form.onsubmit = function(e) {
        e.preventDefault();
        var permission = {
            origins: ['*://*/*']
        };
        chrome.permissions.request(permission, function(hasAccess) {
            if (hasAccess) {
                form.hidden = true;
            }
        });
    };
    form.onreset = function(e) {
        form.hidden = true;
    };
}
function alert(msg) {
    var dialog = document.createElement('dialog');
    dialog.style.whiteSpace = 'pre-wrap';
    dialog.style.wordBreak = 'break-all';
    dialog.textContent = msg;
    dialog.onclose = function() {
        dialog.remove();
    };
    var closeButton = document.createElement('button');
    closeButton.onclick = function() {
        dialog.close();
    };
    closeButton.textContent = 'OK';
    dialog.append(closeButton);
    document.body.append(dialog);
    dialog.showModal();
    showPermissionPromptIfMissingHostPermission();
}
var hasDownloadedOnce = false;
function doDownload() {
    if (hasDownloadedOnce) {
        console.log('Download is pending.');
        return;
    }
    openCRXasZip(crx_url, function(blob, publicKey) {
        tryTriggerDownload(blob, filename);
    }, function(errorMessage) {
        hasDownloadedOnce = false;
        document.getElementById('download').classList.toggle('downloading', hasDownloadedOnce);
        console.error(errorMessage);
        alert('Error in CRX Viewer:\n\n' + errorMessage);
    }, onXHRprogress.bind(null, document.getElementById('download')));
    hasDownloadedOnce = true;
    document.getElementById('download').classList.toggle('downloading', hasDownloadedOnce);
}
function doViewSource() {
    chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
    }, function(tabs) {
        var tab = tabs && tabs[0];
        chrome.tabs.create({
            url: chrome.runtime.getURL('crxviewer.html') +
                '?' + encodeQueryString({crx: crx_url, zipname: filename}),
            active: true,
            windowId: tab ? tab.windowId : undefined,
            index: tab ? tab.index + 1 : undefined,
//#if FIREFOX
            cookieStoreId: tab && tab.cookieStoreId,
//#endif
        }, function() {
            window.close();
        });
    });
}
function onXHRprogress(progressContainer, xhrProgressEvent) {
    var progressBar = progressContainer.querySelector('progress');
    if (!progressBar) {
        progressBar = document.createElement('progress');
        progressContainer.appendChild(progressBar);
    }
    if (xhrProgressEvent.lengthComputable) {
        progressBar.max = xhrProgressEvent.total;
        progressBar.value = xhrProgressEvent.loaded;
    } else {
        progressBar.removeAttribute('value');
    }
}
//#if OPERA
var hasDownloadedCRX = false;
function doInstall() {
    var filename_nex = filename.replace(/\.zip$/, '.nex');

    if (hasDownloadedCRX) {
        console.log('Download is pending.');
        return;
    }
    var x = new XMLHttpRequest();
    x.open('GET', crx_url);
    x.responseType = 'blob';
    x.onprogress = onXHRprogress.bind(null, document.getElementById('install-as-nex'));
    x.onload = function() {
        var blob = x.response;
        if (!blob) {
            hasDownloadedCRX = false;
            alert('Unexpected error: no response for ' + crx_url);
            return;
        }
        if (blob.type !== 'application/x-navigator-extension' ||
            blob.type !== 'application/x-chrome-extension') {
            blob = new Blob([blob], {
                type: 'application/x-navigator-extension'
            });
        }
        tryTriggerDownload(blob, filename_nex);
    };
    x.onerror = function() {
        hasDownloadedCRX = false;
        alert('Network error for ' + crx_url);
    };
    x.onabort = function() {
        hasDownloadedCRX = false;
    };
    x.send();
    hasDownloadedCRX = true;
}
//#endif

function tryTriggerDownload(blob, filename) {
//#if FIREFOX
//  // Use background to trigger download to avoid blob:-URL invalidation when
//  // the popup is closed, see https://bugzil.la/2005952
//  chrome.runtime.sendMessage({
//      action: "downloadBlob",
//      blob,
//      incognito: chrome.extension.inIncognitoContext,
//#else
    chrome.downloads.download({
        url: URL.createObjectURL(blob),
        // incognito option is not supported in downloads.download() in Chrome,
        // but incognito:split is supported in the manifest which should enable
        // separation as needed.
//#endif
        filename: filename,
    }, function() {
        // The popup should have closed already, but if not, do it now.
        window.close();
    });
}
