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

/******************************************************************************
*******************************************************************************
  Calculates the Speed Index for a page by:
  - Collecting a list of visible rectangles for all elements, and marking
    the ones that loaded external resources (images, background images)
  - Gets the time when the external resource for those elements loaded
    through Resource Timing
  - Calculates the likely time that each background painted, substracting rectangles
    that covered it.
    (assuming that rectangles that don't require a resource were painted at first paint)
  - Runs the various paint rectangles through the SpeedIndex calculation:
    https://sites.google.com/a/webpagetest.org/docs/using-webpagetest/metrics/speed-index

  TODO:
  - Improve the start render estimate
  - Detect elements with Custom fonts and the time that the respective font
    loaded
  - Better error handling for browsers that don't support resource timing
*******************************************************************************
******************************************************************************/

var RUMSpeedIndex = function(win) {
  win = win || window;
  var doc = win.document;

  /****************************************************************************
    Support Routines
  ****************************************************************************/
  // Get the rect for the visible portion of the provided DOM element
  var GetElementViewportRect = function(el) {
    var intersect = false;
    if (el.getBoundingClientRect) {
      var elRect = el.getBoundingClientRect();
      intersect = {'top': Math.max(elRect.top, 0),
                       'left': Math.max(elRect.left, 0),
                       'bottom': Math.min(elRect.bottom, (win.innerHeight || doc.documentElement.clientHeight)),
                       'right': Math.min(elRect.right, (win.innerWidth || doc.documentElement.clientWidth))};
      if (intersect.bottom <= intersect.top ||
          intersect.right <= intersect.left) {
        intersect = false;
      } else {
        intersect.area = (intersect.bottom - intersect.top) * (intersect.right - intersect.left);
      }
    }
    return intersect;
  };

  // Analyze the background of an element
  var AnalyzeBackground = function(el, rect) {
    var style = win.getComputedStyle(el)['background'];
    var re = /url\((http.*)\)/ig;
    re.lastIndex = 0;
    var matches = re.exec(style);
    if (matches && matches.length > 1)
      rect.url = matches[1];
    // FIXME: We're ignoring semi-transparent backgrounds here!
    rect.color = (style.indexOf('rgb(') > -1);
    rect.body = (el.tagName == 'BODY');
  };

  // Walk the DOM and check all the elements
  var WalkTheDOM = function(parentRect, el) {
    if (!parentRect.children)
      parentRect.children = [];
    var rect = GetElementViewportRect(el);
    if (!rect)
        return;
    if (el.tagName == 'IMG') {
      rect.url = el.src;
    } else if (el.tagName == 'IFRAME') {
      // Recursively calculate the score for iframes
      rect.tm = RUMSpeedIndex(el.contentWindow);
      rect.iframe = true;
    } else {
      AnalyzeBackground(el, rect);
    }
    parentRect.children.push(rect);

    for (var i = 0; i < el.children.length; ++i)
      WalkTheDOM(rect, el.children[i]);
  };

  // Walk the rectangle representing the elements and calculate their area
  var WalkTheRects = function(rect) {
    var childrenSum = 0;
    if (rect.children)
      for (var i = 0; i < rect.children.length; ++i)
        childrenSum += WalkTheRects(rect.children[i]);
    rect.area = Math.max(rect.area - childrenSum, 0);
    var returnValue = childrenSum;
    // We're ignoring seamless iframes here, since it's not really a thing
    if (rect.color || rect.url || rect.body || rect.iframe)
      returnValue += rect.area;
    return returnValue;
  };

  // Push all the rectangles into an array
  var FlattenRects = function(rect) {
    if (rect.color || rect.url || rect.body || rect.iframe)
      rects.push(rect);
    if (!rect.children)
      return;
    for (var i = 0; i < rect.children.length; ++i)
      FlattenRects(rect.children[i]);
  };

  // Get the visible rectangles for elements that we care about
  var GetRects = function() {
    var bodyRect = {};
    WalkTheDOM(bodyRect, win.document.body);
    WalkTheRects(bodyRect);
    FlattenRects(bodyRect);
  };

  // Get the time at which each external resource loaded
  var GetRectTimings = function() {
    var timings = {};
    var requests = win.performance.getEntriesByType("resource");
    for (var i = 0; i < requests.length; i++)
      timings[requests[i].name] = requests[i].responseEnd;
    for (var j = 0; j < rects.length; j++) {
      if (!('tm' in rects[j]))
        rects[j].tm = timings[rects[j].url] !== undefined ? timings[rects[j].url] : 0;
    }
  };

  // Get the first paint time.
  var GetFirstPaint = function() {
    // If the browser supports a first paint event, just use what the browser reports
    if ('msFirstPaint' in win.performance.timing)
      firstPaint = win.performance.timing.msFirstPaint - navStart;
    if ('chrome' in win && 'loadTimes' in win.chrome) {
      var chromeTimes = win.chrome.loadTimes();
      if ('firstPaintTime' in chromeTimes && chromeTimes.firstPaintTime > 0) {
        var startTime = chromeTimes.startLoadTime;
        if ('requestTime' in chromeTimes)
          startTime = chromeTimes.requestTime;
        if (chromeTimes.firstPaintTime >= startTime)
          firstPaint = (chromeTimes.firstPaintTime - startTime) * 1000.0;
      }
    }
    // For browsers that don't support first-paint or where we get insane values,
    // use the time of the last non-async script or css from the head.
    if (firstPaint === undefined || firstPaint < 0 || firstPaint > 120000) {
      firstPaint = win.performance.timing.responseStart - navStart;
      var headURLs = {};
      var headElements = doc.getElementsByTagName('head')[0].children;
      for (var i = 0; i < headElements.length; i++) {
        var el = headElements[i];
        if (el.tagName == 'SCRIPT' && el.src && !el.async)
          headURLs[el.src] = true;
        if (el.tagName == 'LINK' && el.rel == 'stylesheet' && el.href)
          headURLs[el.href] = true;
      }
      var requests = win.performance.getEntriesByType("resource");
      var doneCritical = false;
      for (var j = 0; j < requests.length; j++) {
        if (!doneCritical &&
            headURLs[requests[j].name] &&
           (requests[j].initiatorType == 'script' || requests[j].initiatorType == 'link')) {
          var requestEnd = requests[j].responseEnd;
          if (firstPaint === undefined || requestEnd > firstPaint)
            firstPaint = requestEnd;
        } else {
          doneCritical = true;
        }
      }
    }
    firstPaint = Math.max(firstPaint, 0);
  };

  // Sort and group all of the paint rects by time and use them to
  // calculate the visual progress
  var CalculateVisualProgress = function() {
    var paints = {'0':0};
    var total = 0;
    for (var i = 0; i < rects.length; i++) {
      var tm = firstPaint;
      if ('tm' in rects[i] && rects[i].tm > firstPaint)
        tm = rects[i].tm;
      if (paints[tm] === undefined)
        paints[tm] = 0;
      paints[tm] += rects[i].area;
      total += rects[i].area;
    }
    // Add a paint area for the page background
    var pixels = Math.max(doc.documentElement.clientWidth, win.innerWidth || 0) *
                 Math.max(doc.documentElement.clientHeight, win.innerHeight || 0);
    if (pixels != total)
        console.log('Number of pixels does not add up ' + pixels + ' != ' + total);
    // Calculate the visual progress
    if (total) {
      for (var time in paints) {
        if (paints.hasOwnProperty(time)) {
          progress.push({'tm': time, 'area': paints[time]});
        }
      }
      progress.sort(function(a,b){return a.tm - b.tm;});
      var accumulated = 0;
      for (var j = 0; j < progress.length; j++) {
        accumulated += progress[j].area;
        progress[j].progress = accumulated / total;
      }
    }
  };

  // Given the visual progress information, Calculate the speed index.
  var CalculateSpeedIndex = function() {
    if (progress.length) {
      SpeedIndex = 0;
      var lastTime = 0;
      var lastProgress = 0;
      for (var i = 0; i < progress.length; i++) {
        var elapsed = progress[i].tm - lastTime;
        if (elapsed > 0 && lastProgress < 1)
          SpeedIndex += (1 - lastProgress) * elapsed;
        lastTime = progress[i].tm;
        lastProgress = progress[i].progress;
      }
    } else {
      SpeedIndex = firstPaint;
    }
  };

  /****************************************************************************
    Main flow
  ****************************************************************************/
  var rects = [];
  var progress = [];
  var firstPaint;
  var SpeedIndex;
  try {
    var navStart = win.performance.timing.navigationStart;
    GetRects();
    GetRectTimings();
    GetFirstPaint();
    CalculateVisualProgress();
    CalculateSpeedIndex();
  } catch(e) {
  }
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
  return SpeedIndex;
};
