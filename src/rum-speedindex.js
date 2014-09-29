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
  - Collecting a list of visible rectangles for elements that loaded
    external resources (images, background images, fonts)
  - Gets the time when the external resource for those elements loaded
    through Resource Timing
  - Calculates the likely time that the background painted
  - Runs the various paint rectangles through the SpeedIndex calculation:
    https://sites.google.com/a/webpagetest.org/docs/using-webpagetest/metrics/speed-index
    
  TODO:
  - Improve the start render estimate
  - Handle overlapping rects (though maybe counting the area as multiple paints
    will work out well)
  - Detect elements with Custom fonts and the time that the respective font
    loaded
  - Better error handling for browsers that don't support resource timing
*******************************************************************************
******************************************************************************/

var RUMSpeedIndex = function() {
  /****************************************************************************
    Support Routines
  ****************************************************************************/
  var GetResourceTimings = function() {
    // Get all of the available resource timings and store them in an
    // indexed object for faster lookup.
    var requests = window.performance.getEntriesByType("resource");
    for (i = 0; i < requests.length; i++) {
      var url = requests[i].name;
    }
        if (window.performance.getEntriesByType)
            var requests = window.performance.getEntriesByType("resource");
        else
            var requests = window.performance.webkitGetEntriesByType("resource");
        var detected = false;
        var data = {'browser': wptBrowser,
                    'jsCached': false,
                    'cookiePresent': false,
                    'existingSession' : false,
                    'localStoragePresent' : false,
                    'jsTime': 0};
        for (i = 0; i < requests.length; i++) {
            var url = requests[i].name;
            if (requests[i].name.indexOf('site.js') != -1) {
                detected = true;
                if (requests[i].responseStart == 0 ||
                    requests[i].responseStart == requests[i].requestStart)
                    data.jsCached = true;
                data.jsTime = Math.round(requests[i].duration);
            }
        }
    
  };
  
  // Get the rect for the visible portion of the provided DOM element
  var GetElementViewportRect = function(el) {
    var intersect = false;
    if (el.getBoundingClientRect) {
      var elRect = el.getBoundingClientRect();
      var intersect = {'top': Math.max(elRect.top, 0),
                       'left': Math.max(elRect.left, 0),
                       'bottom': Math.min(elRect.bottom, (window.innerHeight || document.documentElement.clientHeight)),
                       'right': Math.min(elRect.right, (window.innerWidth || document.documentElement.clientWidth))};
      if (intersect.bottom <= intersect.top ||
          intersect.right <= intersect.left) {
        intersect = false;
      } else {
        intersect['area'] = (intersect.bottom - intersect.top) * (intersect.right - intersect.left);
      }
    }
    return intersect;
  };
  
  // Check a given element to see if it is visible
  var CheckElement = function(el, url) {
    if (url) {
      var rect = GetElementViewportRect(el);
      if (rect) {
        rects.push({'url': url,
                     'area': rect['area'],
                     'rect': rect});
      }
    }
  }

  // Get the visible rectangles for elements that we care about
  var GetRects = function() {
    // Walk all of the elements in the DOM (try to only do this once)
    var elements = document.getElementsByTagName('*');
    var re = /url\((http.*)\)/ig;
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var style = window.getComputedStyle(el);
      
      // check for Images
      if (el.tagName == 'IMG') {
        CheckElement(el, el.src);
      }
      // Check for background images
      if (style['background-image']) {
        var backgroundImage = style['background-image'];
        var matches = re.exec(style['background-image']);
        if (matches && matches.length > 1)
          CheckElement(el, matches[1]);
      }
    }
  };
  
  // Get the time at which each external resource loaded
  var GetRectTimings = function() {
    var timings = {};
    var requests = window.performance.getEntriesByType("resource");
    for (var i = 0; i < requests.length; i++)
      timings[requests[i].name] = requests[i].responseEnd;
    for (var i = 0; i < rects.length; i++) {
      if (timings[rects[i].url] !== undefined)
        rects[i]['tm'] = timings[rects[i].url];
    }
  };
  
  // Get the first paint time.  For now just use the browser-reported
  // time but we can do a lot better if we look at the font load times
  // and the load times of all of the head resources.
  var GetFirstPaint = function() {
  };

  /****************************************************************************
    Main flow
  ****************************************************************************/
  var rects = [];
  var firstPaint = undefined;
  try {
    GetRects();
    GetRectTimings();
    GetFirstPaint();
  } catch(e) {
  }
  return rects;
};

// Just here for testing for now
RUMSpeedIndex();