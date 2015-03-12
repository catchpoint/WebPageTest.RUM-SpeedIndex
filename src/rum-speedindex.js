/* globals window */
/**
\file run-speedindex.js
A plugin beaconing speeedindex back to the server
A Boomerang implementation of https://github.com/WPO-Foundation/RUM-SpeedIndex
*/

(function(w) {
    'use strict';
    // First make sure BOOMR is actually defined.  It's possible that your plugin is
    // loaded before boomerang, in which case you'll need this.
    w.BOOMR = w.BOOMR || {};
    w.BOOMR.plugins = w.BOOMR.plugins || {};
    if (w.BOOMR.plugins.speedindex) {
        return;
    }

    // A private object to encapsulate all your implementation details
    // This is optional, but the way we recommend you do it.
    var impl = {
        // Copyright and license for realUserMetricsSpeedIndex reproduced from https://github.com/WPO-Foundation/RUM-SpeedIndex

        /******************************************************************************
		Copyright (c) 2014, Google Inc.
		All rights reserved.
		Redistribution and use in source and binary forms, with or without
		modification, are permitted provided that the following conditions are met:
		    * Redistributions of source code must retain the above copyright notice,
		      this list of conditions and the following disclaimer.
		    * Redistributions in binary form must reproduce the above copyright notice,
		      this list of conditions and the following disclaimer in the documentation
		      and/or other materials provided with the distribution.
		    * Neither the name of the <ORGANIZATION> nor the names of its contributors
		    may be used to endorse or promote products derived from this software
		    without specific prior written permission.
		THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
		AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
		IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
		DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
		FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
		DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
		SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
		CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
		OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
		OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
		******************************************************************************/
        realUserMetricsSpeedIndex: function(win) {
            win = win || w;
            var doc = win.document;
            var speedIndex;

            /****************************************************************************
             * Support Routines
             ****************************************************************************/
            // Get the rect for the visible portion of the provided DOM element
            var getElementViewportRect = function(el) {
                var intersect = false;
                var elRect;
                if (el.getBoundingClientRect) {
                    elRect = el.getBoundingClientRect();
                    intersect = {
                        top: Math.max(elRect.top, 0),
                        left: Math.max(elRect.left, 0),
                        bottom: Math.min(elRect.bottom, (win.innerHeight || doc.documentElement.clientHeight)),
                        right: Math.min(elRect.right, (win.innerWidth || doc.documentElement.clientWidth))
                    };
                    if (intersect.bottom <= intersect.top ||
                        intersect.right <= intersect.left) {
                        intersect = false;
                    } else {
                        intersect.area = (intersect.bottom - intersect.top) * (intersect.right - intersect.left);
                    }
                }
                return intersect;
            };

            // Check a given element to see if it is visible
            var checkElement = function(el, url) {
                var rect;
                if (url) {
                    rect = getElementViewportRect(el);
                    if (rect) {
                        rects.push({
                            url: url,
                            area: rect.area,
                            rect: rect
                        });
                    }
                }
            };

            // Get the visible rectangles for elements that we care about
            var getRects = function() {
                // Walk all of the elements in the DOM (try to only do this once)
                var elements = doc.getElementsByTagName('*');
                var re = /url\((http.*)\)/ig;
                var i;
                var el;
                var style;
                var matches;
                var rect;
                var tm;
                for (i = 0; i < elements.length; i++) {
                    el = elements[i];
                    style = win.getComputedStyle(el);

                    // check for Images
                    if (el.tagName === 'IMG') {
                        checkElement(el, el.src);
                    }
                    // Check for background images
                    if (style['background-image']) {
                        re.lastIndex = 0;
                        matches = re.exec(style['background-image']);
                        if (matches && matches.length > 1) {
                            checkElement(el, matches[1]);
                        }
                    }
                    // recursively walk any iFrames
                    if (el.tagName === 'IFRAME') {
                        try {
                            rect = getElementViewportRect(el);
                            if (rect) {
                                tm = this.realUserMetricsSpeedIndex(el.contentWindow);
                                if (tm) {
                                    rects.push({
                                        tm: tm,
                                        area: rect.area,
                                        rect: rect
                                    });
                                }
                            }
                        } catch (e) {}
                    }
                }
            };

            // Get the time at which each external resource loaded
            var getRectTimings = function() {
                var timings = {};
                var requests = win.performance.getEntriesByType('resource');
                var i;
                var j;
                for (i = 0; i < requests.length; i++) {
                    timings[requests[i].name] = requests[i].responseEnd;
                }
                for (j = 0; j < rects.length; j++) {
                    if (!('tm' in rects[j])) {
                        rects[j].tm = timings[rects[j].url] !== undefined ? timings[rects[j].url] : 0;
                    }
                }
            };

            // Get the first paint time.
            var getFirstPaint = function() {
                var chromeTimes;
                var startTime;
                var headURLs;
                var headElements;
                var i;
                var el;
                var requests;
                var doneCritical;
                var j;
                var requestEnd;

                // If the browser supports a first paint event, just use what the browser reports
                if ('msFirstPaint' in win.performance.timing) {
                    firstPaint = win.performance.timing.msFirstPaint - navStart;
                }
                if ('chrome' in win && 'loadTimes' in win.chrome) {
                    chromeTimes = win.chrome.loadTimes();
                    if ('firstPaintTime' in chromeTimes && chromeTimes.firstPaintTime > 0) {
                        startTime = chromeTimes.startLoadTime;
                        if ('requestTime' in chromeTimes) {
                            startTime = chromeTimes.requestTime;
                        }
                        if (chromeTimes.firstPaintTime >= startTime) {
                            firstPaint = (chromeTimes.firstPaintTime - startTime) * 1000.0;
                        }
                    }
                }
                // For browsers that don't support first-paint or where we get insane values,
                // use the time of the last non-async script or css from the head.
                if (firstPaint === undefined || firstPaint < 0 || firstPaint > 120000) {
                    firstPaint = win.performance.timing.responseStart - navStart;
                    headURLs = {};
                    headElements = doc.getElementsByTagName('head')[0].children;
                    for (i = 0; i < headElements.length; i++) {
                        el = headElements[i];
                        if (el.tagName === 'SCRIPT' && el.src && !el.async) {
                            headURLs[el.src] = true;
                        }
                        if (el.tagName === 'LINK' && el.rel === 'stylesheet' && el.href) {
                            headURLs[el.href] = true;
                        }
                    }
                    requests = win.performance.getEntriesByType('resource');
                    doneCritical = false;
                    for (j = 0; j < requests.length; j++) {
                        if (!doneCritical &&
                            headURLs[requests[j].name] &&
                            (requests[j].initiatorType === 'script' || requests[j].initiatorType === 'link')) {
                            requestEnd = requests[j].responseEnd;
                            if (firstPaint === undefined || requestEnd > firstPaint) {
                                firstPaint = requestEnd;
                            }
                        } else {
                            doneCritical = true;
                        }
                    }
                }
                firstPaint = Math.max(firstPaint, 0);
            };

            // Sort and group all of the paint rects by time and use them to
            // calculate the visual progress
            var calculateVisualProgress = function() {
                var paints = {
                    0: 0
                };
                var total = 0;
                var i;
                var tm;
                var pixels;
                var time;
                var accumulated;
                var j;
                for (i = 0; i < rects.length; i++) {
                    tm = firstPaint;
                    if ('tm' in rects[i] && rects[i].tm > firstPaint) {
                        tm = rects[i].tm;
                    }
                    if (paints[tm] === undefined) {
                        paints[tm] = 0;
                    }
                    paints[tm] += rects[i].area;
                    total += rects[i].area;
                }
                // Add a paint area for the page background (count 10% of the pixels not
                // covered by existing paint rects.
                pixels = Math.max(doc.documentElement.clientWidth, win.innerWidth || 0) *
                    Math.max(doc.documentElement.clientHeight, win.innerHeight || 0);
                if (pixels > 0) {
                    pixels = Math.max(pixels - total, 0) * pageBackgroundWeight;
                    if (paints[firstPaint] === undefined) {
                        paints[firstPaint] = 0;
                    }
                    paints[firstPaint] += pixels;
                    total += pixels;
                }
                // Calculate the visual progress
                if (total) {
                    for (time in paints) {
                        if (paints.hasOwnProperty(time)) {
                            progress.push({
                                tm: time,
                                area: paints[time]
                            });
                        }
                    }
                    progress.sort(function(a, b) {
                        return a.tm - b.tm;
                    });
                    accumulated = 0;
                    for (j = 0; j < progress.length; j++) {
                        accumulated += progress[j].area;
                        progress[j].progress = accumulated / total;
                    }
                }
            };

            // Given the visual progress information, Calculate the speed index.
            var calculateSpeedIndex = function() {
                var lastTime;
                var lastProgress;
                var i;
                var elapsed;
                if (progress.length) {
                    speedIndex = 0;
                    lastTime = 0;
                    lastProgress = 0;
                    for (i = 0; i < progress.length; i++) {
                        elapsed = progress[i].tm - lastTime;
                        if (elapsed > 0 && lastProgress < 1) {
                            speedIndex += (1 - lastProgress) * elapsed;
                        }
                        lastTime = progress[i].tm;
                        lastProgress = progress[i].progress;
                    }
                } else {
                    speedIndex = firstPaint;
                }
            };

            /****************************************************************************
             * Main flow
             ****************************************************************************/
            var rects = [];
            var progress = [];
            var firstPaint;
            var pageBackgroundWeight = 0.1;
            var navStart;
            try {
                navStart = win.performance.timing.navigationStart;
                getRects();
                getRectTimings();
                getFirstPaint();
                calculateVisualProgress();
                calculateSpeedIndex();
            } catch (ex) {}
            /* Debug output for testing
  var dbg = '';
  dbg += "Paint Rects\n";
  for (var i = 0; i < rects.length; i++)
    dbg += '(' + rects[i].area + ') ' + rects[i].tm + ' - ' + rects[i].url + "\n";
  dbg += "Visual Progress\n";
  for (var i = 0; i < progress.length; i++)
    dbg += '(' + progress[i].area + ') ' + progress[i].tm + ' - ' + progress[i].progress + "\n";
  dbg += 'First Paint: ' + firstPaint + "\n";
  dbg += 'Speed Index: ' + SpeedIndex + "\n";
  console.log(dbg);
  */
            return speedIndex;

        },

        complete: false,

        done: function() {
            w.BOOMR.addVar('speedindex', Math.round(this.realUserMetricsSpeedIndex(), 0));
            // no need of sendBeacon because we're called when the beacon is being sent
            this.complete = true;
        }
    };

    w.BOOMR.plugins.speedindex = {
        init: function() {

            if (impl.initialized) {
                return this;
            }

            impl.initialized = true;

            w.BOOMR.subscribe('page_ready', impl.done, null, impl);
            return this;
        },

        // Any other public methods would be defined here

        // jscs:disable requireCamelCaseOrUpperCaseIdentifiers
        is_complete: function() {
            // Always true since we run on before_beacon, which happens after the check
            return impl.complete;
        }
        // jscs:enable requireCamelCaseOrUpperCaseIdentifiers
    };

}(window));
