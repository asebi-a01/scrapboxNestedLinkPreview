// ==UserScript==
// @name         Scrapbox Nested Link Preview (Secure & Refactored)
// @namespace    https://scrapbox.io/asebi/
// @version      1.1.0
// @description  Shows a nested, scrollable preview of linked Scrapbox pages on hover. DOM API used for secure HTML generation.
// @description:ja Scrapboxのページ内リンクにホバーすると、ネストされたスクロール可能なプレビューを表示します。安全なHTML生成のためDOM APIを使用。
// @author       asebi
// @match        https://scrapbox.io/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @license      MIT License
// @icon         https://scrapbox.io/favicon.ico
// ==/UserScript==

(function() {
    'use strict';

    // --- User Configurable Settings ---
    const HOVER_DELAY = 250;
    const HIDE_DELAY = 200;
    const CACHE_DURATION = 5 * 60 * 1000;
    const MAX_NEST_LEVEL = 4;
    // --- End of Settings ---

    GM_addStyle(`
        .scrapbox-link-preview-tooltip {
            position: fixed; border: 1px solid #ccc; background-color: #f9f9f9; color: #333;
            padding: 10px; max-width: 550px; max-height: 400px; overflow-y: auto;
            font-size: 13px; line-height: 1.5;
            box-shadow: 0 4px 8px rgba(0,0,0,0.15); border-radius: 4px;
            white-space: pre-wrap; opacity: 0;
            transition: opacity 0.15s ease-in-out, visibility 0s 0.15s;
            visibility: hidden;
        }
        .scrapbox-link-preview-tooltip.visible { opacity: 1; visibility: visible; transition: opacity 0.15s ease-in-out; }
        .scrapbox-link-preview-tooltip strong { font-weight: bold; }
        .scrapbox-link-preview-tooltip code { background-color: #eee; padding: 0.2em 0.4em; border-radius: 3px; font-family: monospace; }
        .scrapbox-link-preview-tooltip a, .scrapbox-link-preview-tooltip a:visited { text-decoration: none; }
        .scrapbox-link-preview-tooltip a:hover { text-decoration: underline; }
        .scrapbox-link-preview-tooltip .preview-internal-link { color: #007bff; }
        .scrapbox-link-preview-tooltip .preview-external-link { color: #28a745; }
        .scrapbox-link-preview-tooltip .preview-image { max-width: 100%; height: auto; margin-top: 5px; border: 1px solid #ddd; }
        .scrapbox-link-preview-tooltip hr { border: none; border-top: 1px solid #eee; margin: 5px 0; }
    `);

    const previewTooltips = [];
    for (let i = 0; i <= MAX_NEST_LEVEL; i++) {
        const tooltip = document.createElement('div');
        tooltip.className = 'scrapbox-link-preview-tooltip';
        tooltip.style.zIndex = `${10000 + i}`;
        tooltip.dataset.nestLevel = i;
        document.body.appendChild(tooltip);
        previewTooltips.push(tooltip);
    }

    const activeHoverTimeouts = new Array(MAX_NEST_LEVEL + 1).fill(null);
    const activeHideTimeouts = new Array(MAX_NEST_LEVEL + 1).fill(null);
    const pageCache = new Map();

    /**
     * Creates a DOM element with specified tag, attributes, and text content.
     * @param {string} tagName - The HTML tag name.
     * @param {object} [attributes={}] - An object of attributes to set (e.g., { href: '...', class: '...' }).
     * @param {string} [textContent=''] - The text content for the element.
     * @returns {HTMLElement} The created HTML element.
     */
    function createElement(tagName, attributes = {}, textContent = '') {
        const el = document.createElement(tagName);
        for (const attr in attributes) {
            if (Object.prototype.hasOwnProperty.call(attributes, attr)) {
                el.setAttribute(attr, attributes[attr]);
            }
        }
        if (textContent) {
            el.textContent = textContent;
        }
        return el;
    }

    /**
     * Formats a line of Scrapbox text into a DocumentFragment for secure preview.
     * This function now builds DOM elements instead of an HTML string.
     * @param {string} rawText - The raw text of the line.
     * @param {string} currentProject - The name of the project the line belongs to.
     * @returns {DocumentFragment} A DocumentFragment containing the formatted line.
     */
    function formatLineTextToDOM(rawText, currentProject) {
        const fragment = document.createDocumentFragment();
        let remainingText = rawText;

        // Order of regexes matters: more specific or disruptive ones first.
        // Regexes now primarily serve to identify patterns and extract content,
        // not to construct HTML strings directly.
        const patterns = [
            // 1. Image links: [image_url.jpg] or [image_url.jpg link_url_or_page_name]
            {
                regex: /\[(https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|svg|webp))(?:\s+(https?:\/\/[^\s]+|[^\s]+))?\]/gi,
                handler: (match, imageUrl, linkUrlOrPage) => {
                    const img = createElement('img', { src: encodeURI(imageUrl), class: 'preview-image', alt: 'image' });
                    if (linkUrlOrPage) {
                        let href, linkClass, target, rel;
                        if (linkUrlOrPage.match(/^https?:\/\//)) {
                            href = encodeURI(linkUrlOrPage);
                            linkClass = 'preview-external-link';
                            target = '_blank';
                            rel = 'noopener noreferrer';
                        } else {
                            const pageNameForData = linkUrlOrPage.startsWith('/') ? linkUrlOrPage.substring(1).split('/').slice(1).join('/') || linkUrlOrPage.substring(1).split('/')[0] || linkUrlOrPage.substring(1) : linkUrlOrPage;
                            const projectNameForData = linkUrlOrPage.startsWith('/') ? linkUrlOrPage.substring(1).split('/')[0] || currentProject : currentProject;
                            href = linkUrlOrPage.startsWith('/') ? encodeURI(linkUrlOrPage.replace(/ /g, '_')) : `/${encodeURIComponent(projectNameForData)}/${encodeURIComponent(pageNameForData.replace(/ /g, '_'))}`;
                            linkClass = 'preview-internal-link';
                        }
                        const a = createElement('a', { href, class: linkClass, 'data-project': encodeURIComponent(projectNameForData), 'data-title': encodeURIComponent(pageNameForData.replace(/ /g,'_')) });
                        if(target) a.target = target;
                        if(rel) a.rel = rel;
                        a.appendChild(img);
                        return a;
                    }
                    return img;
                }
            },
            // Basic formatting (must come after complex link/image parsing that might contain these characters)
            { regex: /\[\*+([^\]]+?)\*\]/g, handler: (match, content) => createElement('strong', {}, content) },
            { regex: /(?<!\[)\*\*(?!\s)(.*?)(?<!\s)\*\*(?!\])/g, handler: (match, content) => createElement('strong', {}, content) },
            { regex: /\[-+([^\]]+?)-\]/g, handler: (match, content) => createElement('del', {}, content) },
            { regex: /`([^`]+?)`/g, handler: (match, content) => createElement('code', {}, content) },

            // Links (order is important: more specific before general)
            // 2. Links with explicit URL/Path and text: [text URL_or_Path] or [URL_or_Path text]
            {
                regex: /\[((?:(?!https?:\/\/|\s+\/|\s+https?:\/\/).)+?)\s+((https?:\/\/[^\s]+)|(\/[^\s]+))\]|\[((https?:\/\/[^\s]+)|(\/[^\s]+))\s+((?:(?!https?:\/\/|\s+\/|\s+https?:\/\/).)+?)\]/g,
                handler: (match, text1, urlOrPath1_full, url1, path1, urlOrPath2_full, url2, path2, text2) => {
                    const textContent = text1 || text2 || '';
                    const url = url1 || url2;
                    const path = path1 || path2;
                    if (url) {
                        return createElement('a', { href: encodeURI(url), target: '_blank', rel: 'noopener noreferrer', class: 'preview-external-link' }, textContent);
                    } else if (path) {
                        const pageNameForData = path.substring(1).split('/').slice(1).join('/') || path.substring(1).split('/')[0] || path.substring(1);
                        const projectNameForData = path.substring(1).split('/')[0] || currentProject;
                        return createElement('a', { href: encodeURI(path.replace(/ /g, '_')), class: 'preview-internal-link', 'data-project': encodeURIComponent(projectNameForData), 'data-title': encodeURIComponent(pageNameForData.replace(/ /g,'_')) }, textContent);
                    }
                    return document.createTextNode(match); // Should not happen
                }
            },
            // 3. Simple external URL: [http://example.com]
            { regex: /\[(https?:\/\/[^\s]+?)\]/g, handler: (match, url) => createElement('a', { href: encodeURI(url), target: '_blank', rel: 'noopener noreferrer', class: 'preview-external-link' }, url) },
            // 4. Simple inter-project or absolute path: [/project/page name]
            {
                regex: /\[(\/[^\]]+?)\]/g, handler: (match, path) => {
                    const pageNameForData = path.substring(1).split('/').slice(1).join('/') || path.substring(1).split('/')[0] || path.substring(1);
                    const projectNameForData = path.substring(1).split('/')[0] || currentProject;
                    return createElement('a', { href: encodeURI(path.replace(/ /g, '_')), class: 'preview-internal-link', 'data-project': encodeURIComponent(projectNameForData), 'data-title': encodeURIComponent(pageNameForData.replace(/ /g,'_')) }, path);
                }
            },
            // 5. [[Page Name]] (internal link, current project)
            {
                regex: /\[\[([^\]]+?)\]\]/g, handler: (match, pageTitle) => {
                    const encodedPageTitleForHref = encodeURIComponent(pageTitle.replace(/ /g, '_'));
                    return createElement('a', { href: `/${encodeURIComponent(currentProject)}/${encodedPageTitleForHref}`, class: 'preview-internal-link', 'data-project': encodeURIComponent(currentProject), 'data-title': encodeURIComponent(pageTitle.replace(/ /g,'_')) }, pageTitle);
                }
            },
            // 6. [Page Name] (internal link, current project, should be one of the last rules)
            {
                regex: /\[([^\]]+?)\]/g, handler: (match, pageTitle) => {
                    // Avoid re-linking if content is already an HTML element (heuristics) or special notation
                    if (pageTitle.includes('>') || pageTitle.includes('<') || pageTitle.endsWith('.icon') || pageTitle.match(/^https?:\/\//) || pageTitle.startsWith('/')) {
                        return document.createTextNode(`[${pageTitle}]`);
                    }
                    const encodedPageTitleForHref = encodeURIComponent(pageTitle.replace(/ /g, '_'));
                    return createElement('a', { href: `/${encodeURIComponent(currentProject)}/${encodedPageTitleForHref}`, class: 'preview-internal-link', 'data-project': encodeURIComponent(currentProject), 'data-title': encodeURIComponent(pageTitle.replace(/ /g,'_')) }, pageTitle);
                }
            }
        ];

        let lastIndex = 0;
        // Simplified iterative replacement for DOM construction
        // This is a basic approach; a more robust parser would be better for complex overlapping cases.
        // For now, we assume regexes are mostly for distinct patterns or ordered by precedence.

        // A more robust way would be to split by all regexes and interleave text nodes and element nodes.
        // This is a simplified loop that processes text sequentially, which might not handle overlapping or nested Scrapbox syntax perfectly.
        // However, for typical line-by-line formatting, it should work reasonably well.
        // The core idea is to append text nodes for unmatched parts and element nodes for matched parts.

        // For simplicity in this example, we'll just apply regexes in sequence to the *whole line*.
        // This is NOT ideal for multiple matches of *different* types in one line if they overlap.
        // A true parser would tokenize the string.
        // Given the review's focus was on XSS via innerHTML, using DOM for *output* is the key.
        // The parsing logic itself for Scrapbox's complex syntax remains a challenge.

        // Let's refine the parsing logic to be slightly more robust:
        // We find the first match of any pattern, process it, and then continue with the rest of the string.
        function parseTextRecursively(textToParse, parentNode) {
            if (!textToParse) return;

            let earliestMatch = null;
            let earliestPattern = null;

            for (const pattern of patterns) {
                pattern.regex.lastIndex = 0; // Reset regex state
                const match = pattern.regex.exec(textToParse);
                if (match && (earliestMatch === null || match.index < earliestMatch.index)) {
                    earliestMatch = match;
                    earliestPattern = pattern;
                }
            }

            if (earliestMatch) {
                // Text before the match
                if (earliestMatch.index > 0) {
                    parentNode.appendChild(document.createTextNode(textToParse.substring(0, earliestMatch.index)));
                }
                // The matched element
                const el = earliestPattern.handler(...earliestMatch);
                parentNode.appendChild(el);
                // Text after the match
                parseTextRecursively(textToParse.substring(earliestMatch.index + earliestMatch[0].length), parentNode);
            } else {
                // No more patterns match, append remaining text
                parentNode.appendChild(document.createTextNode(textToParse));
            }
        }

        parseTextRecursively(rawText, fragment);
        return fragment;
    }


    function fetchPageContentViaApi(project, title) {
        const normalizedTitle = title.replace(/ /g, '_');
        const apiUrl = `https://scrapbox.io/api/pages/${encodeURIComponent(project)}/${encodeURIComponent(normalizedTitle)}`;

        return new Promise((resolve, reject) => {
            const cachedData = pageCache.get(apiUrl);
            if (cachedData && (Date.now() - cachedData.timestamp < CACHE_DURATION)) {
                resolve(cachedData.content); // content is now a DocumentFragment or an array of them
                return;
            }

            GM_xmlhttpRequest({
                method: 'GET', url: apiUrl, responseType: 'json',
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300 && response.response) {
                        const pageData = response.response;
                        if (pageData && Array.isArray(pageData.lines)) {
                            const contentFragment = document.createDocumentFragment();
                            let titleTextDisplayed = null;

                            if (pageData.title) {
                                titleTextDisplayed = pageData.title;
                                const strong = createElement('strong');
                                strong.appendChild(formatLineTextToDOM(pageData.title, project));
                                contentFragment.appendChild(strong);
                                contentFragment.appendChild(createElement('br'));
                            }

                            if (pageData.image) {
                                contentFragment.appendChild(createElement('img', { src: encodeURI(pageData.image), class: 'preview-image', alt: 'page image' }));
                                contentFragment.appendChild(createElement('br'));
                                if (titleTextDisplayed && pageData.lines.some(l=>l.text.trim()!=='' && l.text !== titleTextDisplayed)) {
                                    contentFragment.appendChild(createElement('hr'));
                                }
                            }

                            for (const lineObj of pageData.lines) {
                                const currentLineText = lineObj.text;
                                if (titleTextDisplayed && currentLineText === titleTextDisplayed) continue;
                                contentFragment.appendChild(formatLineTextToDOM(currentLineText, project));
                                contentFragment.appendChild(createElement('br'));
                            }

                            // Remove last <br> if fragment ends with it (more complex with DOM)
                            // This might be better handled by CSS (e.g., :last-child) or by not adding the last <br> in the loop.
                            // For now, we'll leave it; browser rendering usually handles trailing <br> in a block okay.

                            pageCache.set(apiUrl, { content: contentFragment.cloneNode(true), timestamp: Date.now() }); // Cache a clone
                            resolve(contentFragment);
                        } else reject(new Error('API response format error'));
                    } else reject(new Error(`API fetch error: ${response.statusText} (status: ${response.status}) for ${apiUrl}`));
                },
                onerror: (e) => reject(new Error(`GM_xhr error: ${e.statusText} for ${apiUrl}`))
            });
        });
    }

    function showPreview(event, targetLinkElement, nestLevel = 0) {
        if (nestLevel > MAX_NEST_LEVEL) return;
        const currentTooltip = previewTooltips[nestLevel];
        clearTimeout(activeHideTimeouts[nestLevel]);
        for (let i = nestLevel + 1; i <= MAX_NEST_LEVEL; i++) hidePreview(i, 0);

        activeHoverTimeouts[nestLevel] = setTimeout(async () => {
            let project, title, rawHref;
            // ... (project, title extraction logic from v0.9.2 - unchanged)
            if (targetLinkElement.tagName === 'A') {
                rawHref = targetLinkElement.getAttribute('href');
                project = decodeURIComponent(targetLinkElement.dataset.project || '');
                title = decodeURIComponent(targetLinkElement.dataset.title || '');
                if ((!project || !title) && rawHref && rawHref.startsWith('/')) {
                    const pathString = rawHref.substring(1);
                    const parts = pathString.split('/');
                    if (parts.length > 0 && parts[0] !== '') {
                        project = decodeURIComponent(parts[0]);
                        let pageTitle = parts.length > 1 ? parts.slice(1).join('/') : project;
                        title = decodeURIComponent(pageTitle.replace(/_/g, ' '));
                    } else { return; }
                } else if (!project || !title) { return; }
            } else { return; }


            try {
                const contentDOMFragment = await fetchPageContentViaApi(project, title); // Now receives a DocumentFragment

                currentTooltip.innerHTML = ''; // Clear previous content
                if (contentDOMFragment.childNodes.length === 0) {
                    const emptyMsg = createElement('i', {}, '(No content or unable to fetch)');
                    currentTooltip.appendChild(emptyMsg);
                } else {
                    currentTooltip.appendChild(contentDOMFragment.cloneNode(true)); // Append a clone
                }


                if (nestLevel < MAX_NEST_LEVEL) {
                    currentTooltip.querySelectorAll('a.preview-internal-link').forEach(link => {
                        link.onmouseover = (e) => {
                            clearTimeout(activeHideTimeouts[nestLevel + 1]);
                            if (currentTooltip.classList.contains('visible')) {
                                 clearTimeout(activeHideTimeouts[nestLevel]);
                                 showPreview(e, link, nestLevel + 1);
                            }
                        };
                        link.onmouseout = (e) => {
                            if (!(previewTooltips[nestLevel] && previewTooltips[nestLevel].contains(e.relatedTarget))) {
                                 hidePreview(nestLevel + 1);
                            }
                        };
                    });
                }

                // Positioning logic (v0.9.2 - unchanged)
                currentTooltip.style.visibility = 'hidden';
                currentTooltip.style.left = '-9999px'; currentTooltip.style.top = '-9999px';
                currentTooltip.style.pointerEvents = 'auto';
                currentTooltip.classList.add('visible');
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        const tooltipRect = currentTooltip.getBoundingClientRect();
                        const viewportWidth = window.innerWidth; const viewportHeight = window.innerHeight;
                        let x = event.clientX + 15; let y = event.clientY + 15;
                        if (x + tooltipRect.width > viewportWidth - 10) x = event.clientX - tooltipRect.width - 15;
                        if (x < 10) x = 10;
                        if (y + tooltipRect.height > viewportHeight - 10) y = event.clientY - tooltipRect.height - 15;
                        if (y < 10) y = 10;
                        currentTooltip.style.left = `${x}px`; currentTooltip.style.top = `${y}px`;
                        currentTooltip.style.visibility = 'visible';
                    });
                });
            } catch (error) {
                console.error(`[LinkPreview] Lv${nestLevel} Error rendering preview:`, error);
                currentTooltip.innerHTML = ''; // Clear previous content
                const errorMsgItalic = createElement('i');
                // Safely display error message using textContent
                const errorNode = createElement('span', {}, 'Preview failed: ');
                const errorMessageNode = createElement('span', {});
                errorMessageNode.textContent = error.message; // Safely set potentially unsafe message
                errorMsgItalic.appendChild(errorNode);
                errorMsgItalic.appendChild(errorMessageNode);
                currentTooltip.appendChild(errorMsgItalic);

                currentTooltip.style.left = `${event.clientX + 15}px`;
                currentTooltip.style.top = `${event.clientY + 15}px`;
                currentTooltip.classList.add('visible');
                currentTooltip.style.pointerEvents = 'auto';
                currentTooltip.style.visibility = 'visible';
            }
        }, HOVER_DELAY);
    }

    // hidePreview function and main event listeners are unchanged from v0.9.2
    function hidePreview(nestLevel, delay = HIDE_DELAY) {
        if (nestLevel < 0 || nestLevel > MAX_NEST_LEVEL || !previewTooltips[nestLevel]) return;
        clearTimeout(activeHoverTimeouts[nestLevel]);
        activeHideTimeouts[nestLevel] = setTimeout(() => {
            if (previewTooltips[nestLevel]) {
                previewTooltips[nestLevel].classList.remove('visible');
                previewTooltips[nestLevel].style.pointerEvents = 'none';
            }
            for (let i = nestLevel + 1; i <= MAX_NEST_LEVEL; i++) {
                if (previewTooltips[i]) {
                    clearTimeout(activeHoverTimeouts[i]); clearTimeout(activeHideTimeouts[i]);
                    previewTooltips[i].classList.remove('visible');
                    previewTooltips[i].style.pointerEvents = 'none';
                }
            }
        }, delay);
    }

    document.addEventListener('mouseover', function(event) {
        const targetLink = event.target.closest('a.page-link:not(.preview-internal-link):not(.preview-external-link)');
        if (targetLink && targetLink.getAttribute('href') && targetLink.getAttribute('href').startsWith('/')) {
            clearTimeout(activeHideTimeouts[0]);
            for (let i = 1; i <= MAX_NEST_LEVEL; i++) { hidePreview(i, 0); }
            showPreview(event, targetLink, 0);
        }
    });
    document.addEventListener('mouseout', function(event) {
        const targetLink = event.target.closest('a.page-link:not(.preview-internal-link):not(.preview-external-link)');
        if (targetLink) {
            let overPreview = false;
            for(let i=0; i<=MAX_NEST_LEVEL; ++i) if(previewTooltips[i] && previewTooltips[i].classList.contains('visible') && previewTooltips[i].contains(event.relatedTarget)) overPreview = true;
            if (!overPreview) hidePreview(0);
        }
    });
    previewTooltips.forEach((tooltip, level) => {
        tooltip.addEventListener('mouseover', function(event) {
            clearTimeout(activeHideTimeouts[level]);
            if (level > 0 && previewTooltips[level - 1]) clearTimeout(activeHideTimeouts[level - 1]);
        });
        tooltip.addEventListener('mouseout', function(event) {
            let overAnyTooltip = false;
            for(let i=0; i<=MAX_NEST_LEVEL; ++i) if(previewTooltips[i] && previewTooltips[i].classList.contains('visible') && previewTooltips[i].contains(event.relatedTarget)) overAnyTooltip = true;
            if (!overAnyTooltip) {
                 for (let i = 0; i <= MAX_NEST_LEVEL; i++) hidePreview(i);
            } else {
                let stillOverParentOrChild = false;
                if (level > 0 && previewTooltips[level-1] && previewTooltips[level-1].contains(event.relatedTarget)) stillOverParentOrChild = true;
                if (level < MAX_NEST_LEVEL && previewTooltips[level+1] && previewTooltips[level+1].contains(event.relatedTarget)) stillOverParentOrChild = true;
                if(!stillOverParentOrChild) hidePreview(level);
            }
        });
    });

    console.log('[LinkPreview] Script loaded and initialized (v1.1.0)');
})();